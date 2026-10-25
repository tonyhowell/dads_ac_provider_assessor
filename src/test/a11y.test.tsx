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

/** Sample answers for the screens that call the server directly (people, site administration). */
function stubApi() {
  const member = { user_id: 'u1', username: 'alex', display_name: 'Alex', role: 'coordinator', enrolled: true, enrolment_expires_at: null, disabled: false, added_at: AT };
  const routes: Record<string, unknown> = {
    '/api/applications/app-1/members': { members: [member, { ...member, user_id: 'u2', username: 'sam', display_name: 'Sam', role: 'viewer', enrolled: false, enrolment_expires_at: AT }] },
    '/api/applications/app-1/suggestions': { suggestions: [] },
    '/api/admin/users': {
      users: [{ id: 'u1', username: 'alex', display_name: 'Alex', role: 'admin', disabled: false, last_login_at: null, created_at: AT, passkeys: 1, enrolment_expires_at: null, applications: [{ application_id: 'app-1', name: 'Dad', role: 'coordinator' }] }],
    },
    '/api/admin/applications': {
      applications: [{ id: 'app-1', name: 'Dad', suburb: 'Wynnum', postcode: '4178', status: 'active', created_at: AT, updated_at: AT, last_activity: AT, members: 2, coordinators: [{ user_id: 'u1', display_name: 'Alex', username: 'alex' }] }],
    },
    '/api/admin/suggestions?status=pending': {
      suggestions: [
        {
          id: 's1', provider_id: 'bolton-clarke', is_new: false, current: null, proposed: { id: 'bolton-clarke', provider: 'Bolton Clarke', type: null, outlet: null, rn: null, en: null, pc: 130, domestic: null, social: null, respite: null, gardening: null, care_mgmt: null, prices_as_at: '1 Nov 2026', prices_as_at_date: '2026-11-01', veteran_fit: null, flags: [], source_url: null },
          note: 'Price list', application_id: 'app-1', application_name: 'Dad', suggested_by: 'Sam', status: 'pending', decided_by: null, decision_note: '', decided_at: null, created_at: AT,
        },
      ],
    },
  };
  vi.stubGlobal('fetch', vi.fn(async (path: string) => new Response(JSON.stringify(routes[path] ?? { error: 'Not found' }), { status: routes[path] ? 200 : 404, headers: { 'Content-Type': 'application/json' } })));
}

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
    '/people',
    '/selection/scan',
    '/selection/interview',
    '/interview-pack',
    '/interviews',
    '/interviews/new/bolton-clarke',
    '/interviews/int-1',
    '/scoring',
    '/summary',
  ];

  it.each(routes)('%s has no violations', async (route) => {
    stubApi();
    await renderApp(route, { server: memoryServer(populated()) });
    await expectNoViolations();
  }, 20_000);

  const outside = ['/about', '/applications', '/admin', '/admin/applications', '/admin/suggestions', '/admin/providers', '/admin/providers/import', '/admin/providers/bolton-clarke/edit'];
  it.each(outside)('%s has no violations', async (route) => {
    stubApi();
    await renderApp(route, { server: memoryServer(populated()), waitForNav: false });
    await screen.findAllByRole('heading', { level: 1 });
    await new Promise((r) => setTimeout(r, 50));
    await expectNoViolations();
  }, 20_000);

  it("a viewer's read-only screens have no violations", async () => {
    for (const route of ['/providers/bolton-clarke', '/bounding', '/selection/interview', '/interview-pack', '/scoring']) {
      const { unmount } = await renderApp(route, { server: memoryServer(populated()), role: 'viewer' });
      await expectNoViolations();
      unmount();
    }
  }, 30_000);

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
