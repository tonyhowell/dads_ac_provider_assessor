import type { Db, Queryable } from './db.ts';
import { readPrices, type EnrichDeps } from './enrich.ts';
import { UsageTally } from './usage.ts';
import type { Provider } from '../src/types.ts';

// Reading a provider's prices when a family shortlists it: find the price list if there's no link (one small
// search), read it with Claude Haiku, and put the prices in the catalogue (or suggest changes to existing ones).
// Families see the status on the provider; checks within the last week aren't repeated.

export interface PriceCheckRow {
  provider_id: string;
  status: 'running' | 'done' | 'failed';
  stage: string | null;
  outcome: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

const RECHECK_DAYS = 7;
const RUNNING_STALE_MS = 15 * 60_000;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
const toRow = (r: Record<string, unknown>): PriceCheckRow => ({
  provider_id: r.provider_id as string,
  status: r.status as PriceCheckRow['status'],
  stage: (r.stage as string | null) ?? null,
  outcome: (r.outcome as string | null) ?? null,
  error: (r.error as string | null) ?? null,
  started_at: iso(r.started_at)!,
  finished_at: iso(r.finished_at),
});

export async function listPriceChecks(db: Queryable): Promise<PriceCheckRow[]> {
  return (await db.query('SELECT * FROM provider_price_checks ORDER BY provider_id')).map(toRow);
}

/** Marks a check as started unless one is running or (without `force`) one finished well in the last week. */
export async function claimPriceCheck(db: Db, providerId: string, force: boolean): Promise<{ row: PriceCheckRow; start: boolean }> {
  return db.transaction(async (tx) => {
    await tx.query(`INSERT INTO provider_price_checks (provider_id, status, started_at) VALUES ($1, 'failed', now() - interval '1 year') ON CONFLICT (provider_id) DO NOTHING`, [providerId]);
    const row = toRow((await tx.query('SELECT * FROM provider_price_checks WHERE provider_id = $1 FOR UPDATE', [providerId]))[0]);
    const now = Date.now();
    const running = row.status === 'running' && now - new Date(row.started_at).getTime() < RUNNING_STALE_MS;
    const recent = row.status === 'done' && !!row.finished_at && now - new Date(row.finished_at).getTime() < RECHECK_DAYS * 86_400_000;
    if (running || (recent && !force)) return { row, start: false };
    const [updated] = await tx.query(
      `UPDATE provider_price_checks SET status = 'running', stage = 'Starting', outcome = NULL, error = NULL, started_at = now(), finished_at = NULL WHERE provider_id = $1 RETURNING *`,
      [providerId],
    );
    return { row: toRow(updated), start: true };
  });
}

/** Runs a claimed check to the end, recording its stage as it goes. Never throws. */
export async function runPriceCheck(deps: EnrichDeps, provider: Provider): Promise<void> {
  const { db } = deps;
  const stage = (s: string) => db.query('UPDATE provider_price_checks SET stage = $2 WHERE provider_id = $1', [provider.id, s]).then(() => undefined);
  try {
    const res = await readPrices(deps, provider, { usage: new UsageTally(), findMissing: true, takeSearch: () => true, onStage: (s) => void stage(s) });
    if (res.ok)
      await db.query(`UPDATE provider_price_checks SET status = 'done', stage = NULL, outcome = $2, finished_at = now() WHERE provider_id = $1`, [
        provider.id,
        res.kind === 'unchanged' ? 'Price list unchanged since it was last read' : res.outcome,
      ]);
    else await db.query(`UPDATE provider_price_checks SET status = 'failed', stage = NULL, error = $2, finished_at = now() WHERE provider_id = $1`, [provider.id, `${res.stage}: ${res.error}`]);
  } catch (err) {
    console.error('[prices]', provider.id, err);
    await db.query(`UPDATE provider_price_checks SET status = 'failed', stage = NULL, error = 'Unexpected error reading the prices', finished_at = now() WHERE provider_id = $1`, [provider.id]);
  }
}
