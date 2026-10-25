import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { pricesMissing } from '../data/load';
import { useAuth } from '../auth/AuthContext';
import { locate, PHASES, phaseState, type PhaseState } from '../phases';
import { AppMark } from './ui/Feedback';
import { Icon } from './ui/Icon';
import { useHelp } from './ui/HelpPanel';
import { DisplaySettingsButton } from './DisplaySettings';
import { ResolutionCard } from './ui/Cards';
import { ScreenNotes } from './ScreenNotes';
import { WelcomeBack } from './Welcome';

const STATE_WORDS: Record<PhaseState, string> = { 'not-started': 'Not started', 'in-progress': 'In progress', done: 'Done' };

export function Layout() {
  const { providers, syncError } = useApp();
  const help = useHelp();
  const location = useLocation();
  const here = locate(location.pathname);

  return (
    <div className={`flex min-h-screen flex-col ${help.isOpen ? 'min-[1120px]:pr-[400px]' : ''}`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-[var(--surface)] focus:p-3">
        Skip to main content
      </a>
      <Header />
      <JourneyBar />

      {(syncError || pricesMissing(providers)) && (
        <div className="mx-auto w-full max-w-[var(--wrap)] space-y-2 px-4 pt-4">
          {syncError && (
            <ResolutionCard status="stop" title="Your last change wasn't saved" role="alert">
              <p>{syncError.replace(/^Your last change wasn't saved: /, '')} The screen now shows what's saved. Make the change again once you're connected.</p>
            </ResolutionCard>
          )}
          {pricesMissing(providers) && (
            <ResolutionCard status="caution" title="No provider prices loaded" role="status">
              <p>The starter data has no prices, so costs can't be worked out yet. Add prices on the Providers screen.</p>
            </ResolutionCard>
          )}
        </div>
      )}

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[var(--wrap)] min-w-0 flex-1 px-4 py-6">
        <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
          <nav aria-label="Breadcrumb" className="text-[0.95rem]">
            {here ? (
              <ol className="flex flex-wrap items-center gap-1">
                {here.phase.name !== here.screen.label && (
                  <>
                    <li>{here.phase.name}</li>
                    <li aria-hidden>›</li>
                  </>
                )}
                <li aria-current="page" className="font-medium">
                  {here.screen.label}
                </li>
              </ol>
            ) : (
              <span />
            )}
          </nav>
          <SavedIndicator />
        </div>
        <WelcomeBack />
        <ScreenNotes />
        <Outlet />
      </main>

      <footer className="border-t border-[var(--rule)] px-4 py-6">
        <div className="mx-auto max-w-[var(--wrap)] space-y-2 text-[0.95rem]">
          <p>General information only — not financial or legal advice. Check prices and eligibility with the provider, My Aged Care and DVA before deciding.</p>
          <p className="flex flex-wrap gap-x-4">
            <Link to="/about#data-sources">Data sources</Link>
            <Link to="/about#accessibility">Accessibility</Link>
            <Link to="/about#privacy">Privacy</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

function Header() {
  const help = useHelp();
  return (
    <header data-app-header className="bg-[var(--header-bg)] text-[var(--on-dark)]">
      <div className="relative mx-auto flex max-w-[var(--wrap)] flex-wrap items-center justify-between gap-2 px-4 py-3">
        <Link to="/" className="flex items-center gap-3 no-underline">
          <AppMark onDark />
          <span className="leading-tight">
            <span className="block text-lg font-semibold">Provider Assessor</span>
            <span className="block text-[0.875rem] text-[var(--on-dark)] opacity-80">from Quantivate</span>
          </span>
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="header-btn" onClick={(e) => help.open(undefined, e.currentTarget)}>
            <Icon name="help" size={20} /> Help
          </button>
          <DisplaySettingsButton />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref}>
      <button type="button" className="header-btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        <Icon name="menu" size={20} /> Menu
      </button>
      {open && (
        <div className="header-panel min-[721px]:w-64 space-y-1 rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--surface)] p-3 text-[var(--charcoal)] shadow-[var(--shadow-raised)]">
          <p className="muted px-1">Signed in as {user?.display_name}</p>
          {user?.role === 'admin' && (
            <Link to="/admin" className="btn w-full justify-start">
              Manage family access
            </Link>
          )}
          <Link to="/about" className="btn w-full justify-start">
            About this app
          </Link>
          <button type="button" className="btn w-full justify-start" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function JourneyBar() {
  const { state, seed } = useApp();
  const location = useLocation();
  const here = locate(location.pathname);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <nav data-journey aria-label="Steps" className="border-b border-[var(--rule)] bg-[var(--surface)]">
      <div className="mx-auto max-w-[var(--wrap)] px-4">
        {/* Phones: one button that opens the full list (UI-SPEC §4.2). */}
        <div className="py-2 min-[721px]:hidden">
          <button type="button" className="btn w-full justify-between" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>
            <span>{here ? `Step ${here.phase.n} of 4 · ${here.phase.name}` : 'All steps'}</span>
            <Icon name="chevronDown" size={20} />
          </button>
          {mobileOpen && (
            <ol className="mt-2 space-y-3 pb-2">
              {PHASES.map((p) => (
                <li key={p.n}>
                  <p className="font-semibold">
                    {p.n}. {p.name} <span className="font-normal">· {STATE_WORDS[phaseState(p, state, seed)]}</span>
                  </p>
                  <ul className="mt-1 space-y-1">
                    {p.screens.map((sc) => (
                      <li key={sc.id}>
                        <ScreenLink to={sc.to} label={sc.label} done={sc.done(state, seed)} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Wider screens: four phases, then the current phase's screens. */}
        <div className="hidden min-[721px]:block">
          <ol className="flex gap-2 overflow-x-auto py-2">
            {PHASES.map((p) => {
              const st = phaseState(p, state, seed);
              const current = here?.phase.n === p.n;
              return (
                <li key={p.n} className="min-w-0 flex-1">
                  <Link
                    to={p.screens[0].to}
                    aria-current={current ? 'step' : undefined}
                    className={`flex min-h-[var(--target-min)] items-center gap-2 rounded-[var(--radius-control)] border px-3 py-1.5 no-underline ${
                      current ? 'border-2 border-[var(--charcoal)] bg-[var(--amber-tint)]' : 'border-[var(--rule)]'
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-[var(--charcoal)] text-[0.875rem] font-semibold ${st === 'done' ? 'bg-[var(--charcoal)] text-[var(--surface)]' : ''}`}
                      aria-hidden
                    >
                      {st === 'done' ? <Icon name="check" size={16} /> : p.n}
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block font-semibold">{p.name}</span>
                      <span className="block text-[0.875rem]">{STATE_WORDS[st]}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          {here && here.phase.screens.length > 1 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 pb-2" aria-label={`${here.phase.name} screens`}>
              {here.phase.screens.map((sc) => (
                <li key={sc.id}>
                  <ScreenLink to={sc.to} label={sc.label} done={sc.done(state, seed)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </nav>
  );
}

function ScreenLink({ to, label, done }: { to: string; label: string; done: boolean }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => `inline-flex min-h-[44px] items-center gap-1.5 ${isActive ? 'font-semibold underline decoration-2' : 'no-underline'}`}
    >
      {done && <Icon name="check" size={18} label="Done" />}
      {label}
    </NavLink>
  );
}

function SavedIndicator() {
  const { saving, savedAt } = useApp();
  return (
    <p aria-live="polite" className="muted flex items-center gap-1">
      {saving ? (
        'Saving…'
      ) : savedAt ? (
        <>
          <Icon name="check" size={18} /> Saved {savedAt.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })}
        </>
      ) : (
        'Changes save automatically'
      )}
    </p>
  );
}
