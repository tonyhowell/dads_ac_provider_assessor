import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import { usePlanCosts } from './usePlanCosts';
import { servesArea } from '../area';
import { formatAud, formatRate } from '../format';
import {
  lookingForInputs,
  matchProvider,
  rankMatches,
  PRIORITY_LABELS,
  VERDICT_SHORT,
  VERDICT_WORDS,
  type Level,
  type Match,
  type Reason,
  type Verdict,
} from '../matching';
import type { Claims } from '../types';
import { Icon, type IconName } from './ui/Icon';
import { Meter } from './ui/Visual';
import { ClaimsPanel } from './Claims';
import { ProviderNotes } from './ProviderNotes';
import { usePhone } from './useMinWidth';
import { ProviderDataBox } from './ProviderData';

// Shared pieces of "Find providers" (v4): the ranked matches, the insight panel and the shortlist bar.

/** Ranked whole-plan matches for providers in the applicant's area (or all, when `includeOutside`). */
export function useMatches(includeOutside = false) {
  const { providers, state, plan, areaPostcode } = useApp();
  const { claims } = useSession();
  const inArea = useMemo(() => providers.filter((p) => includeOutside || servesArea(p, areaPostcode) !== 'outside'), [providers, areaPostcode, includeOutside]);
  const { byProvider, benchmark, budget } = usePlanCosts(inArea);
  const outside = providers.length - inArea.length;
  const matches = useMemo(() => {
    const claimMap = new Map<string, Claims | null>([...claims].map(([id, row]) => [id, row.claims]));
    const ctx = { plan, answers: state.answers, claims: claimMap, benchmarkCost: benchmark, areaPostcode };
    return rankMatches(byProvider.map(({ provider, cost }) => matchProvider(provider, cost, ctx)));
  }, [byProvider, benchmark, claims, plan, state.answers, areaPostcode]);
  const { priorities, dealBreakers } = lookingForInputs(state.answers);
  return { matches, priorities, dealBreakers, budget, benchmark, outside };
}

export const VERDICT_TONE: Record<Verdict, 'good' | 'caution' | 'charcoal'> = { strong: 'good', good: 'good', partial: 'caution', weak: 'caution', unclear: 'charcoal', quote: 'charcoal' };

const LEVEL_ICON: Record<Level, { icon: IconName; cls: string; word: string }> = {
  yes: { icon: 'check', cls: 'text-[var(--good)]', word: 'Yes' },
  partly: { icon: 'minus', cls: 'text-[var(--caution)]', word: 'Partly' },
  unknown: { icon: 'help', cls: 'text-[var(--grey)]', word: 'Unknown' },
  no: { icon: 'close', cls: 'text-[var(--stop)]', word: 'No' },
};

export function LevelIcon({ level }: { level: Level }) {
  const l = LEVEL_ICON[level];
  return (
    <span className={`inline-flex shrink-0 ${l.cls}`}>
      <Icon name={l.icon} size={20} />
      <span className="sr-only">{l.word}:</span>
    </span>
  );
}

export function VerdictText({ verdict, short = false }: { verdict: Verdict; short?: boolean }) {
  const tone = VERDICT_TONE[verdict];
  return <span className={`font-semibold ${tone === 'good' ? 'text-[var(--good)]' : tone === 'caution' ? 'text-[var(--caution)]' : ''}`}>{short ? VERDICT_SHORT[verdict] : VERDICT_WORDS[verdict]}</span>;
}

/** Score meter with the verdict beside it. */
export function FitMeter({ match }: { match: Match }) {
  if (match.verdict === 'quote') return <VerdictText verdict="quote" />;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-24">
        <Meter value={match.score} max={100} tone={VERDICT_TONE[match.verdict] === 'good' ? 'good' : VERDICT_TONE[match.verdict] === 'caution' ? 'caution' : 'charcoal'} />
      </span>
      <VerdictText verdict={match.verdict} />
      <span className="sr-only">, {match.score} out of 100</span>
    </span>
  );
}

