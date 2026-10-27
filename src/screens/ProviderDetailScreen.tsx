import { ClaimsPanel } from '../components/Claims';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSession } from '../state/SessionContext';
import { servesArea, areaText } from '../area';
import { formatDateTime, formatRate } from '../format';
import type { Suggestion } from '../backend';
import type { Provider, RateKey } from '../types';
import { StatusText, Chip } from '../components/ui/Status';
import { useApp, useProvider } from '../state/AppContext';
import { newId } from '../state/reducer';
import { ConfirmButton } from '../components/ConfirmButton';
import { mentionsDisallowedFees } from '../flags';
import { PriceCell, PriceProvenance, isStale, daysBetween } from '../components/Price';
import { StageControls } from '../components/StageControls';
import { ProviderNotes } from '../components/ProviderNotes';
import { InterviewList } from '../components/InterviewList';
import { RATE_KEYS } from '../schemas';
import { RATE_LABELS } from '../labels';
import { toIsoDate } from '../rules';
import { NextStepCard, ResolutionCard } from '../components/ui/Cards';
import { Term } from '../components/ui/Help';
import { Icon } from '../components/ui/Icon';
import { Expander } from '../components/ui/Expander';
import { GuideScale } from '../components/ui/Visual';
import { variance, varianceBand } from '../calc';

