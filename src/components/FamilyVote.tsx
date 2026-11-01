import { useApp } from '../state/AppContext';
import { useAuth } from '../auth/AuthContext';
import { useMembers } from '../screens/GatherScreen';
import { isVoter, voteResult } from '../family';
import type { Provider } from '../types';
import { Icon } from './ui/Icon';

// The family vote on who to interview (improvement plan 3.1): each voter picks up to three from the shortlist.
// Results show once everyone has voted; the applicant's picks break ties. The coordinator then moves the
// chosen providers to "to interview".

export function FamilyVote({ shortlist }: { shortlist: Provider[] }) {
  const { state, dispatch, canEdit, role } = useApp();
  const { user } = useAuth();
  const members = useMembers();
  const voters = members.filter((m) => isVoter(m, state.gather.applicantUserId));
  const votes = state.select.votes;
  const mine = user ? (votes[user.id]?.picks ?? []) : [];
  const voted = voters.filter((m) => votes[m.user_id]);
  const everyone = voters.length > 0 && voted.length === voters.length;
  const result = voteResult(state, shortlist.map((p) => p.id));
  const name = (id: string) => shortlist.find((p) => p.id === id)?.provider ?? id;
  const canVote = canEdit && !!user && (voters.length === 0 || voters.some((m) => m.user_id === user.id));

  const toggle = (id: string) => {
    const next = mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id].slice(0, 3);
    dispatch({ type: 'select/vote', userId: user?.id ?? '', name: user?.display_name ?? '', picks: next, at: new Date().toISOString() });
  };
  const applyResult = () => {
    const at = new Date().toISOString();
    for (const p of shortlist) {
      const entry = state.selection.find((e) => e.provider_id === p.id);
      const target = result.chosen.includes(p.id) ? 'interview' : 'refine';
      if (entry && entry.stage !== target) dispatch({ type: 'selection/stage', providerId: p.id, stage: target, at });
    }
  };

  if (shortlist.length < 2) return null;
  return (
    <section className="card space-y-3" aria-labelledby="vote-heading">
      <h2 id="vote-heading" className="text-[1.2rem]">
        Family vote: who should we meet?
      </h2>
      <p>
        Each person picks up to three. Results show once everyone has voted{state.gather.applicantUserId ? "; the applicant's picks break any tie" : ''}.{' '}
        <span className="font-medium">
          {voted.length} of {voters.length || '…'} voted
        </span>
        {voters.length > 0 && !everyone && <span className="small"> (waiting for {voters.filter((m) => !votes[m.user_id]).map((m) => m.display_name).join(', ')})</span>}
      </p>
      {canVote && (
        <fieldset>
          <legend className="label">Your picks ({mine.length} of 3)</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {shortlist.map((p) => (
              <button key={p.id} type="button" className="btn" aria-pressed={mine.includes(p.id)} disabled={!mine.includes(p.id) && mine.length >= 3} onClick={() => toggle(p.id)}>
                {mine.includes(p.id) && <Icon name="check" size={18} />} {p.provider}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {everyone ? (
        <div className="well space-y-2">
          <p className="font-semibold">The family's choice: {result.chosen.map(name).join(', ') || 'no picks yet'}</p>
          <ol className="list-decimal pl-6">
            {result.ranked.map((r) => (
              <li key={r.providerId}>
                {name(r.providerId)}: {r.votes} vote{r.votes === 1 ? '' : 's'}
                {r.applicantPicked && state.gather.applicantUserId ? ' · the applicant picked this' : ''}
              </li>
            ))}
          </ol>
          {role === 'coordinator' && result.chosen.length > 0 && (
            <button type="button" className="btn btn-primary" onClick={applyResult}>
              Interview {result.chosen.length === 1 ? 'this provider' : `these ${result.chosen.length}`}
            </button>
          )}
        </div>
      ) : (
        <p className="small">Results stay hidden until everyone has voted, so no one is swayed.</p>
      )}
    </section>
  );
}
