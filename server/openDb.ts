import type { Config } from './config.ts';
import { createPgliteDb, createPostgresDb, migrate, type Db } from './db.ts';

export async function openDb(config: Config): Promise<Db> {
  const db = config.databaseUrl ? createPostgresDb(config.databaseUrl) : await createPgliteDb(config.dataDir);
  await migrate(db);
  return db;
}
