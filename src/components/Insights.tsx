import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import { formatDate, formatDateTime } from '../format';
import type { ProviderQuestion } from '../backend';
import type { Provider } from '../types';
import { Icon } from './ui/Icon';
import { ResolutionCard } from './ui/Cards';

// Insight panel tabs (improvement plan 2.2): the provider's quality and compliance record, and questions the
// family asks Claude about them (answered by a web search, with sources).

const KIND: Record<string, string> = { sanction: 'Sanction', non_compliance: 'Non-compliance', notice: 'Notice', audit: 'Audit or review', other: 'Other' };

function Source({ url, title }: { url: string; title: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[0.9rem]">
      {title || url} <Icon name="external" size={14} />
      <span className="sr-only">(opens in new tab)</span>
    </a>
  );
}

export function QualityPanel({ provider }: { provider: Provider }) {
  const { canEdit, application } = useApp();
  const { compliance, startCompliance } = useSession();
  const [error, setError] = useState<string | null>(null);
  const row = compliance.get(provider.id);
  const start = async (refresh: boolean) => {
    setError(null);
    try {
      await startCompliance(application.id, provider.id, refresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the check.');
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[0.95rem]">From the Aged Care Quality and Safety Commission's website: sanctions, notices of non-compliance, and audit findings. Checked when the provider is shortlisted.</p>
      {row?.status === 'running' && <p role="status">Checking the Commission's records… usually under two minutes.</p>}
      {row?.status === 'failed' && <p className="text-[var(--caution)]">The last check didn't finish: {row.error}</p>}
      {row?.result && (
        <>
          <p className="small">Checked {row.finished_at && formatDate(row.finished_at.slice(0, 10))}.</p>
          {row.result.findings.length === 0 ? (
            <p className={row.result.none_found ? 'text-[var(--good)]' : ''}>
              {row.result.none_found ? <Icon name="check" size={18} /> : null} {row.result.summary}
            </p>
          ) : (
            <>
              <p>{row.result.summary}</p>
              <ul className="space-y-2">
                {row.result.findings.map((f, i) => (
                  <li key={i} className="rounded-[var(--radius-control)] border border-[var(--rule)] p-3">
                    <p>
                      <b className={f.kind === 'sanction' || f.kind === 'non_compliance' ? 'text-[var(--caution)]' : ''}>{KIND[f.kind]}</b>
                      {f.date && ` · ${f.date}`}
                    </p>
                    <p>{f.text}</p>
                    <Source url={f.source_url} title={f.source_title} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {!row && <p>Not checked yet.</p>}
      {canEdit && row?.status !== 'running' && (
        <button type="button" className="btn btn-sm" onClick={() => start(!!row?.result)}>
          <Icon name="search" size={16} /> {row?.result ? 'Check again' : 'Check their record'}
        </button>
      )}
      {error && <p role="alert" className="text-[var(--stop)]">{error}</p>}
    </div>
  );
}

export function AskPanel({ provider }: { provider: Provider }) {
  const { canEdit, application } = useApp();
  const { backend } = useSession();
  const [questions, setQuestions] = useState<ProviderQuestion[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    backend
      .listQuestions(application.id, provider.id)
      .then((q) => live && setQuestions(q))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [backend, application.id, provider.id]);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const q = await backend.askQuestion(application.id, provider.id, question.trim());
      setQuestions((list) => [...list, q]);
      setQuestion('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not get an answer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[0.95rem]">Ask anything about {provider.provider}. Claude searches the web for the answer and shows where it found it. Answers are kept for your family.</p>
      {questions.length > 0 && (
        <ul className="space-y-3">
          {questions.map((q) => (
            <li key={q.id} className="space-y-1 rounded-[var(--radius-control)] border border-[var(--rule)] p-3">
              <p className="font-semibold">{q.question}</p>
              <p className="whitespace-pre-wrap">{q.answer}</p>
              {q.sources.length > 0 && (
                <ul className="space-y-0.5">
                  {q.sources.map((s) => (
                    <li key={s.url}>
                      <Source url={s.url} title={s.title} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="small">
                {q.asked_by && `${q.asked_by} · `}
                {formatDateTime(q.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="space-y-2">
          <label htmlFor={`ask-${provider.id}`} className="label">
            Your question
          </label>
          <input
            id={`ask-${provider.id}`}
            className="input"
            placeholder="e.g. Do they offer weekend visits?"
            value={question}
            maxLength={500}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && question.trim().length >= 5 && !busy && ask()}
          />
          <button type="button" className="btn" disabled={busy || question.trim().length < 5} onClick={ask}>
            {busy ? 'Searching… this can take a minute' : 'Ask Claude'}
          </button>
        </div>
      )}
      {error && (
        <ResolutionCard status="stop" title="That didn't work" role="alert">
          <p>{error}</p>
        </ResolutionCard>
      )}
    </div>
  );
}
