import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from './renderApp';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(async ({ optionsJSON }) => ({ id: 'cred-1', challenge: optionsJSON.challenge })),
  startRegistration: vi.fn(async ({ optionsJSON }) => ({ id: 'cred-1', challenge: optionsJSON.challenge })),
}));

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

afterEach(() => vi.unstubAllGlobals());

describe('sign in', () => {
  it('signs in with a username and passkey', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      'POST /api/auth/options': () => json(200, { challenge: 'c1' }),
      'POST /api/auth/verify': () => json(200, { user: { id: 'u1', username: 'alex', display_name: 'Alex', role: 'member' } }),
    });
    await renderApp('/', { user: null });

    await user.type(screen.getByLabelText('Username'), 'alex');
    await user.click(screen.getByRole('button', { name: 'Sign in with passkey' }));

    await user.click(await screen.findByRole('button', { name: 'Menu' }));
    expect(screen.getByText(/Signed in as Alex/)).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/auth/verify')!.body.response).toEqual({ id: 'cred-1', challenge: 'c1' });
    expect(screen.queryByRole('link', { name: 'Manage family access' })).not.toBeInTheDocument();
  });

  it('shows why sign-in failed', async () => {
    const user = userEvent.setup();
    mockApi({
      'POST /api/auth/options': () => json(200, { challenge: 'c1' }),
      'POST /api/auth/verify': () => json(401, { error: 'Sign-in failed. Check your username.' }),
    });
    await renderApp('/', { user: null });
    await user.type(screen.getByLabelText('Username'), 'alex');
    await user.click(screen.getByRole('button', { name: 'Sign in with passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed');
  });

  it('returns to sign-in when the session expires', async () => {
    await renderApp('/providers');
    act(() => void window.dispatchEvent(new Event('sah:session-expired')));
    expect(await screen.findByRole('button', { name: 'Sign in with passkey' })).toBeInTheDocument();
  });

  it('signs out', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ 'POST /api/auth/logout': () => json(200, { ok: true }) });
    await renderApp('/providers');
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in with passkey' })).toBeInTheDocument();
    expect(calls.map((c) => c.key)).toContain('POST /api/auth/logout');
  });
});

describe('enrolment', () => {
  it('creates a passkey from a one-time link and signs the user in', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      'GET /api/enrol/tok123': () => json(200, { username: 'sam', display_name: 'Sam', expires_at: '2026-10-26T00:00:00Z' }),
      'POST /api/enrol/tok123/options': () => json(200, { challenge: 'r1' }),
      'POST /api/enrol/tok123/verify': () => json(200, { user: { id: 'u2', username: 'sam', display_name: 'Sam', role: 'member' } }),
    });
    await renderApp('/enrol/tok123', { user: null });

    expect(await screen.findByText('sam')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/name this device/i), 'Sam phone');
    await user.click(screen.getByRole('button', { name: 'Create passkey' }));

    await user.click(await screen.findByRole('button', { name: 'Menu' }));
    expect(screen.getByText(/Signed in as Sam/)).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/enrol/tok123/verify')!.body).toEqual({
      response: { id: 'cred-1', challenge: 'r1' },
      nickname: 'Sam phone',
    });
  });

  it('explains an expired link', async () => {
    mockApi({ 'GET /api/enrol/old': () => json(410, { error: 'This enrolment link has expired or already been used.' }) });
    await renderApp('/enrol/old', { user: null });
    expect(await screen.findByRole('alert')).toHaveTextContent('expired');
  });
});

describe('administration', () => {
  const users = [
    { id: 'u1', username: 'alex', display_name: 'Alex', role: 'admin', disabled: false, last_login_at: null, created_at: '2026-10-25T00:00:00Z', passkeys: 1, enrolment_expires_at: null, applications: [] },
    { id: 'u2', username: 'sam', display_name: 'Sam', role: 'member', disabled: false, last_login_at: null, created_at: '2026-10-25T00:00:00Z', passkeys: 0, enrolment_expires_at: '2026-10-26T00:00:00Z', applications: [{ application_id: 'app-1', name: 'Dad', role: 'viewer' }] },
  ];

  it('is hidden from family members', async () => {
    await renderApp('/admin', { user: { id: 'u2', username: 'sam', display_name: 'Sam', role: 'member' } });
    expect(screen.queryByRole('link', { name: 'Manage family access' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Manage family access' })).not.toBeInTheDocument();
  });

  it('adds a person and shows their enrolment link once', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      'GET /api/admin/users': () => json(200, { users }),
      'POST /api/admin/users': () =>
        json(201, { user: { ...users[1], id: 'u3', username: 'jo' }, enrolment_url: 'https://assessor.quantivate.com.au/enrol/abc' }),
    });
    await renderApp('/admin', { waitForNav: false });
    expect(await screen.findByText(/Waiting for passkey setup/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Username'), 'jo');
    await user.type(screen.getByLabelText('Display name'), 'Jo');
    await user.click(screen.getByRole('button', { name: 'Add and create enrolment link' }));

    expect(await screen.findByLabelText('Enrolment link for jo')).toHaveValue('https://assessor.quantivate.com.au/enrol/abc');
    expect(calls.find((c) => c.key === 'POST /api/admin/users')!.body).toEqual({ username: 'jo', display_name: 'Jo', role: 'member' });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('Enrolment link for jo')).not.toBeInTheDocument();
  });

  it('disables a person after confirming, and never offers to disable yourself', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      'GET /api/admin/users': () => json(200, { users }),
      'PATCH /api/admin/users/u2': () => json(200, { user: { ...users[1], disabled: true } }),
    });
    await renderApp('/admin', { waitForNav: false });
    const alexCard = (await screen.findByRole('heading', { name: /Alex \(alex\)/ })).closest('li')!;
    expect(within(alexCard).queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();

    const samCard = screen.getByRole('heading', { name: /Sam \(sam\)/ }).closest('li')!;
    await user.click(within(samCard).getByRole('button', { name: 'Disable' }));
    await user.click(within(within(samCard).getByRole('group')).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/admin/users/u2')?.body).toEqual({ disabled: true }));
  });
});
