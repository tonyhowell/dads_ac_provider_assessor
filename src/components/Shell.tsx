import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useOptionalApp } from '../state/AppContext';
import { AppMark } from './ui/Feedback';
import { Icon } from './ui/Icon';
import { useHelp } from './ui/HelpPanel';
import { ResolutionCard } from './ui/Cards';
import { DisplaySettingsButton } from './DisplaySettings';

export const ROLE_LABELS = { coordinator: 'Coordinator', contributor: 'Contributor', viewer: 'Viewer' } as const;

/** App header: brand, the open application (with a link to switch), Help, Display and the menu. */
export function Header() {
  const help = useHelp();
  const app = useOptionalApp();
  return (
    <header data-app-header className="bg-[var(--header-bg)] text-[var(--on-dark)]">
      <div className="relative mx-auto flex max-w-[var(--wrap)] flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
          <Link to={app ? '/' : '/applications'} className="flex items-center gap-3 no-underline">
            <AppMark onDark />
            <span className="leading-tight">
              <span className="block text-lg font-semibold">Provider Assessor</span>
              <span className="block text-[0.875rem] text-[var(--on-dark)] opacity-80">from Quantivate</span>
            </span>
          </Link>
          {app && (
            <Link to="/applications" className="header-btn min-w-0 max-w-full" aria-label={`Application: ${app.application.name}. Switch application`}>
              <Icon name="users" size={20} />
              <span className="min-w-0 truncate">{app.application.name}</span>
              <span className="text-[0.875rem] opacity-80">Switch</span>
            </Link>
          )}
        </div>
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
  const app = useOptionalApp();
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
        <div className="header-panel min-[721px]:w-72 space-y-1 rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--surface)] p-3 text-[var(--charcoal)] shadow-[var(--shadow-raised)]">
          <p className="muted px-1">
            Signed in as {user?.display_name}
            {app && ` · ${ROLE_LABELS[app.role]}`}
          </p>
          {app && (
            <Link to="/people" className="btn w-full justify-start">
              <Icon name="users" size={20} /> People in this application
            </Link>
          )}
          <Link to="/applications" className="btn w-full justify-start">
            <Icon name="list" size={20} /> Your applications
          </Link>
          {user?.role === 'admin' && (
            <Link to="/admin" className="btn w-full justify-start">
              <Icon name="shield" size={20} /> Site administration
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

export function Footer() {
  return (
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
  );
}

/** Frame for screens outside an application: your applications, site administration, About. */
export function PlainLayout({ children }: { children?: ReactNode }) {
  const help = useHelp();
  return (
    <div className={`flex min-h-screen flex-col ${help.isOpen ? 'min-[1120px]:pr-[400px]' : ''}`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-[var(--surface)] focus:p-3">
        Skip to main content
      </a>
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[var(--wrap)] min-w-0 flex-1 px-4 py-6">
        {children ?? <Outlet />}
      </main>
      <Footer />
    </div>
  );
}

/** Shown across an application to viewers, and to everyone when it's archived. */
export function ReadOnlyNotice() {
  const { application, role } = useOptionalApp()!;
  if (application.status === 'archived') {
    return <ResolutionCard status="info" title="This application is archived" role="status" more={<p>You can look at everything, but nothing can be changed. A site administrator can restore it.</p>} moreLabel="What does that mean?" />;
  }
  return (
    <ResolutionCard
      status="info"
      title="You can view this application"
      role="status"
      moreLabel="How do I make changes?"
      more={<p>You were added as a {ROLE_LABELS[role].toLowerCase()}. Ask the coordinator to make you a contributor if you'd like to help with answers, notes and choices.</p>}
    />
  );
}
