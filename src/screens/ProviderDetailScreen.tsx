import { Link, useParams } from 'react-router-dom';
import { useApp, useProvider } from '../state/AppContext';
import { PriceProvenance } from '../components/Price';
import { StageControls } from '../components/StageControls';
import { ProviderNotes } from '../components/ProviderNotes';
import { InterviewList } from '../components/InterviewList';
import { formatRate } from '../format';
import { RATE_KEYS } from '../schemas';
import type { RateKey } from '../types';

export const RATE_LABELS: Record<RateKey, string> = {
  rn: 'Registered nurse',
  en: 'Enrolled nurse',
  pc: 'Personal care',
  domestic: 'Domestic assistance',
  social: 'Social support',
  respite: 'Respite',
  gardening: 'Gardening',
  care_mgmt: 'Care management',
};

export function ProviderDetailScreen() {
  const { id } = useParams();
  const provider = useProvider(id);
  const { seed } = useApp();

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
      </div>

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
