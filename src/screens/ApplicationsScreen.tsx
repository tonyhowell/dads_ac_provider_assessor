import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSession } from '../state/SessionContext';
import type { ApplicationSummary } from '../backend';
import { formatDateTime } from '../format';
import { ResolutionCard } from '../components/ui/Cards';
import { Expander } from '../components/ui/Expander';
import { Icon } from '../components/ui/Icon';
import { ROLE_LABELS } from '../components/Shell';

const STATUS_LABELS = { active: 'In progress', decided: 'Decided', archived: 'Archived' } as const;

/** Every application the person belongs to. Choosing one opens it; the choice is remembered on this device. */
export function ApplicationsScreen() {
  const { user } = useAuth();
  const { applications, applicationsError, currentId, setCurrentId } = useSession();
  const navigate = useNavigate();
  const open = (id: string) => {
    setCurrentId(id);
    navigate('/');
  };

  if (applicationsError) return <ResolutionCard status="stop" title="We couldn't load your applications" role="alert"><p>{applicationsError}</p></ResolutionCard>;
  if (!applications) return <p role="status">Loading your applications…</p>;
  const active = applications.filter((a) => a.status !== 'archived');
  const archived = applications.filter((a) => a.status === 'archived');

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1>Your applications</h1>
        <p>Each application is one person's search for a provider, shared with the family members added to it.</p>
        {user?.role === 'admin' && (
          <Link to="/admin/applications" className="btn btn-primary">
            <Icon name="plus" size={20} /> Create an application
          </Link>
        )}
      </div>

      {applications.length === 0 && (
        <ResolutionCard status="info" title="You haven't been added to an application yet">
          <p>
            {user?.role === 'admin'
              ? 'Create one, and choose who coordinates it.'
              : "Ask the family member running the application to add you, or ask the site administrator."}
          </p>
        </ResolutionCard>
      )}

      {active.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {active.map((a) => (
            <ApplicationCard key={a.id} app={a} current={a.id === currentId} onOpen={() => open(a.id)} />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <Expander icon="list" title="Archived" summary={`${archived.length} application${archived.length === 1 ? '' : 's'}, read-only`}>
          <ul className="grid gap-3 md:grid-cols-2">
            {archived.map((a) => (
              <ApplicationCard key={a.id} app={a} current={a.id === currentId} onOpen={() => open(a.id)} />
            ))}
          </ul>
        </Expander>
      )}
    </section>
  );
}

function ApplicationCard({ app, current, onOpen }: { app: ApplicationSummary; current: boolean; onOpen: () => void }) {
  return (
    <li className={`card space-y-3 ${current ? 'border-2 border-[var(--charcoal)]' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-[1.2rem]">{app.name}</h2>
        <span className={`chip ${app.status === 'decided' ? 'chip-good' : 'chip-neutral'}`}>{STATUS_LABELS[app.status]}</span>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        {(app.suburb || app.postcode) && (
          <span className="inline-flex items-center gap-1">
            <Icon name="pin" size={18} /> {[app.suburb, app.postcode].filter(Boolean).join(' ')}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Icon name="users" size={18} /> {app.members} {app.members === 1 ? 'person' : 'people'} · you're {ROLE_LABELS[app.role].toLowerCase()}
        </span>
      </p>
      <p className="small">Last change {formatDateTime(app.last_activity)}</p>
      <button type="button" className={`btn ${current ? 'btn-primary' : ''}`} onClick={onOpen}>
        {current ? 'Continue' : 'Open'} <span className="sr-only">{app.name}</span> <Icon name="arrowRight" size={20} />
      </button>
    </li>
  );
}