function SourceLine({ reason }: { reason: Reason }) {
  if (!reason.source) return <span className="block text-[0.9rem]">{reason.detail.startsWith('Not checked') ? 'Not checked yet' : 'Ask at interview'}</span>;
  return (
    <span className="block text-[0.9rem]">
      {reason.source.url ? (
        <a href={reason.source.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1">
          {reason.source.title} <Icon name="external" size={14} />
          <span className="sr-only">(opens in new tab)</span>
        </a>
      ) : (
        reason.source.title
      )}
    </span>
  );
}

export function ReasonList({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="space-y-2">
      {reasons.map((r) => (
        <li key={r.priority} className="flex gap-2 rounded-[var(--radius-control)] border border-[var(--rule)] p-3">
          <LevelIcon level={r.level} />
          <span className="min-w-0">
            <span className="font-semibold">{r.label}</span>
            {r.level !== 'unknown' && <span> — {r.detail}</span>}
            <SourceLine reason={r} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Adds a provider to the shortlist (the selection list) or takes it off. */
export function ShortlistButton({ match, className = '' }: { match: Match; className?: string }) {
  const { state, dispatch, canEdit } = useApp();
  const { watchPriceChecks } = useSession();
  const on = state.selection.some((e) => e.provider_id === match.provider.id);
  if (!canEdit) return on ? <span className="chip chip-outline">Shortlisted</span> : null;
  return (
    <button
      type="button"
      className={`btn ${className}`}
      aria-pressed={on}
      onClick={() => {
        dispatch(on ? { type: 'selection/remove', providerId: match.provider.id } : { type: 'selection/add', providerId: match.provider.id, at: new Date().toISOString() });
        // Shortlisting reads the provider's prices on the server; look for the result.
        if (!on) watchPriceChecks();
      }}
    >
      {on && <Icon name="check" size={20} />} {on ? 'Shortlisted' : 'Shortlist'}
      <span className="sr-only">: {match.provider.provider}</span>
    </button>
  );
}

/** Search params with one key changed (null removes it). */
export function useParamLink() {
  const [params] = useSearchParams();
  return (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v === null ? next.delete(k) : next.set(k, v));
    const s = next.toString();
    return s ? `?${s}` : '?';
  };
}

type Tab = 'why' | 'cost' | 'claims' | 'notes';

/**
 * The insight panel: why a provider fits, what it costs, what it says publicly and the family's notes.
 * `compact` is the phone version: the verdict, top reasons and cost, with the rest one tap away.
 */
export function InsightPanel({ match, position, next, closeTo, compact = false, extra }: { match: Match; position?: string; next?: Match; closeTo: string; compact?: boolean; extra?: ReactNode }) {
  const { state } = useApp();
  const { claims } = useSession();
  const link = useParamLink();
  const [tab, setTab] = useState<Tab>('why');
  const p = match.provider;
  const claimCount = claims.get(p.id)?.claims?.items.length ?? 0;
  const noteCount = state.notes.filter((n) => n.provider_id === p.id).length;
  const over = match.cost.over_budget;

  const costLine = match.verdict !== 'quote' && (
    <div className="well">
      <p className="font-semibold">{formatAud(match.cost.quarterly_cost)} a quarter</p>
      {over !== null && <p className={over > 0 ? 'text-[var(--caution)]' : 'text-[var(--good)]'}>{over > 0 ? `${formatAud(over)} more than your budget` : `${formatAud(-over)} within your budget`}</p>}
      {match.missing.length > 0 && <p className="text-[0.95rem]">Includes price-guide rates for {match.missing.join(', ').toLowerCase()}: no published price.</p>}
    </div>
  );

  if (compact) {
    return (
      <section aria-labelledby="insight-title" className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Link to={closeTo} className="btn-quiet">
            <Icon name="arrowLeft" size={20} /> Matches
          </Link>
          {position && <span className="text-[0.95rem]">{position}</span>}
        </div>
        <div>
          <h2 id="insight-title" className="text-[1.6rem]">
            {p.provider}
          </h2>
          <p>
            <VerdictText verdict={match.verdict} />. {match.summary}
          </p>
        </div>
        <ProviderDataBox provider={p} />
        <ReasonList reasons={match.reasons} />
        {match.cautions.map((c) => (
          <p key={c.text} className="text-[var(--caution)]">
            <Icon name="triangle" size={18} /> {c.text}
          </p>
        ))}
        {costLine}
        <nav aria-label={`More about ${p.provider}`} className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
          <Link to={`/providers/${p.id}`} className="flex min-h-[52px] items-center justify-between no-underline">
            <span>What they say publicly</span>
            <span>{claimCount} ›</span>
          </Link>
          <Link to={`/providers/${p.id}`} className="flex min-h-[52px] items-center justify-between no-underline">
            <span>Your notes</span>
            <span>{noteCount} · Add ›</span>
          </Link>
        </nav>
        <p className="text-[0.9rem]">Scores, full prices and the dossier are on a bigger screen.</p>
        <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-[var(--rule)] bg-[var(--surface)] p-3">
          <ShortlistButton match={match} className="flex-1" />
          {next && (
            <Link to={link({ p: next.provider.id })} className="btn">
              Next <span className="sr-only">: {next.provider.provider}</span> ›
            </Link>
          )}
        </div>
      </section>
    );
  }

  const tabs: [Tab, string][] = [
    ['why', 'Why it fits'],
    ['cost', 'Cost'],
    ['claims', `Public claims${claimCount ? ` ${claimCount}` : ''}`],
    ['notes', `Notes${noteCount ? ` ${noteCount}` : ''}`],
  ];
  return (
    <section aria-labelledby="insight-title" className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          {position && <p className="text-[0.9rem]">Insight · {position}</p>}
          <h2 id="insight-title" className="text-[1.5rem]">
            {p.provider}
          </h2>
          {(p.type || p.outlet) && <p className="text-[0.95rem]">{[p.type, p.outlet].filter(Boolean).join(' · ')}</p>}
        </div>
        <Link to={closeTo} className="btn btn-sm" aria-label="Close insight">
          <Icon name="close" size={20} />
        </Link>
      </div>
      <div className="flex items-center gap-3 rounded-[var(--radius-control)] bg-[var(--sunken)] p-3">
        {match.verdict !== 'quote' && <span className="text-[2rem] leading-none font-bold">{match.score}</span>}
        <p>
          <VerdictText verdict={match.verdict} />. {match.summary}
        </p>
      </div>
      <ProviderDataBox provider={p} />
      {extra}
      <div role="tablist" aria-label={`About ${p.provider}`} className="flex flex-wrap gap-1 border-b-2 border-[var(--charcoal)]">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            className={`min-h-[var(--target-min)] rounded-t-[var(--radius-control)] px-3 ${tab === t ? 'bg-[var(--charcoal)] font-semibold text-[var(--surface)]' : ''}`}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-3">
        {tab === 'why' && (
          <>
            {match.reasons.length > 0 ? <ReasonList reasons={match.reasons} /> : <p>Tell us what matters most in “What I'm looking for” and we'll say how they fit.</p>}
            {match.cautions.map((c) => (
              <p key={c.text} className="flex gap-2 text-[var(--caution)]">
                <Icon name="triangle" size={20} /> <span>{c.dealBreaker ? <b>One of your deal-breakers: </b> : null}{c.text}</span>
              </p>
            ))}
            <details className="border-t border-[var(--rule)] pt-2">
              <summary className="cursor-pointer font-semibold">How the {match.verdict === 'quote' ? 'match' : match.score} is worked out</summary>
              <table className="data-table mt-2">
                <tbody>
                  {match.parts.map((part) => (
                    <tr key={part.label}>
                      <td>{part.label}</td>
                      <td className="text-right">
                        {Math.round(part.got)} / {part.max}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[0.9rem]">
                Your first priority counts most. Things we couldn't find score nothing, but don't count against the provider — ask about them at interview. When more than half of your
                priorities are unknown, we say “Not enough known”.
              </p>
            </details>
          </>
        )}
        {tab === 'cost' && (
          <>
            {costLine || <p>No published prices for your services. Ask for a quote.</p>}
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Per hour</th>
                </tr>
              </thead>
              <tbody>
                {match.cost.lines.map((l) => (
                  <tr key={l.key}>
                    <td>{l.service}</td>
                    <td>{l.filled_from_benchmark ? `No price (guide ${formatRate(l.price)})` : formatRate(l.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {tab === 'claims' && <ClaimsPanel provider={p} />}
        {tab === 'notes' && <ProviderNotes providerId={p.id} />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ShortlistButton match={match} />
        <Link to={`/providers/${p.id}`} className="btn">
          Full profile
        </Link>
        {next && (
          <Link to={link({ p: next.provider.id })} className="btn-quiet ml-auto">
            Next: {next.provider.provider} <Icon name="arrowRight" size={20} />
          </Link>
        )}
      </div>
    </section>
  );
}

/** Sticky bar with the shortlist count and the way on. */
export function ShortlistBar({ children }: { children?: ReactNode }) {
  const { state } = useApp();
  const n = state.selection.length;
  const phone = usePhone();
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 bg-[var(--header-bg)] px-4 py-3 text-[var(--on-dark)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children ?? <span><b>{n}</b> shortlisted</span>}</div>
        <Link to="/compare" className="btn btn-primary">
          {phone ? 'Compare' : 'Compare and choose who to meet'} <Icon name="arrowRight" size={20} />
        </Link>
      </div>
    </div>
  );
}

export const priorityWords = (ids: string[]) => ids.map((id) => PRIORITY_LABELS[id as keyof typeof PRIORITY_LABELS] ?? id);
