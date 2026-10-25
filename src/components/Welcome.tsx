import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { locate, PHASES } from '../phases';
import { AppMark } from './ui/Feedback';

const WELCOMED = 'sah-assessor:welcomed';
const LAST_PATH = 'sah-assessor:last-path';
const RETURN_SHOWN = 'sah-assessor:return-shown';

const get = (store: Storage, k: string) => {
  try {
    return store.getItem(k);
  } catch {
    return null;
  }
};
const put = (store: Storage, k: string, v: string) => {
  try {
    store.setItem(k, v);
  } catch {
    /* not remembered */
  }
};

const MINUTES = [5, 10, 15, 30];

/** First run (UI-SPEC §7): one welcome screen, not a carousel. Shown once per device, before anything is entered. */
export function useFirstRun(): [boolean, () => void] {
  const { state } = useApp();
  const fresh = !state.participant && Object.keys(state.answers).length === 0;
  const [show, setShow] = useState(() => fresh && !get(localStorage, WELCOMED));
  return [show, () => (put(localStorage, WELCOMED, '1'), setShow(false))];
}

export function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <section className="mx-auto max-w-[var(--wrap-form)] space-y-6 py-4">
      <AppMark size={14} gap={6} />
      <h1>Choose a Support at Home provider, step by step</h1>
      <p className="text-xl">
        This app helps you compare the providers near you on cost and fit, decide who to interview, ask them the right questions, and record your decision. Every number can be
        explained, and nothing is decided for you.
      </p>
      <ol className="card space-y-3">
        {PHASES.map((p, i) => (
          <li key={p.n} className="flex items-baseline gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-[var(--charcoal)] font-semibold">{p.n}</span>
            <span>
              <span className="font-semibold">{p.name}</span> — about {MINUTES[i]} minutes
            </span>
          </li>
        ))}
      </ol>
      <p>Your information is shared only with the family members invited to this assessment. You can stop at any time and pick up where you left off.</p>
      <button type="button" className="btn btn-primary" onClick={onStart}>
        Get started
      </button>
    </section>
  );
}

/** "Welcome back" card on return (UI-SPEC §7): where you were last time, and Continue. Once per visit. */
export function WelcomeBack() {
  const { pathname } = useLocation();
  const { state } = useApp();
  const [last] = useState(() => (get(sessionStorage, RETURN_SHOWN) ? null : get(localStorage, LAST_PATH)));
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    put(sessionStorage, RETURN_SHOWN, '1');
  }, []);
  useEffect(() => {
    if (!pathname.startsWith('/interview-pack/print')) put(localStorage, LAST_PATH, pathname);
  }, [pathname]);

  const where = last ? locate(last) : undefined;
  if (dismissed || !last || !where || last === pathname || !state.participant) return null;
  return (
    <div role="status" className="no-print card tone-info mb-4 flex flex-wrap items-center justify-between gap-3 border-l-4">
      <p>
        <strong>Welcome back.</strong> Last time you were on <strong>{where.screen.label}</strong> ({where.phase.name}).
      </p>
      <span className="flex flex-wrap gap-2">
        <Link to={last} className="btn" onClick={() => setDismissed(true)}>
          Continue
        </Link>
        <Link to="/summary" className="btn" onClick={() => setDismissed(true)}>
          See everything you've done
        </Link>
        <button type="button" className="btn" onClick={() => setDismissed(true)} aria-label="Dismiss">
          ✕
        </button>
      </span>
    </div>
  );
}
