import { randomUUID } from 'node:crypto';
import type { Db, Queryable } from './db.ts';
import type { Provider } from '../src/types.ts';

// The common provider catalogue: the starter pack (data/providers.json) plus corrections and additions
// stored here. Every change is recorded in provider_history. Families suggest changes; site admins decide.

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

/** Never store the per-application marker in the catalogue. */
const clean = (p: Provider): Provider => {
  const { special_rates: _s, ...rest } = p;
  return rest;
};

export async function catalogueEdits(db: Queryable): Promise<{ providers: Provider[]; updated_at: string | null }> {
  const rows = await db.query<{ provider: unknown; updated_at: unknown }>('SELECT provider, updated_at FROM provider_catalogue ORDER BY id');
  const latest = rows.reduce<string | null>((m, r) => {
    const t = iso(r.updated_at);
    return !m || (t && t > m) ? t : m;
  }, null);
  return { providers: rows.map((r) => json<Provider>(r.provider)), updated_at: latest };
}

export async function upsertCatalogue(db: Queryable, provider: Provider, userId: string | null, change: string): Promise<void> {
  const p = clean(provider);
  await db.query(
    `INSERT INTO provider_catalogue (id, provider, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [p.id, JSON.stringify(p), userId],
  );
  await db.query('INSERT INTO provider_history (provider_id, provider, change, user_id) VALUES ($1, $2::jsonb, $3, $4)', [p.id, JSON.stringify(p), change, userId]);
}

/** Back to the starter-pack record (or removes a provider that was added). */
export async function revertCatalogue(db: Queryable, id: string, userId: string | null): Promise<boolean> {
  const removed = await db.query('DELETE FROM provider_catalogue WHERE id = $1 RETURNING id', [id]);
  if (removed.length) await db.query('INSERT INTO provider_history (provider_id, provider, change, user_id) VALUES ($1, NULL, $2, $3)', [id, 'Reverted to the starter data', userId]);
  return removed.length > 0;
}

export async function providerHistory(db: Queryable, id: string) {
  const rows = await db.query(
    `SELECT h.id, h.change, h.created_at, u.display_name AS by_name FROM provider_history h LEFT JOIN users u ON u.id = h.user_id
     WHERE h.provider_id = $1 ORDER BY h.id DESC LIMIT 50`,
    [id],
  );
  return rows.map((r) => ({ id: Number(r.id), change: r.change as string, created_at: iso(r.created_at)!, by: (r.by_name as string | null) ?? null }));
}

// --- Suggestions ---

export interface Suggestion {
  id: string;
  provider_id: string;
  is_new: boolean;
  current: Provider | null;
  proposed: Provider;
  note: string;
  application_id: string | null;
  application_name: string | null;
  suggested_by: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decision_note: string;
  decided_at: string | null;
  created_at: string;
}

const SUGGESTION_SELECT = `SELECT s.*, a.name AS application_name, u.display_name AS suggested_by, d.display_name AS decided_by_name
  FROM provider_suggestions s
  LEFT JOIN applications a ON a.id = s.application_id
  LEFT JOIN users u ON u.id = s.user_id
  LEFT JOIN users d ON d.id = s.decided_by`;

const toSuggestion = (r: Record<string, unknown>): Suggestion => ({
  id: r.id as string,
  provider_id: r.provider_id as string,
  is_new: r.is_new as boolean,
  current: r.current ? json<Provider>(r.current) : null,
  proposed: json<Provider>(r.proposed),
  note: r.note as string,
  application_id: (r.application_id as string | null) ?? null,
  application_name: (r.application_name as string | null) ?? null,
  suggested_by: (r.suggested_by as string | null) ?? null,
  status: r.status as Suggestion['status'],
  decided_by: (r.decided_by_name as string | null) ?? null,
  decision_note: r.decision_note as string,
  decided_at: iso(r.decided_at),
  created_at: iso(r.created_at)!,
});

export async function createSuggestion(
  db: Queryable,
  input: { current: Provider | null; proposed: Provider; note: string; applicationId: string | null; userId: string | null },
): Promise<Suggestion> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO provider_suggestions (id, provider_id, is_new, current, proposed, note, application_id, user_id)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)`,
    [
      id,
      input.proposed.id,
      input.current === null,
      input.current ? JSON.stringify(clean(input.current)) : null,
      JSON.stringify(clean(input.proposed)),
      input.note.trim(),
      input.applicationId,
      input.userId,
    ],
  );
  return (await getSuggestion(db, id))!;
}

export async function getSuggestion(db: Queryable, id: string): Promise<Suggestion | undefined> {
  const [row] = await db.query(`${SUGGESTION_SELECT} WHERE s.id = $1`, [id]);
  return row ? toSuggestion(row) : undefined;
}

export async function listSuggestions(db: Queryable, filter: { status?: Suggestion['status']; applicationId?: string }): Promise<Suggestion[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) where.push(`s.status = $${params.push(filter.status)}`);
  if (filter.applicationId) where.push(`s.application_id = $${params.push(filter.applicationId)}`);
  const rows = await db.query(`${SUGGESTION_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.created_at DESC LIMIT 200`, params);
  return rows.map(toSuggestion);
}

/** Approves (applying the proposed record, or an admin's edited version of it) or rejects a pending suggestion. */
export async function decideSuggestion(
  db: Db,
  id: string,
  decision: { approve: boolean; provider?: Provider; note?: string },
  adminId: string,
): Promise<Suggestion | 'not-found' | 'decided'> {
  return db.transaction(async (tx) => {
    const [row] = await tx.query(`${SUGGESTION_SELECT} WHERE s.id = $1 FOR UPDATE OF s`, [id]);
    if (!row) return 'not-found';
    const s = toSuggestion(row);
    if (s.status !== 'pending') return 'decided';
    if (decision.approve) {
      const provider = { ...(decision.provider ?? s.proposed), id: s.provider_id };
      await upsertCatalogue(tx, provider, adminId, `Approved suggestion from ${s.suggested_by ?? (s.application_id ? 'a family member' : 'the automatic price check')}${s.application_name ? ` (${s.application_name})` : ''}`);
    }
    await tx.query('UPDATE provider_suggestions SET status = $2, decided_by = $3, decision_note = $4, decided_at = now() WHERE id = $1', [
      id,
      decision.approve ? 'approved' : 'rejected',
      adminId,
      decision.note?.trim() ?? '',
    ]);
    return (await getSuggestion(tx, id))!;
  });
}
