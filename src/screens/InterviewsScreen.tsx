import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { InterviewList } from '../components/InterviewList';

export function InterviewsScreen() {
  const { seed, state } = useApp();
  const shortlisted = new Set(state.shortlist.map((e) => e.provider_id));
  // Shortlisted providers first (in rank order), then any others that have interviews.
  const providerIds = [
    ...state.shortlist.map((e) => e.provider_id),
    ...new Set(state.interviews.map((i) => i.provider_id).filter((id) => !shortlisted.has(id))),
  ];
  const byId = new Map(seed.providers.map((p) => [p.id, p]));

  return (
    <section>
      <h1 className="text-2xl font-semibold">Interviews</h1>
      <p className="muted mt-1">
        Record each provider interview, then turn the transcript into draft notes. Recordings stay on this device.
      </p>

      {providerIds.length === 0 ? (
        <div className="card mt-4">
          <p>Shortlist some providers first, then record your interviews with them here.</p>
          <p className="mt-2">
            <Link to="/providers">Go to providers</Link>
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {providerIds.map((id) => {
            const provider = byId.get(id);
            if (!provider) return null;
            return (
              <li key={id} className="card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">
                    <Link to={`/providers/${id}`}>{provider.provider}</Link>
                    {!shortlisted.has(id) && <span className="muted font-normal"> (not shortlisted)</span>}
                  </h2>
                  <Link to={`/interviews/new/${id}`} className="btn btn-primary no-underline hover:no-underline">
                    Record interview <span className="sr-only">with {provider.provider}</span>
                  </Link>
                </div>
                <InterviewList providerId={id} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
