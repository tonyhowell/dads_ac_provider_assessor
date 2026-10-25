import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmButton } from '../components/ConfirmButton';
import { FEE_FLAG_TEXT, mentionsDisallowedFees } from '../flags';
import { useApp, useProvider } from '../state/AppContext';
import { PriceProvenance } from '../components/Price';
import { StageControls } from '../components/StageControls';
import { ProviderNotes } from '../components/ProviderNotes';
import { InterviewList } from '../components/InterviewList';
import { formatRate } from '../format';
import { RATE_KEYS } from '../schemas';
import { RATE_LABELS } from '../labels';


export function ProviderDetailScreen() {
  const { id } = useParams();
  const provider = useProvider(id);
  const { seed, state } = useApp();

  if (!provider) {
    return (
      <section>
        <h1 className="text-2xl font-semibold">Provider not found</h1>
        <Link to="/providers">Back to providers</Link>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <Link to="/providers" className="muted">
        ← All providers
      </Link>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{provider.provider}</h1>
        {(provider.outlet || provider.type) && (
          <p className="muted">{[provider.type, provider.outlet].filter(Boolean).join(' · ')}</p>
        )}
        <PriceProvenance provider={provider} />
        <StageControls provider={provider} />
        <ProviderEditControls />
      </div>

      {(mentionsDisallowedFees(...provider.flags, ...state.notes.filter((n) => n.provider_id === provider.id).map((n) => n.text)) || provider.flags.length > 0) && (
        <section aria-labelledby="flags-heading" className="card space-y-2">
          <h2 id="flags-heading" className="text-lg font-semibold">
            Flags
          </h2>
          {mentionsDisallowedFees(...provider.flags, ...state.notes.filter((n) => n.provider_id === provider.id).map((n) => n.text)) && (
            <p className="rounded-md border border-orange-300 bg-orange-50 p-2 text-sm text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-100">
              <strong>Check fees:</strong> {FEE_FLAG_TEXT}
            </p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {provider.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="rates-heading" className="card overflow-x-auto">
        <h2 id="rates-heading" className="text-lg font-semibold">
          Weekday hourly rates
        </h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left">
              <th scope="col" className="py-1 pr-4">Service</th>
              <th scope="col" className="py-1 pr-4 text-right">Provider</th>
              <th scope="col" className="py-1 text-right">IHACPA benchmark</th>
            </tr>
          </thead>
          <tbody>
            {RATE_KEYS.map((k) => (
              <tr key={k} className="border-t border-slate-200 dark:border-slate-800">
                <th scope="row" className="py-1 pr-4 text-left font-normal">{RATE_LABELS[k]}</th>
                <td className="py-1 pr-4 text-right">{provider[k] === null ? 'Not published' : formatRate(provider[k])}</td>
                <td className="py-1 text-right">{formatRate(seed.benchmark[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {provider.veteran_fit && <p className="mt-3"><strong>Veteran fit:</strong> {provider.veteran_fit}</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ProviderNotes providerId={provider.id} />
        <section aria-labelledby="interviews-heading" className="card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="interviews-heading" className="text-lg font-semibold">Interviews</h2>
            <Link to={`/interviews/new/${provider.id}`} className="btn no-underline hover:no-underline">
              Record interview
            </Link>
          </div>
          <InterviewList providerId={provider.id} />
        </section>
      </div>
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
    <div className="flex flex-wrap items-center gap-2">
      <Link to={`/providers/${id}/edit`} className="btn no-underline hover:no-underline">
        Edit details and prices
      </Link>
      {edited && fromSeed && (
        <ConfirmButton
          className="btn"
          prompt="Undo all changes and go back to the starter-pack data?"
          confirmLabel="Undo changes"
          onConfirm={() => dispatch({ type: 'provider/revert', id: id! })}
        >
          Undo changes
        </ConfirmButton>
      )}
      {edited && !fromSeed && (
        <ConfirmButton
          prompt="Remove this provider you added? Notes and selection entries for it are kept."
          confirmLabel="Remove provider"
          onConfirm={() => {
            dispatch({ type: 'provider/revert', id: id! });
            navigate('/providers');
          }}
        >
          Remove provider
        </ConfirmButton>
      )}
      {edited && <span className="muted text-sm">{fromSeed ? 'Edited by the family' : 'Added by the family'}</span>}
    </div>
  );
}
