import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import { useAuth } from '../auth/AuthContext';
import { entriesAt, newId, type Booking } from '../state/reducer';
import { interviewIcs, packEmail, tailoredQuestions, type TailoredQuestion } from '../tailored';
import { useMatches } from '../components/Finder';
import { CRITERIA } from '../scoring';
import { lookingForInputs, PRIORITY_LABELS } from '../matching';
import { answerLabels } from '../lookingFor';
import { DependencyCard, NextStepCard, ScreenHeader } from '../components/ui/Cards';
import { Icon } from '../components/ui/Icon';
import { formatDate } from '../format';
import type { Provider } from '../types';

// Prepare (improvement plan 3.2): for each provider you'll interview — tailored questions, the booking, the
// pack to send them, and a briefing for whoever attends.

const blankBooking = (): Booking => ({ date: '', time: '', mode: 'in_person', place: '', attendees: '', lead: '', sent: { questions: false, dossier: false, price_list_request: false } });

export function useTailored(provider: Provider | undefined) {
  const { seed, state } = useApp();
  const { claims, compliance } = useSession();
  const { matches } = useMatches(true);
  if (!provider) return { focus: [], rest: [] };
  return tailoredQuestions({ seed, state, provider, match: matches.find((m) => m.provider.id === provider.id), claims: claims.get(provider.id)?.claims, compliance: compliance.get(provider.id) });
}

