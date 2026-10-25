import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { PriceProvenance } from '../components/Price';

export function ShortlistScreen() {
  const { seed, state, dispatch } = useApp();
  const byId = new Map(seed.providers.map((p) => [p.id, p]));
  const entries = state.shortlist.flatMap((e) => {
    const provider = byId.get(e.provider_id);
    return provider ? [{ entry: e, provider }] : [];
  });

  return (
    <section>
      <h1 className="text-2xl font-semibold">Shortlist</h1>
      <p className="muted mt-1">
        The providers you have chosen to pursue, in order of preference. Record why each made the list and what to probe at interview.
      </p>

      {entries.length === 0 ? (
        <div className="card mt-4">
          <p>No providers shortlisted yet.</p>
          <p className="mt-2">
            <Link to="/providers">Choose providers from the full list</Link>
          </p>
        </div>
      ) : (
        <ol className="mt-4 space-y-3">
          {entries.map(({ entry, provider }, index) => {
            const interviewCount = state.interviews.filter((i) => i.provider_id === provider.id).length;
            return (
              <li key={provider.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">
                      <span className="mr-2 inline-block min-w-6 rounded bg-teal-700 px-1.5 text-center text-white dark:bg-teal-600" aria-hidden>
                        {index + 1}
                      </span>
                      <span className="sr-only">Rank {index + 1}: </span>
                      <Link to={`/providers/${provider.id}`}>{provider.provider}</Link>
                    </h2>
                    <PriceProvenance provider={provider} />
                    <p className="muted">
                      {interviewCount} interview{interviewCount === 1 ? '' : 's'} recorded
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn"
                      disabled={index === 0}
                      onClick={() => dispatch({ type: 'shortlist/move', providerId: provider.id, toIndex: index - 1 })}
                    >
                      Move up <span className="sr-only">{provider.provider}</span>
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={index === entries.length - 1}
                      onClick={() => dispatch({ type: 'shortlist/move', providerId: provider.id, toIndex: index + 1 })}
                    >
                      Move down <span className="sr-only">{provider.provider}</span>
                    </button>
                    <Link to={`/interviews/new/${provider.id}`} className="btn no-underline hover:no-underline">
                      Record interview
                    </Link>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => dispatch({ type: 'shortlist/remove', providerId: provider.id })}
                    >
                      Remove <span className="sr-only">{provider.provider}</span>
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <label htmlFor={`why-${provider.id}`} className="muted block">
                      Why it's on the list
                    </label>
                    <textarea
                      id={`why-${provider.id}`}
                      className="input min-h-20"
                      value={entry.why}
                      onChange={(e) => dispatch({ type: 'shortlist/update', providerId: provider.id, why: e.target.value })}
                    />
                  </div>
                  <div>
                    <label htmlFor={`watch-${provider.id}`} className="muted block">
                      Probe at interview
                    </label>
                    <textarea
                      id={`watch-${provider.id}`}
                      className="input min-h-20"
                      value={entry.watch}
                      onChange={(e) => dispatch({ type: 'shortlist/update', providerId: provider.id, watch: e.target.value })}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
