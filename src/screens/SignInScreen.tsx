import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';

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
          <label htmlFor="username" className="muted block">
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
        <button type="submit" className="btn btn-primary w-full justify-center" disabled={busy || !username.trim()}>
          {busy ? 'Waiting for your passkey…' : 'Sign in with passkey'}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </form>
      <p className="muted mt-6">
        Access is by invitation. If you don't have an account, or you've lost the device with your passkey, ask your administrator for
        an enrolment link.
      </p>
    </AuthShell>
  );
}

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-sm flex-1 px-4 py-12">
        <p className="text-lg font-semibold">Support at Home Provider Assessor</p>
        <h1 className="mt-6 text-2xl font-semibold">{title}</h1>
        <div className="card mt-4">{children}</div>
      </main>
      <footer className="px-4 py-4 text-center text-xs text-slate-600 dark:text-slate-400">
        General information only — not financial or legal advice.
      </footer>
    </div>
  );
}
