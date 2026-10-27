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
  /** Run the data check this often (hours). Unset = only when an admin or the command line runs it. */
  enrichEveryHours?: number;
  /** Most full web searches for public claims in one scheduled run. */
  enrichMaxResearch: number;
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
    enrichEveryHours: Number(env.ENRICH_EVERY_HOURS) > 0 ? Number(env.ENRICH_EVERY_HOURS) : undefined,
    enrichMaxResearch: Number.isFinite(Number(env.ENRICH_MAX_RESEARCH)) && env.ENRICH_MAX_RESEARCH ? Math.max(0, Number(env.ENRICH_MAX_RESEARCH)) : 3,
    production,
  };
}
