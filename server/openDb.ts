import type { Config } from './config.ts';
import { createPgliteDb, createPostgresDb, migrate, type Db } from './db.ts';
import { moveLegacyState } from './state.ts';

export async function openDb(config: Config): Promise<Db> {
  const db = config.databaseUrl ? createPostgresDb(config.databaseUrl) : await createPgliteDb(config.dataDir);
  await migrate(db);
  const moved = await moveLegacyState(db);
  if (moved) console.log(`[migrate] Moved the shared record into the first application (${moved}).`);
  return db;
}
