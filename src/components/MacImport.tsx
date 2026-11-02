import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import { macSearchUrl, planServices } from '../mac';
import type { MacPreview } from '../backend';
import type { FinderState } from './Narrow';
import { ResolutionCard } from './ui/Cards';
import { Icon } from './ui/Icon';
import { formatDate } from '../format';
import type { RateKey } from '../types';

// Find starts from My Aged Care (the official directory): search there for the family's area, shortlist, save the
// shortlist and Compare pages as PDF, and upload them here. The providers become this family's list in Find, with
// the prices they publish on My Aged Care. A provider's details page adds weekend rates and other prices.

const KIND_WORDS = { shortlist: 'Shortlist', compare: 'Compare', details: 'Provider details', unknown: 'Not recognised' } as const;

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function MacSource({ f }: { f: FinderState }) {
  const { state, plan, application, canEdit } = useApp();
  const mac = state.find.mac;
  const count = mac?.provider_ids.length ?? 0;
  const [open, setOpen] = useState(count === 0);
  const suburb = state.participant?.suburb ?? '';
  const postcode = (state.participant?.postcode || application.postcode || '').trim();
  const keys = [...new Set(plan.filter((i) => i.hours_per_week > 0).map((i) => i.key))] as RateKey[];
  const search = macSearchUrl({ suburb, postcode, services: planServices(keys) });

  if (count > 0 && !open) {
    return (
      <section className="card flex flex-wrap items-center gap-3" aria-label="Providers from My Aged Care">
        <span>
          <b>{count} providers from My Aged Care</b>
          {mac?.updated_at && <span className="small"> · updated {formatDate(mac.updated_at.slice(0, 10))}</span>}
        </span>
        <div role="group" aria-label="Show" className="inline-flex">
          <button type="button" className="btn btn-sm rounded-r-none" aria-pressed={f.scope === 'mac'} onClick={() => f.setScope('mac')}>
            This family's list
          </button>
          <button type="button" className="btn btn-sm -ml-px rounded-l-none" aria-pressed={f.scope === 'all'} onClick={() => f.setScope('all')}>
            Everyone in the catalogue
          </button>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
            Add from My Aged Care
          </button>
        )}
        {mac?.share_url && (
          <a href={mac.share_url} target="_blank" rel="noreferrer noopener" className="small">
            Shortlist on My Aged Care<span className="sr-only"> (opens in new tab)</span>
          </a>
        )}
      </section>
    );
  }

  return (
    <section className="card space-y-4" aria-labelledby="mac-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="mac-heading" className="text-[1.2rem]">
          Find providers on My Aged Care
        </h2>
        {count > 0 && (
          <button type="button" className="btn-quiet" onClick={() => setOpen(false)}>
            Close
          </button>
        )}
      </div>
      <p>My Aged Care lists the providers that serve your area and the prices they publish. Search there, then bring the results here.</p>
      <ol className="space-y-3">
        <li>
          <p className="font-semibold">1. Search My Aged Care</p>
          {search ? (
            <a href={search} target="_blank" rel="noreferrer noopener" className="btn btn-primary">
              <Icon name="external" size={18} /> Search for {suburb} {postcode}
              <span className="sr-only"> on My Aged Care (opens in new tab)</span>
            </a>
          ) : (
            <p>Add the suburb and postcode in Gather first, so the search is set to your area.</p>
          )}
          <p className="small">It opens set to your area{keys.length ? ' and the services in your plan' : ''}.</p>
        </li>
        <li>
          <p className="font-semibold">2. Shortlist and save as PDF</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              Add the providers you're interested in to your shortlist, open <b>My shortlist</b>, and save it: <b>Print → Save as PDF</b>.
            </li>
            <li>
              For prices, choose <b>Compare</b> (up to three at a time) and save each comparison as PDF too.
            </li>
            <li>Optional: a provider's own page (<b>Show details</b>, sections expanded) adds weekend and public holiday rates.</li>
          </ul>
        </li>
        <li>
          <p className="font-semibold">3. Upload them here</p>
          {canEdit ? <MacUpload onDone={() => setOpen(false)} /> : <p>Ask a coordinator or contributor to upload them.</p>}
        </li>
      </ol>
      {count === 0 && <p className="small">Until then, Find shows everyone in the catalogue.</p>}
    </section>
  );
}

