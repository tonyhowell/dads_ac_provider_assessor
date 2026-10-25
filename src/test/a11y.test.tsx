import axe from 'axe-core';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryServer, renderApp } from './renderApp';
import { emptyState, type AppState } from '../state/reducer';

// Automated accessibility check on every screen (UI-SPEC §11). jsdom has no layout, so colour contrast is checked
// by hand against design/tokens.css instead; everything else axe knows about must pass.
async function expectNoViolations() {
  const results = await axe.run(document.body, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  const summary = results.violations.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`);
  expect(summary).toEqual([]);
}

const AT = '2026-10-20T00:00:00.000Z';

/** A household part-way through: details saved, a shortlist, answers, an interview with notes, scores. */
const populated = (): AppState => ({
  ...emptyState(),
  participant: {
    id: 'p1',
    name: '',
    suburb: 'Exampleton',
    postcode: '4000',
    classification: '5',
    nwop: false,
    pension_status: 'part_pensioner',
    ind_rate: 0.2,
    ev_rate: 0.4,
    dva_card: 'gold',
    lifetime_contributions_paid: 0,
  } as AppState['participant'],
  selection: [
    { provider_id: 'bolton-clarke', stage: 'interview', why: 'Published prices', watch: 'Worker turnover', added_at: AT, stage_changed_at: AT },
    { provider_id: 'anglicare-southern-queensland', stage: 'interview', why: '', watch: '', added_at: AT, stage_changed_at: AT },
    { provider_id: 'carers-link', stage: 'refine', why: '', watch: '', added_at: AT, stage_changed_at: AT },
    { provider_id: 'bluecare-unitingcare-qld', stage: 'scan', why: '', watch: '', added_at: AT, stage_changed_at: AT },
  ],
  notes: [{ id: 'n1', provider_id: 'bolton-clarke', text: 'Rang intake, call back Tuesday', created_at: AT, source: 'manual' }],
  answers: { 'B1.1': { answer: 'yes', notes: '', not_relevant: false } },
  responses: { 'bolton-clarke::A1': { text: 'Two weeks', rating: 'yes', in_writing: true } },
  scores: { 'bolton-clarke::veteran': 4, 'bolton-clarke::price': 2 },
  interviews: [
    {
      id: 'int-1', provider_id: 'bolton-clarke', started_at: AT, duration_seconds: 0, consent_confirmed: true, interviewer: '', audio_id: null, audio_mime: null,
      transcript: 'We have a veterans program.',
      notes: { summary: 'Veterans program.', strengths: ['Same worker each week'], concerns: [], commitments: [], pricing_mentions: [], follow_up_questions: [] },
      notes_generated_at: AT,
    },
  ],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('accessibility (axe)', () => {
  const routes = [
    '/',
    '/overview',
    '/bounding',
    '/costs',
    '/providers',
    '/providers/bolton-clarke',
    '/providers/bolton-clarke/edit',
    '/providers/new',
    '/providers/import',
    '/selection/scan',
    '/selection/interview',
    '/interview-pack',
    '/interviews',
    '/interviews/new/bolton-clarke',
    '/interviews/int-1',
    '/scoring',
    '/summary',
    '/about',
  ];

  it.each(routes)('%s has no violations', async (route) => {
    await renderApp(route, { server: memoryServer(populated()) });
    await expectNoViolations();
  }, 20_000);

  it('the empty start has no violations', async () => {
    await renderApp('/costs');
    await expectNoViolations();
  });

  it('the printable pack has no violations', async () => {
    await renderApp('/interview-pack/print', { server: memoryServer(populated()), waitForNav: false });
    await expectNoViolations();
  });

  it('the first-run welcome has no violations', async () => {
    localStorage.clear();
    await renderApp('/', { firstRun: true, waitForNav: false });
    await expectNoViolations();
  });

  it('sign-in has no violations', async () => {
    await renderApp('/', { user: null });
    await expectNoViolations();
  });

  it('the help panel, display settings and menu have no violations when open', async () => {
    const user = userEvent.setup();
    await renderApp('/costs', { server: memoryServer(populated()) });
    await user.click(screen.getByRole('button', { name: /Help/ }));
    await expectNoViolations();
    await user.click(screen.getByRole('button', { name: /Display/ }));
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await expectNoViolations();
  });
});
