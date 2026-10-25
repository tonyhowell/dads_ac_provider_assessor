import type { Db } from './db.ts';
import { initialState, migrate as migrateState, reducer, type AppState } from '../src/state/reducer.ts';
import type { Action } from '../src/state/actions.ts';
import { loadSeedData } from '../src/data/load.ts';
import type { User } from './users.ts';

export interface VersionedState {
  version: number;
  state: AppState;
}

function fresh(now: Date): AppState {
  const seed = loadSeedData();
  return initialState(seed.shortlist, seed.providers, now.toISOString());
}

export async function readState(db: Db): Promise<VersionedState> {
  const [row] = await db.query<{ version: number; state: unknown }>('SELECT version, state FROM app_state WHERE id = 1');
  if (!row) return { version: 0, state: fresh(new Date()) };
  return { version: row.version, state: migrateState(row.state) ?? fresh(new Date()) };
}

/** Server-side facts the browser can't be trusted with: the time, and who did it. */
export function stampAction(action: Action, user: User, now: Date): Action {
  const at = now.toISOString();
  switch (action.type) {
    case 'note/add':
      return { ...action, note: { ...action.note, created_at: at, author: user.display_name } };
    case 'screenNote/add':
      return { ...action, note: { ...action.note, created_at: at, author: user.display_name } };
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
 * Applies one action to the shared state. Actions are serialised by a row lock, so two family
 * members editing at once never overwrite each other — each change applies on top of the latest.
 */
export async function applyAction(db: Db, action: Action, user: User, now = new Date()): Promise<VersionedState> {
  const stamped = stampAction(action, user, now);
  return db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO app_state (id, version, state) VALUES (1, 0, $1::jsonb) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(fresh(now))],
    );
    const [row] = await tx.query<{ version: number; state: unknown }>('SELECT version, state FROM app_state WHERE id = 1 FOR UPDATE');
    const current = migrateState(row.state) ?? fresh(now);
    const next = reducer(current, stamped);
    const version = row.version + 1;
    await tx.query('UPDATE app_state SET version = $1, state = $2::jsonb, updated_at = now() WHERE id = 1', [version, JSON.stringify(next)]);
    await tx.query('INSERT INTO state_actions (user_id, action) VALUES ($1, $2::jsonb)', [user.id, JSON.stringify(stamped)]);
    return { version, state: next };
  });
}
