import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, ApiError } from '../api';

export interface SessionUser {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
}

interface AuthValue {
  user: SessionUser | null;
  signIn(username: string): Promise<void>;
  signOut(): Promise<void>;
  /** Called after enrolment, which signs the user in on the server. */
  setUser(user: SessionUser): void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children, initialUser }: { children: ReactNode; initialUser?: SessionUser | null }) {
  const [user, setUser] = useState<SessionUser | null>(initialUser ?? null);
  const [loading, setLoading] = useState(initialUser === undefined);

  useEffect(() => {
    if (initialUser !== undefined) return;
    api<{ user: SessionUser }>('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [initialUser]);

  // Any request that comes back 401 (session expired, user disabled) returns to the sign-in screen.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('sah:session-expired', onExpired);
    return () => window.removeEventListener('sah:session-expired', onExpired);
  }, []);

  const signIn = useCallback(async (username: string) => {
    const optionsJSON = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/auth/options', { body: { username } });
    let response;
    try {
      response = await startAuthentication({ optionsJSON });
    } catch (err) {
      throw new ApiError(0, err instanceof Error && err.name === 'NotAllowedError' ? 'Sign-in was cancelled.' : 'Your device could not use a passkey.');
    }
    const r = await api<{ user: SessionUser }>('/api/auth/verify', { body: { response } });
    setUser(r.user);
  }, []);

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
  }, []);

  if (loading) return <p className="p-6 text-center">Loading…</p>;
  return <AuthContext.Provider value={{ user, signIn, signOut, setUser }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
