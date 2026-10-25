import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import { api } from '../api';
import { useAuth, type SessionUser } from '../auth/AuthContext';
import { formatDateTime } from '../format';
import { AuthShell } from './SignInScreen';

interface EnrolmentInfo {
  username: string;
  display_name: string;
  expires_at: string;
}

export function EnrolScreen() {
  const { token = '' } = useParams();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<EnrolmentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<EnrolmentInfo>(`/api/enrol/${token}`)
      .then(setInfo)
      .catch((err) => setError(err.message));
  }, [token]);

  const register = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>(`/api/enrol/${token}/options`, { method: 'POST' });
      let response;
      try {
        response = await startRegistration({ optionsJSON });
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        throw new Error(
          name === 'InvalidStateError'
            ? 'This device already has a passkey for your account. Sign in instead.'
            : name === 'NotAllowedError'
              ? 'Passkey setup was cancelled.'
              : 'Your device could not create a passkey.',
        );
      }
      const r = await api<{ user: SessionUser }>(`/api/enrol/${token}/verify`, { body: { response, nickname } });
      setUser(r.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey setup failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Set up your passkey">
      {!info && !error && <p>Checking your link…</p>}
      {info && (
        <form onSubmit={register} className="space-y-4">
          <p>
            Welcome, <strong>{info.display_name}</strong>. Your username is <strong>{info.username}</strong>.
          </p>
          <p className="muted">
            A passkey lets you sign in with your fingerprint, face or device PIN. There's no password to remember. This link works once
            and expires {formatDateTime(info.expires_at)}.
          </p>
          <div>
            <label htmlFor="nickname" className="muted block">
              Name this device (optional)
            </label>
            <input id="nickname" className="input" placeholder="e.g. Tony's iPhone" value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary w-full justify-center" disabled={busy}>
            {busy ? 'Waiting for your device…' : 'Create passkey'}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </AuthShell>
  );
}
