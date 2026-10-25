import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { formatDateTime, formatDuration } from '../format';

export function InterviewList({ providerId }: { providerId: string }) {
  const { state } = useApp();
  const interviews = state.interviews
    .filter((i) => i.provider_id === providerId)
    .sort((a, b) => b.started_at.localeCompare(a.started_at));

  if (interviews.length === 0) return <p className="muted mt-2">No interviews recorded.</p>;
  return (
    <ul className="mt-2 space-y-1">
      {interviews.map((i) => (
        <li key={i.id}>
          <Link to={`/interviews/${i.id}`}>{formatDateTime(i.started_at)}</Link>
          <span className="muted">
            {' '}
            · {i.audio_id ? formatDuration(i.duration_seconds) : 'no recording'} · {i.notes ? 'notes drafted' : 'no notes yet'}
          </span>
        </li>
      ))}
    </ul>
  );
}
