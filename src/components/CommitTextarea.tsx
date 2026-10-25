import { useEffect, useState } from 'react';

/**
 * Textarea that saves when the user leaves it, not on every keystroke, so shared state
 * gets one change per edit. Picks up changes made by others while it isn't being edited.
 */
export function CommitTextarea({ id, value, onCommit, className = 'input min-h-20' }: { id: string; value: string; onCommit: (v: string) => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  return (
    <textarea
      id={id}
      className={className}
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}
