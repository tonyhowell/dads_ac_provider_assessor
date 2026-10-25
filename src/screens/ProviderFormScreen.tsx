import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useOptionalApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import { useAuth } from '../auth/AuthContext';
import { areaText, parseAreas } from '../area';
import { ResolutionCard } from '../components/ui/Cards';
import { ProviderSchema, RATE_KEYS } from '../schemas';
import { RATE_LABELS } from '../labels';
import { latestDateIn, slugify } from '../data/normalise';
import type { Provider, RateKey } from '../types';

type Draft = Record<'provider' | 'type' | 'outlet' | 'prices_as_at' | 'source_url' | 'veteran_fit' | 'flags' | 'areas' | 'note', string> & Record<RateKey, string>;

const toDraft = (p?: Provider): Draft => ({
  provider: p?.provider ?? '',
  type: p?.type ?? '',
  outlet: p?.outlet ?? '',
  prices_as_at: p?.prices_as_at ?? '',
  source_url: p?.source_url ?? '',
  veteran_fit: p?.veteran_fit ?? '',
  flags: p?.flags.join('\n') ?? '',
  areas: p ? areaText(p).replace(/–/g, '-') : '',
  note: '',
  ...(Object.fromEntries(RATE_KEYS.map((k) => [k, p?.[k] == null ? '' : String(p[k])])) as Record<RateKey, string>),
});

/**
 * Add or correct a provider in the common catalogue. Site admins change it directly; contributors send
 * a suggested correction for an admin to review. Special rates for one applicant are recorded on the
 * provider's page instead.
 */
export function ProviderFormScreen() {
  const { id } = useParams();
  const { user } = useAuth();
  const { catalogue: providers, backend, setCatalogue } = useSession();
  const app = useOptionalApp();
  const inAdmin = useLocation().pathname.startsWith('/admin');
  const isAdmin = user?.role === 'admin';
  const existing = providers.find((p) => p.id === id);
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => toDraft(existing));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const listPath = inAdmin ? '/admin/providers' : '/providers';
  const backPath = existing && !inAdmin ? `/providers/${existing.id}` : listPath;
  const suggesting = !isAdmin;

  if (id && !existing) {
    return (
      <section>
        <h1>Provider not found</h1>
        <Link to={listPath}>Back to providers</Link>
      </section>
    );
  }
  if (suggesting && !app?.canEdit) {
    return <ResolutionCard status="info" title="Only contributors can suggest changes" actions={<Link to={backPath} className="btn">Back</Link>} />;
  }
  if (sent) {
    return (
      <ResolutionCard status="good" title="Thanks — your suggestion has been sent for review" role="status" actions={<Link to={backPath} className="btn btn-primary">Back to {existing ? existing.provider : 'providers'}</Link>}>
        <p>A site administrator will check it. Once approved, every application sees the change. You can see its progress on the provider's page.</p>
      </ResolutionCard>
    );
  }

  const save = async (e: FormEvent) => {
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
      postcodes_served: parseAreas(draft.areas),
    };
    const parsed = ProviderSchema.safeParse(candidate);
    if (!draft.provider.trim()) problems.push('Enter the provider name.');
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        if (i.path[0] === 'source_url') problems.push('Source link must be a full web address starting with https://');
        else if (i.path[0] !== 'provider') problems.push(`${String(i.path[0])}: ${i.message}`);
      }
    }
    if (draft.areas.trim() && parseAreas(draft.areas).length === 0) problems.push('Postcodes served: enter 4-digit postcodes or ranges, e.g. 4178, 4150-4169.');
    if (suggesting && !draft.note.trim()) problems.push('Say where the new information comes from, so the administrator can check it.');
    setErrors(problems);
    if (problems.length || !parsed.success) return;
    setBusy(true);
    try {
      if (suggesting) {
        await backend.suggest(app!.application.id, parsed.data, draft.note);
        setSent(true);
      } else {
        setCatalogue(await backend.saveProvider(parsed.data));
        navigate(inAdmin ? listPath : `/providers/${parsed.data.id}`);
      }
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Could not save.']);
    } finally {
      setBusy(false);
    }
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
      <Link to={backPath} className="muted">
        ← {existing && !inAdmin ? existing.provider : 'All providers'}
      </Link>
      <h1>{suggesting ? (existing ? `Suggest a correction to ${existing.provider}` : 'Suggest a provider') : existing ? `Edit ${existing.provider}` : 'Add a provider'}</h1>
      <p>
        {suggesting
          ? 'Provider information is shared by every application. A site administrator checks suggestions before they change. If this provider offered you special rates, record them on its page instead.'
          : 'Changes apply to every application straight away.'}
      </p>

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
        {text('areas', 'Postcodes served', 'Postcodes or ranges, e.g. 4178, 4150-4169. Leave blank if not confirmed; the provider then shows everywhere.')}
        <div>
          <label htmlFor="pf-flags" className="muted block">
            Flags (one per line)
          </label>
          <textarea id="pf-flags" className="input min-h-24" value={draft.flags} onChange={(e) => set('flags', e.target.value)} />
        </div>
        {suggesting && (
          <div>
            <label htmlFor="pf-note" className="label">
              Where does this come from?
            </label>
            <span className="hint">For example: their price list dated 1 November, or a phone call with their intake team.</span>
            <textarea id="pf-note" className="input min-h-20" value={draft.note} onChange={(e) => set('note', e.target.value)} />
          </div>
        )}

        {errors.length > 0 && (
          <ul role="alert" className="list-disc space-y-1 pl-5 text-[var(--stop)]">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {suggesting ? 'Send for review' : existing ? 'Save changes' : 'Add provider'}
          </button>
          <Link to={backPath} className="btn">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}
