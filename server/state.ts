import type { Db } from './db.ts';
import { initialState, legacyProviderEdits, migrate as migrateState, reducer, type AppState } from '../src/state/reducer.ts';
import type { Action } from '../src/state/actions.ts';
import { loadSeedData } from '../src/data/load.ts';
import type { User } from './users.ts';
import { createApplication } from './applications.ts';
import { upsertCatalogue } from './catalogue.ts';

export interface VersionedState {
  version: number;
  state: AppState;
}

/** A new application's starting state: the starter pack's shortlist is not carried over, so each applicant starts clean. */
export function freshState(now: Date = new Date()): AppState {
  const seed = loadSeedData();
  return initialState([], seed.providers, now.toISOString());
}

export async function readState(db: Db, applicationId: string): Promise<VersionedState | undefined> {
  const [row] = await db.query<{ version: number; state: unknown }>('SELECT version, state FROM application_state WHERE application_id = $1', [applicationId]);
  if (!row) return undefined;
  return { version: row.version, state: migrateState(row.state) ?? freshState() };
}

/** Server-side facts the browser can't be trusted with: the time, and who did it. */
export function stampAction(action: Action, user: User, now: Date): Action {
  const at = now.toISOString();
  switch (action.type) {
    case 'note/add':
      return { ...action, note: { ...action.note, created_at: at, author: user.display_name } };
    case 'screenNote/add':
      return { ...action, note: { ...action.note, created_at: at, author: user.display_name } };
    case 'specialRate/set':
      return { ...action, rate: { ...action.rate, recorded_at: at, author: user.display_name } };
    case 'note/edit':
    case 'selection/add':
    case 'selection/stage':
    case 'interview/notes':
      return { ...action, at };
    default:
      return action;
  }
}

/**
 * Applies one action to an application's shared state. Actions are serialised by a row lock, so two family
 * members editing at once never overwrite each other — each change applies on top of the latest.
 */
export async function applyAction(db: Db, applicationId: string, action: Action, user: User, now = new Date()): Promise<VersionedState> {
  const stamped = stampAction(action, user, now);
  return db.transaction(async (tx) => {
    const [row] = await tx.query<{ version: number; state: unknown }>('SELECT version, state FROM application_state WHERE application_id = $1 FOR UPDATE', [applicationId]);
    const current = migrateState(row.state) ?? freshState(now);
    const next = reducer(current, stamped);
    const version = row.version + 1;
    await tx.query('UPDATE application_state SET version = $1, state = $2::jsonb, updated_at = now() WHERE application_id = $3', [version, JSON.stringify(next), applicationId]);
    await tx.query('INSERT INTO state_actions (user_id, application_id, action) VALUES ($1, $2, $3::jsonb)', [user.id, applicationId, JSON.stringify(stamped)]);
    return { version, state: next };
  });
}

/**
 * One-off move from v1 (one shared record for everyone) to v2 (applications). The old record becomes the
 * first application: admins become its coordinators and everyone else a contributor, so no one loses the
 * access they had. Provider corrections the family made move into the common catalogue.
 * Does nothing once any application exists.
 */
export async function moveLegacyState(db: Db): Promise<string | undefined> {
  const [{ n }] = await db.query<{ n: string | number }>('SELECT count(*) AS n FROM applications');
  if (Number(n) > 0) return undefined;
  const [legacy] = await db.query<{ version: number; state: unknown }>('SELECT version, state FROM app_state WHERE id = 1');
  if (!legacy) return undefined;
  return db.transaction(async (tx) => {
    const state = migrateState(legacy.state) ?? freshState();
    const p = state.participant;
    const app = await createApplication(tx, { name: p?.name?.trim() || 'First application', suburb: p?.suburb, postcode: p?.postcode }, null, state);
    await tx.query('UPDATE application_state SET version = $1 WHERE application_id = $2', [legacy.version, app.id]);
    await tx.query(
      `INSERT INTO application_members (application_id, user_id, role)
       SELECT $1, id, CASE WHEN role = 'admin' THEN 'coordinator' ELSE 'contributor' END FROM users`,
      [app.id],
    );
    await tx.query(`INSERT INTO membership_log (application_id, subject_id, change) SELECT $1, user_id, 'moved from the shared record as ' || role FROM application_members WHERE application_id = $1`, [app.id]);
    await tx.query('UPDATE state_actions SET application_id = $1 WHERE application_id IS NULL', [app.id]);
    for (const provider of legacyProviderEdits(legacy.state)) await upsertCatalogue(tx, provider, null, 'Moved from family edits (v1)');
    return app.id;
  });
}
