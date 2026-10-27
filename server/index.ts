import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.ts';
import { openDb } from './openDb.ts';
import { createApp } from './app.ts';
import { NotesError } from './interviewNotes.ts';
import { countUsers, createUser, issueEnrolment } from './users.ts';
import { EnrichmentBusyError, recoverAfterRestart, runEnrichment } from './enrich.ts';
import { effectiveProviders } from '../src/state/reducer.ts';
import { loadSeedData } from '../src/data/load.ts';
import { catalogueEdits } from './catalogue.ts';

const config = loadConfig();
const db = await openDb(config);

// First run: with no users yet, create the bootstrap admin and print their one-time enrolment link.
if (config.bootstrapAdmin && (await countUsers(db)) === 0) {
  const user = await createUser(db, { username: config.bootstrapAdmin, display_name: config.bootstrapAdmin, role: 'admin' });
  const token = await issueEnrolment(db, user.id, null);
  console.log(`[bootstrap] Created admin "${user.username}". Set up their passkey within 24 hours at:\n  ${config.origin}/enrol/${token}`);
}

// Nothing the server was doing before it restarted is still running.
await recoverAfterRestart(db);

let anthropic: Anthropic | undefined;
const app = createApp({
  db,
  config,
  getAnthropic: config.anthropicApiKey
    ? () => (anthropic ??= new Anthropic({ apiKey: config.anthropicApiKey }))
    : () => {
        throw new NotesError(503, 'Claude features (notes, summaries, public claims) are not configured: set ANTHROPIC_API_KEY on the server.');
      },
});

// The built React app; any non-API path falls back to index.html for client-side routing.
app.use('/assets/*', serveStatic({ root: './dist' }));
app.use('*', serveStatic({ root: './dist' }));
app.get('*', serveStatic({ root: './dist', path: 'index.html' }));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Provider Assessor listening on port ${info.port} (${config.origin})`);
});

// Scheduled data check (ENRICH_EVERY_HOURS). It only spends tokens on pages that changed, so a daily run is cheap.
if (config.enrichEveryHours && config.anthropicApiKey) {
  const seed = loadSeedData();
  const deps = {
    db,
    getAnthropic: () => (anthropic ??= new Anthropic({ apiKey: config.anthropicApiKey })),
    providers: async () => effectiveProviders(seed.providers, (await catalogueEdits(db)).providers),
    topics: seed.interviewSections.flatMap((s) => s.questions.map((q) => ({ id: q.id, text: q.text }))),
  };
  const tick = async () => {
    try {
      const run = await runEnrichment(deps, { trigger: 'schedule', maxResearch: config.enrichMaxResearch });
      console.log(`[enrich] ${run.status}: ${JSON.stringify(run.stats)} · est. US$${'estimated_cost_usd' in run.usage ? run.usage.estimated_cost_usd : 0}`);
    } catch (err) {
      if (!(err instanceof EnrichmentBusyError)) console.error('[enrich]', err);
    }
  };
  // First run 10 minutes after start, so a deploy doesn't pay for a check straight away.
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), config.enrichEveryHours! * 3_600_000).unref();
  }, 10 * 60_000).unref();
  console.log(`[enrich] Data check every ${config.enrichEveryHours} hours.`);
}

const shutdown = async () => {
  await db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
