import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { entriesAt } from '../state/reducer';
import { includedSections, interviewPack, packQuestionCount } from '../questions';
import { responseKey } from '../scoring';
import { formatDate } from '../format';
import { toIsoDate } from '../rules';

const STATUS: Record<string, string> = { full_pensioner: 'Full pensioner', part_pensioner: 'Part pensioner / CSHC', self_funded: 'Self-funded' };
const CARD: Record<string, string> = { gold: 'DVA Gold Card', white: 'DVA White Card', none: 'No DVA card' };

/** Print-friendly interview pack: sections A–Q, one response column per shortlisted provider. Use the browser's Print / Save as PDF. */
export function PrintPackScreen() {
  const { seed, state, providers } = useApp();
  const pack = interviewPack(seed.interviewSections, includedSections(seed.boundingGroups, seed.interviewSections, state.answers), state.customQuestions);
  const shortlist = entriesAt(state, 'interview').flatMap((e) => {
    const p = providers.find((x) => x.id === e.provider_id);
    return p ? [{ provider: p, watch: e.watch }] : [];
  });
  const p = state.participant;

  return (
    <div className="print-pack mx-auto max-w-[1100px] bg-white p-6 text-slate-900">
      <div className="no-print mb-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Print or save as PDF
        </button>
        <Link to="/interview-pack" className="btn no-underline hover:no-underline">
          Back to the interview pack
        </Link>
        <p className="muted self-center text-sm">Prints landscape. Choose "Save as PDF" in the print dialog for a file.</p>
      </div>

      <header className="mb-4 border-b border-slate-300 pb-3">
        <h1 className="text-2xl font-semibold">Support at Home provider interview pack</h1>
        <p className="text-sm">
          Prepared {formatDate(toIsoDate(new Date()))}
          {p && (
            <>
              {' '}
              · {p.name ? `${p.name}, ` : ''}
              {p.suburb} {p.postcode} · {p.classification.startsWith('HCP') ? p.classification.replace('HCP L', 'HCP level ') : `Classification ${p.classification}`} ·{' '}
              {STATUS[p.pension_status] ?? p.pension_status}
              {p.nwop ? ' (no-worse-off)' : ''} · {CARD[p.dva_card]}
            </>
          )}
        </p>
        <p className="text-sm">
          {packQuestionCount(pack)} questions. <strong>MUST</strong> questions need a written answer from every provider; a provider that won't answer one in writing
          should be reconsidered.
        </p>
      </header>

      {shortlist.length > 0 && (
        <section className="mb-4 break-inside-avoid">
          <h2 className="mb-1 text-lg font-semibold">Providers to interview</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {shortlist.map(({ provider, watch }) => (
              <li key={provider.id}>
                <strong>{provider.provider}</strong> — prices as at {provider.prices_as_at}
                {provider.source_url && <span className="break-all"> ({provider.source_url})</span>}
                {watch && <span className="block">Probe: {watch}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {pack.map((section) => (
        <section key={section.code} className="mb-4">
          <h2 className="mb-1 text-lg font-semibold break-after-avoid">
            {section.code}. {section.section}
            {!section.included && <span className="text-sm font-normal"> (must questions only)</span>}
          </h2>
          <table className="print-table w-full border-collapse text-xs">
            <thead>
              <tr>
                <th scope="col" className="w-10 border border-slate-400 p-1 text-left">#</th>
                <th scope="col" className="border border-slate-400 p-1 text-left">Question</th>
                {shortlist.map(({ provider }) => (
                  <th key={provider.id} scope="col" className="border border-slate-400 p-1 text-left" style={{ width: `${Math.max(10, 48 / Math.max(1, shortlist.length))}%` }}>
                    {provider.provider}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.questions.map((q) => (
                <tr key={q.id} className="break-inside-avoid align-top">
                  <td className="border border-slate-400 p-1">{q.custom ? '+' : q.id}</td>
                  <td className="border border-slate-400 p-1">
                    {q.priority === 'must' && <strong>MUST · </strong>}
                    {q.text}
                  </td>
                  {shortlist.map(({ provider }) => {
                    const r = state.responses[responseKey(provider.id, q.id)];
                    return (
                      <td key={provider.id} className="h-14 border border-slate-400 p-1 whitespace-pre-wrap">
                        {r?.text}
                        {r?.satisfactory === false && <em> (not satisfactory)</em>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <footer className="print-footer mt-6 border-t border-slate-300 pt-2 text-xs">
        General information only — not financial or legal advice. Check prices and eligibility with the provider, My Aged Care and DVA before deciding.
      </footer>
    </div>
  );
}
