import { randomUUID } from 'node:crypto';
import type { Db, Queryable } from './db.ts';
import type { User } from './users.ts';

// An application is one applicant's assessment. Everything in it (about you, plan, selection, interviews,
// scores, decision) is private to its members; provider data comes from the common catalogue.

export type MemberRole = 'coordinator' | 'contributor' | 'viewer';
export type ApplicationStatus = 'active' | 'decided' | 'archived';

export interface Application {
  id: string;
  name: string;
  suburb: string;
  postcode: string;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
}

export interface Member {
  user_id: string;
  username: string;
  display_name: string;
  role: MemberRole;
  /** False until the person has set up a passkey. */
  enrolled: boolean;
  enrolment_expires_at: string | null;
  disabled: boolean;
  added_at: string;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
const toApp = (r: Record<string, unknown>): Application => ({
  id: r.id as string,
  name: r.name as string,
  suburb: r.suburb as string,
  postcode: r.postcode as string,
  status: r.status as ApplicationStatus,
  created_at: iso(r.created_at)!,
  updated_at: iso(r.updated_at)!,
});

/** Changes need a contributor or coordinator, on an application that isn't archived. */
export const canEdit = (role: MemberRole | undefined, app: Pick<Application, 'status'>) => (role === 'coordinator' || role === 'contributor') && app.status !== 'archived';

export async function createApplication(
  db: Queryable,
  input: { name: string; suburb?: string; postcode?: string },
  createdBy: string | null,
  initialState: unknown,
): Promise<Application> {
  const id = randomUUID();
  const [row] = await db.query(
    'INSERT INTO applications (id, name, suburb, postcode, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [id, input.name.trim(), input.suburb?.trim() ?? '', input.postcode?.trim() ?? '', createdBy],
  );
  await db.query('INSERT INTO application_state (application_id, version, state) VALUES ($1, 0, $2::jsonb)', [id, JSON.stringify(initialState)]);
  return toApp(row);
}

export async function getApplication(db: Queryable, id: string): Promise<Application | undefined> {
  const [row] = await db.query('SELECT * FROM applications WHERE id = $1', [id]);
  return row ? toApp(row) : undefined;
}

export async function updateApplication(
  db: Queryable,
  id: string,
  patch: { name?: string; suburb?: string; postcode?: string; status?: ApplicationStatus },
): Promise<Application | undefined> {
  const [row] = await db.query(
    `UPDATE applications SET name = COALESCE($2, name), suburb = COALESCE($3, suburb), postcode = COALESCE($4, postcode),
       status = COALESCE($5, status), updated_at = now() WHERE id = $1 RETURNING *`,
    [id, patch.name?.trim() ?? null, patch.suburb?.trim() ?? null, patch.postcode?.trim() ?? null, patch.status ?? null],
  );
  return row ? toApp(row) : undefined;
}

export async function getRole(db: Queryable, applicationId: string, userId: string): Promise<MemberRole | undefined> {
  const [row] = await db.query<{ role: MemberRole }>('SELECT role FROM application_members WHERE application_id = $1 AND user_id = $2', [applicationId, userId]);
  return row?.role;
}

/** The applications a person belongs to, with their role and when each last changed. */
export async function listApplicationsFor(db: Queryable, userId: string): Promise<(Application & { role: MemberRole; last_activity: string; members: number })[]> {
  const rows = await db.query(
    `SELECT a.*, m.role, s.updated_at AS last_activity,
       (SELECT count(*) FROM application_members x WHERE x.application_id = a.id) AS members
     FROM application_members m JOIN applications a ON a.id = m.application_id
     LEFT JOIN application_state s ON s.application_id = a.id
     WHERE m.user_id = $1 ORDER BY (a.status = 'archived'), s.updated_at DESC NULLS LAST`,
    [userId],
  );
  return rows.map((r) => ({ ...toApp(r), role: r.role as MemberRole, last_activity: iso(r.last_activity) ?? iso(r.updated_at)!, members: Number(r.members) }));
}

/** Every application, for site admins: details only, never the contents. */
export async function listAllApplications(db: Queryable) {
  const rows = await db.query(
    `SELECT a.*, s.updated_at AS last_activity,
       (SELECT count(*) FROM application_members x WHERE x.application_id = a.id) AS members,
       (SELECT coalesce(json_agg(json_build_object('user_id', u.id, 'display_name', u.display_name, 'username', u.username) ORDER BY u.display_name), '[]'::json)
          FROM application_members x JOIN users u ON u.id = x.user_id WHERE x.application_id = a.id AND x.role = 'coordinator') AS coordinators
     FROM applications a LEFT JOIN application_state s ON s.application_id = a.id
     ORDER BY (a.status = 'archived'), a.created_at DESC`,
  );
  return rows.map((r) => ({
    ...toApp(r),
    last_activity: iso(r.last_activity) ?? iso(r.updated_at)!,
    members: Number(r.members),
    coordinators: (typeof r.coordinators === 'string' ? JSON.parse(r.coordinators) : r.coordinators) as { user_id: string; display_name: string; username: string }[],
  }));
}

/** Each person's applications, for the site admin's people list. */
export async function membershipsByUser(db: Queryable): Promise<Map<string, { application_id: string; name: string; role: MemberRole }[]>> {
  const rows = await db.query<{ user_id: string; application_id: string; name: string; role: MemberRole }>(
    'SELECT m.user_id, m.application_id, a.name, m.role FROM application_members m JOIN applications a ON a.id = m.application_id ORDER BY a.name',
  );
  const out = new Map<string, { application_id: string; name: string; role: MemberRole }[]>();
  for (const r of rows) out.set(r.user_id, [...(out.get(r.user_id) ?? []), { application_id: r.application_id, name: r.name, role: r.role }]);
  return out;
}

export async function listMembers(db: Queryable, applicationId: string): Promise<Member[]> {
  const rows = await db.query(
    `SELECT u.id AS user_id, u.username, u.display_name, u.disabled_at, m.role, m.created_at AS added_at,
       (SELECT count(*) FROM credentials c WHERE c.user_id = u.id) AS passkeys,
       (SELECT max(e.expires_at) FROM enrolments e WHERE e.user_id = u.id AND e.used_at IS NULL AND e.expires_at > now()) AS enrolment_expires_at
     FROM application_members m JOIN users u ON u.id = m.user_id
     WHERE m.application_id = $1
     ORDER BY CASE m.role WHEN 'coordinator' THEN 0 WHEN 'contributor' THEN 1 ELSE 2 END, u.display_name`,
    [applicationId],
  );
  return rows.map((r) => ({
    user_id: r.user_id as string,
    username: r.username as string,
    display_name: r.display_name as string,
    role: r.role as MemberRole,
    enrolled: Number(r.passkeys) > 0,
    enrolment_expires_at: iso(r.enrolment_expires_at),
    disabled: r.disabled_at !== null,
    added_at: iso(r.added_at)!,
  }));
}

export class MembershipError extends Error {
  constructor(
    public status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

async function log(db: Queryable, applicationId: string, actor: string | null, subject: string, change: string) {
  await db.query('INSERT INTO membership_log (application_id, actor_id, subject_id, change) VALUES ($1, $2, $3, $4)', [applicationId, actor, subject, change]);
}

async function coordinatorCount(db: Queryable, applicationId: string): Promise<number> {
  const [r] = await db.query<{ n: string | number }>(`SELECT count(*) AS n FROM application_members WHERE application_id = $1 AND role = 'coordinator'`, [applicationId]);
  return Number(r.n);
}

/** Adds a person, or changes their role if they're already a member. */
export async function setMember(db: Db, applicationId: string, userId: string, role: MemberRole, actor: User | null): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await getRole(tx, applicationId, userId);
    if (before === role) return;
    if (before === 'coordinator' && (await coordinatorCount(tx, applicationId)) <= 1) {
      throw new MembershipError(400, 'An application needs at least one coordinator. Make someone else coordinator first.');
    }
    await tx.query(
      `INSERT INTO application_members (application_id, user_id, role, added_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (application_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [applicationId, userId, role, actor?.id ?? null],
    );
    await log(tx, applicationId, actor?.id ?? null, userId, before ? `role ${before} → ${role}` : `added as ${role}`);
  });
}

export async function removeMember(db: Db, applicationId: string, userId: string, actor: User | null): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await getRole(tx, applicationId, userId);
    if (!before) throw new MembershipError(404, 'That person is not in this application.');
    if (before === 'coordinator' && (await coordinatorCount(tx, applicationId)) <= 1) {
      throw new MembershipError(400, 'An application needs at least one coordinator. Make someone else coordinator first.');
    }
    await tx.query('DELETE FROM application_members WHERE application_id = $1 AND user_id = $2', [applicationId, userId]);
    await log(tx, applicationId, actor?.id ?? null, userId, `removed (was ${before})`);
  });
}
