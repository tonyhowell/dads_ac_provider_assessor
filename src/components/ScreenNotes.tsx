import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { newId } from '../state/reducer';
import { formatDateTime } from '../format';
import { locate } from '../phases';
import { Icon } from './ui/Icon';

/** Family notes on any screen (UI-SPEC §5.9): shown at the top of that screen until marked done. */
export function ScreenNotes() {
  const { state, dispatch, canEdit } = useApp();
  const { pathname } = useLocation();
  const route = locate(pathname)?.screen.to ?? pathname;
  const notes = state.screenNotes.filter((n) => n.route === route && !n.done);
  const doneCount = state.screenNotes.filter((n) => n.route === route && n.done).length;
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    dispatch({ type: 'screenNote/add', note: { id: newId(), route, text: text.trim(), created_at: new Date().toISOString(), done: false } });
    setText('');
    setWriting(false);
  };

  return (
    <div className="no-print mb-4 space-y-2">
      {notes.map((n) => (
        <div key={n.id} className="card tone-info flex flex-wrap items-start gap-3 border-l-4 p-4">
          <span className="status-info mt-0.5">
            <Icon name="note" size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Note from {n.author ?? 'the family'}</p>
            <p className="whitespace-pre-wrap">{n.text}</p>
            <p className="muted">{formatDateTime(n.created_at)}</p>
          </div>
          {canEdit && (
            <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'screenNote/done', id: n.id, done: true })}>
              <Icon name="check" size={18} /> Mark done
            </button>
          )}
        </div>
      ))}
      {writing ? (
        <form onSubmit={add} className="card space-y-2 p-4">
          <label htmlFor="screen-note" className="label">
            Note for the family on this screen
          </label>
          <span className="hint">Everyone who signs in sees it here until someone marks it done.</span>
          <textarea id="screen-note" className="input" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <button type="submit" className="btn">
              Leave note
            </button>
            <button type="button" className="btn" onClick={() => setWriting(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="flex flex-wrap items-center gap-3">
          {canEdit && (
            <button type="button" className="btn-quiet" onClick={() => setWriting(true)}>
              <Icon name="note" size={20} /> Leave a note for the family
            </button>
          )}
          {doneCount > 0 && <span className="muted">{doneCount} done</span>}
        </p>
      )}
    </div>
  );
}
