import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useSession } from '../state/SessionContext';
import type { ApplicationInfo, ApplicationStatus, Catalogue, Suggestion } from '../backend';
import type { Provider } from '../types';
import { RATE_KEYS } from '../schemas';
import { RATE_LABELS } from '../labels';
import { formatDateTime, formatRate } from '../format';
import { areaText } from '../area';
import { ConfirmButton } from '../components/ConfirmButton';
import { ResolutionCard } from '../components/ui/Cards';
import { ChoiceCards, Field } from '../components/ui/Form';
import { Expander } from '../components/ui/Expander';
import { Icon } from '../components/ui/Icon';
import { Chip } from '../components/ui/Status';
import { EnrolmentLink } from './AdminScreen';

/** Site administration: people, applications, provider suggestions and the common catalogue. */
export function AdminLayout() {
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    api<{ suggestions: Suggestion[] }>('/api/admin/suggestions?status=pending')
      .then((r) => setPending(r.suggestions.length))
      .catch(() => setPending(null));
  }, []);
  const tab = ({ isActive }: { isActive: boolean }) => `btn ${isActive ? 'btn-selected' : ''}`;
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1>Site administration</h1>
        <p>Applications, who can sign in, and the provider information every application uses.</p>
      </div>
      <nav aria-label="Administration" className="flex flex-wrap gap-2">
        <NavLink to="/admin/applications" className={tab}>
          <Icon name="list" size={20} /> Applications
        </NavLink>
        <NavLink to="/admin" end className={tab}>
          <Icon name="users" size={20} /> People
        </NavLink>
        <NavLink to="/admin/suggestions" className={tab}>
          <Icon name="edit" size={20} /> Suggested corrections {pending ? <span className="chip chip-caution">{pending}</span> : null}
        </NavLink>
        <NavLink to="/admin/providers" className={tab}>
          <Icon name="dollar" size={20} /> Provider catalogue
        </NavLink>
        <NavLink to="/admin/data-checks" className={tab}>
          <Icon name="search" size={20} /> Data checks
        </NavLink>
      </nav>
      <Outlet />
    </section>
  );
}

// --- Applications ---

interface AdminApplication extends ApplicationInfo {
  last_activity: string;
  members: number;
  coordinators: { user_id: string; display_name: string; username: string }[];
}
interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  disabled: boolean;
}

const STATUS_LABELS: Record<ApplicationStatus, string> = { active: 'In progress', decided: 'Decided', archived: 'Archived' };

