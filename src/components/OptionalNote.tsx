import { useState, type ReactNode } from 'react';
import { CommitTextarea } from './CommitTextarea';
import { Icon } from './ui/Icon';

/**
 * A note field that stays out of the way: a short "Add a note" button until there's something to say.
 * Once written, the note shows as text with an Edit button. Saves when the box loses focus.
 */
export function OptionalNote({ id, label, addLabel, hint, value, onCommit }: { id: string; label: string; addLabel?: string; hint?: ReactNode; value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [full, setFull] = useState(false);
  const long = value.length > 90;
  if (editing) {
    return (
      <div>
        <label htmlFor={id} className="label">
          {label}
        </label>
        {hint && <span className="hint">{hint}</span>}
        <CommitTextarea
          id={id}
          className="input min-h-20"
          value={value}
          autoFocus
          onCommit={onCommit}
          onDone={() => setEditing(false)}
        />
      </div>
    );
  }
  if (value.trim()) {
    return (
      <div className="well space-y-1">
        <p className="text-[0.95rem] font-medium">{label}</p>
        <p className={`whitespace-pre-wrap ${long && !full ? 'line-clamp-2' : ''}`}>{value}</p>
        <div className="flex flex-wrap gap-x-4">
          {long && (
            <button type="button" className="btn-quiet no-print" aria-expanded={full} onClick={() => setFull(!full)}>
              {full ? 'Show less' : 'Show all'} <span className="sr-only">{label.toLowerCase()}</span>
            </button>
          )}
          <button type="button" className="btn-quiet" onClick={() => setEditing(true)}>
            <Icon name="edit" size={18} /> Edit <span className="sr-only">{label.toLowerCase()}</span>
          </button>
        </div>
      </div>
    );
  }
  return (
    <button type="button" className="btn-quiet" onClick={() => setEditing(true)}>
      <Icon name="plus" size={20} /> {addLabel ?? `Add ${label.toLowerCase()}`}
    </button>
  );
}
