import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { pricesMissing } from '../data/load';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '../auth/AuthContext';

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
  const { providers, state, syncError } = useApp();
  const { user, signOut } = useAuth();
  const nav = user?.role === 'admin' ? [...NAV, { to: '/admin', label: 'Admin' }] : NAV;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <p className="text-lg font-semibold">Support at Home Provider Assessor</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="muted">Signed in as {user?.display_name}</span>
            <button type="button" className="btn" onClick={signOut}>
              Sign out
            </button>
            <ThemeToggle />
          </div>
        </div>
        <nav aria-label="Main" className="mx-auto max-w-6xl overflow-x-auto px-4">
          <ul className="flex gap-1 pb-2 text-sm whitespace-nowrap">
            {nav.map((n) => (
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

      {syncError && (
        <div role="alert" className="border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <div className="mx-auto max-w-6xl">{syncError}</div>
        </div>
      )}

      {pricesMissing(providers) && (
        <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <div className="mx-auto max-w-6xl">
            Placeholder seed data: no provider prices loaded yet. Replace the files in <code>data/</code> with the starter-pack data.
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 py-6">
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
