import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api';
import { GATHER, isGatherStep, mattersGroup, missingForFind, needsGroups, stepInfo, stepPath } from '../gather';
import type { GatherStep } from '../state/reducer';
import { ParticipantScreen } from './ParticipantScreen';
import { OverviewScreen } from './OverviewScreen';
import { BoundingScreen } from './BoundingScreen';
import { ProfileEditor } from '../components/ProfileEditor';
import { CarePlanStep } from '../components/CarePlanStep';
import { ApplicantPicker, BriefStep } from '../components/Brief';
import { FamilyConversation } from '../components/FamilyConversation';
import { Icon } from '../components/ui/Icon';
import { Meter } from '../components/ui/Visual';
import { DictationProvider } from '../components/Dictation';

// The Gather stage (improvement plan, package 1): one topic per screen, with progress, who's doing each step,
// and the way on. The applicant (marked by the coordinator) sees only their own steps, in larger text.

interface Member {
  user_id: string;
  display_name: string;
  role: 'coordinator' | 'contributor' | 'viewer';
}

export function useMembers() {
  const { application } = useApp();
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    let live = true;
    api<{ members: Member[] }>(`/api/applications/${encodeURIComponent(application.id)}/members`)
      .then((r) => live && setMembers(r.members))
      .catch(() => live && setMembers([]));
    return () => {
      live = false;
    };
  }, [application.id]);
  return members;
}

export function GatherScreen() {
  const params = useParams();
  const step: GatherStep = isGatherStep(params.step) ? params.step : 'situation';
  if (params.step && !isGatherStep(params.step)) return <Navigate to={stepPath('situation')} replace />;
  return <GatherStepView step={step} />;
}

function GatherStepView({ step }: { step: GatherStep }) {
  const { state, seed, role, dispatch } = useApp();
  const { user } = useAuth();
  const members = useMembers();
  const isApplicant = !!user && state.gather.applicantUserId === user.id;
  const steps = isApplicant ? GATHER.filter((g) => g.forApplicant || g.step === 'brief') : GATHER;
  const index = steps.findIndex((g) => g.step === step);
  const info = stepInfo(step);
  const prev = steps[index - 1];
  const next = steps[index + 1];
  const doneCount = steps.filter((g) => g.done(state, seed)).length;
  const assignee = members.find((m) => m.user_id === state.gather.assignments[step]);
  const missing = missingForFind(state);
  const firstName = (user?.display_name ?? '').split(' ')[0];

  let content: ReactNode;
  switch (step) {
    case 'situation':
      content = (
        <>
          <ApplicantPicker members={members} />
          <ParticipantScreen embedded />
        </>
      );
      break;
    case 'money':
      content = <OverviewScreen embedded />;
      break;
    case 'plan':
      content = <CarePlanStep />;
      break;
    case 'needs':
      content = (
        <>
          <FamilyConversation groups={needsGroups(seed).map((g) => g.group)} />
          <BoundingScreen embedded groups={needsGroups(seed).map((g) => g.group)} />
        </>
      );
      break;
    case 'matters':
      content = (
        <>
          <FamilyConversation groups={[mattersGroup(seed)!.group]} />
          <BoundingScreen embedded groups={[mattersGroup(seed)!.group]} />
        </>
      );
      break;
    case 'about':
      content = state.participant ? <ProfileEditor /> : <p className="card">Fill in your situation first, then tell providers about yourself here.</p>;
      break;
    case 'brief':
      content = <BriefStep members={members} />;
      break;
  }

  return (
    <DictationProvider value={isApplicant}>
    <section className={`space-y-6 ${isApplicant ? 'text-[1.15rem]' : ''}`}>
      {isApplicant && (
        <div className="well">
          <p className="text-[1.2rem] font-semibold">Hello{firstName ? ` ${firstName}` : ''}. These are your questions.</p>
          <p>Answer in your own words. You can tap the microphone to speak instead of typing. Your family does the rest.</p>
        </div>
      )}

      <header className="space-y-2">
        <p className="small">
          Gather · step {index + 1} of {steps.length}
        </p>
        <h1>{info.label}</h1>
        <p>{info.purpose}</p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-40">
            <Meter value={doneCount} max={steps.length} label={`${doneCount} of ${steps.length} steps done`} />
          </span>
          {info.done(state, seed) && (
            <span className="chip chip-good">
              <Icon name="check" size={16} /> Done
            </span>
          )}
          {!isApplicant &&
            (role === 'coordinator' && members.length > 1 ? (
              <label className="flex items-center gap-2">
                <span className="small">Who's doing this step</span>
                <select
                  className="input w-auto"
                  value={state.gather.assignments[step] ?? ''}
                  onChange={(e) => dispatch({ type: 'gather/assign', step, userId: e.target.value || null })}
                >
                  <option value="">Anyone</option>
                  {members
                    .filter((m) => m.role !== 'viewer' || m.user_id === state.gather.applicantUserId)
                    .map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.display_name}
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              assignee && <span className="chip chip-outline">{assignee.user_id === user?.id ? 'Assigned to you' : `${assignee.display_name} is doing this step`}</span>
            ))}
        </div>
      </header>

      <StepList steps={steps.map((g) => g.step)} current={step} members={members} />

      {content}

      <nav aria-label="Gather steps" className="card flex flex-wrap items-center justify-between gap-3">
        {prev ? (
          <Link to={stepPath(prev.step)} className="btn">
            <Icon name="arrowLeft" size={20} /> {prev.label}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link to={stepPath(next.step)} className="btn btn-primary">
            Next: {next.label} <Icon name="arrowRight" size={20} />
          </Link>
        ) : isApplicant ? (
          <span>That's everything we need from you. Thank you.</span>
        ) : missing.length ? (
          <span>
            Find opens when Gather has {missing.map((m) => m.label.toLowerCase()).join(', ')}.
          </span>
        ) : (
          <Link to="/providers" className="btn btn-primary">
            Continue to Find <Icon name="arrowRight" size={20} />
          </Link>
        )}
      </nav>
    </section>
    </DictationProvider>
  );
}

function StepList({ steps, current, members }: { steps: GatherStep[]; current: GatherStep; members: Member[] }) {
  const { state, seed } = useApp();
  return (
    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="All Gather steps">
      {steps.map((s, i) => {
        const info = stepInfo(s);
        const done = info.done(state, seed);
        const who = members.find((m) => m.user_id === state.gather.assignments[s]);
        return (
          <li key={s}>
            <Link
              to={stepPath(s)}
              aria-current={s === current ? 'step' : undefined}
              className={`flex min-h-[var(--target-min)] items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 no-underline ${s === current ? 'border-2 border-[var(--charcoal)] bg-[var(--amber-tint)]' : 'border-[var(--rule)]'}`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[var(--charcoal)] text-[0.8rem] ${done ? 'bg-[var(--charcoal)] text-[var(--surface)]' : ''}`} aria-hidden>
                {done ? <Icon name="check" size={14} /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{info.label}</span>
                <span className="block text-[0.85rem]">
                  {done ? 'Done' : 'Not done'}
                  {who && ` · ${who.display_name}`}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
