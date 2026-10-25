import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { entriesAt } from '../state/reducer';
import { includedSections, interviewPack, packQuestionCount } from '../questions';
import { responseKey } from '../scoring';
import { formatDate } from '../format';
import { toIsoDate } from '../rules';
import { Icon } from '../components/ui/Icon';

const DISCLAIMER = 'General information only — not financial or legal advice. Check prices and eligibility with the provider, My Aged Care and DVA before deciding.';

/**
 * Printable interview pack (UI-SPEC §10): one section of pages per provider, numbered questions with a ■ for
 * must-ask, ruled lines for handwriting (or the answer already recorded), a "Got it in writing" box, and a
 * footer on every page with the provider's name and the disclaimer.
 */
export function PrintPackScreen() {
  const { seed, state, providers } = useApp();
  const pack = interviewPack(seed.interviewSections, includedSections(seed.boundingGroups, seed.interviewSections, state.answers), state.customQuestions);
  const shortlist = entriesAt(state, 'interview').flatMap((e) => {
    const p = providers.find((x) => x.id === e.provider_id);
    return p ? [{ provider: p, watch: e.watch }] : [];
  });
  // With nobody shortlisted yet, print one blank pack to write the provider's name on.
  const sections = shortlist.length ? shortlist : [{ provider: null, watch: '' }];
  const today = formatDate(toIsoDate(new Date()));
  const who = state.participant?.name;

  return (
    <main className="print-pack mx-auto max-w-[56rem] bg-[var(--surface)] p-6 text-[var(--charcoal)]">
      <div className="no-print mb-6 space-y-3">
        <h1>Print your interview questions</h1>
        <p>
          {shortlist.length ? `One section for each of your ${shortlist.length} providers, ` : 'A blank pack, '}
          with lines to write answers on. Answers you've already recorded are printed in.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            Print or save as PDF
          </button>
          <Link to="/interview-pack" className="btn">
            <Icon name="arrowLeft" size={20} /> Back to your questions
          </Link>
        </div>
        <p>In the print window, choose "Save as PDF" to get a file you can email.</p>
      </div>

      {sections.map(({ provider, watch }, si) => (
        <table key={provider?.id ?? 'blank'} className={`w-full ${si > 0 ? 'print-break' : ''}`}>
          <tfoot>
            <tr>
              <td className="pt-4 text-[9pt]">
                <span className="font-semibold">{provider?.provider ?? 'Provider: ____________________'}</span> · Interview questions{who ? ` for ${who}` : ''} · {DISCLAIMER}
              </td>
            </tr>
          </tfoot>
          <tbody>
            <tr>
              <td>
                <div className="print-keep mb-6 space-y-2 border-b-2 border-[var(--charcoal)] pb-4">
                  <p className="text-[0.875rem]">Provider Assessor · from Quantivate</p>
                  <h2 className="text-[1.75rem]">{provider ? provider.provider : 'Provider: ______________________________'}</h2>
                  <p>Interview questions{who ? ` for ${who}` : ''} · printed {today}</p>
                  {provider && (
                    <p className="text-[0.95rem]">
                      Prices as at {provider.prices_as_at}
                      {provider.source_url ? ` · ${provider.source_url}` : ''}
                    </p>
                  )}
                  <p>Date of interview: ____________________ Interviewed by: ______________________________</p>
                  {watch && (
                    <div className="mt-2 border-l-4 border-[var(--charcoal)] pl-3">
                      <p className="font-semibold">Watch for</p>
                      <p className="whitespace-pre-wrap">{watch}</p>
                    </div>
                  )}
                  <p className="text-[0.95rem]">
                    {packQuestionCount(pack)} questions. ■ = must ask: get a written answer. A provider that won't answer a must-ask question in writing should be reconsidered.
                  </p>
                </div>

                {pack.map((section) => (
                  <section key={section.code} className="mb-6">
                    <h3 className="print-keep mb-2 border-b border-[var(--charcoal)] pb-1 text-[1.2rem]">
                      {section.code}. {section.section}
                      {!section.included && <span className="font-normal"> (must ask only)</span>}
                    </h3>
                    <ol className="space-y-4">
                      {section.questions.map((q) => {
                        const r = provider ? state.responses[responseKey(provider.id, q.id)] : undefined;
                        return (
                          <li key={q.id} className="print-keep">
                            <p>
                              <span className="font-semibold">{q.custom ? '+' : q.id}</span> {q.priority === 'must' && <span aria-label="Must ask">■ </span>}
                              {q.text}
                            </p>
                            {r?.text.trim() ? (
                              <p className="mt-1 border-l-2 border-[var(--line)] pl-3 whitespace-pre-wrap">
                                {r.text}
                                {r.rating && <em> — answered well: {r.rating}</em>}
                              </p>
                            ) : (
                              <div aria-hidden className="mt-1">
                                {[0, 1, 2].map((i) => (
                                  <div key={i} className="h-[9mm] border-b border-[var(--line)]" />
                                ))}
                              </div>
                            )}
                            {q.priority === 'must' && <p className="mt-1">Got it in writing {r?.in_writing ? '☑' : '☐'}</p>}
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ))}
              </td>
            </tr>
          </tbody>
        </table>
      ))}
    </main>
  );
}
