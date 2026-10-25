import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from './renderApp';

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Routes fetch calls to handlers keyed by "METHOD /path". */
function mockApi(routes: Record<string, (body: any) => Response>) {
  const calls: { key: string; body: any }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${path}`;
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ key, body });
      const handler = routes[key];
      return handler ? handler(body) : json(404, { error: `No mock for ${key}` });
    }),
  );
  return calls;
}

const AT = '2026-10-25T00:00:00.000Z';
const sam = { id: 'u2', username: 'sam', display_name: 'Sam', role: 'member' as const };

describe('applications', () => {
  it('lists your applications and opens one', async () => {
    const user = userEvent.setup();
    await renderApp('/applications', { waitForNav: false });
    const card = screen.getByRole('heading', { name: 'Dad – Wynnum' }).closest('li')!;
    expect(within(card).getByText(/you're coordinator/)).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: /Continue/ }));
    expect(await screen.findByRole('heading', { name: 'Tell us about your situation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Application: Dad – Wynnum/ })).toBeInTheDocument();
  });

  it('shows viewers everything but lets them change nothing', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/providers', { user: sam, role: 'viewer' });
    expect(screen.getByText('You can view this application')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add to my list/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Suggest a provider/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Bolton Clarke' }));
    expect(screen.queryByRole('button', { name: /Suggest a correction/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a note' })).not.toBeInTheDocument();
    expect(server.version).toBe(0);
  });

  it('coordinators add family as viewers by default, then change their role', async () => {
    const user = userEvent.setup();
    const alex = { user_id: 'u1', username: 'alex', display_name: 'Alex', role: 'coordinator', enrolled: true, enrolment_expires_at: null, disabled: false, added_at: AT };
    const jo = { ...alex, user_id: 'u3', username: 'jo', display_name: 'Jo', role: 'viewer', enrolled: false, enrolment_expires_at: AT };
    let members: Record<string, unknown>[] = [alex];
    const calls = mockApi({
      'GET /api/applications/app-1/members': () => json(200, { members }),
      'POST /api/applications/app-1/members': () => {
        members = [alex, jo];
        return json(201, { member: 'jo', enrolment_url: 'https://assessor.quantivate.com.au/enrol/xyz' });
      },
      'PATCH /api/applications/app-1/members/u3': (body) => {
        members = [alex, { ...jo, role: body.role }];
        return json(200, { members });
      },
    });
    await renderApp('/people');
    expect(await screen.findByText('1 person')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Add a family member/ }));
    await user.type(screen.getByLabelText('Their name'), 'Jo');
    await user.type(screen.getByLabelText('Username'), 'jo');
    await user.click(screen.getByRole('button', { name: 'Add and create their link' }));
    expect(await screen.findByLabelText('Enrolment link for jo')).toHaveValue('https://assessor.quantivate.com.au/enrol/xyz');
    expect(calls.find((c) => c.key === 'POST /api/applications/app-1/members')!.body).toEqual({ username: 'jo', display_name: 'Jo', new: true, role: 'viewer' });

    await user.selectOptions(await screen.findByLabelText('Role for Jo'), 'contributor');
    await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/applications/app-1/members/u3')?.body).toEqual({ role: 'contributor' }));
  });
});

describe('site administration', () => {
  it('creates an application with a new coordinator and shows their link', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      'GET /api/admin/suggestions?status=pending': () => json(200, { suggestions: [] }),
      'GET /api/admin/applications': () => json(200, { applications: [] }),
      'GET /api/admin/users': () => json(200, { users: [{ id: 'u1', username: 'alex', display_name: 'Alex', disabled: false }] }),
      'POST /api/admin/applications': () =>
        json(201, { application: { id: 'app-2', name: 'Mum', suburb: '', postcode: '4179', status: 'active', created_at: AT, updated_at: AT }, enrolment_url: 'https://assessor.quantivate.com.au/enrol/m' }),
    });
    await renderApp('/admin/applications', { waitForNav: false });
    await user.type(await screen.findByLabelText('Name'), 'Mum');
    await user.type(screen.getByLabelText('Postcode'), '4179');
    await user.click(screen.getByLabelText(/A new person/));
    await user.type(screen.getByLabelText('Their name'), 'Jo');
    await user.type(screen.getByLabelText('Username'), 'jo');
    await user.click(screen.getByRole('button', { name: 'Create application' }));
    expect(await screen.findByLabelText('Enrolment link for jo')).toHaveValue('https://assessor.quantivate.com.au/enrol/m');
    expect(calls.find((c) => c.key === 'POST /api/admin/applications')!.body).toEqual({ name: 'Mum', suburb: '', postcode: '4179', coordinator: { username: 'jo', display_name: 'Jo' } });
  });

  it('shows what a suggestion changes and approves it', async () => {
    const user = userEvent.setup();
    const base = { id: 'bolton-clarke', provider: 'Bolton Clarke', type: null, outlet: null, rn: null, en: null, pc: 126, domestic: null, social: null, respite: null, gardening: null, care_mgmt: null, prices_as_at: '1 Jul 2026', prices_as_at_date: '2026-07-01', veteran_fit: null, flags: [], source_url: null };
    const suggestion = { id: 's1', provider_id: 'bolton-clarke', is_new: false, current: base, proposed: { ...base, pc: 130 }, note: 'Price list 1 Nov', application_id: 'app-1', application_name: 'Dad', suggested_by: 'Sam', status: 'pending', decided_by: null, decision_note: '', decided_at: null, created_at: AT };
    let pending = [suggestion];
    const calls = mockApi({
      'GET /api/admin/suggestions?status=pending': () => json(200, { suggestions: pending }),
      'POST /api/admin/suggestions/s1/decision': () => {
        pending = [];
        return json(200, { suggestion: { ...suggestion, status: 'approved' }, providers: [{ ...base, pc: 130 }], updated_at: AT });
      },
    });
    await renderApp('/admin/suggestions', { waitForNav: false });
    const card = (await screen.findAllByRole('heading', { name: 'Bolton Clarke' }))[0].closest('li')!;
    expect(within(card).getByRole('row', { name: /Personal care/ })).toHaveTextContent('$126.00$130.00');
    expect(within(card).getByText('“Price list 1 Nov”')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: /Approve/ }));
    expect(await screen.findByText(/No suggestions waiting/)).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/admin/suggestions/s1/decision')!.body).toEqual({ approve: true, note: '' });
  });
});
