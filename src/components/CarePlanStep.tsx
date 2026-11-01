import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/AppContext';
import { RATE_KEYS } from '../schemas';
import { RATE_LABELS } from '../labels';
import type { Category, PlanItem, RateKey } from '../types';
import { PlanEditor } from './PlanEditor';
import { ResolutionCard } from './ui/Cards';
import { Icon } from './ui/Icon';

// Gather step 3: the care plan, read from the support plan (Claude Haiku) and confirmed item by item, or
// entered by hand and marked unconfirmed until a support plan replaces it.

interface ReadPlan {
  document_kind: string;
  classification: string | null;
  services: { name: string; key: RateKey | null; hours_per_week: number | null; frequency: string; start_date: string | null }[];
  notes: string[];
}

const DEFAULT_CATEGORY: Record<RateKey, Category> = {
  rn: 'clinical',
  en: 'clinical',
  pc: 'clinical',
  domestic: 'everyday',
  gardening: 'everyday',
  social: 'independence',
  respite: 'independence',
  care_mgmt: 'everyday',
};

/** File to base64, without the data: prefix. */
const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error("The file couldn't be read."));
    r.readAsDataURL(file);
  });

export function CarePlanStep() {
  const { state, seed, dispatch, canEdit } = useApp();
  const source = state.gather.planSource;
  const [reading, setReading] = useState(!state.plan);

  const enterByHand = () => {
    dispatch({ type: 'plan/set', plan: seed.samplePlan.map((i) => ({ ...i })) });
    dispatch({ type: 'gather/planSource', source: 'manual' });
    setReading(false);
  };

  return (
    <div className="space-y-4">
      {state.plan && (
        <p className={`chip ${source === 'support_plan' ? 'chip-good' : 'chip-caution'}`}>
          {source === 'support_plan' ? 'From your support plan' : 'Entered by hand — unconfirmed until your support plan arrives'}
        </p>
      )}
      {canEdit && (reading || !state.plan) ? (
        <SupportPlanReader onDone={() => setReading(false)} onManual={!state.plan ? enterByHand : undefined} onCancel={state.plan ? () => setReading(false) : undefined} />
      ) : (
        canEdit && (
          <button type="button" className="btn" onClick={() => setReading(true)}>
            <Icon name="note" size={20} /> {source === 'support_plan' ? 'Read a newer support plan' : 'Read my support plan'}
          </button>
        )
      )}
      {state.plan && <PlanEditor />}
      {!state.plan && !canEdit && <p className="card">No care plan yet.</p>}
    </div>
  );
}

