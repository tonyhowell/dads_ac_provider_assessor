import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.ts';
import { openDb } from './openDb.ts';
import { createApp } from './app.ts';
import { NotesError } from './interviewNotes.ts';
import { countUsers, createUser, issueEnrolment } from './users.ts';

const config = loadConfig();
const db = await openDb(config);

// First run: with no users yet, create the bootstrap admin and print their one-time enrolment link.
if (config.bootstrapAdmin && (await countUsers(db)) === 0) {
  const user = await createUser(db, { username: config.bootstrapAdmin, display_name: config.bootstrapAdmin, role: 'admin' });
  const token = await issueEnrolment(db, user.id, null);
  console.log(`[bootstrap] Created admin "${user.username}". Set up their passkey within 24 hours at:\n  ${config.origin}/enrol/${token}`);
}

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

const shutdown = async () => {
  await db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
