import type { ReactNode } from 'react';
import { Icon } from './Icon';

/** Inline undo bar that stays until dismissed or replaced; no timed toast (UI-SPEC §6.10, §8). */
export function UndoBar({ children, onUndo, onDismiss }: { children: ReactNode; onUndo: () => void; onDismiss: () => void }) {
  return (
    <div role="status" className="card flex flex-wrap items-center justify-between gap-2 p-3">
      <span>{children}</span>
      <span className="flex gap-2">
        <button type="button" className="btn btn-sm" onClick={onUndo}>
          <Icon name="undo" size={20} /> Undo
        </button>
        <button type="button" className="btn btn-sm" onClick={onDismiss} aria-label="Dismiss">
          <Icon name="close" size={20} />
        </button>
      </span>
    </div>
  );
}

/** The 3×3 mark: eight resting cells and one amber cell, the right provider among many (UI-SPEC §2.3). */
export function AppMark({ size = 6, gap = 3, onDark = false, working = false }: { size?: number; gap?: number; onDark?: boolean; working?: boolean }) {
  const cells = Array.from({ length: 9 }, (_, i) => i);
  const dim = size * 3 + gap * 2;
  return (
    <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} aria-hidden focusable="false" className={working ? 'grid-working' : undefined}>
      {cells.map((i) => {
        const x = (i % 3) * (size + gap);
        const y = Math.floor(i / 3) * (size + gap);
        const signal = i === 5;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={size}
            height={size}
            rx={1}
            fill={signal ? 'var(--amber)' : onDark ? 'var(--on-dark-quiet)' : 'var(--cell-mark)'}
            style={working ? { animationDelay: `${(signal ? 9 : i) * 70}ms` } : undefined}
          />
        );
      })}
    </svg>
  );
}

/** "Working…" state for anything over 400ms: the grid, a sentence saying what's happening, and Cancel (UI-SPEC §6.14). */
export function WorkingGrid({ children, onCancel }: { children: ReactNode; onCancel?: () => void }) {
  return (
    <div role="status" aria-live="polite" className="card flex flex-wrap items-center gap-4">
      <AppMark size={10} gap={4} working />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Working… </span>
        {children}
      </p>
      {onCancel && (
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
