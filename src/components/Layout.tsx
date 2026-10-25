import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { pricesMissing } from '../data/load';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { to: '/', label: 'Participant', end: true },
  { to: '/overview', label: 'Overview' },
  { to: '/costs', label: 'Relative costs' },
  { to: '/providers', label: 'Providers' },
  { to: '/selection', label: 'Selection' },
  { to: '/bounding', label: 'Bounding questions' },
  { to: '/interview-pack', label: 'Interview pack' },
  { to: '/interviews', label: 'Interviews' },
  { to: '/scoring', label: 'Scoring' },
];

export function Layout() {
  const { seed, state } = useApp();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <p className="text-lg font-semibold">Support at Home Provider Assessor</p>
          <ThemeToggle />
        </div>
        <nav aria-label="Main" className="mx-auto max-w-6xl overflow-x-auto px-4">
          <ul className="flex gap-1 pb-2 text-sm whitespace-nowrap">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-1.5 no-underline hover:no-underline ${
                      isActive
                        ? 'bg-teal-700 text-white dark:bg-teal-600 dark:text-white'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`
                  }
                >
                  {n.label}
                  {n.to === '/selection' && state.selection.length > 0 && ` (${state.selection.length})`}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {import.meta.env.MODE === 'static' && (
        <div role="status" className="border-b border-sky-300 bg-sky-50 px-4 py-2 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200">
          <div className="mx-auto max-w-6xl">
            Review preview. Recording and drafting interview notes need the full app; everything else works and is saved in this
            browser only.
          </div>
        </div>
      )}

      {pricesMissing(seed.providers) && (
        <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <div className="mx-auto max-w-6xl">
            Placeholder seed data: no provider prices loaded yet. Replace the files in <code>data/</code> with the starter-pack data.
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 px-4 py-4 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
        <p className="mx-auto max-w-6xl">
          General information only — not financial or legal advice. Check prices and eligibility with the provider, My Aged Care and DVA
          before deciding.
        </p>
      </footer>
    </div>
  );
}
