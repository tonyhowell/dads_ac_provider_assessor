import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { InterviewList } from '../components/InterviewList';
import { entriesAt } from '../state/reducer';
import { ScreenHeader } from '../components/ui/Cards';
import { MoreText } from '../components/ui/Expander';

export function InterviewsScreen() {
  const { providers, state } = useApp();
  const shortlistIds = entriesAt(state, 'interview').map((e) => e.provider_id);
  const shortlisted = new Set(shortlistIds);
  // Interview shortlist first (in rank order), then any others that have interviews.
  const providerIds = [
    ...shortlistIds,
    ...new Set(state.interviews.map((i) => i.provider_id).filter((id) => !shortlisted.has(id))),
  ];
  const byId = new Map(providers.map((p) => [p.id, p]));

  return (
    <section className="space-y-6">
      <ScreenHeader
        title="Record or note an interview"
        purpose={
          <>
            Record an interview, then turn it into notes you can check and keep.{' '}
            <MoreText text="Who sees what? Transcripts and notes are shared with your family; recordings stay on the device that made them." />
          </>
        }
        helpTopic="interviews"
      />

      {providerIds.length === 0 ? (
        <div className="card">
          <p>Move providers to "Providers to interview" first, then record your interviews here.</p>
          <p className="mt-2">
            <Link to="/selection/interview">Choose who to meet</Link>
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {providerIds.map((id) => {
            const provider = byId.get(id);
            if (!provider) return null;
            return (
              <li key={id} className="card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[1.2rem]">
                    <Link to={`/providers/${id}`}>{provider.provider}</Link>
                    {!shortlisted.has(id) && <span className="muted font-normal"> (not on the interview shortlist)</span>}
                  </h2>
                  <Link to={`/interviews/new/${id}`} className="btn">
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
