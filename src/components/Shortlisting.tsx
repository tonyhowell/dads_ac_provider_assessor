import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { useAuth } from '../auth/AuthContext';
import { lookingForInputs, PRIORITY_LABELS } from '../matching';
import { formatDateTime } from '../format';
import { newId } from '../state/reducer';
import { Icon } from './ui/Icon';

// Shortlisting (improvement plan 2.4): quick reasons for shortlisting, family reactions and notes from a phone
// call. Reasons are kept in the shortlist entry's "why", so they carry into the comparison and interviews.

const EXTRA_REASONS = ['Price', 'Local', 'Recommended to us', 'Good first call'];
const split = (why: string) => why.split(/,\s*/).map((s) => s.trim()).filter(Boolean);

export function QuickReasons({ providerId, compact = false }: { providerId: string; compact?: boolean }) {
  const { state, dispatch, canEdit } = useApp();
  const entry = state.selection.find((e) => e.provider_id === providerId);
  if (!entry) return null;
  const chosen = split(entry.why);
  const { priorities } = lookingForInputs(state.answers);
  const options = [...new Set([...priorities.map((p) => PRIORITY_LABELS[p]), ...EXTRA_REASONS])];
  const toggle = (r: string) => {
    const next = chosen.includes(r) ? chosen.filter((x) => x !== r) : [...chosen, r];
    dispatch({ type: 'selection/update', providerId, why: next.join(', ') });
  };
  if (!canEdit) return chosen.length ? <p className="text-[0.95rem]">Why shortlisted: {chosen.join(', ')}</p> : null;
  return (
    <div role="group" aria-label="Why shortlist them?" className="flex flex-wrap items-center gap-1.5">
      <span className={compact ? 'small' : 'font-medium'}>Why?</span>
      {options.map((r) => (
        <button key={r} type="button" className="btn btn-sm min-h-[36px] px-2.5" aria-pressed={chosen.includes(r)} onClick={() => toggle(r)}>
          {chosen.includes(r) && <Icon name="check" size={14} />} {r}
        </button>
      ))}
    </div>
  );
}

export function Reactions({ providerId }: { providerId: string }) {
  const { state, dispatch, canEdit } = useApp();
  const { user } = useAuth();
  const list = state.find.reactions[providerId] ?? [];
  const mine = list.find((r) => r.user_id === user?.id);
  const [comment, setComment] = useState(mine?.comment ?? '');
  const react = (value: 'up' | 'down' | null) =>
    dispatch({ type: 'find/react', providerId, reaction: { user_id: user?.id ?? '', name: user?.display_name ?? '', value, comment: value ? comment.trim() : '', at: new Date().toISOString() } });
  const ups = list.filter((r) => r.value === 'up').length;
  const downs = list.filter((r) => r.value === 'down').length;
  return (
    <div className="space-y-2">
      <p className="font-medium">
        Family reactions {list.length > 0 && <span className="font-normal">· {ups} up, {downs} down</span>}
      </p>
      {list.length > 0 && (
        <ul className="space-y-1 text-[0.95rem]">
          {list.map((r) => (
            <li key={r.user_id}>
              <Icon name={r.value === 'up' ? 'check' : 'close'} size={16} label={r.value === 'up' ? 'Thumbs up' : 'Thumbs down'} /> <b>{r.name || 'Someone'}</b>
              {r.comment && `: “${r.comment}”`} <span className="small">· {formatDateTime(r.at)}</span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <input className="input w-auto flex-1" aria-label="Your comment (optional)" placeholder="A comment (optional)" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
          <button type="button" className="btn btn-sm" aria-pressed={mine?.value === 'up'} onClick={() => react(mine?.value === 'up' ? null : 'up')}>
            <Icon name="check" size={16} /> Thumbs up
          </button>
          <button type="button" className="btn btn-sm" aria-pressed={mine?.value === 'down'} onClick={() => react(mine?.value === 'down' ? null : 'down')}>
            <Icon name="close" size={16} /> Thumbs down
          </button>
        </div>
      )}
    </div>
  );
}

export function CallNote({ providerId, providerName }: { providerId: string; providerName: string }) {
  const { dispatch, canEdit } = useApp();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');
  const [said, setSaid] = useState('');
  const [when, setWhen] = useState('');
  const [saved, setSaved] = useState(false);
  if (!canEdit) return null;
  const save = () => {
    const text = [`Phone call${who.trim() ? ` with ${who.trim()}` : ''}.`, said.trim(), when.trim() && `Availability: ${when.trim()}`].filter(Boolean).join('\n');
    dispatch({ type: 'note/add', note: { id: newId(), provider_id: providerId, text, created_at: new Date().toISOString(), source: 'call' } });
    setWho('');
    setSaid('');
    setWhen('');
    setOpen(false);
    setSaved(true);
  };
  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={() => (setOpen(true), setSaved(false))}>
          <Icon name="note" size={16} /> I rang them
        </button>
        {saved && <span role="status">Call note saved to Notes.</span>}
      </div>
    );
  return (
    <fieldset className="space-y-2 rounded-[var(--radius-control)] border border-[var(--rule)] p-3">
      <legend className="font-medium">Notes from a call to {providerName}</legend>
      <label className="block">
        <span className="label">Who you spoke to</span>
        <input className="input" value={who} onChange={(e) => setWho(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">What they said</span>
        <textarea className="input min-h-20" value={said} onChange={(e) => setSaid(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">Availability</span>
        <input className="input" placeholder="e.g. can start in two weeks; Tuesday mornings" value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm btn-primary" disabled={!said.trim() && !when.trim()} onClick={save}>
          Save call note
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </fieldset>
  );
}
