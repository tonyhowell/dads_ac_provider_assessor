import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import { formatDateTime } from '../format';
import { isAnswered } from '../lookingFor';
import type { StoredSummary } from '../types';
import { ConfirmButton } from './ConfirmButton';
import { ResolutionCard } from './ui/Cards';
import { WorkingGrid } from './ui/Feedback';
import { Icon } from './ui/Icon';

const LISTS = [
  ['priorities', 'What matters most'],
  ['must_haves', 'Must haves'],
  ['deal_breakers', 'Deal breakers'],
] as const;

/**
 * "What I'm looking for" in a few lines: drafted by Claude from the questionnaire, About you and the care
 * plan, then checked and edited by the family. It goes in the dossier.
 */
export function LookingForSummary() {
  const { state, dispatch, canEdit, application, refresh } = useApp();
  const { backend } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const summary = state.lookingFor;
  const answered = Object.values(state.answers).filter((a) => isAnswered(a)).length;

  const draft = async () => {
    setBusy(true);
    setError(null);
    try {
      await backend.draftLookingFor(application.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-4 border-2 border-[var(--charcoal)]/20" aria-labelledby="lf-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="lf-heading" className="flex items-center gap-2">
          <Icon name="star" size={26} /> What I'm looking for, in brief
        </h2>
        {summary && <span className="small">{summary.edited ? 'Edited by the family' : summary.generated_at ? `Drafted by Claude ${formatDateTime(summary.generated_at)}` : ''}</span>}
      </div>

      {busy && <WorkingGrid>Drafting your summary. This usually takes about 20 seconds.</WorkingGrid>}
      {error && (
        <ResolutionCard status="stop" title="We couldn't draft the summary" role="alert">
          <p>{error}</p>
        </ResolutionCard>
      )}

      {!summary && !busy && (
        <>
          <p>When you've answered what you can, Claude can draft a short summary for you to check. It goes in the dossier you give providers.</p>
          {canEdit && (
            <button type="button" className="btn btn-primary" onClick={draft} disabled={answered < 3}>
              <Icon name="star" size={20} /> Draft my summary with Claude
            </button>
          )}
          {canEdit && answered < 3 && <p className="small">Answer at least three questions first.</p>}
          <p className="small">Drafting sends your answers, care plan and the details in About you (not money or contribution details) to Anthropic's Claude.</p>
        </>
      )}

      {summary && !busy && !editing && (
        <>
          <p className="text-lg">{summary.summary}</p>
          <div className="grid gap-4 md:grid-cols-3">
            {LISTS.map(([key, label]) =>
              summary[key].length ? (
                <div key={key} className="well">
                  <h3 className="text-base font-semibold">{label}</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {summary[key].map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                <Icon name="edit" size={20} /> Edit
              </button>
              {summary.edited ? (
                <ConfirmButton className="btn" prompt="Draft again? Your edits will be replaced." confirmLabel="Draft again" onConfirm={draft}>
                  Draft again
                </ConfirmButton>
              ) : (
                <button type="button" className="btn" onClick={draft}>
                  Draft again
                </button>
              )}
            </div>
          )}
        </>
      )}

      {summary && editing && (
        <SummaryEditor
          summary={summary}
          onCancel={() => setEditing(false)}
          onSave={(next) => {
            dispatch({ type: 'lookingFor/set', summary: next });
            setEditing(false);
          }}
        />
      )}
    </section>
  );
}

function SummaryEditor({ summary, onSave, onCancel }: { summary: StoredSummary; onSave: (s: StoredSummary) => void; onCancel: () => void }) {
  const [text, setText] = useState(summary.summary);
  const [lists, setLists] = useState<Record<string, string>>(Object.fromEntries(LISTS.map(([k]) => [k, summary[k].join('\n')])));
  const toList = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 10);
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="lf-summary" className="label">
          Summary
        </label>
        <textarea id="lf-summary" className="input min-h-28" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {LISTS.map(([key, label]) => (
          <div key={key}>
            <label htmlFor={`lf-${key}`} className="label">
              {label}
            </label>
            <span className="hint">One per line.</span>
            <textarea id={`lf-${key}`} className="input min-h-28" value={lists[key]} onChange={(e) => setLists({ ...lists, [key]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            onSave({ summary: text.trim(), priorities: toList(lists.priorities), must_haves: toList(lists.must_haves), deal_breakers: toList(lists.deal_breakers), generated_at: summary.generated_at, edited: true })
          }
        >
          Save summary
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