function SupportPlanReader({ onDone, onManual, onCancel }: { onDone: () => void; onManual?: () => void; onCancel?: () => void }) {
  const { application, state, dispatch } = useApp();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<ReadPlan | null>(null);
  const [rows, setRows] = useState<{ use: boolean; name: string; key: RateKey | ''; hours: string }[]>([]);
  const [updateLevel, setUpdateLevel] = useState(true);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > 12 * 1024 * 1024) return setError('That file is over 12 MB. Try a smaller copy or a photo of each page.');
    setBusy(true);
    try {
      const data = await toBase64(file);
      const r = await api<{ plan: ReadPlan }>(`/api/applications/${encodeURIComponent(application.id)}/support-plan`, { body: { name: file.name, mime: file.type, data } });
      setRead(r.plan);
      setRows(r.plan.services.map((s) => ({ use: s.key !== null && s.key !== 'care_mgmt' && (s.hours_per_week ?? 0) > 0, name: s.name, key: s.key ?? '', hours: s.hours_per_week === null ? '' : String(s.hours_per_week) })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The document couldn't be read.");
    } finally {
      setBusy(false);
    }
  };

  const chosen = rows.filter((r) => r.use && r.key && Number(r.hours) > 0);
  const levelDiffers = !!read?.classification && !!state.participant && read.classification !== state.participant.classification;

  const confirm = () => {
    // Several lines for the same service (e.g. two personal care visits) add up.
    const byKey = new Map<RateKey, PlanItem>();
    for (const r of chosen) {
      const key = r.key as RateKey;
      const prev = byKey.get(key);
      byKey.set(key, { service: RATE_LABELS[key], key, hours_per_week: (prev?.hours_per_week ?? 0) + Number(r.hours), category: DEFAULT_CATEGORY[key] });
    }
    dispatch({ type: 'plan/set', plan: [...byKey.values()] });
    dispatch({ type: 'gather/planSource', source: 'support_plan' });
    if (levelDiffers && updateLevel && state.participant) dispatch({ type: 'participant/set', participant: { ...state.participant, classification: read!.classification! } });
    onDone();
  };

  if (read) {
    return (
      <section className="card space-y-3" aria-labelledby="check-plan">
        <h2 id="check-plan" className="text-[1.2rem]">
          Check what we read from your {read.document_kind.toLowerCase() || 'document'}
        </h2>
        <p>Tick the services to include and check the hours. Nothing is saved until you confirm.</p>
        {read.classification && <p>Level: <b>{read.classification}</b></p>}
        {levelDiffers && (
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={updateLevel} onChange={(e) => setUpdateLevel(e.target.checked)} />
            Update your level from {state.participant!.classification} to {read.classification}
          </label>
        )}
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Include</th>
                <th scope="col">In the document</th>
                <th scope="col">Service</th>
                <th scope="col">Hours a week</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input type="checkbox" aria-label={`Include ${r.name}`} checked={r.use} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, use: e.target.checked } : x)))} />
                  </td>
                  <td>
                    {r.name}
                    <span className="small block">{read.services[i].frequency}</span>
                  </td>
                  <td>
                    <select
                      className="input"
                      aria-label={`Service for ${r.name}`}
                      value={r.key}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, key: e.target.value as RateKey | '' } : x)))}
                    >
                      <option value="">Not a priced service</option>
                      {RATE_KEYS.filter((k) => k !== 'care_mgmt').map((k) => (
                        <option key={k} value={k}>
                          {RATE_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="input w-24"
                      inputMode="decimal"
                      aria-label={`Hours a week for ${r.name}`}
                      value={r.hours}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {read.notes.length > 0 && (
          <div className="well">
            <p className="font-semibold">Worth checking</p>
            <ul className="list-disc pl-6">
              {read.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={!chosen.length} onClick={confirm}>
            Use these {chosen.length} service{chosen.length === 1 ? '' : 's'}
          </button>
          <button type="button" className="btn" onClick={() => setRead(null)}>
            Read a different document
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card space-y-3" aria-labelledby="read-plan">
      <h2 id="read-plan" className="text-[1.2rem]">
        Read your support plan
      </h2>
      <p>Upload your support plan or Notice of Decision (a PDF or a photo). Claude reads the services and hours, and you check them before anything is saved.</p>
      <label className="flex min-h-[var(--target-min)] items-start gap-3">
        <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>I'm happy for this document to be read by Claude (Anthropic) to set up the care plan. It isn't stored.</span>
      </label>
      <div>
        <label htmlFor="support-plan" className="label">
          Document
        </label>
        <input id="support-plan" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={!consent || busy} onChange={(e) => upload(e.target.files?.[0])} />
      </div>
      {busy && <p role="status">Reading your document… this usually takes under a minute.</p>}
      {error && (
        <ResolutionCard status="stop" title="That didn't work" role="alert">
          <p>{error}</p>
        </ResolutionCard>
      )}
      <div className="flex flex-wrap gap-2">
        {onManual && (
          <button type="button" className="btn" onClick={onManual}>
            No support plan yet — enter services by hand
          </button>
        )}
        {onCancel && (
          <button type="button" className="btn-quiet" onClick={onCancel}>
            Keep my current plan
          </button>
        )}
      </div>
    </section>
  );
}
