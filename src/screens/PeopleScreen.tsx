import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import type { Member, MemberRole } from '../backend';
import { formatDateTime } from '../format';
import { ConfirmButton } from '../components/ConfirmButton';
import { ResolutionCard, ScreenHeader } from '../components/ui/Cards';
import { ChoiceCards, Field } from '../components/ui/Form';
import { Expander } from '../components/ui/Expander';
import { Icon } from '../components/ui/Icon';
import { ROLE_LABELS } from '../components/Shell';
import { EnrolmentLink } from './AdminScreen';

const ROLE_HELP: Record<MemberRole, string> = {
  coordinator: 'Runs the application: adds and removes people, and can change everything.',
  contributor: 'Can change answers, notes, choices and scores.',
  viewer: 'Can see everything but not change it. New family members start here.',
};

/** Who is in this application. Coordinators add family (as viewers by default), set roles and remove people. */
export function PeopleScreen() {
  const { application, role } = useApp();
  const { user } = useAuth();
  const { reloadApplications, setCurrentId } = useSession();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ username: string; url: string } | null>(null);
  const base = `/api/applications/${encodeURIComponent(application.id)}`;
  const isCoordinator = role === 'coordinator';

  const load = useCallback(async () => {
    try {
      setMembers((await api<{ members: Member[] }>(`${base}/members`)).members);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the people in this application.');
    }
  }, [base]);
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

  const leave = async () => {
    await run(() => api(`${base}/members/${user!.id}`, { method: 'DELETE' }));
    setCurrentId(null);
    await reloadApplications();
    navigate('/applications');
  };

  return (
    <section className="space-y-6">
      <ScreenHeader title="People in this application" purpose={`Who can see and help with ${application.name}.`} />

      {error && (
        <ResolutionCard status="stop" title="That didn't work" role="alert">
          <p>{error}</p>
        </ResolutionCard>
      )}
      {link && <EnrolmentLink {...link} onDismiss={() => setLink(null)} />}

      <Expander icon="info" title="What each role can do" summary="Coordinator · Contributor · Viewer">
        <dl className="space-y-2">
          {(Object.keys(ROLE_HELP) as MemberRole[]).map((r) => (
            <div key={r}>
              <dt className="font-semibold">{ROLE_LABELS[r]}</dt>
              <dd>{ROLE_HELP[r]}</dd>
            </div>
          ))}
        </dl>
      </Expander>

      {isCoordinator && application.status !== 'archived' && (
        <AddPerson
          base={base}
          onAdded={(username, url) => {
            if (url) setLink({ username, url });
            load();
          }}
          onError={setError}
        />
      )}

      <section aria-labelledby="members-heading" className="space-y-3">
        <h2 id="members-heading">{members ? `${members.length} ${members.length === 1 ? 'person' : 'people'}` : 'People'}</h2>
        {!members ? (
          <p role="status">Loading…</p>
        ) : (
          <ul className="space-y-3">
            {members.map((m) => (
              <li key={m.user_id} className="card space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3>
                      {m.display_name} <span className="font-normal">({m.username})</span>
                      {m.user_id === user?.id && <span className="font-normal"> · you</span>}
                    </h3>
                    <p className="small">
                      {m.enrolled
                        ? `Added ${formatDateTime(m.added_at)}`
                        : m.enrolment_expires_at
                          ? `Waiting for passkey setup (link expires ${formatDateTime(m.enrolment_expires_at)})`
                          : 'Not set up yet — send a new link'}
                    </p>
                  </div>
                  <span className="chip chip-outline">{ROLE_LABELS[m.role]}</span>
                </div>
                {isCoordinator && application.status !== 'archived' && (
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label htmlFor={`role-${m.user_id}`} className="label">
                        Role <span className="sr-only">for {m.display_name}</span>
                      </label>
                      <select
                        id={`role-${m.user_id}`}
                        className="input"
                        value={m.role}
                        onChange={(e) => run(() => api(`${base}/members/${m.user_id}`, { method: 'PATCH', body: { role: e.target.value } }))}
                      >
                        {(Object.keys(ROLE_LABELS) as MemberRole[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </div>
                    {!m.enrolled && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => run(async () => setLink({ username: m.username, url: (await api<{ enrolment_url: string }>(`${base}/members/${m.user_id}/enrolment`, { method: 'POST' })).enrolment_url }))}
                      >
                        New link <span className="sr-only">for {m.display_name}</span>
                      </button>
                    )}
                    {m.user_id !== user?.id && (
                      <ConfirmButton prompt={`Remove ${m.display_name} from ${application.name}?`} confirmLabel="Remove" onConfirm={() => run(() => api(`${base}/members/${m.user_id}`, { method: 'DELETE' }))}>
                        Remove <span className="sr-only">{m.display_name}</span>
                      </ConfirmButton>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {members && !isCoordinator && (
        <ConfirmButton prompt={`Leave ${application.name}? You'll need to be added again to see it.`} confirmLabel="Leave" onConfirm={leave}>
          Leave this application
        </ConfirmButton>
      )}
    </section>
  );
}

function AddPerson({ base, onAdded, onError }: { base: string; onAdded: (username: string, url?: string) => void; onError: (msg: string) => void }) {
  const [kind, setKind] = useState<'existing' | 'new'>('new');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<MemberRole>('viewer');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = kind === 'new' ? { username, display_name: displayName, new: true, role } : { username, role };
      const r = await api<{ member: string; enrolment_url?: string }>(`${base}/members`, { body });
      onAdded(r.member, r.enrolment_url);
      setUsername('');
      setDisplayName('');
      setRole('viewer');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not add them.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Expander icon="plus" title="Add a family member" summary="They join as a viewer unless you choose otherwise" defaultOpen={false}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <ChoiceCards<'existing' | 'new'>
          legend="Do they already use this app?"
          name="kind"
          value={kind}
          onChange={setKind}
          columns={2}
          choices={[
            { value: 'new', label: 'No, invite them', description: "We'll make a one-time link for them to set up a passkey." },
            { value: 'existing', label: 'Yes, add by username', description: 'For someone already helping with another application.' },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {kind === 'new' && (
            <Field label="Their name">
              {({ id }) => <input id={id} className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />}
            </Field>
          )}
          <Field label="Username" hint={kind === 'new' ? 'Lowercase, e.g. sam. They sign in with this.' : undefined}>
            {({ id, describedBy }) => (
              <input id={id} aria-describedby={describedBy} className="input" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required />
            )}
          </Field>
        </div>
        <ChoiceCards<MemberRole>
          legend="What can they do?"
          name="new-role"
          value={role}
          onChange={setRole}
          columns={3}
          choices={(['viewer', 'contributor', 'coordinator'] as MemberRole[]).map((r) => ({ value: r, label: ROLE_LABELS[r], description: ROLE_HELP[r] }))}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !username.trim() || (kind === 'new' && !displayName.trim())}>
          <Icon name="plus" size={20} /> {kind === 'new' ? 'Add and create their link' : 'Add them'}
        </button>
      </form>
    </Expander>
  );
}
