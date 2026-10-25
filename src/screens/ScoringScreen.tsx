import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { entriesAt } from '../state/reducer';
import { CRITERIA, effectiveWeights, failedMustQuestions, rank, scoreKey, suggestedPriceScore } from '../scoring';
import { usePlanCosts } from '../components/usePlanCosts';
import { CommitTextarea } from '../components/CommitTextarea';

export function ScoringScreen() {
  const { seed, state, providers, dispatch } = useApp();
  const shortlist = entriesAt(state, 'interview').flatMap((e) => providers.filter((p) => p.id === e.provider_id));
  const weights = effectiveWeights(state.weights);
  const ranked = rank(shortlist, state.scores, weights);
  const { benchmark, byProvider } = usePlanCosts(shortlist);
  const priceHint = (id: string) => {
    const c = byProvider.find((r) => r.provider.id === id)?.cost;
    const ownPrices = c?.lines.some((l) => l.hours_per_week > 0 && !l.filled_from_benchmark && l.price !== null);
    return c && ownPrices ? suggestedPriceScore(c.quarterly_cost, benchmark.quarterly_cost) : null;
  };
  const priorities = state.answers['B8.1'];

  if (shortlist.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Scoring and decision</h1>
        <p className="card">
          Score providers once they're on the interview shortlist. <Link to="/selection/interview">Go to stage 3</Link>.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Scoring and decision</h1>
        <p className="muted mt-1">Score each interviewed provider from 1 (poor) to 5 (excellent). The weighted total ranks them; change the weights to match what matters most.</p>
      </div>

      {(priorities?.answer || priorities?.notes) && (
        <p className="card text-sm">
          <strong>What matters most to him (B8.1):</strong> {priorities.notes || priorities.answer}
        </p>
      )}

      <section className="card space-y-2" aria-labelledby="ranking-heading">
        <h2 id="ranking-heading" className="font-semibold">
          Ranking
        </h2>
        <ol className="space-y-2">
          {ranked.map((r, i) => {
            const failed = failedMustQuestions(r.provider.id, seed.interviewSections, state.responses);
            return (
              <li key={r.provider.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-6 text-right font-semibold tabular-nums">{r.total === null ? '–' : i + 1}</span>
                <Link to={`/providers/${r.provider.id}`} className="font-medium">
                  {r.provider.provider}
                </Link>
                <span className="tabular-nums">{r.total === null ? 'not scored' : `${r.total.toFixed(2)} / 5`}</span>
                <span className="muted text-sm">
                  {r.scored} of {CRITERIA.length} criteria scored
                </span>
                {failed.length > 0 && (
                  <Link
                    to="/interview-pack"
                    className="rounded bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-900 no-underline dark:bg-orange-900 dark:text-orange-100"
                    title={`Must questions without a satisfactory written answer: ${failed.join(', ')}`}
                  >
                    Disqualify? {failed.length} must question{failed.length === 1 ? '' : 's'} not answered in writing
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="card space-y-2" aria-labelledby="matrix-heading">
        <h2 id="matrix-heading" className="font-semibold">
          Scores
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left align-bottom">
                <th scope="col" className="py-1 pr-3">Criterion</th>
                <th scope="col" className="py-1 pr-3">Weight</th>
                {shortlist.map((p) => (
                  <th key={p.id} scope="col" className="py-1 pr-3">
                    {p.provider}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CRITERIA.map((c) => (
                <tr key={c.id} className="border-t border-slate-200 align-top dark:border-slate-800">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {c.label}
                  </th>
                  <td className="py-2 pr-3">
                    <label htmlFor={`w-${c.id}`} className="sr-only">
                      Weight for {c.label}
                    </label>
                    <select
                      id={`w-${c.id}`}
                      className="input w-16"
                      value={weights[c.id]}
                      onChange={(e) => dispatch({ type: 'weight/set', criterion: c.id, weight: Number(e.target.value) })}
                    >
                      {[0, 1, 2, 3, 4, 5].map((w) => (
                        <option key={w} value={w}>
                          ×{w}
                        </option>
                      ))}
                    </select>
                  </td>
                  {shortlist.map((p) => {
                    const value = state.scores[scoreKey(p.id, c.id)];
                    const hint = c.id === 'price' ? priceHint(p.id) : null;
                    return (
                      <td key={p.id} className="py-2 pr-3">
                        <label htmlFor={`s-${p.id}-${c.id}`} className="sr-only">
                          {c.label} score for {p.provider}
                        </label>
                        <select
                          id={`s-${p.id}-${c.id}`}
                          className="input w-20"
                          value={value ?? ''}
                          onChange={(e) =>
                            dispatch({ type: 'score/set', providerId: p.id, criterion: c.id, score: e.target.value === '' ? null : Number(e.target.value) })
                          }
                        >
                          <option value="">—</option>
                          {[1, 2, 3, 4, 5].map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        {hint !== null && value === undefined && (
                          <button
                            type="button"
                            className="mt-1 block text-xs text-teal-700 underline dark:text-teal-300"
                            onClick={() => dispatch({ type: 'score/set', providerId: p.id, criterion: 'price', score: hint })}
                          >
                            Use suggested {hint} <span className="sr-only">for {p.provider}</span>
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted text-xs">
          Suggested price scores compare the care plan's cost with the IHACPA benchmark: 10%+ below is 5, within 5% is 3, 10%+ above is 1. A weight of ×0 leaves a criterion out.
        </p>
      </section>

      <section className="card space-y-2" aria-labelledby="decision-heading">
        <h2 id="decision-heading" className="font-semibold">
          Decision notes
        </h2>
        <label htmlFor="decision" className="sr-only">
          Decision notes
        </label>
        <CommitTextarea id="decision" className="input min-h-32" value={state.decisionNotes} onCommit={(text) => dispatch({ type: 'decision/set', text })} />
        <p className="muted text-xs">Shared with the family. Saved when you leave the box.</p>
      </section>
    </section>
  );
}