export function PrepareScreen() {
  const { state, providers } = useApp();
  const [params, setParams] = useSearchParams();
  const toMeet = entriesAt(state, 'interview').flatMap((e) => providers.filter((p) => p.id === e.provider_id));
  const current = toMeet.find((p) => p.id === params.get('p')) ?? toMeet[0];

  if (!toMeet.length) {
    return (
      <section className="space-y-6">
        <ScreenHeader title="Prepare for your interviews" purpose="Questions, bookings and briefings for each provider you'll meet." />
        <DependencyCard to="/compare" action="Choose who to interview" minutes={3}>
          Choose who to meet first: vote on your shortlist, or tick who to interview.
        </DependencyCard>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <ScreenHeader title="Prepare for your interviews" purpose="Questions, bookings and briefings for each provider you'll meet." />
      <div role="group" aria-label="Provider to prepare for" className="flex flex-wrap gap-2">
        {toMeet.map((p) => {
          const b = state.select.bookings[p.id];
          return (
            <button key={p.id} type="button" className="btn" aria-pressed={p.id === current.id} onClick={() => setParams({ p: p.id })}>
              {p.provider}
              <span className="font-normal">{b?.date ? ` · ${formatDate(b.date)}` : ' · not booked'}</span>
            </button>
          );
        })}
      </div>
      <BookingCard key={`b-${current.id}`} provider={current} />
      <QuestionsCard provider={current} />
      <SendCard provider={current} />
      <NextStepCard
        done={`${toMeet.filter((p) => state.select.bookings[p.id]?.date).length} of ${toMeet.length} interviews booked.`}
        next="hold the interviews"
        back={{ to: '/compare', label: 'Compare and vote' }}
        forward={{ to: '/interviews', label: 'Continue to interviews' }}
      />
    </section>
  );
}

function BookingCard({ provider }: { provider: Provider }) {
  const { state, dispatch, canEdit } = useApp();
  const saved = state.select.bookings[provider.id];
  const [b, setB] = useState<Booking>(saved ?? blankBooking());
  const set = (patch: Partial<Booking>) => setB((x) => ({ ...x, ...patch }));
  const save = (e: FormEvent) => {
    e.preventDefault();
    dispatch({ type: 'select/booking', providerId: provider.id, booking: b });
  };
  const ics = () => {
    const blob = new Blob([interviewIcs({ provider: provider.provider, ...b })], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `interview-${provider.id}.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <form className="card space-y-3" aria-labelledby="booking-heading" onSubmit={save}>
      <h2 id="booking-heading" className="text-[1.2rem]">
        Booking
      </h2>
      <fieldset disabled={!canEdit} className="grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className="label">Date</span>
          <input type="date" className="input" value={b.date} onChange={(e) => set({ date: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Time</span>
          <input type="time" className="input" value={b.time} onChange={(e) => set({ time: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">How</span>
          <select className="input" value={b.mode} onChange={(e) => set({ mode: e.target.value as Booking['mode'] })}>
            <option value="in_person">In person</option>
            <option value="phone">Phone</option>
            <option value="video">Video call</option>
          </select>
        </label>
        {b.mode === 'in_person' && (
          <label className="block md:col-span-3">
            <span className="label">Where</span>
            <input className="input" value={b.place} placeholder="e.g. at home" onChange={(e) => set({ place: e.target.value })} />
          </label>
        )}
        <label className="block md:col-span-2">
          <span className="label">Who's attending</span>
          <input className="input" value={b.attendees} placeholder="e.g. Dad, Sam, Jo" onChange={(e) => set({ attendees: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Who leads</span>
          <input className="input" value={b.lead} onChange={(e) => set({ lead: e.target.value })} />
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <button type="submit" className="btn btn-primary">
            Save booking
          </button>
        )}
        {saved?.date && (
          <button type="button" className="btn" onClick={ics}>
            <Icon name="calendar" size={18} /> Add to calendar
          </button>
        )}
        <Link to={`/prepare/${provider.id}/briefing`} className="btn">
          <Icon name="note" size={18} /> Family briefing
        </Link>
      </div>
      {saved && <p className="small">Saved{saved.date ? `: ${formatDate(saved.date)}${saved.time ? ` at ${saved.time}` : ''}` : ''}.</p>}
    </form>
  );
}

function QuestionLine({ q, n }: { q: TailoredQuestion; n: number }) {
  return (
    <li className="space-y-0.5">
      <p>
        <span className="mr-1 font-semibold">{n}.</span>
        {q.must && <span className="chip chip-caution mr-1">Must-ask</span>}
        {q.text}
      </p>
      {q.why && <p className="small">{q.why}</p>}
      {q.theySay && <p className="small italic">They say: “{q.theySay}”</p>}
    </li>
  );
}

function QuestionsCard({ provider }: { provider: Provider }) {
  const { seed, dispatch, canEdit } = useApp();
  const { focus, rest } = useTailored(provider);
  const [text, setText] = useState('');
  const [section, setSection] = useState('A');
  const [forAll, setForAll] = useState(false);
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    dispatch({ type: 'question/add', question: { id: `cq-${newId()}`, section, text: text.trim(), ...(forAll ? {} : { provider_id: provider.id }) } });
    setText('');
  };
  return (
    <section className="card space-y-3" aria-labelledby="questions-heading">
      <h2 id="questions-heading" className="text-[1.2rem]">
        Questions for {provider.provider}
      </h2>
      <p>Built from your question list. The ones that matter most for {provider.provider} come first, with why.</p>
      <h3 className="font-semibold">Focus on these ({focus.length})</h3>
      <ol className="space-y-2">
        {focus.map((q, i) => (
          <QuestionLine key={q.id} q={q} n={i + 1} />
        ))}
      </ol>
      <details>
        <summary className="cursor-pointer font-semibold">The rest of your questions ({rest.length})</summary>
        <ol className="mt-2 space-y-2">
          {rest.map((q, i) => (
            <QuestionLine key={q.id} q={q} n={focus.length + i + 1} />
          ))}
        </ol>
      </details>
      {canEdit && (
        <form className="space-y-2 border-t border-[var(--rule)] pt-3" onSubmit={add}>
          <label htmlFor="own-question" className="label">
            Add your own question
          </label>
          <input id="own-question" className="input" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              Topic
              <select className="input w-auto" value={section} onChange={(e) => setSection(e.target.value)}>
                {seed.interviewSections.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code}. {s.section}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={forAll} onChange={(e) => setForAll(e.target.checked)} /> Ask every provider
            </label>
            <button type="submit" className="btn" disabled={!text.trim()}>
              Add question
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function SendCard({ provider }: { provider: Provider }) {
  const { state, application, dispatch, canEdit } = useApp();
  const { user } = useAuth();
  const { focus } = useTailored(provider);
  const b = state.select.bookings[provider.id];
  const applicant = state.profile?.preferred_name || state.participant?.name || application.name;
  const mail = packEmail({ provider: provider.provider, applicant, date: b?.date ?? '', time: b?.time ?? '', questions: focus.filter((q) => q.must || q.kind !== 'pack'), from: user?.display_name ?? '' });
  const href = `mailto:?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`;
  const mark = (key: keyof Booking['sent'], value: boolean) => dispatch({ type: 'select/booking', providerId: provider.id, booking: { ...(b ?? blankBooking()), sent: { ...(b ?? blankBooking()).sent, [key]: value } } });
  return (
    <section className="card space-y-3" aria-labelledby="send-heading">
      <h2 id="send-heading" className="text-[1.2rem]">
        Send them the pack
      </h2>
      <p>Opens an email in your own mail app with your questions. Attach the dossier (save it as a PDF from its page) before sending.</p>
      <div className="flex flex-wrap gap-2">
        <a href={href} className="btn btn-primary">
          <Icon name="note" size={18} /> Write the email
        </a>
        <Link to={`/dossier/${provider.id}`} className="btn">
          Open the dossier (save as PDF)
        </Link>
      </div>
      <fieldset disabled={!canEdit} className="space-y-1">
        <legend className="label">Sent so far</legend>
        {(
          [
            ['questions', 'Questions sent'],
            ['dossier', 'Dossier sent'],
            ['price_list_request', 'Asked for their full price list'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex min-h-[var(--target-min)] items-center gap-3">
            <input type="checkbox" checked={!!b?.sent[key]} onChange={(e) => mark(key, e.target.checked)} /> {label}
          </label>
        ))}
      </fieldset>
    </section>
  );
}

/** One printable page for whoever attends: what to listen for, red flags, the must-asks and how to score. */
export function BriefingScreen() {
  const { providerId } = useParams();
  const { state, seed, providers } = useApp();
  const provider = providers.find((p) => p.id === providerId);
  const { focus } = useTailored(provider);
  const { compliance } = useSession();
  if (!provider) return <main className="p-6">Provider not found. <Link to="/prepare">Back to prepare</Link></main>;
  const { priorities } = lookingForInputs(state.answers);
  const q = (id: string) => seed.boundingGroups.flatMap((g) => g.questions).find((x) => x.id === id)!;
  const dealBreakers = answerLabels(q('B8.3'), state.answers['B8.3']);
  const findings = compliance.get(provider.id)?.result?.findings ?? [];
  const b = state.select.bookings[provider.id];
  return (
    <main className="print-pack mx-auto max-w-[56rem] space-y-5 bg-[var(--surface)] p-6 text-[var(--charcoal)]">
      <div className="no-print flex flex-wrap gap-2">
        <Link to={`/prepare?p=${provider.id}`} className="btn-quiet">
          <Icon name="arrowLeft" size={20} /> Prepare
        </Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <header className="border-b-2 border-[var(--charcoal)] pb-2">
        <h1 className="text-[1.6rem]">Briefing: {provider.provider}</h1>
        <p>
          {b?.date ? `${formatDate(b.date)}${b.time ? ` at ${b.time}` : ''} · ${b.mode === 'phone' ? 'by phone' : b.mode === 'video' ? 'video call' : b.place || 'in person'}` : 'Not booked yet'}
          {b?.lead && ` · led by ${b.lead}`}
        </p>
      </header>
      <section>
        <h2 className="text-[1.2rem]">Listen for</h2>
        <ul className="list-disc pl-6">
          {priorities.map((p) => (
            <li key={p}>{PRIORITY_LABELS[p]}</li>
          ))}
          {state.lookingFor?.must_haves.map((m) => <li key={m}>{m}</li>)}
        </ul>
      </section>
      <section>
        <h2 className="text-[1.2rem]">Red flags</h2>
        <ul className="list-disc pl-6">
          {dealBreakers.map((d) => (
            <li key={d}>{d}</li>
          ))}
          {findings.map((f, i) => (
            <li key={i}>Compliance: {f.text}</li>
          ))}
          {provider.flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
          <li>Vague answers to must-ask questions, or not willing to put answers in writing</li>
        </ul>
      </section>
      <section>
        <h2 className="text-[1.2rem]">Must ask</h2>
        <ol className="list-decimal space-y-1 pl-6">
          {focus.map((x) => (
            <li key={x.id}>{x.text}</li>
          ))}
        </ol>
      </section>
      <section>
        <h2 className="text-[1.2rem]">How to score (1 to 5, afterwards, on your own)</h2>
        <ul className="list-disc pl-6">
          {CRITERIA.map((c) => (
            <li key={c.id}>{c.label}</li>
          ))}
        </ul>
        <p className="small">5 = excellent, 3 = adequate, 1 = poor. Score on your own; the app combines everyone's scores.</p>
      </section>
    </main>
  );
}
