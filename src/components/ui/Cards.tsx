import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { StatusIcon, type Status } from './Status';
import { useHelp } from './HelpPanel';

/**
 * Self-resolution card (UI-SPEC §5.7): icon + status word, what happened, why it matters,
 * and one primary fix. Never a dead end.
 */
export function ResolutionCard({
  status,
  title,
  children,
  actions,
  role,
  more,
  moreLabel = 'Tell me more',
}: {
  status: Status;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  role?: 'alert' | 'status';
  /** Detail kept behind a "Tell me more" toggle so the card stays short. */
  more?: ReactNode;
  moreLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const moreId = useId();
  return (
    <div className={`card tone-${status} border-l-4`} role={role}>
      <div className="flex gap-3">
        <span className={`status-${status} mt-0.5`}>
          <StatusIcon status={status} size={24} />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-semibold">{title}</p>
          {children && <div className="space-y-2">{children}</div>}
          {more && (
            <>
              <div id={moreId} hidden={!open} data-expander-body className="space-y-2">
                {more}
              </div>
              <button type="button" className="btn-quiet no-print" aria-expanded={open} aria-controls={moreId} onClick={() => setOpen(!open)}>
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={20} /> {open ? 'Show less' : moreLabel}
              </button>
            </>
          )}
          {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

/** A screen needs data from an earlier step: say what's missing, link straight to it, say how long it takes (UI-SPEC §6.12). */
export function DependencyCard({ children, to, action, minutes }: { children: ReactNode; to: string; action: string; minutes?: number }) {
  return (
    <ResolutionCard
      status="info"
      title="One thing first"
      actions={
        <Link to={to} className="btn btn-primary">
          {action}
          {minutes && <span className="font-normal">(about {minutes} minute{minutes === 1 ? '' : 's'})</span>}
        </Link>
      }
    >
      <p>{children}</p>
    </ResolutionCard>
  );
}

/** What you've done, what's next, Back and Continue (UI-SPEC §4.3). Continue is the screen's amber action. */
export function NextStepCard({
  done,
  next,
  back,
  forward,
  primary = true,
}: {
  done: ReactNode;
  next: ReactNode;
  back?: { to: string; label: string };
  forward?: { to: string; label: string };
  /** False when another action on the screen is the primary one. */
  primary?: boolean;
}) {
  return (
    <section aria-label="Next step" className="card no-print flex flex-wrap items-center justify-between gap-4 border-2 border-[var(--charcoal)]/20">
      <div className="min-w-0 flex-1 space-y-1">
        <p>{done}</p>
        <p className="font-semibold">Next: {next}</p>
      </div>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        {back && (
          <Link to={back.to} className="btn flex-1 sm:flex-none">
            <Icon name="arrowLeft" size={20} /> {back.label}
          </Link>
        )}
        {forward && (
          <Link to={forward.to} className={`btn flex-1 sm:flex-none ${primary ? 'btn-primary' : ''}`}>
            {forward.label} <Icon name="arrowRight" size={20} />
          </Link>
        )}
      </div>
    </section>
  );
}

/** Page heading block (UI-SPEC §4.3): task-style h1, one-sentence purpose, and a link into the help panel. */
export function ScreenHeader({ title, purpose, helpTopic, children }: { title: string; purpose: ReactNode; helpTopic?: string; children?: ReactNode }) {
  return (
    <div className="space-y-2">
      <h1>{title}</h1>
      <p>{purpose}</p>
      <div className="flex flex-wrap items-center gap-3">
        {helpTopic && <HelpLink topic={helpTopic} />}
        {children}
      </div>
    </div>
  );
}

function HelpLink({ topic }: { topic: string }) {
  const help = useHelp();
  return (
    <button type="button" className="btn-quiet no-print" onClick={(e) => help.open(topic, e.currentTarget)}>
      <Icon name="help" size={20} /> What is this screen for?
    </button>
  );
}
