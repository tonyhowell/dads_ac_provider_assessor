import { useState, type ReactNode } from 'react';

/** A destructive button that asks for confirmation on the page itself (browser confirm dialogs can be blocked). */
export function ConfirmButton({
  children,
  confirmLabel,
  prompt,
  onConfirm,
  className = 'btn btn-danger',
}: {
  children: ReactNode;
  confirmLabel: string;
  prompt: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  }
  return (
    <span role="group" aria-label={prompt} className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm">{prompt}</span>
      <button
        type="button"
        className="btn btn-danger"
        autoFocus
        onClick={async () => {
          await onConfirm();
          setAsking(false);
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="btn" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
