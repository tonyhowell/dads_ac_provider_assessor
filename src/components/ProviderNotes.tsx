import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { newId } from '../state/reducer';
import { formatDateTime } from '../format';
import { ConfirmButton } from './ConfirmButton';
import type { ProviderNote } from '../types';

export function ProviderNotes({ providerId }: { providerId: string }) {
  const { state, dispatch } = useApp();
  const [draft, setDraft] = useState('');
  const notes = state.notes
    .filter((n) => n.provider_id === providerId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const add = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    dispatch({
      type: 'note/add',
      note: { id: newId(), provider_id: providerId, text, created_at: new Date().toISOString(), source: 'manual' },
    });
    setDraft('');
  };

  return (
    <section aria-labelledby="notes-heading" className="card">
      <h2 id="notes-heading" className="text-lg font-semibold">
        Assessment notes
      </h2>
      <form onSubmit={add} className="mt-3 space-y-2">
        <label htmlFor="new-note" className="muted block">
          Add a note (phone calls, impressions, things to check)
        </label>
        <textarea id="new-note" className="input min-h-24" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
          Add note
        </button>
      </form>

      {notes.length === 0 ? (
        <p className="muted mt-4">No notes yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {notes.map((n) => (
            <NoteItem key={n.id} note={n} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteItem({ note }: { note: ProviderNote }) {
  const { dispatch } = useApp();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);

  const save = () => {
    const t = text.trim();
    if (!t) return;
    dispatch({ type: 'note/edit', id: note.id, text: t, at: new Date().toISOString() });
    setEditing(false);
  };

  return (
    <li className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
      <p className="muted text-xs">
        {note.author && `${note.author} · `}
        {formatDateTime(note.created_at)}
        {note.updated_at && ` · edited ${formatDateTime(note.updated_at)}`}
        {note.source === 'interview' && (
          <>
            {' · '}
            {note.interview_id ? <Link to={`/interviews/${note.interview_id}`}>from interview</Link> : 'from interview'}
          </>
        )}
      </p>
      {editing ? (
        <div className="mt-2 space-y-2">
          <label htmlFor={`edit-${note.id}`} className="sr-only">
            Edit note
          </label>
          <textarea id={`edit-${note.id}`} className="input min-h-24" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={save} disabled={!text.trim()}>
              Save
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setText(note.text);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 whitespace-pre-wrap">{note.text}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
            <ConfirmButton prompt="Delete this note?" confirmLabel="Delete" onConfirm={() => dispatch({ type: 'note/delete', id: note.id })}>
              Delete
            </ConfirmButton>
          </div>
        </>
      )}
    </li>
  );
}