export function AdminApplicationsScreen() {
  const { user } = useAuth();
  const { reloadApplications, setCurrentId } = useSession();
  const navigate = useNavigate();
  const [apps, setApps] = useState<AdminApplication[] | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ app: ApplicationInfo; link?: { username: string; url: string }; mine: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, u] = await Promise.all([api<{ applications: AdminApplication[] }>('/api/admin/applications'), api<{ users: AdminUser[] }>('/api/admin/users')]);
      setApps(a.applications);
      setUsers(u.users.filter((x) => !x.disabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load applications.');
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await Promise.all([load(), reloadApplications()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  return (
    <div className="space-y-4">
      <ResolutionCard
        status="info"
        title="You see each application's details, not its contents"
        moreLabel="Why?"
        more={
          <p>
            Answers, notes, interviews and scores belong to the family. To see them, a coordinator has to add you to the application (or you can make yourself
            its coordinator below).
          </p>
        }
      />
      {error && (
        <ResolutionCard status="stop" title="That didn't work" role="alert">
          <p>{error}</p>
        </ResolutionCard>
      )}
      {created && (
        <ResolutionCard
          status="good"
          title={`Created ${created.app.name}`}
          role="status"
          actions={
            created.mine ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setCurrentId(created.app.id);
                  navigate('/');
                }}
              >
                Open it
              </button>
            ) : undefined
          }
        >
          {created.link ? <p>Send the coordinator their link below so they can set up a passkey.</p> : <p>The coordinator can now add family members.</p>}
        </ResolutionCard>
      )}
      {created?.link && <EnrolmentLink {...created.link} onDismiss={() => setCreated({ ...created, link: undefined })} />}

      {apps && (
        <CreateApplication
          users={users}
          defaultOpen={apps.length === 0}
          onCreated={async (app, link, coordinatorId) => {
            setCreated({ app, link, mine: coordinatorId === user?.id });
            await Promise.all([load(), reloadApplications()]);
          }}
          onError={setError}
        />
      )}

      {!apps ? (
        <p role="status">Loading…</p>
      ) : (
        <ul className="space-y-3">
          {apps.map((a) => (
            <li key={a.id} className="card space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-[1.2rem]">{a.name}</h2>
                  <p className="flex flex-wrap gap-x-4">
                    {(a.suburb || a.postcode) && <span>{[a.suburb, a.postcode].filter(Boolean).join(' ')}</span>}
                    <span>
                      {a.members} {a.members === 1 ? 'person' : 'people'}
                    </span>
                    <span>Coordinator: {a.coordinators.map((c) => c.display_name).join(', ') || 'none'}</span>
                  </p>
                  <p className="small">Last change {formatDateTime(a.last_activity)}</p>
                </div>
                <span className={`chip ${a.status === 'decided' ? 'chip-good' : 'chip-neutral'}`}>{STATUS_LABELS[a.status]}</span>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <CoordinatorPicker
                  users={users}
                  appName={a.name}
                  onPick={(userId) => run(() => api(`/api/admin/applications/${a.id}/coordinator`, { body: { user_id: userId } }))}
                />
                {a.status === 'archived' ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => run(() => api(`/api/admin/applications/${a.id}`, { method: 'PATCH', body: { status: 'active' } }))}
                  >
                    Restore <span className="sr-only">{a.name}</span>
                  </button>
                ) : (
                  <ConfirmButton
                    className="btn"
                    prompt={`Archive ${a.name}? It becomes read-only for everyone.`}
                    confirmLabel="Archive"
                    onConfirm={() => run(() => api(`/api/admin/applications/${a.id}`, { method: 'PATCH', body: { status: 'archived' } }))}
                  >
                    Archive <span className="sr-only">{a.name}</span>
                  </ConfirmButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CoordinatorPicker({ users, appName, onPick }: { users: AdminUser[]; appName: string; onPick: (userId: string) => void }) {
  const [userId, setUserId] = useState('');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="label" htmlFor={`coord-${appName}`}>
          Make coordinator <span className="sr-only">of {appName}</span>
        </label>
        <select id={`coord-${appName}`} className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Choose a person…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name} ({u.username})
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="btn" disabled={!userId} onClick={() => (onPick(userId), setUserId(''))}>
        Make coordinator
      </button>
    </div>
  );
}

function CreateApplication({
  users,
  defaultOpen,
  onCreated,
  onError,
}: {
  users: AdminUser[];
  defaultOpen: boolean;
  onCreated: (app: ApplicationInfo, link: { username: string; url: string } | undefined, coordinatorId: string | undefined) => void;
  onError: (msg: string) => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [suburb, setSuburb] = useState('');
  const [postcode, setPostcode] = useState('');
  const [kind, setKind] = useState<'existing' | 'new'>('existing');
  const [coordinatorId, setCoordinatorId] = useState(user?.id ?? '');
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const coordinator = kind === 'existing' ? { user_id: coordinatorId } : { username: newUsername, display_name: newName };
      const r = await api<{ application: ApplicationInfo; enrolment_url?: string }>('/api/admin/applications', {
        body: { name, suburb, postcode, coordinator },
      });
      onCreated(
        r.application,
        r.enrolment_url ? { username: newUsername.trim().toLowerCase(), url: r.enrolment_url } : undefined,
        kind === 'existing' ? coordinatorId : undefined,
      );
      setName('');
      setSuburb('');
      setPostcode('');
      setNewName('');
      setNewUsername('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create the application.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Expander icon="plus" title="Create an application" summary="For one applicant, with a coordinator to run it" defaultOpen={defaultOpen}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-[2fr_1.5fr_1fr]">
          <Field label="Name" hint='Who it is for, e.g. "Dad – Wynnum".'>
            {({ id, describedBy }) => (
              <input id={id} aria-describedby={describedBy} className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            )}
          </Field>
          <Field label="Suburb">{({ id }) => <input id={id} className="input" value={suburb} onChange={(e) => setSuburb(e.target.value)} />}</Field>
          <Field label="Postcode" hint="Used to match providers' service areas.">
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                className="input"
                inputMode="numeric"
                maxLength={4}
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
              />
            )}
          </Field>
        </div>
        <ChoiceCards<'existing' | 'new'>
          legend="Coordinator"
          hint="The applicant, or the family member who'll run it. They add family and choose what each person can do."
          name="coord-kind"
          value={kind}
          onChange={setKind}
          columns={2}
          choices={[
            { value: 'existing', label: 'Someone who already uses the app' },
            { value: 'new', label: 'A new person', description: "We'll make a one-time link for them." },
          ]}
        />
        {kind === 'existing' ? (
          <Field label="Choose the coordinator">
            {({ id }) => (
              <select id={id} className="input" value={coordinatorId} onChange={(e) => setCoordinatorId(e.target.value)}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name} ({u.username}){u.id === user?.id ? ' — you' : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Their name">{({ id }) => <input id={id} className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />}</Field>
            <Field label="Username" hint="Lowercase, e.g. jo.">
              {({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  className="input"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                />
              )}
            </Field>
          </div>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !name.trim() || (kind === 'existing' ? !coordinatorId : !newName.trim() || !newUsername.trim())}
        >
          Create application
        </button>
      </form>
    </Expander>
  );
}

// --- Suggested corrections ---

const FIELD_LABELS: Partial<Record<keyof Provider, string>> = {
  provider: 'Name',
  type: 'Type',
  outlet: 'Outlet',
  ...Object.fromEntries(RATE_KEYS.map((k) => [k, `${RATE_LABELS[k]} (per hour)`])),
  prices_as_at: 'Prices as at',
  source_url: 'Price list link',
  veteran_fit: 'Veteran experience',
  flags: 'Flags',
  postcodes_served: 'Postcodes served',
};

const show = (key: keyof Provider, v: unknown): string => {
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return '—';
  if ((RATE_KEYS as readonly string[]).includes(key as string)) return formatRate(v as number);
  if (Array.isArray(v)) return v.join('; ');
  return String(v);
};

/** Fields that differ between the catalogue record and the suggestion. */
export function changedFields(current: Provider | null, proposed: Provider): (keyof Provider)[] {
  return (Object.keys(FIELD_LABELS) as (keyof Provider)[]).filter((k) => JSON.stringify(current?.[k] ?? null) !== JSON.stringify(proposed[k] ?? null));
}

export function AdminSuggestionsScreen() {
  const { setCatalogue } = useSession();
  const [status, setStatus] = useState<'pending' | 'decided'>('pending');
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = (await api<{ suggestions: Suggestion[] }>(`/api/admin/suggestions${status === 'pending' ? '?status=pending' : ''}`)).suggestions;
      setItems(status === 'pending' ? all : all.filter((s) => s.status !== 'pending'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load suggestions.');
    }
  }, [status]);
  useEffect(() => {
    load();
  }, [load]);

  const decide = async (s: Suggestion, approve: boolean, note: string) => {
    setError(null);
    try {
      const r = await api<{ suggestion: Suggestion } & Catalogue>(`/api/admin/suggestions/${s.id}/decision`, { body: { approve, note } });
      setCatalogue(r);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the decision.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        <button type="button" className="btn" aria-pressed={status === 'pending'} onClick={() => setStatus('pending')}>
          Waiting for review
        </button>
        <button type="button" className="btn" aria-pressed={status === 'decided'} onClick={() => setStatus('decided')}>
          Decided
        </button>
      </div>
      {error && (
        <ResolutionCard status="stop" title="That didn't work" role="alert">
          <p>{error}</p>
        </ResolutionCard>
      )}
      {!items ? (
        <p role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p className="card">{status === 'pending' ? 'No suggestions waiting. Families suggest corrections from a provider’s page.' : 'Nothing decided yet.'}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((s) => (
            <SuggestionCard key={s.id} s={s} onDecide={(approve, note) => decide(s, approve, note)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SuggestionCard({ s, onDecide }: { s: Suggestion; onDecide: (approve: boolean, note: string) => void }) {
  const [note, setNote] = useState('');
  const fields = changedFields(s.current, s.proposed);
  return (
    <li className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[1.2rem]">{s.proposed.provider}</h2>
          <p className="small">
            From {s.suggested_by ?? (s.application_id ? 'a family member' : 'the automatic price check')}
            {s.application_name && ` (${s.application_name})`} · {formatDateTime(s.created_at)}
          </p>
        </div>
        {s.is_new ? (
          <Chip status="info">New provider</Chip>
        ) : (
          <span className="chip chip-neutral">
            {fields.length} change{fields.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {s.note && <p className="well whitespace-pre-wrap">“{s.note}”</p>}
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Now</th>
              <th scope="col">Suggested</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((k) => (
              <tr key={k}>
                <th scope="row" className="font-normal">
                  {FIELD_LABELS[k]}
                </th>
                <td>{show(k, s.current?.[k])}</td>
                <td className="font-semibold">{show(k, s.proposed[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.status === 'pending' ? (
        <>
          <Field label="Note to the family (optional)">
            {({ id }) => <input id={id} className="input" value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => onDecide(true, note)}>
              <Icon name="check" size={20} /> Approve <span className="sr-only">{s.proposed.provider}</span>
            </button>
            <button type="button" className="btn btn-danger" onClick={() => onDecide(false, note)}>
              Reject <span className="sr-only">{s.proposed.provider}</span>
            </button>
          </div>
        </>
      ) : (
        <p>
          <Chip status={s.status === 'approved' ? 'good' : 'stop'}>{s.status === 'approved' ? 'Approved' : 'Rejected'}</Chip> by{' '}
          {s.decided_by ?? 'an administrator'}
          {s.decided_at && ` · ${formatDateTime(s.decided_at)}`}
          {s.decision_note && ` · “${s.decision_note}”`}
        </p>
      )}
    </li>
  );
}

// --- Catalogue ---

export function AdminProvidersScreen() {
  const { catalogue, catalogueEdited, backend, setCatalogue } = useSession();
  const [error, setError] = useState<string | null>(null);
  const noArea = catalogue.filter((p) => !p.postcodes_served?.length).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Link to="/admin/providers/new" className="btn btn-primary">
          <Icon name="plus" size={20} /> Add provider
        </Link>
        <Link to="/admin/providers/import" className="btn">
          Import a spreadsheet
        </Link>
      </div>
      {noArea > 0 && (
        <ResolutionCard
          status="caution"
          title={`${noArea} provider${noArea === 1 ? " hasn't" : "s haven't"} got a service area`}
          moreLabel="What does that mean?"
          more={
            <p>
              Without postcodes served, a provider shows in every application as "area not confirmed". Edit the provider to add the postcodes or ranges it
              covers, e.g. 4150-4179.
            </p>
          }
        />
      )}
      {error && (
        <ResolutionCard status="stop" title="That didn't work" role="alert">
          <p>{error}</p>
        </ResolutionCard>
      )}
      <ul className="space-y-3">
        {catalogue.map((p) => (
          <li key={p.id} className="card flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="text-[1.2rem]">{p.provider}</h2>
              <p className="small">
                Prices as at {p.prices_as_at} · {p.postcodes_served?.length ? `Serves ${areaText(p)}` : 'Area not confirmed'}
              </p>
              {catalogueEdited.has(p.id) && <span className="chip chip-neutral">Changed from the starter data</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={`/admin/providers/${p.id}/edit`} className="btn">
                <Icon name="edit" size={20} /> Edit <span className="sr-only">{p.provider}</span>
              </Link>
              {catalogueEdited.has(p.id) && (
                <ConfirmButton
                  className="btn"
                  prompt={`Undo all changes to ${p.provider} and go back to the starter data?`}
                  confirmLabel="Undo changes"
                  onConfirm={async () => {
                    try {
                      setCatalogue(await backend.revertProvider(p.id));
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not undo the changes.');
                    }
                  }}
                >
                  Undo changes <span className="sr-only">to {p.provider}</span>
                </ConfirmButton>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
