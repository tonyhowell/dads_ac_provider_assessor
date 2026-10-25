import { useId, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * Expandable section: a one-line summary (with an optional icon or small visual and a figure on the right)
 * that opens to show the detail. Closed by default so screens scan quickly; printing shows everything.
 */
export function Expander({
  title,
  summary,
  icon,
  visual,
  aside,
  defaultOpen = false,
  level = 2,
  card = true,
  children,
  className = '',
}: {
  title: ReactNode;
  /** One short line shown while closed (and open). */
  summary?: ReactNode;
  icon?: IconName;
  /** A small graphic in place of the icon, e.g. a meter. */
  visual?: ReactNode;
  /** A figure or chip at the right of the header. */
  aside?: ReactNode;
  defaultOpen?: boolean;
  level?: 2 | 3 | 4;
  /** Draw as its own card (default) or as a plain row inside another card. */
  card?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const H = `h${level}` as 'h2' | 'h3' | 'h4';
  return (
    <section className={`${card ? 'card p-0' : 'border-t border-[var(--rule)] first:border-t-0'} ${className}`} data-expander>
      <H className="m-0 text-base">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          className={`flex min-h-[var(--target-min)] w-full items-center gap-3 text-left ${card ? 'p-4' : 'py-3'}`}
        >
          {visual ?? (icon && <Icon name={icon} size={26} className="text-[var(--charcoal)]" />)}
          <span className="min-w-0 flex-1">
            <span className={`block font-semibold ${level === 2 ? 'text-[1.2rem]' : ''}`}>{title}</span>
            {summary && <span className="block font-normal">{summary}</span>}
          </span>
          {aside && <span className="shrink-0 text-right font-normal">{aside}</span>}
          <Icon name={open ? 'chevronDown' : 'chevronRight'} className="no-print" />
        </button>
      </H>
      <div id={id} hidden={!open} data-expander-body className={`space-y-3 ${card ? 'px-4 pb-4' : 'pb-3'}`}>
        {children}
      </div>
    </section>
  );
}

/** "More" toggle for a short piece of text: shows the first part, the rest on request. */
export function MoreText({ text, id, className = '' }: { text: string; id?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const m = text.match(/^(.+?[.?!])\s+(.+)$/s);
  if (!m || text.length < 70) {
    return (
      <span id={id} className={className}>
        {text}
      </span>
    );
  }
  return (
    <span id={id} className={className}>
      {m[1]}{' '}
      <span id={bodyId} hidden={!open} data-expander-body>
        {m[2]}{' '}
      </span>
      <button type="button" className="no-print font-medium underline underline-offset-2" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        {open ? 'Less' : 'More'}
      </button>
    </span>
  );
}
