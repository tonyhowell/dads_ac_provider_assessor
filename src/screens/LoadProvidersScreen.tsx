import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../state/SessionContext';
import { parseCsv } from '../csv';
import { toIsoDate } from '../rules';
import type { Catalogue } from '../backend';
import { candidateToProvider, findHeader, GEN_FIELD_LABELS, GEN_FIELDS, groupProviders, isHomeCare, toServices, type Cell, type GenField, type Mapping } from '../genLoad';
import { ResolutionCard } from '../components/ui/Cards';
import { Icon } from '../components/ui/Icon';

// Site administration → Provider catalogue → Load from the government list. Reads the GEN aged care service
// list in the browser (nothing is uploaded but the providers chosen), then adds the ones not yet in the catalogue.

interface Sheet {
  name: string;
  rows: Cell[][];
}

async function readFile(file: File): Promise<Sheet[]> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return [{ name: file.name, rows: parseCsv(await file.text()) }];
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  const sheets = await readXlsxFile(file);
  return sheets.map((s) => ({ name: s.sheet, rows: s.data as Cell[][] }));
}

export function LoadProvidersScreen() {
  const { catalogue, setCatalogue } = useSession();
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [homeOnly, setHomeOnly] = useState(true);
  const [regions, setRegions] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [appPostcodes, setAppPostcodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    api<{ applications: { postcode: string; status: string }[] }>('/api/admin/applications')
      .then((r) => setAppPostcodes([...new Set(r.applications.filter((a) => a.status === 'active' && a.postcode).map((a) => a.postcode))]))
      .catch(() => setAppPostcodes([]));
  }, []);

  const pickSheet = (all: Sheet[], i: number) => {
    setSheetIndex(i);
    const h = findHeader(all[i].rows);
    setHeaderIndex(h?.index ?? 0);
    setHeaders(h?.headers ?? (all[i].rows[0] ?? []).map((c) => String(c ?? '')));
    setMapping(h?.mapping ?? null);
    if (!h) setError("We couldn't find the column headings in this sheet. Check it's the aged care service list, or choose another sheet.");
  };

  const onFile = async (file: File | undefined) => {
    setError(null);
    setDone(null);
    setSheets(null);
    setRegions(new Set());
    setSkipped(new Set());
    if (!file) return;
    try {
      setFileName(file.name);
      const all = await readFile(file);
      if (!all.length) throw new Error('The file has no sheets.');
      setSheets(all);
      // The first sheet whose headings we recognise.
      const i = Math.max(0, all.findIndex((s) => findHeader(s.rows)));
      pickSheet(all, i);
    } catch (err) {
      setError(err instanceof Error ? `We couldn't read that file: ${err.message}` : "We couldn't read that file.");
    }
  };

  const services = useMemo(() => (sheets && mapping ? toServices(sheets[sheetIndex].rows, headerIndex, mapping) : []), [sheets, sheetIndex, headerIndex, mapping]);
  const kept = useMemo(() => (homeOnly ? services.filter(isHomeCare) : services), [services, homeOnly]);
  const regionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of kept) m.set(s.region || s.state || 'Unknown', (m.get(s.region || s.state || 'Unknown') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [kept]);

  // Pre-select the regions the applications are in.
  useEffect(() => {
    if (!kept.length || regions.size) return;
    const near = new Set(kept.filter((s) => appPostcodes.includes(s.postcode)).map((s) => s.region || s.state || 'Unknown'));
    if (near.size) setRegions(near);
  }, [kept, appPostcodes, regions.size]);

  const inArea = kept.filter((s) => regions.has(s.region || s.state || 'Unknown'));
  const candidates = useMemo(() => groupProviders(inArea, catalogue), [inArea, catalogue]);
  const toAdd = candidates.filter((c) => !c.existing && !skipped.has(c.key));

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const taken = new Set(catalogue.map((p) => p.id));
      const today = toIsoDate(new Date());
      const note = `${fileName}${regions.size ? `, ${[...regions].join(', ')}` : ''}`;
      const providers = toAdd.map((c) => candidateToProvider(c, taken, today, note));
      const r = await api<{ added: string[] } & Catalogue>('/api/admin/providers/load', { body: { providers } });
      setCatalogue(r);
      setDone(r.added.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the providers.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link to="/admin/providers" className="btn-quiet">
        <Icon name="arrowLeft" size={20} /> Provider catalogue
      </Link>
      <div className="space-y-2">
        <h2 className="text-[1.4rem]">Load providers from the government list</h2>
        <p>
          Use the <b>Aged care service list</b> from GEN, the government's aged care data site (one Excel file per state, current to 30 June each year). The file is read in your
          browser. Home care providers in the regions you pick are added to the catalogue, marked as loaded, without prices. Their prices are read when a family shortlists them.
        </p>
        <p>
          <a href="https://www.gen-agedcaredata.gov.au/resources/access-data/2025/october/aged-care-service-list-30-june-2025" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1">
            Get the aged care service list <Icon name="external" size={16} />
            <span className="sr-only">(opens in new tab)</span>
          </a>
        </p>
      </div>

      {error && (
        <ResolutionCard status="stop" title="That didn't work" role="alert">
          <p>{error}</p>
        </ResolutionCard>
      )}
      {done !== null && (
        <ResolutionCard status="good" title={`${done} provider${done === 1 ? '' : 's'} added`} role="status" actions={<Link to="/admin/providers" className="btn">See the catalogue</Link>}>
          <p>They show to families as "needs a quote" until their prices are read. To find their websites and price lists now, run "Find providers near each application" in Data checks.</p>
        </ResolutionCard>
      )}

      <section className="card space-y-3" aria-labelledby="step-file">
        <h3 id="step-file" className="text-[1.15rem]">
          1. Choose the file
        </h3>
        <label className="label" htmlFor="gen-file">
          Service list (.xlsx or .csv)
        </label>
        <input id="gen-file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
        {sheets && sheets.length > 1 && (
          <div>
            <label className="label" htmlFor="gen-sheet">
              Sheet
            </label>
            <select id="gen-sheet" className="input max-w-sm" value={sheetIndex} onChange={(e) => pickSheet(sheets, Number(e.target.value))}>
              {sheets.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {sheets && mapping && (
        <section className="card space-y-3" aria-labelledby="step-columns">
          <h3 id="step-columns" className="text-[1.15rem]">
            2. Check the columns
          </h3>
          <p>We matched these from the headings. Change any that are wrong. Provider name is needed; the rest help.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {GEN_FIELDS.map((f: GenField) => (
              <div key={f}>
                <label className="label" htmlFor={`col-${f}`}>
                  {GEN_FIELD_LABELS[f]}
                </label>
                <select id={`col-${f}`} className="input" value={mapping[f] ?? ''} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">Not in this file</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="small">{services.length} services read.</p>
        </section>
      )}

      {services.length > 0 && (
        <section className="card space-y-3" aria-labelledby="step-area">
          <h3 id="step-area" className="text-[1.15rem]">
            3. Choose the area
          </h3>
          <label className="flex min-h-[var(--target-min)] items-center gap-3">
            <input type="checkbox" checked={homeOnly} onChange={(e) => setHomeOnly(e.target.checked)} /> Home care only ({services.filter(isHomeCare).length} of {services.length} services)
          </label>
          <fieldset>
            <legend className="label">Regions{appPostcodes.length ? ' (the ones your applications are in are ticked)' : ''}</legend>
            <div className="grid gap-1 md:grid-cols-2">
              {regionCounts.map(([r, n]) => (
                <label key={r} className="flex min-h-[var(--target-min)] items-center gap-3">
                  <input type="checkbox" checked={regions.has(r)} onChange={(e) => setRegions(new Set(e.target.checked ? [...regions, r] : [...regions].filter((x) => x !== r)))} />
                  {r} <span className="small">({n})</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>
      )}

      {regions.size > 0 && (
        <section className="card space-y-3" aria-labelledby="step-check">
          <h3 id="step-check" className="text-[1.15rem]">
            4. Check and load
          </h3>
          <p>
            {candidates.length} provider{candidates.length === 1 ? '' : 's'} in the area: <b>{toAdd.length} to add</b>, {candidates.filter((c) => c.existing).length} already in the catalogue.
          </p>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Add?</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Services in the area</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.key}>
                    <td>
                      {c.existing ? (
                        <span className="small">Already in the catalogue</span>
                      ) : (
                        <input
                          type="checkbox"
                          aria-label={`Add ${c.name}`}
                          checked={!skipped.has(c.key)}
                          onChange={(e) => setSkipped(new Set(e.target.checked ? [...skipped].filter((k) => k !== c.key) : [...skipped, c.key]))}
                        />
                      )}
                    </td>
                    <td>
                      {c.name}
                      {c.existing && <span className="small block">as {c.existing.provider}</span>}
                      {c.orgType && <span className="small block">{c.orgType}</span>}
                    </td>
                    <td className="text-[0.95rem]">
                      {c.services
                        .slice(0, 4)
                        .map((s) => [s.service, s.suburb].filter(Boolean).join(', '))
                        .join('; ')}
                      {c.services.length > 4 && ` and ${c.services.length - 4} more`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-primary" disabled={busy || toAdd.length === 0} onClick={load}>
            {busy ? 'Adding…' : `Add ${toAdd.length} provider${toAdd.length === 1 ? '' : 's'}`}
          </button>
        </section>
      )}
    </div>
  );
}