function MacUpload({ onDone }: { onDone: () => void }) {
  const { application, dispatch } = useApp();
  const { backend, setCatalogue } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<'reading' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MacPreview | null>(null);
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [matches, setMatches] = useState<Record<string, string | null>>({});
  const [added, setAdded] = useState<number | null>(null);

  const read = async () => {
    setError(null);
    setBusy('reading');
    try {
      const r = await backend.readMac(application.id, await Promise.all(files.map(async (f) => ({ name: f.name, data: await toBase64(f) }))));
      setPreview(r);
      setInclude(new Set(r.providers.map((p) => p.name)));
      setMatches(Object.fromEntries(r.providers.map((p) => [p.name, p.match?.id ?? null])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the files.');
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    if (!preview) return;
    setError(null);
    setBusy('saving');
    try {
      const chosen = preview.providers.filter((p) => include.has(p.name));
      const r = await backend.applyMac(application.id, {
        share_url: preview.share_url,
        providers: chosen.map(({ match: _m, ...p }) => ({ ...p, match_id: matches[p.name] ?? null })),
      });
      setCatalogue(r);
      dispatch({ type: 'find/macList', providerIds: r.ids, shareUrl: preview.share_url, at: new Date().toISOString() });
      setAdded(r.ids.length);
      setPreview(null);
      setFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(null);
    }
  };

  if (added !== null)
    return (
      <ResolutionCard
        status="good"
        title={`${added} provider${added === 1 ? '' : 's'} added to this family's list`}
        role="status"
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={onDone}>
              See them in Find
            </button>
            <button type="button" className="btn" onClick={() => setAdded(null)}>
              Upload more
            </button>
          </>
        }
      >
        <p>Their published prices are used for costs; prices that looked wrong were left out.</p>
      </ResolutionCard>
    );

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="mac-files" className="label">
          Saved pages (PDF)
        </label>
        <input id="mac-files" type="file" accept="application/pdf,.pdf" multiple disabled={!!busy} onChange={(e) => setFiles([...(e.target.files ?? [])])} />
      </div>
      {files.length > 0 && !preview && (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {files.length} file{files.length === 1 ? '' : 's'}: {files.map((f) => f.name).join(', ')}
          </span>
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={read}>
            {busy === 'reading' ? 'Reading…' : 'Read these files'}
          </button>
        </div>
      )}
      {busy === 'reading' && (
        <p role="status" className="small">
          Reading the pages… a provider details page takes up to a minute.
        </p>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {preview && (
        <section className="space-y-3" aria-labelledby="mac-preview-heading">
          <h3 id="mac-preview-heading" className="font-semibold">
            Check before adding
          </h3>
          <ul className="small space-y-0.5">
            {preview.files.map((f) => (
              <li key={f.name}>
                {f.name}: {KIND_WORDS[f.kind]}
                {f.error ? ` — ${f.error}` : `, ${f.providers} provider${f.providers === 1 ? '' : 's'}`}
              </li>
            ))}
          </ul>
          {preview.providers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <caption className="sr-only">Providers read from the pages</caption>
                <thead>
                  <tr>
                    <th scope="col">Add</th>
                    <th scope="col">Provider</th>
                    <th scope="col">Based in</th>
                    <th scope="col">Prices</th>
                    <th scope="col">In our catalogue</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.providers.map((p) => {
                    const flags = p.prices.filter((x) => x.flag).length;
                    const priced = p.prices.filter((x) => x.standard !== null && !x.flag).length;
                    return (
                      <tr key={p.name}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Add ${p.name}`}
                            checked={include.has(p.name)}
                            onChange={() => setInclude((s) => new Set(s.has(p.name) ? [...s].filter((x) => x !== p.name) : [...s, p.name]))}
                          />
                        </td>
                        <th scope="row" className="font-normal">
                          <b>{p.name}</b>
                          {p.phone && <span className="small block">{p.phone}</span>}
                        </th>
                        <td>{p.based_in ?? '—'}</td>
                        <td>
                          {priced ? `${priced} services` : 'None yet'}
                          {flags > 0 && <span className="small block">{flags} look wrong, left out</span>}
                        </td>
                        <td>
                          <label className="sr-only" htmlFor={`match-${p.name}`}>
                            Catalogue match for {p.name}
                          </label>
                          <select id={`match-${p.name}`} className="input" value={matches[p.name] ?? ''} onChange={(e) => setMatches((m) => ({ ...m, [p.name]: e.target.value || null }))}>
                            <option value="">New provider</option>
                            {p.match && <option value={p.match.id}>Same as {p.match.provider}</option>}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No providers found in these pages.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={!!busy || include.size === 0} onClick={save}>
              {busy === 'saving' ? 'Adding…' : `Add ${include.size} to this family's list`}
            </button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
          <p className="small">Prices are saved as published on My Aged Care today. Matched providers keep everything else we know; their prices are updated where My Aged Care has one.</p>
        </section>
      )}
    </div>
  );
}
