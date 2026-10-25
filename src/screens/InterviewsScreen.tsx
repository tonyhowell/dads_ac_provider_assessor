import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { InterviewList } from '../components/InterviewList';
import { entriesAt } from '../state/reducer';

export function InterviewsScreen() {
  const { seed, state } = useApp();
  const shortlistIds = entriesAt(state, 'interview').map((e) => e.provider_id);
  const shortlisted = new Set(shortlistIds);
  // Interview shortlist first (in rank order), then any others that have interviews.
  const providerIds = [
    ...shortlistIds,
    ...new Set(state.interviews.map((i) => i.provider_id).filter((id) => !shortlisted.has(id))),
  ];
  const byId = new Map(seed.providers.map((p) => [p.id, p]));

  return (
    <section>
      <h1 className="text-2xl font-semibold">Interviews</h1>
      <p className="muted mt-1">
        Record each provider interview, then turn the transcript into draft notes. Transcripts and notes are shared with the family; recordings stay on the device that made them.
      </p>

      {providerIds.length === 0 ? (
        <div className="card mt-4">
          <p>Advance providers to the interview shortlist (stage 3), then record your interviews with them here.</p>
          <p className="mt-2">
            <Link to="/selection">Go to provider selection</Link>
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
                    {!shortlisted.has(id) && <span className="muted font-normal"> (not on the interview shortlist)</span>}
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
