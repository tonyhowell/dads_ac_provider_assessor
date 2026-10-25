import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { HelpData, HelpTopic } from '../../types';
import { Icon } from './Icon';

interface HelpValue {
  help: HelpData;
  /** Opens the panel at a topic (or the current screen's topic). `from` gets focus back on close. */
  open(topicId?: string, from?: HTMLElement | null): void;
  close(): void;
  isOpen: boolean;
  topicForPath(path: string): HelpTopic | undefined;
}

const HelpContext = createContext<HelpValue | null>(null);

export function useHelp(): HelpValue {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error('useHelp must be used inside <HelpProvider>');
  return ctx;
}

/** The topic for a route: the longest matching screen_route prefix. */
function matchTopic(topics: HelpTopic[], path: string): HelpTopic | undefined {
  return [...topics]
    .sort((a, b) => b.screen_route.length - a.screen_route.length)
    .find((t) => (t.screen_route === '/' ? path === '/' : path === t.screen_route || path.startsWith(t.screen_route + '/') || path.startsWith(t.screen_route)));
}

export function HelpProvider({ help, children }: { help: HelpData; children: ReactNode }) {
  const [topicId, setTopicId] = useState<string | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const topicForPath = useCallback((path: string) => matchTopic(help.topics, path), [help.topics]);

  const open = useCallback(
    (id?: string, from?: HTMLElement | null) => {
      returnTo.current = from ?? (document.activeElement as HTMLElement | null);
      setTopicId(id ?? topicForPath(location.pathname)?.id ?? help.topics[0]?.id ?? null);
    },
    [help.topics, location.pathname, topicForPath],
  );
  const close = useCallback(() => {
    setTopicId(null);
    returnTo.current?.focus?.();
  }, []);

  // "?" opens help; Esc closes it (UI-SPEC §5.3, §8).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        open();
      } else if (e.key === 'Escape' && topicId) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, topicId]);

  const value = useMemo(() => ({ help, open, close, isOpen: topicId !== null, topicForPath }), [help, open, close, topicId, topicForPath]);
  return (
    <HelpContext.Provider value={value}>
      {children}
      {topicId && <HelpPanel help={help} topicId={topicId} onTopic={setTopicId} onClose={close} />}
    </HelpContext.Provider>
  );
}

function HelpPanel({ help, topicId, onTopic, onClose }: { help: HelpData; topicId: string; onTopic: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const topic = help.topics.find((t) => t.id === topicId) ?? help.topics[0];
  useEffect(() => headingRef.current?.focus(), [topicId]);

  const q = query.trim().toLowerCase();
  const results = q
    ? [
        ...help.topics.filter((t) => [t.title, t.purpose, ...t.steps, ...t.faqs.flatMap((f) => [f.q, f.a])].some((s) => s.toLowerCase().includes(q))).map((t) => ({ kind: 'topic' as const, id: t.id, title: t.title, text: t.purpose })),
        ...help.glossary.filter((g) => `${g.term} ${g.plain}`.toLowerCase().includes(q)).map((g) => ({ kind: 'term' as const, id: g.id, title: g.term, text: g.plain })),
      ]
    : [];
  const terms = help.glossary.filter((g) => topic?.glossary_ids.includes(g.id));

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 min-[1120px]:hidden" onClick={onClose} aria-hidden />
      <div
        data-help-panel
        role="dialog"
        aria-modal="false"
        aria-labelledby="help-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto border-l border-[var(--rule)] bg-[var(--sunken)] shadow-[var(--shadow-raised)] sm:w-[420px] min-[1120px]:w-[400px]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-[var(--sunken)] px-5 pt-4 pb-2">
          <p className="font-semibold">Help</p>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close help">
            <Icon name="close" size={20} /> Close
          </button>
        </div>
        <div className="space-y-5 px-5 pb-8">
          <div>
            <label htmlFor="help-search" className="label">
              Search help
            </label>
            <input id="help-search" type="search" className="input" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          {q ? (
            <section aria-label="Search results" className="space-y-3">
              {results.length === 0 && <p>Nothing matched "{query}". Try a different word, or call one of the numbers below.</p>}
              {results.map((r) => (
                <div key={`${r.kind}-${r.id}`} className="card p-4">
                  {r.kind === 'topic' ? (
                    <button type="button" className="btn-quiet text-left" onClick={() => (setQuery(''), onTopic(r.id))}>
                      {r.title}
                    </button>
                  ) : (
                    <p className="font-semibold">{r.title}</p>
                  )}
                  <p className="font-serif">{r.text}</p>
                </div>
              ))}
            </section>
          ) : (
            topic && (
              <article className="space-y-5 font-serif" style={{ lineHeight: 'var(--leading-read)' }}>
                <h2 id="help-title" ref={headingRef} tabIndex={-1} className="font-sans">
                  {topic.title}
                </h2>
                <section>
                  <h3 className="font-sans">What this screen is for</h3>
                  <p>{topic.purpose}</p>
                </section>
                <section>
                  <h3 className="font-sans">What to do here</h3>
                  <ol className="list-decimal space-y-1 pl-6">
                    {topic.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </section>
                <section>
                  <h3 className="font-sans">What you'll have at the end</h3>
                  <p>{topic.outcome}</p>
                </section>
                {topic.faqs.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="font-sans">Common questions</h3>
                    {topic.faqs.map((f) => (
                      <details key={f.q} className="card p-4">
                        <summary className="cursor-pointer font-sans font-medium">{f.q}</summary>
                        <p className="mt-2">{f.a}</p>
                      </details>
                    ))}
                  </section>
                )}
                {topic.troubleshooting.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="font-sans">If something looks wrong</h3>
                    {topic.troubleshooting.map((t) => (
                      <div key={t.symptom} className="card p-4">
                        <p className="font-sans font-medium">{t.symptom}</p>
                        <p>Why: {t.cause}</p>
                        <p>
                          What to do: {t.fix}
                          {t.action_route && (
                            <>
                              {' '}
                              <Link to={t.action_route} onClick={onClose}>
                                Go there
                              </Link>
                            </>
                          )}
                        </p>
                      </div>
                    ))}
                  </section>
                )}
                {terms.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="font-sans">Words on this screen</h3>
                    <dl className="space-y-2">
                      {terms.map((g) => (
                        <div key={g.id}>
                          <dt className="font-sans font-semibold">{g.term}</dt>
                          <dd>{g.plain}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}
              </article>
            )
          )}

          <section aria-labelledby="talk-heading" className="space-y-2">
            <h3 id="talk-heading">Talk to a person</h3>
            <ul className="space-y-3">
              {help.contacts.map((c) => (
                <li key={c.id}>
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-lg font-semibold tabular-nums select-all">{c.phone}</p>
                  <p>{c.purpose}</p>
                  <p className="muted">{c.hours}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-1">
            <h3>Other topics</h3>
            <ul>
              {help.topics
                .filter((t) => t.id !== topic?.id)
                .map((t) => (
                  <li key={t.id}>
                    <button type="button" className="btn-quiet text-left" onClick={() => onTopic(t.id)}>
                      {t.title}
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
