import { Link, useNavigate, useParams } from 'react-router-dom';
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

export function ProviderDetailScreen() {
  const { id } = useParams();
  const provider = useProvider(id);
  const { seed, state, dispatch } = useApp();

  if (!provider) {
    return (
      <ResolutionCard status="caution" title="We couldn't find that provider" actions={<Link to="/providers" className="btn btn-primary">Back to providers</Link>}>
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

  return (
    <section className="space-y-6">
      <Link to="/providers" className="btn-quiet">
        <Icon name="arrowLeft" size={20} /> All providers
      </Link>
      <div className="space-y-2">
        <h1>{provider.provider}</h1>
        {(provider.outlet || provider.type) && <p>{[provider.type, provider.outlet].filter(Boolean).join(' · ')}</p>}
        <PriceProvenance provider={provider} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <StageControls provider={provider} primaryAdd />
        {selected && <StageControls provider={provider} compact />}
        <ProviderEditControls />
      </div>

      {feeMention && (
        <ResolutionCard
          status="caution"
          title="Possible extra fee"
          actions={
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
          }
        >
          <p>The notes for {provider.provider} mention a travel, admin or similar charge. Support at Home prices must be all-inclusive.</p>
        </ResolutionCard>
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
        >
          <p>
            {provider.prices_as_at_date
              ? `These were collected on ${provider.prices_as_at} (${daysBetween(provider.prices_as_at_date, today)} days ago).`
              : `We don't have a date for these prices ("${provider.prices_as_at}").`}{' '}
            Providers must review prices every two months.
          </p>
        </ResolutionCard>
      )}

      <section aria-labelledby="rates-heading" className="card space-y-3">
        <h2 id="rates-heading">Prices per hour (weekdays)</h2>
        <p>
          Compared with the <Term id="benchmark">guide price</Term>.
        </p>
        <dl className="divide-y divide-[var(--rule)]">
          {RATE_KEYS.map((k) => (
            <div key={k} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <dt className="font-medium">{RATE_LABELS[k]}</dt>
              <dd className="min-w-0 text-right">
                <PriceCell rate={provider[k]} guide={seed.benchmark[k]} />
              </dd>
            </div>
          ))}
        </dl>
        {missing.length > 0 && (
          <p>
            {missing.length} price{missing.length === 1 ? ' isn\'t' : 's aren\'t'} published. Costs use the guide price for {missing.length === 1 ? 'it' : 'them'} — ask at interview.
          </p>
        )}
      </section>

      {(provider.flags.length > 0 || provider.veteran_fit) && (
        <section aria-labelledby="flags-heading" className="card space-y-3">
          <h2 id="flags-heading">What we know</h2>
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
        </section>
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
        back={{ to: '/providers', label: 'All providers' }}
        forward={{ to: '/selection', label: 'Continue to choose who to meet' }}
        primary={selected}
      />
    </section>
  );
}

function ProviderEditControls() {
  const { id } = useParams();
  const { seed, state, dispatch } = useApp();
  const navigate = useNavigate();
  const edited = state.providerEdits.some((p) => p.id === id);
  const fromSeed = seed.providers.some((p) => p.id === id);
  return (
    <>
      <Link to={`/providers/${id}/edit`} className="btn">
        Edit details and prices
      </Link>
      {edited && fromSeed && (
        <ConfirmButton className="btn" prompt="Undo all changes and go back to the starter data?" confirmLabel="Undo changes" onConfirm={() => dispatch({ type: 'provider/revert', id: id! })}>
          Undo changes
        </ConfirmButton>
      )}
      {edited && !fromSeed && (
        <ConfirmButton
          prompt="Remove this provider you added? Notes and list entries for it are kept."
          confirmLabel="Remove provider"
          onConfirm={() => {
            dispatch({ type: 'provider/revert', id: id! });
            navigate('/providers');
          }}
        >
          Remove provider
        </ConfirmButton>
      )}
      {edited && <span className="muted">{fromSeed ? 'Edited by the family' : 'Added by the family'}</span>}
    </>
  );
}