export function ProviderDetailScreen() {
  const { id } = useParams();
  const provider = useProvider(id);
  const { seed, state, dispatch, canEdit } = useApp();

  if (!provider) {
    return (
      <ResolutionCard
        status="caution"
        title="We couldn't find that provider"
        actions={
          <Link to="/providers" className="btn btn-primary">
            Back to providers
          </Link>
        }
      >
        <p>It may have been removed by a family member.</p>
      </ResolutionCard>
    );
  }

  const notesText = state.notes.filter((n) => n.provider_id === provider.id).map((n) => n.text);
  const feeMention = mentionsDisallowedFees(...provider.flags, ...notesText);
  const feeQuestionText = `${provider.provider}: you mentioned extra charges (for example travel or admin). Confirm in writing that your prices are all-inclusive.`;
  const feeQuestionAdded = state.customQuestions.some((q) => q.text === feeQuestionText);
  const today = toIsoDate(new Date());
  const stale = isStale(provider.prices_as_at_date, today);
  const selected = state.selection.some((e) => e.provider_id === provider.id);
  const missing = RATE_KEYS.filter((k) => provider[k] === null);
  const bands = { above: 0, near: 0, below: 0 };
  for (const k of RATE_KEYS) {
    const b = varianceBand(variance(provider[k], seed.benchmark[k]));
    if (b) bands[b] += 1;
  }

  return (
    <section className="space-y-6">
      <Link to="/providers" className="btn-quiet">
        <Icon name="arrowLeft" size={20} /> All providers
      </Link>
      <div className="space-y-2">
        <h1>{provider.provider}</h1>
        {(provider.outlet || provider.type) && <p>{[provider.type, provider.outlet].filter(Boolean).join(' · ')}</p>}
        <PriceProvenance provider={provider} />
        <p>
          <AreaLine provider={provider} />
        </p>
        <SuggestionStatus providerId={provider.id} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <StageControls provider={provider} primaryAdd />
        <Link to={`/dossier/${provider.id}`} className="btn">
          <Icon name="note" size={20} /> Dossier for this provider
        </Link>
        {selected && <StageControls provider={provider} compact />}
        <ProviderEditControls />
      </div>

      {feeMention && (
        <ResolutionCard
          status="caution"
          title="Possible extra fee"
          actions={
            canEdit && (
              <button
                type="button"
                className="btn"
                disabled={feeQuestionAdded}
                onClick={() => dispatch({ type: 'question/add', question: { id: `cq-${newId()}`, section: 'G', text: feeQuestionText } })}
              >
                {feeQuestionAdded ? (
                  <>
                    <Icon name="check" size={20} /> Added to interview questions
                  </>
                ) : (
                  'Add to interview questions'
                )}
              </button>
            )
          }
          more={<p>The notes for {provider.provider} mention a travel, admin or similar charge. Support at Home prices must be all-inclusive.</p>}
          moreLabel="Why does this matter?"
        />
      )}

      {stale && (
        <ResolutionCard
          status="caution"
          title="Prices may be out of date"
          actions={
            <>
              <Link to={`/providers/${provider.id}/edit`} className="btn">
                Update prices
              </Link>
            </>
          }
          moreLabel="Why?"
          more={
            <p>
              {provider.prices_as_at_date
                ? `These were collected on ${provider.prices_as_at} (${daysBetween(provider.prices_as_at_date, today)} days ago).`
                : `We don't have a date for these prices ("${provider.prices_as_at}").`}{' '}
              Providers must review prices every two months.
            </p>
          }
        />
      )}

      <section aria-labelledby="rates-heading" className="card space-y-3">
        <h2 id="rates-heading">Prices per hour (weekdays)</h2>
        <p>
          Compared with the <Term id="benchmark">guide price</Term>: {bands.above} above, {bands.near} close to it, {bands.below} below
          {missing.length > 0 ? `, ${missing.length} not published` : ''}.
        </p>
        <dl className="grid gap-x-8 md:grid-cols-2">
          {RATE_KEYS.map((k) => {
            const rate = provider[k];
            const guide = seed.benchmark[k];
            return (
              <div key={k} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[var(--rule)] py-2">
                <dt className="min-w-0 flex-1 font-medium">{RATE_LABELS[k]}</dt>
                {rate !== null && guide !== null && <GuideScale rate={rate} guide={guide} />}
                <dd className="min-w-0 text-right">
                  <PriceCell rate={rate} guide={guide} special={provider.special_rates?.includes(k)} />
                </dd>
              </div>
            );
          })}
        </dl>
        {missing.length > 0 && (
          <p>
            {missing.length} price{missing.length === 1 ? " isn't" : "s aren't"} published. Costs use the guide price for {missing.length === 1 ? 'it' : 'them'}{' '}
            — ask at interview.
          </p>
        )}
      </section>

      <ClaimsPanel provider={provider} />

      <SpecialRates provider={provider} />

      {(provider.flags.length > 0 || provider.veteran_fit) && (
        <Expander
          icon="list"
          title="What we know"
          summary={[
            provider.veteran_fit && `Veteran experience: ${provider.veteran_fit.split(/[:;,.]/)[0]}`,
            provider.flags.length && `${provider.flags.length} thing${provider.flags.length === 1 ? '' : 's'} to check`,
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          {provider.veteran_fit && (
            <p>
              <strong>Veteran experience:</strong> {provider.veteran_fit}.
            </p>
          )}
          {provider.flags.length > 0 && (
            <>
              <h3>Things to check</h3>
              <ul className="list-disc space-y-1 pl-6">
                {provider.flags.map((f) => (
                  <li key={f}>{f.endsWith('.') ? f : `${f}.`}</li>
                ))}
              </ul>
            </>
          )}
        </Expander>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <ProviderNotes providerId={provider.id} />
        <section aria-labelledby="interviews-heading" className="card space-y-3">
          <h2 id="interviews-heading">Interviews</h2>
          <InterviewList providerId={provider.id} />
          <Link to={`/interviews/new/${provider.id}`} className="btn">
            Record an interview
          </Link>
        </section>
      </div>

      <NextStepCard
        done={selected ? `${provider.provider} is on your list.` : `Add ${provider.provider} to your list if it's worth a closer look.`}
        next="choose who to meet"
        back={{ to: '/providers', label: 'Find providers' }}
        forward={{ to: '/compare', label: 'Compare your shortlist' }}
        primary={selected}
      />
    </section>
  );
}

function ProviderEditControls() {
  const { id } = useParams();
  const { user } = useAuth();
  const { canEdit } = useApp();
  const { seed, catalogueEdited, backend, setCatalogue } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const edited = catalogueEdited.has(id!);
  const fromSeed = seed.providers.some((p) => p.id === id);
  if (user?.role !== 'admin') {
    return canEdit ? (
      <Link to={`/providers/${id}/edit`} className="btn">
        <Icon name="edit" size={20} /> Suggest a correction
      </Link>
    ) : null;
  }
  const revert = async () => {
    try {
      setCatalogue(await backend.revertProvider(id!));
      if (!fromSeed) navigate('/providers');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not undo the changes.');
    }
  };
  return (
    <>
      <Link to={`/providers/${id}/edit`} className="btn">
        <Icon name="edit" size={20} /> Edit details and prices
      </Link>
      {edited && (
        <ConfirmButton
          className={fromSeed ? 'btn' : 'btn btn-danger'}
          prompt={
            fromSeed
              ? 'Undo all changes and go back to the starter data, for every application?'
              : 'Remove this provider from the catalogue, for every application?'
          }
          confirmLabel={fromSeed ? 'Undo changes' : 'Remove provider'}
          onConfirm={revert}
        >
          {fromSeed ? 'Undo changes' : 'Remove provider'}
        </ConfirmButton>
      )}
      {edited && <span className="muted">{fromSeed ? 'Changed from the starter data' : 'Added to the catalogue'}</span>}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </>
  );
}

/** Where this provider works, against the applicant's postcode. */
function AreaLine({ provider }: { provider: Provider }) {
  const { areaPostcode } = useApp();
  const match = servesArea(provider, areaPostcode);
  if (match === 'serves') return <StatusText status="good">Serves {areaPostcode}</StatusText>;
  if (match === 'outside')
    return (
      <StatusText status="caution">
        {areaPostcode} isn't in its service area ({areaText(provider)})
      </StatusText>
    );
  return <span>Service area not confirmed{provider.postcodes_served?.length ? ` (${areaText(provider)})` : ''}</span>;
}

/**
 * Special rates this provider has offered the applicant. Costed only in this application; the common
 * catalogue is unchanged. Blank means the catalogue price applies.
 */
function SpecialRates({ provider }: { provider: Provider }) {
  const { state, dispatch, canEdit, application } = useApp();
  const { catalogue } = useSession();
  const base = catalogue.find((p) => p.id === provider.id) ?? provider;
  const current = state.specialRates[provider.id];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const keys = current ? (RATE_KEYS.filter((k) => current.rates[k] !== undefined) as RateKey[]) : [];

  const start = () => {
    setDraft(Object.fromEntries(RATE_KEYS.map((k) => [k, current?.rates[k] === undefined ? '' : String(current.rates[k])])));
    setNote(current?.note ?? '');
    setProblem(null);
    setEditing(true);
  };
  const save = () => {
    const rates: Partial<Record<RateKey, number>> = {};
    for (const k of RATE_KEYS) {
      const raw = (draft[k] ?? '').trim().replace(/[$,]/g, '');
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return setProblem(`${RATE_LABELS[k]}: enter an hourly price, or leave it blank.`);
      rates[k] = n;
    }
    if (!Object.keys(rates).length) return setProblem('Enter at least one special rate, or press Cancel.');
    if (!note.trim()) return setProblem('Say what they offered and whether you have it in writing.');
    dispatch({ type: 'specialRate/set', providerId: provider.id, rate: { rates, note: note.trim(), recorded_at: new Date().toISOString() } });
    setEditing(false);
  };

  return (
    <Expander
      icon="star"
      title={`Special rates for ${application.name}`}
      summary={
        current
          ? `${keys.length} rate${keys.length === 1 ? '' : 's'} offered — costed in this application only`
          : 'None recorded. Add any rates this provider has offered you.'
      }
    >
      {current && !editing && (
        <>
          <dl className="grid gap-x-8 md:grid-cols-2">
            {keys.map((k) => (
              <div key={k} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--rule)] py-2">
                <dt className="font-medium">{RATE_LABELS[k]}</dt>
                <dd className="text-right">
                  <span className="font-semibold tabular-nums">{formatRate(current.rates[k]!)} /hr</span>{' '}
                  <span className="small">{base[k] === null ? '(no published price)' : `instead of ${formatRate(base[k]!)}`}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="well whitespace-pre-wrap">{current.note}</p>
          <p className="small">
            Recorded{current.author ? ` by ${current.author}` : ''} {formatDateTime(current.recorded_at)}
          </p>
        </>
      )}
      {editing ? (
        <div className="space-y-3">
          <p>Enter only the rates they offered you. Leave the others blank to use the published price.</p>
          <div className="grid gap-3 sm:grid-cols-4">
            {RATE_KEYS.map((k) => (
              <div key={k}>
                <label htmlFor={`sr-${k}`} className="label">
                  {RATE_LABELS[k]}
                </label>
                <span className="hint">Published: {base[k] === null ? 'none' : formatRate(base[k]!)}</span>
                <input
                  id={`sr-${k}`}
                  className="input tabular-nums"
                  inputMode="decimal"
                  value={draft[k] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div>
            <label htmlFor="sr-note" className="label">
              What did they offer?
            </label>
            <span className="hint">For example: "Veteran rate quoted by intake on 20 Oct, confirmed by email."</span>
            <textarea id="sr-note" className="input min-h-20" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {problem && (
            <p role="alert" className="field-error">
              <Icon name="octagon" size={20} /> {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={save}>
              Save special rates
            </button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={start}>
              <Icon name={current ? 'edit' : 'plus'} size={20} /> {current ? 'Change special rates' : 'Add special rates'}
            </button>
            {current && (
              <ConfirmButton
                prompt="Remove these special rates? Costs go back to the published prices."
                confirmLabel="Remove"
                onConfirm={() => dispatch({ type: 'specialRate/clear', providerId: provider.id })}
              >
                Remove special rates
              </ConfirmButton>
            )}
          </div>
        )
      )}
    </Expander>
  );
}

/** Suggested corrections sent from this application for this provider, and what happened to them. */
function SuggestionStatus({ providerId }: { providerId: string }) {
  const { application } = useApp();
  const { backend } = useSession();
  const [items, setItems] = useState<Suggestion[]>([]);
  useEffect(() => {
    let live = true;
    backend
      .applicationSuggestions(application.id)
      .then((all) => live && setItems(all.filter((s) => s.provider_id === providerId)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [backend, application.id, providerId]);
  if (!items.length) return null;
  return (
    <ul className="space-y-1">
      {items.map((s) => (
        <li key={s.id}>
          <Chip status={s.status === 'approved' ? 'good' : s.status === 'rejected' ? 'stop' : 'info'}>
            {s.status === 'pending' ? 'Suggestion waiting for review' : s.status === 'approved' ? 'Suggestion approved' : 'Suggestion not accepted'}
          </Chip>{' '}
          <span className="small">
            {s.suggested_by ?? 'Someone'}, {formatDateTime(s.created_at)}
            {s.decision_note && ` · “${s.decision_note}”`}
          </span>
        </li>
      ))}
    </ul>
  );
}
