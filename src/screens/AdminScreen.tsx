import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { ConfirmButton } from '../components/ConfirmButton';
import { formatDateTime } from '../format';

interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
  disabled: boolean;
  last_login_at: string | null;
  created_at: string;
  passkeys: number;
  enrolment_expires_at: string | null;
}

interface Passkey {
  id: string;
  nickname: string;
  device_type: string | null;
  backed_up: boolean;
  created_at: string;
  last_used_at: string | null;
}

export function AdminScreen() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The most recently issued link, shown until dismissed. Links are only ever shown once. */
  const [link, setLink] = useState<{ username: string; url: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers((await api<{ users: AdminUser[] }>('/api/admin/users')).users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load users.');
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h1>Manage family access</h1>
        <p className="muted mt-1">
          Add family members, issue the one-time links they use to set up a passkey, and remove access when needed.
        </p>
      </div>

      {error && (
        <p role="alert" className="card tone-stop border-l-4">
          {error}
        </p>
      )}
      {link && <EnrolmentLink {...link} onDismiss={() => setLink(null)} />}

      <AddUserForm
        onCreated={(username, url) => {
          setLink({ username, url });
          load();
        }}
        onError={setError}
      />

      <section aria-labelledby="users-heading" className="space-y-3">
        <h2 id="users-heading">
          People with access
        </h2>
        {!users ? (
          <p className="muted">Loading…</p>
        ) : (
          <ul className="space-y-3">
            {users.map((u) => (
              <UserCard
                key={u.id}
                user={u}
                isMe={u.id === me?.id}
                run={run}
                onLink={(url) => setLink({ username: u.username, url })}
              />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function AddUserForm({ onCreated, onError }: { onCreated: (username: string, url: string) => void; onError: (msg: string) => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ user: AdminUser; enrolment_url: string }>('/api/admin/users', {
        body: { username, display_name: displayName, role },
      });
      onCreated(r.user.username, r.enrolment_url);
      setUsername('');
      setDisplayName('');
      setRole('member');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not add user.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-3" aria-labelledby="add-heading">
      <h2 id="add-heading">
        Add a person
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="new-username" className="muted block">
            Username
          </label>
          <input
            id="new-username"
            className="input"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. sam"
            required
          />
        </div>
        <div>
          <label htmlFor="new-display" className="muted block">
            Display name
          </label>
          <input id="new-display" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="new-role" className="muted block">
            Role
          </label>
          <select id="new-role" className="input" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
            <option value="member">Family member</option>
            <option value="admin">Administrator</option>
          </select>
        </div>
      </div>
      <p className="muted">Usernames are 2–32 lowercase letters, digits, dots, dashes or underscores.</p>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        Add and create enrolment link
      </button>
    </form>
  );
}

function EnrolmentLink({ username, url, onDismiss }: { username: string; url: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="card tone-info space-y-2 border-l-4">
      <p className="font-medium">Enrolment link for {username}</p>
      <p className="muted">
        Send this to them privately. It works once, expires in 24 hours, and won't be shown again (you can issue a new one).
      </p>
      <input aria-label={`Enrolment link for ${username}`} className="input font-mono text-xs" readOnly value={url} onFocus={(e) => e.target.select()} />
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            navigator.clipboard
              ?.writeText(url)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button type="button" className="btn" onClick={onDismiss}>
          Done
        </button>
      </div>
    </div>
  );
}

function UserCard({
  user,
  isMe,
  run,
  onLink,
}: {
  user: AdminUser;
  isMe: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  onLink: (url: string) => void;
}) {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [open, setOpen] = useState(false);

  const loadPasskeys = async () => setPasskeys((await api<{ passkeys: Passkey[] }>(`/api/admin/users/${user.id}/passkeys`)).passkeys);

  const status = user.disabled
    ? 'Disabled'
    : user.passkeys === 0
      ? user.enrolment_expires_at
        ? `Waiting for passkey setup (link expires ${formatDateTime(user.enrolment_expires_at)})`
        : 'No passkey — issue a new link'
      : `${user.passkeys} passkey${user.passkeys === 1 ? '' : 's'}`;

  return (
    <li className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            {user.display_name} <span className="muted font-normal">({user.username})</span>
            {isMe && <span className="muted font-normal"> · you</span>}
          </h3>
          <p className="muted">
            {user.role === 'admin' ? 'Administrator' : 'Family member'} · {status}
          </p>
          <p className="muted text-xs">
            Last signed in {user.last_login_at ? formatDateTime(user.last_login_at) : 'never'} · added {formatDateTime(user.created_at)}
          </p>
        </div>
        {user.disabled && (
          <span className="chip chip-stop">Disabled</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {!user.disabled && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              run(async () => onLink((await api<{ enrolment_url: string }>(`/api/admin/users/${user.id}/enrolment`, { method: 'POST' })).enrolment_url))
            }
          >
            {user.passkeys === 0 ? 'New enrolment link' : 'Link to add a device'}
          </button>
        )}
        {!isMe && (
          <button
            type="button"
            className="btn"
            onClick={() => run(() => api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { role: user.role === 'admin' ? 'member' : 'admin' } }))}
          >
            {user.role === 'admin' ? 'Make family member' : 'Make administrator'}
          </button>
        )}
        {!isMe &&
          (user.disabled ? (
            <button type="button" className="btn" onClick={() => run(() => api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { disabled: false } }))}>
              Enable
            </button>
          ) : (
            <ConfirmButton
              prompt={`Disable ${user.display_name}? They'll be signed out everywhere.`}
              confirmLabel="Disable"
              onConfirm={() => run(() => api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { disabled: true } }))}
            >
              Disable
            </ConfirmButton>
          ))}
        {user.passkeys > 0 && (
          <button
            type="button"
            className="btn"
            aria-expanded={open}
            onClick={async () => {
              if (!open) await loadPasskeys();
              setOpen(!open);
            }}
          >
            {open ? 'Hide passkeys' : 'Show passkeys'}
          </button>
        )}
      </div>

      {open && passkeys && (
        <ul className="space-y-2 border-t border-[var(--rule)] pt-3">
          {passkeys.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                <strong>{p.nickname || 'Unnamed device'}</strong>
                <span className="muted">
                  {' '}
                  · {p.backed_up ? 'synced passkey' : 'this device only'} · added {formatDateTime(p.created_at)} · last used{' '}
                  {p.last_used_at ? formatDateTime(p.last_used_at) : 'never'}
                </span>
              </span>
              <ConfirmButton
                prompt="Remove this passkey?"
                confirmLabel="Remove"
                onConfirm={() =>
                  run(async () => {
                    await api(`/api/admin/passkeys/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
                    await loadPasskeys();
                  })
                }
              >
                Remove <span className="sr-only">{p.nickname || 'passkey'}</span>
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
