import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { AppMark } from '../components/ui/Feedback';

export function SignInScreen() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="username" className="label">
            Username
          </label>
          <input
            id="username"
            className="input"
            autoComplete="username webauthn"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="btn btn-primary w-full" disabled={busy || !username.trim()}>
          {busy ? 'Waiting for your passkey…' : 'Sign in with passkey'}
        </button>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </form>
      <p className="mt-6">
        Access is by invitation. If you don't have an account, or you've lost the device with your passkey, ask your administrator for
        an enrolment link.
      </p>
    </AuthShell>
  );
}

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-[var(--header-bg)] text-[var(--on-dark)]">
        <div className="mx-auto flex max-w-[var(--wrap)] items-center gap-3 px-4 py-3">
          <AppMark onDark />
          <span className="leading-tight">
            <span className="block text-lg font-semibold">Provider Assessor</span>
            <span className="block text-[0.875rem] opacity-80">from Quantivate</span>
          </span>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        <h1>{title}</h1>
        <div className="card mt-4">{children}</div>
      </main>
      <footer className="px-4 py-6">
        <p className="mx-auto max-w-[var(--wrap)]">General information only — not financial or legal advice.</p>
      </footer>
    </div>
  );
}
