import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db, Queryable } from './db.ts';

export type Role = 'admin' | 'member';

export interface User {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  webauthn_user_id: string;
  disabled_at: string | null;
  last_login_at: string | null;
  created_at: string;
}

export interface StoredCredential {
  id: string;
  user_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string[];
  device_type: string | null;
  backed_up: boolean;
  nickname: string;
  last_used_at: string | null;
  created_at: string;
}

export const ENROLMENT_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Opaque random token for links and cookies. Only its hash is stored. */
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
export const normaliseUsername = (u: string) => u.trim().toLowerCase();

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
function toUser(r: Record<string, unknown>): User {
  return {
    ...(r as unknown as User),
    disabled_at: iso(r.disabled_at),
    last_login_at: iso(r.last_login_at),
    created_at: iso(r.created_at)!,
  };
}
function toCredential(r: Record<string, unknown>): StoredCredential {
  return {
    ...(r as unknown as StoredCredential),
    public_key: new Uint8Array(r.public_key as Uint8Array),
    counter: Number(r.counter),
    last_used_at: iso(r.last_used_at),
    created_at: iso(r.created_at)!,
  };
}

export async function countUsers(db: Queryable): Promise<number> {
  const [r] = await db.query<{ n: string | number }>('SELECT count(*) AS n FROM users');
  return Number(r.n);
}

export async function createUser(db: Queryable, input: { username: string; display_name: string; role: Role }): Promise<User> {
  const [row] = await db.query(
    `INSERT INTO users (id, username, display_name, role, webauthn_user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [randomUUID(), normaliseUsername(input.username), input.display_name.trim(), input.role, randomBytes(32).toString('base64url')],
  );
  return toUser(row);
}

export async function getUser(db: Queryable, id: string): Promise<User | undefined> {
  const [row] = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return row ? toUser(row) : undefined;
}

export async function getUserByUsername(db: Queryable, username: string): Promise<User | undefined> {
  const [row] = await db.query('SELECT * FROM users WHERE username = $1', [normaliseUsername(username)]);
  return row ? toUser(row) : undefined;
}

export async function updateUser(
  db: Queryable,
  id: string,
  patch: { display_name?: string; role?: Role; disabled?: boolean },
): Promise<User | undefined> {
  const [row] = await db.query(
    `UPDATE users SET
       display_name = COALESCE($2, display_name),
       role = COALESCE($3, role),
       disabled_at = CASE WHEN $4::boolean IS NULL THEN disabled_at WHEN $4::boolean THEN COALESCE(disabled_at, now()) ELSE NULL END
     WHERE id = $1 RETURNING *`,
    [id, patch.display_name?.trim() ?? null, patch.role ?? null, patch.disabled ?? null],
  );
  return row ? toUser(row) : undefined;
}

export async function countActiveAdmins(db: Queryable): Promise<number> {
  const [r] = await db.query<{ n: string | number }>(`SELECT count(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL`);
  return Number(r.n);
}

export interface UserSummary extends User {
  passkeys: number;
  enrolment_expires_at: string | null;
}

export async function listUsers(db: Queryable): Promise<UserSummary[]> {
  const rows = await db.query(
    `SELECT u.*,
       (SELECT count(*) FROM credentials c WHERE c.user_id = u.id) AS passkeys,
       (SELECT max(e.expires_at) FROM enrolments e WHERE e.user_id = u.id AND e.used_at IS NULL AND e.expires_at > now()) AS enrolment_expires_at
     FROM users u ORDER BY u.created_at`,
  );
  return rows.map((r) => ({ ...toUser(r), passkeys: Number(r.passkeys), enrolment_expires_at: iso(r.enrolment_expires_at) }));
}

// --- Enrolment links ---

/** Issues a one-time enrolment token, replacing any unused one for this user. Returns the raw token. */
export async function issueEnrolment(db: Db, userId: string, createdBy: string | null, now = new Date()): Promise<string> {
  const token = newToken();
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM enrolments WHERE user_id = $1 AND used_at IS NULL', [userId]);
    await tx.query('INSERT INTO enrolments (token_hash, user_id, created_by, expires_at) VALUES ($1, $2, $3, $4)', [
      hashToken(token),
      userId,
      createdBy,
      new Date(now.getTime() + ENROLMENT_TTL_MS),
    ]);
  });
  return token;
}

/** The user an enrolment token belongs to, if the token is unused, unexpired and the user enabled. */
export async function findEnrolment(db: Queryable, token: string): Promise<{ user: User; expires_at: string } | undefined> {
  const [row] = await db.query(
    `SELECT u.*, e.expires_at AS enrolment_expires_at FROM enrolments e JOIN users u ON u.id = e.user_id
     WHERE e.token_hash = $1 AND e.used_at IS NULL AND e.expires_at > now() AND u.disabled_at IS NULL`,
    [hashToken(token)],
  );
  return row ? { user: toUser(row), expires_at: iso(row.enrolment_expires_at)! } : undefined;
}

export async function markEnrolmentUsed(db: Queryable, token: string): Promise<void> {
  await db.query('UPDATE enrolments SET used_at = now() WHERE token_hash = $1', [hashToken(token)]);
}

// --- Passkeys ---

export async function listCredentials(db: Queryable, userId: string): Promise<StoredCredential[]> {
  return (await db.query('SELECT * FROM credentials WHERE user_id = $1 ORDER BY created_at', [userId])).map(toCredential);
}

export async function getCredential(db: Queryable, id: string): Promise<StoredCredential | undefined> {
  const [row] = await db.query('SELECT * FROM credentials WHERE id = $1', [id]);
  return row ? toCredential(row) : undefined;
}

export async function addCredential(
  db: Queryable,
  c: Pick<StoredCredential, 'id' | 'user_id' | 'public_key' | 'counter' | 'transports' | 'device_type' | 'backed_up' | 'nickname'>,
): Promise<void> {
  await db.query(
    `INSERT INTO credentials (id, user_id, public_key, counter, transports, device_type, backed_up, nickname)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [c.id, c.user_id, c.public_key, c.counter, JSON.stringify(c.transports), c.device_type, c.backed_up, c.nickname],
  );
}

export async function recordCredentialUse(db: Queryable, id: string, counter: number, backedUp: boolean): Promise<void> {
  await db.query('UPDATE credentials SET counter = $2, backed_up = $3, last_used_at = now() WHERE id = $1', [id, counter, backedUp]);
}

export async function deleteCredential(db: Queryable, id: string): Promise<boolean> {
  return (await db.query('DELETE FROM credentials WHERE id = $1 RETURNING id', [id])).length > 0;
}

// --- Sessions ---

export async function createSession(db: Queryable, userId: string, userAgent: string, now = new Date()): Promise<string> {
  const token = newToken();
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)', [
    hashToken(token),
    userId,
    new Date(now.getTime() + SESSION_TTL_MS),
    userAgent.slice(0, 300),
  ]);
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  return token;
}

