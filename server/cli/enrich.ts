// Usage: npm run enrich -- [--only prices,sources,claims] [--max-research N] [--provider <id>]...
// Runs one data check against the configured database and prints what it did and roughly what it cost.
// Suits a cron job (e.g. a Railway cron service with the same DATABASE_URL and ANTHROPIC_API_KEY).
import Anthropic from '@anthropic-ai/sdk';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { openDb } from '../openDb.ts';
import { catalogueEdits } from '../catalogue.ts';
import { ENRICH_PARTS, EnrichmentBusyError, runEnrichment, type EnrichPart } from '../enrich.ts';
import { effectiveProviders } from '../../src/state/reducer.ts';
import { loadSeedData } from '../../src/data/load.ts';

const { values } = parseArgs({
  options: { only: { type: 'string' }, 'max-research': { type: 'string' }, provider: { type: 'string', multiple: true } },
});
const parts = values.only?.split(',').map((p) => p.trim()) as EnrichPart[] | undefined;
if (parts?.some((p) => !ENRICH_PARTS.includes(p))) {
  console.error(`--only takes a comma-separated list of: ${ENRICH_PARTS.join(', ')}`);
  process.exit(1);
}

const config = loadConfig();
if (!config.anthropicApiKey) {
  console.error('Set ANTHROPIC_API_KEY first.');
  process.exit(1);
}
const db = await openDb(config);
const seed = loadSeedData();
const client = new Anthropic({ apiKey: config.anthropicApiKey });
try {
  const run = await runEnrichment(
    {
      db,
      getAnthropic: () => client,
      providers: async () => effectiveProviders(seed.providers, (await catalogueEdits(db)).providers),
      topics: seed.interviewSections.flatMap((s) => s.questions.map((q) => ({ id: q.id, text: q.text }))),
    },
    { trigger: 'cli', parts, maxResearch: values['max-research'] ? Number(values['max-research']) : config.enrichMaxResearch, providerIds: values.provider },
  );
  for (const line of run.log) console.log(`- ${line}`);
  console.log(`\n${run.status}: ${JSON.stringify(run.stats, null, 2)}`);
  console.log(`Estimated cost: US$${'estimated_cost_usd' in run.usage ? run.usage.estimated_cost_usd : 0}`);
  process.exitCode = run.status === 'done' ? 0 : 1;
} catch (err) {
  console.error(err instanceof EnrichmentBusyError ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.close();
}
