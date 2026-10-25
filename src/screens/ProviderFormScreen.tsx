import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, useProvider } from '../state/AppContext';
import { ProviderSchema, RATE_KEYS } from '../schemas';
import { RATE_LABELS } from '../labels';
import { latestDateIn, slugify } from '../data/normalise';
import type { Provider, RateKey } from '../types';

type Draft = Record<'provider' | 'type' | 'outlet' | 'prices_as_at' | 'source_url' | 'veteran_fit' | 'flags', string> & Record<RateKey, string>;

const toDraft = (p?: Provider): Draft => ({
  provider: p?.provider ?? '',
  type: p?.type ?? '',
  outlet: p?.outlet ?? '',
  prices_as_at: p?.prices_as_at ?? '',
  source_url: p?.source_url ?? '',
  veteran_fit: p?.veteran_fit ?? '',
  flags: p?.flags.join('\n') ?? '',
  ...(Object.fromEntries(RATE_KEYS.map((k) => [k, p?.[k] == null ? '' : String(p[k])])) as Record<RateKey, string>),
});

/** Add a provider, or correct one (prices, source, flags). Changes are shared with the family. */
export function ProviderFormScreen() {
  const { id } = useParams();
  const existing = useProvider(id);
  const { providers, dispatch } = useApp();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => toDraft(existing));
  const [errors, setErrors] = useState<string[]>([]);
  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  if (id && !existing) {
    return (
      <section>
        <h1 className="text-2xl font-semibold">Provider not found</h1>
        <Link to="/providers">Back to providers</Link>
      </section>
    );
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    const problems: string[] = [];
    const rates = Object.fromEntries(
      RATE_KEYS.map((k) => {
        const raw = draft[k].trim().replace(/[$,]/g, '');
        if (raw === '') return [k, null];
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) problems.push(`${RATE_LABELS[k]}: enter an hourly price, or leave it blank if not published.`);
        return [k, Number.isFinite(n) ? n : null];
      }),
    );
    let newId = existing?.id ?? slugify(draft.provider);
    if (!existing) {
      const taken = new Set(providers.map((p) => p.id));
      for (let n = 2; taken.has(newId); n++) newId = `${slugify(draft.provider)}-${n}`;
    }
    const candidate = {
      id: newId,
      provider: draft.provider.trim(),
      type: draft.type.trim() || null,
      outlet: draft.outlet.trim() || null,
      ...rates,
      prices_as_at: draft.prices_as_at.trim() || 'Not captured',
      prices_as_at_date: latestDateIn(draft.prices_as_at.trim()),
      veteran_fit: draft.veteran_fit.trim() || null,
      flags: draft.flags.split(/\n|;/).map((f) => f.trim()).filter(Boolean),
      source_url: draft.source_url.trim() || null,
    };
    const parsed = ProviderSchema.safeParse(candidate);
    if (!draft.provider.trim()) problems.push('Enter the provider name.');
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        if (i.path[0] === 'source_url') problems.push('Source link must be a full web address starting with https://');
        else if (i.path[0] !== 'provider') problems.push(`${String(i.path[0])}: ${i.message}`);
      }
    }
    setErrors(problems);
    if (problems.length || !parsed.success) return;
    dispatch({ type: 'provider/upsert', provider: parsed.data });
    navigate(`/providers/${parsed.data.id}`);
  };

  const text = (k: keyof Draft, label: string, hint?: string) => (
    <div>
      <label htmlFor={`pf-${k}`} className="muted block">
        {label}
      </label>
      <input id={`pf-${k}`} className="input" value={draft[k]} onChange={(e) => set(k, e.target.value)} />
      {hint && <p className="muted mt-1 text-xs">{hint}</p>}
    </div>
  );

  return (
    <section className="space-y-4">
      <Link to={existing ? `/providers/${existing.id}` : '/providers'} className="muted">
        ← {existing ? existing.provider : 'All providers'}
      </Link>
      <h1 className="text-2xl font-semibold">{existing ? `Edit ${existing.provider}` : 'Add a provider'}</h1>

      <form onSubmit={save} className="card space-y-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          {text('provider', 'Provider name')}
          {text('type', 'Type', 'e.g. Not-for-profit, private company')}
          {text('outlet', 'Outlet or local office')}
          {text('veteran_fit', 'Veteran fit', 'What you know about their veteran and PTSD capability')}
        </div>

        <fieldset className="space-y-2">
          <legend className="font-medium">Weekday hourly rates (AUD)</legend>
          <p className="muted text-sm">Leave blank if not published; costs then use the IHACPA benchmark for that service.</p>
          <div className="grid gap-3 sm:grid-cols-4">
            {RATE_KEYS.map((k) => (
              <div key={k}>
                <label htmlFor={`pf-${k}`} className="muted block">
                  {RATE_LABELS[k]}
                </label>
                <input id={`pf-${k}`} className="input tabular-nums" inputMode="decimal" value={draft[k]} onChange={(e) => set(k, e.target.value)} />
              </div>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          {text('prices_as_at', 'Prices as at', 'As written on the price list, e.g. "1 Oct 2026". Used for the 60-day staleness warning.')}
          {text('source_url', 'Price list link', 'Where the prices came from, e.g. the My Aged Care listing')}
        </div>
        <div>
          <label htmlFor="pf-flags" className="muted block">
            Flags (one per line)
          </label>
          <textarea id="pf-flags" className="input min-h-24" value={draft.flags} onChange={(e) => set('flags', e.target.value)} />
        </div>

        {errors.length > 0 && (
          <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-red-700 dark:text-red-300">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary">
            {existing ? 'Save changes' : 'Add provider'}
          </button>
          <Link to={existing ? `/providers/${existing.id}` : '/providers'} className="btn no-underline hover:no-underline">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}