/** The signed-in user for a session token, if the session is live and the user enabled. */
export async function userForSession(db: Queryable, token: string): Promise<User | undefined> {
  const [row] = await db.query(
    `UPDATE sessions s SET last_seen_at = now() FROM users u
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.id = s.user_id AND u.disabled_at IS NULL
     RETURNING u.*`,
    [hashToken(token)],
  );
  return row ? toUser(row) : undefined;
}

export async function deleteSession(db: Queryable, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function deleteUserSessions(db: Queryable, userId: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

// --- WebAuthn challenges ---

export async function saveChallenge(
  db: Queryable,
  c: { challenge: string; purpose: 'register' | 'authenticate'; user_id: string | null; enrolment_token_hash?: string },
  now = new Date(),
): Promise<string> {
  const id = newToken();
  await db.query('DELETE FROM auth_challenges WHERE expires_at < now()');
  await db.query(
    'INSERT INTO auth_challenges (id, challenge, purpose, user_id, enrolment_token_hash, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, c.challenge, c.purpose, c.user_id, c.enrolment_token_hash ?? null, new Date(now.getTime() + CHALLENGE_TTL_MS)],
  );
  return id;
}

/** Fetches and deletes a challenge: each one can be used once. */
export async function takeChallenge(
  db: Queryable,
  id: string,
  purpose: 'register' | 'authenticate',
): Promise<{ challenge: string; user_id: string | null; enrolment_token_hash: string | null } | undefined> {
  const [row] = await db.query<{ challenge: string; user_id: string | null; enrolment_token_hash: string | null }>(
    'DELETE FROM auth_challenges WHERE id = $1 AND purpose = $2 AND expires_at > now() RETURNING challenge, user_id, enrolment_token_hash',
    [id, purpose],
  );
  return row;
}
