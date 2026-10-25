import { useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useHelp } from './HelpPanel';

/**
 * L2 "What does this mean?" disclosure (UI-SPEC §5.2): expands inline and pushes content down,
 * never a hover tooltip. Stays open until closed.
 */
export function Explain({ question = 'What does this mean?', children, example }: { question?: string; children: ReactNode; example?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="no-print">
      <button type="button" className="btn-quiet" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Icon name="info" size={20} /> {question}
      </button>
      {open && (
        <div id={id} className="mt-1 space-y-2 border-l-4 border-[var(--info)] pl-3">
          <div className="space-y-2">{children}</div>
          {example && <div className="well">{example}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * L4 glossary term (UI-SPEC §5.4): dotted underline; tapping shows a definition card inline.
 * Mark only the first use on a screen.
 */
export function Term({ id, children }: { id: string; children: ReactNode }) {
  const { help, open } = useHelp();
  const [shown, setShown] = useState(false);
  const term = help.glossary.find((g) => g.id === id);
  const cardId = useId();
  if (!term) return <>{children}</>;
  return (
    <>
      <button type="button" className="term" aria-expanded={shown} aria-controls={cardId} onClick={() => setShown(!shown)}>
        {children}
      </button>
      {shown && (
        <span id={cardId} role="note" className="card my-2 block space-y-1 p-4 font-normal">
          <span className="block font-semibold">{term.term}</span>
          <span className="block">{term.plain}</span>
          {term.example && <span className="well block">{term.example}</span>}
          <span className="flex flex-wrap gap-3">
            {term.more_topic_id && (
              <button type="button" className="btn-quiet" onClick={(e) => open(term.more_topic_id, e.currentTarget)}>
                More in Help
              </button>
            )}
            <button type="button" className="btn-quiet" onClick={() => setShown(false)}>
              Close
            </button>
          </span>
        </span>
      )}
    </>
  );
}

export interface WhyLine {
  label: ReactNode;
  working?: ReactNode;
  value: ReactNode;
  note?: ReactNode;
}

/**
 * "Why this number?" (UI-SPEC §5.5): the figure is a button; activating it shows the working.
 */
export function WhyNumber({ figure, title, lines, total, footer, className = '' }: { figure: ReactNode; title: string; lines: WhyLine[]; total?: WhyLine[]; footer?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" className={`inline-flex items-baseline gap-1 text-left underline decoration-dotted decoration-2 underline-offset-4 ${className}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {figure}
        <span className="no-print text-[0.875rem] font-medium no-underline">Why?</span>
      </button>
      {open && (
        <span id={id} role="note" className="card my-2 block space-y-2 p-4 text-left text-base font-normal">
          <span className="block font-semibold">{title}</span>
          <span className="block overflow-x-auto">
            <table className="w-full text-[0.95rem]">
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-[var(--rule)] align-top">
                    <th scope="row" className="py-1 pr-3 text-left font-normal">{l.label}</th>
                    <td className="py-1 pr-3 text-left">{l.working}</td>
                    <td className="py-1 text-right font-medium tabular-nums">
                      {l.value}
                      {l.note && <span className="block text-[0.875rem] font-normal">{l.note}</span>}
                    </td>
                  </tr>
                ))}
                {total?.map((l, i) => (
                  <tr key={`t${i}`} className="align-top">
                    <th scope="row" className="py-1 pr-3 text-left font-semibold">{l.label}</th>
                    <td className="py-1 pr-3">{l.working}</td>
                    <td className="py-1 text-right font-semibold tabular-nums">
                      {l.value}
                      {l.note && <span className="block text-[0.875rem] font-normal">{l.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </span>
          {footer && <span className="muted block">{footer}</span>}
          <button type="button" className="btn-quiet" onClick={() => setOpen(false)}>
            Close
          </button>
        </span>
      )}
    </>
  );
}
