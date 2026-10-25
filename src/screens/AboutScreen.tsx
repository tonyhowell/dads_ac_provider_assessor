import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from '../state/SessionContext';
import { ScreenHeader } from '../components/ui/Cards';

export function AboutScreen() {
  const { seed } = useSession();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  return (
    <section className="space-y-6">
      <ScreenHeader title="About this app" purpose="Where the numbers come from, how the app works for different needs, and what happens to your information." />

      <section id="data-sources" className="card space-y-2">
        <h2>Data sources</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            Provider prices: each provider's published price list, linked as the source next to every price, with the date it was collected. Prices captured 25 Oct 2026.
          </li>
          <li>
            Guide prices: {seed.benchmark.provider} —{' '}
            <a href="https://www.ihacpa.gov.au/resources/support-home-pricing-advice-2026-27-0" target="_blank" rel="noreferrer">
              IHACPA Support at Home pricing advice 2026-27
            </a>
            .
          </li>
          <li>
            Budgets, contribution rates and the lifetime cap:{' '}
            <a href="https://www.myagedcare.gov.au/support-at-home-costs-and-contributions" target="_blank" rel="noreferrer">
              My Aged Care
            </a>
            , rules as verified 25 Oct 2026.
          </li>
          <li>Interview questions and "what matters to you" questions: written for this app, reviewed by the family.</li>
        </ul>
        <p>Rules change. Check with My Aged Care and DVA before relying on any figure.</p>
      </section>

      <section id="accessibility" className="card space-y-2">
        <h2>Accessibility</h2>
        <p>
          The app aims to meet WCAG 2.2 AA. Text can be made larger (up to 24px) under Display, with light, dark and high-contrast themes. Every control works with a
          keyboard: press ? for help and Esc to close it. Status is always shown with words and a shape, not colour alone.
        </p>
        <p>If something is hard to use, tell the family member who manages access so it can be fixed.</p>
      </section>

      <section id="privacy" className="card space-y-2">
        <h2>Privacy</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Only family members the administrator invites can sign in, each with their own passkey.</li>
          <li>We ask only what's needed to work out costs. Your name is optional.</li>
          <li>Your details, notes, answers and interview transcripts are shared with those family members only.</li>
          <li>Interview recordings never leave the device that made them.</li>
          <li>Drafting interview notes sends the transcript (not the audio) to Anthropic's Claude API.</li>
          <li>Nothing is shared with providers or insurers.</li>
        </ul>
      </section>
    </section>
  );
}
