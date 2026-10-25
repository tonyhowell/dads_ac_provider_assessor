import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

/** The few database operations the server needs, so Postgres (Railway) and PGlite (local, tests) are interchangeable. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createPostgresDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    // Railway's internal network doesn't use TLS; its public proxy does.
    ssl: /sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  return {
    async query(sql, params) {
      return (await pool.query(sql, params)).rows;
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: async (sql, params) => (await client.query(sql, params)).rows });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Embedded Postgres. `dataDir` undefined = in-memory (tests). */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = await PGlite.create(dataDir);
  return {
    async query(sql, params) {
      return (await db.query(sql, params)).rows as never;
    },
    transaction: (fn) => db.transaction((tx) => fn({ query: async (sql, params) => (await tx.query(sql, params)).rows as never })),
    close: () => db.close(),
  };
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id text PRIMARY KEY,
    username text NOT NULL UNIQUE,
    display_name text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'member')),
    webauthn_user_id text NOT NULL UNIQUE,
    disabled_at timestamptz,
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE credentials (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key bytea NOT NULL,
    counter bigint NOT NULL,
    transports jsonb NOT NULL DEFAULT '[]',
    device_type text,
    backed_up boolean NOT NULL DEFAULT false,
    nickname text NOT NULL DEFAULT '',
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX credentials_user_idx ON credentials(user_id);
  CREATE TABLE enrolments (
    token_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by text REFERENCES users(id) ON DELETE SET NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    user_agent text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE auth_challenges (
    id text PRIMARY KEY,
    challenge text NOT NULL,
    purpose text NOT NULL CHECK (purpose IN ('register', 'authenticate')),
    user_id text REFERENCES users(id) ON DELETE CASCADE,
    enrolment_token_hash text,
    expires_at timestamptz NOT NULL
  );
  CREATE TABLE app_state (
    id integer PRIMARY KEY CHECK (id = 1),
    version integer NOT NULL,
    state jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE state_actions (
    id bigserial PRIMARY KEY,
    user_id text REFERENCES users(id) ON DELETE SET NULL,
    action jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  `,
  // v2: applications (one applicant's assessment each), their members and shared state, and a common provider catalogue.
  `
  CREATE TABLE applications (
    id text PRIMARY KEY,
    name text NOT NULL,
    suburb text NOT NULL DEFAULT '',
    postcode text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'decided', 'archived')),
    created_by text REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE application_members (
    application_id text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('coordinator', 'contributor', 'viewer')),
    added_by text REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (application_id, user_id)
  );
  CREATE INDEX application_members_user_idx ON application_members(user_id);
  CREATE TABLE application_state (
    application_id text PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
    version integer NOT NULL,
    state jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE state_actions ADD COLUMN application_id text REFERENCES applications(id) ON DELETE CASCADE;
  CREATE INDEX state_actions_application_idx ON state_actions(application_id, id);
  CREATE TABLE membership_log (
    id bigserial PRIMARY KEY,
    application_id text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    actor_id text REFERENCES users(id) ON DELETE SET NULL,
    subject_id text REFERENCES users(id) ON DELETE SET NULL,
    change text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE provider_catalogue (
    id text PRIMARY KEY,
    provider jsonb NOT NULL,
    updated_by text REFERENCES users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE provider_history (
    id bigserial PRIMARY KEY,
    provider_id text NOT NULL,
    provider jsonb,
    change text NOT NULL,
    user_id text REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX provider_history_provider_idx ON provider_history(provider_id, id);
  CREATE TABLE provider_suggestions (
    id text PRIMARY KEY,
    provider_id text NOT NULL,
    is_new boolean NOT NULL DEFAULT false,
    current jsonb,
    proposed jsonb NOT NULL,
    note text NOT NULL DEFAULT '',
    application_id text REFERENCES applications(id) ON DELETE SET NULL,
    user_id text REFERENCES users(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    decided_by text REFERENCES users(id) ON DELETE SET NULL,
    decision_note text NOT NULL DEFAULT '',
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX provider_suggestions_status_idx ON provider_suggestions(status, created_at)
  `,
];

/** Applies any migrations not yet recorded. Safe to run on every start. */
export async function migrate(db: Db): Promise<void> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => r.version));
  for (const [i, sql] of MIGRATIONS.entries()) {
    const version = i + 1;
    if (done.has(version)) continue;
    await db.transaction(async (tx) => {
      for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await tx.query(statement);
      await tx.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
  }
}
