export interface Config {
  port: number;
  /** Public origin users visit, e.g. https://assessor.quantivate.com.au. Passkeys are bound to it. */
  origin: string;
  /** WebAuthn relying-party ID: the origin's hostname. */
  rpID: string;
  rpName: string;
  /** Postgres connection string. Unset = embedded PGlite in `dataDir`. */
  databaseUrl?: string;
  dataDir: string;
  anthropicApiKey?: string;
  /** Username to create as the first admin when the database has no users. */
  bootstrapAdmin?: string;
  production: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const origin = (env.APP_ORIGIN ?? (production ? '' : 'http://localhost:5173')).replace(/\/$/, '');
  if (!origin) throw new Error('APP_ORIGIN must be set in production (e.g. https://assessor.quantivate.com.au)');
  return {
    port: Number(env.PORT ?? 3000),
    origin,
    rpID: env.RP_ID ?? new URL(origin).hostname,
    rpName: env.RP_NAME ?? 'Provider Assessor',
    databaseUrl: env.DATABASE_URL || undefined,
    dataDir: env.DATA_DIR ?? '.data/pglite',
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    bootstrapAdmin: env.BOOTSTRAP_ADMIN_USERNAME?.trim() || undefined,
    production,
  };
}
