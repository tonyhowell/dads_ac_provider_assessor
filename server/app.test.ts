// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createApp } from './app.ts';
import { createPgliteDb, migrate, type Db } from './db.ts';
import { createUser, issueEnrolment, type Role } from './users.ts';
import { Agent, fakeWebAuthn, testConfig } from './testing.ts';
import { NotesError } from './interviewNotes.ts';

let db: Db;
let getAnthropic: (() => Anthropic) | undefined;
const app = () => createApp({ db, config: testConfig, webauthn: fakeWebAuthn(), getAnthropic }) as never;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
});
afterAll(() => db.close());
beforeEach(async () => {
  getAnthropic = undefined;
  await db.query('TRUNCATE users, credentials, enrolments, sessions, auth_challenges, app_state, state_actions CASCADE');
});

const tokenFrom = (url: string) => url.split('/enrol/')[1];

/** Creates a user and completes passkey enrolment, returning a signed-in agent. */
async function enrolled(a = app(), username = 'alex', role: Role = 'admin') {
  const user = await createUser(db, { username, display_name: username[0].toUpperCase() + username.slice(1), role });
  const token = await issueEnrolment(db, user.id, null);
  const agent = new Agent(a);
  const opts = await agent.post(`/api/enrol/${token}/options`);
  const res = await agent.post(`/api/enrol/${token}/verify`, { response: { id: `cred-${username}`, challenge: opts.json.challenge }, nickname: 'Phone' });
  expect(res.status).toBe(200);
  return { agent, user, token, app: a };
}

async function signIn(a: ReturnType<typeof app>, username: string, credentialId: string) {
  const agent = new Agent(a);
  const opts = await agent.post('/api/auth/options', { username });
  const res = await agent.post('/api/auth/verify', { response: { id: credentialId, challenge: opts.json.challenge } });
  return { agent, res, opts };
}

describe('migrations', () => {
  it('can be re-run safely', async () => {
    await migrate(db);
    const rows = await db.query<{ version: number }>('SELECT version FROM schema_migrations');
    expect(rows.map((r) => r.version)).toEqual([1]);
  });
});

describe('enrolment', () => {
  it('shows who the link is for, registers a passkey and signs the user in', async () => {
    const a = app();
    const user = await createUser(db, { username: 'Alex', display_name: 'Alex', role: 'admin' });
    const token = await issueEnrolment(db, user.id, null);
    const agent = new Agent(a);

    const info = await agent.get(`/api/enrol/${token}`);
    expect(info.json).toMatchObject({ username: 'alex', display_name: 'Alex' });

    const opts = await agent.post(`/api/enrol/${token}/options`);
    expect(opts.json.challenge).toMatch(/^reg-/);
    expect(agent.cookies.has('sah_challenge')).toBe(true);

    const done = await agent.post(`/api/enrol/${token}/verify`, { response: { id: 'cred-1', challenge: opts.json.challenge } });
    expect(done.status).toBe(200);
    expect(done.headers.getSetCookie().find((c) => c.startsWith('sah_session='))).toMatch(/HttpOnly.*Secure.*SameSite=Lax/i);
    expect((await agent.get('/api/auth/me')).json.user).toMatchObject({ username: 'alex', role: 'admin' });
  });

  it('links are single-use', async () => {
    const { token, agent } = await enrolled();
    expect((await agent.get(`/api/enrol/${token}`)).status).toBe(410);
    expect((await agent.post(`/api/enrol/${token}/options`)).status).toBe(410);
  });

  it('links expire after 24 hours', async () => {
    const user = await createUser(db, { username: 'sam', display_name: 'Sam', role: 'member' });
    const token = await issueEnrolment(db, user.id, null, new Date(Date.now() - 25 * 60 * 60 * 1000));
    expect((await new Agent(app()).get(`/api/enrol/${token}`)).status).toBe(410);
  });

  it('rejects a response to a different challenge', async () => {
    const user = await createUser(db, { username: 'sam', display_name: 'Sam', role: 'member' });
    const token = await issueEnrolment(db, user.id, null);
    const agent = new Agent(app());
    await agent.post(`/api/enrol/${token}/options`);
    const res = await agent.post(`/api/enrol/${token}/verify`, { response: { id: 'c', challenge: 'forged' } });
    expect(res.status).toBe(400);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('sign in', () => {
  it('signs in with a registered passkey', async () => {
    const { app: a } = await enrolled();
    const { agent, res, opts } = await signIn(a, 'ALEX', 'cred-alex');
    expect(opts.json.allowCredentials).toEqual([{ id: 'cred-alex', transports: ['internal'] }]);
    expect(res.status).toBe(200);
    expect((await agent.get('/api/auth/me')).json.user.username).toBe('alex');
    const [row] = await db.query<{ counter: string }>(`SELECT counter FROM credentials WHERE id = 'cred-alex'`);
    expect(Number(row.counter)).toBe(1);
  });

  it("refuses another user's passkey and unknown usernames, without revealing which", async () => {
    const { app: a } = await enrolled();
    await enrolled(a, 'sam', 'member');
    expect((await signIn(a, 'alex', 'cred-sam')).res.status).toBe(401);
    const unknown = await signIn(a, 'nobody', 'cred-alex');
    expect(unknown.opts.status).toBe(200);
    expect(unknown.opts.json.allowCredentials).toEqual([]);
    expect(unknown.res.status).toBe(401);
  });

  it('a challenge can only be used once', async () => {
    const { app: a } = await enrolled();
    const agent = new Agent(a);
    const opts = await agent.post('/api/auth/options', { username: 'alex' });
    const jar = new Map(agent.cookies);
    await agent.post('/api/auth/verify', { response: { id: 'cred-alex', challenge: opts.json.challenge } });
    agent.cookies = jar; // replay the same challenge cookie
    agent.cookies.delete('sah_session');
    expect((await agent.post('/api/auth/verify', { response: { id: 'cred-alex', challenge: opts.json.challenge } })).status).toBe(401);
  });

  it('signing out ends the session', async () => {
    const { agent } = await enrolled();
    const cookie = agent.cookies.get('sah_session')!;
    await agent.post('/api/auth/logout');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    agent.cookies.set('sah_session', cookie);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('blocks state-changing requests from other origins', async () => {
    const { app: a } = await enrolled();
    const evil = new Agent(a, 'https://evil.example');
    expect((await evil.post('/api/auth/options', { username: 'alex' })).status).toBe(403);
  });
});

describe('administration', () => {
  it('is for admins only', async () => {
    const { app: a } = await enrolled();
    const { agent: member } = await enrolled(a, 'sam', 'member');
    expect((await member.get('/api/admin/users')).status).toBe(403);
    expect((await new Agent(a).get('/api/admin/users')).status).toBe(401);
  });

  it('creates users with a one-time enrolment link', async () => {
    const { agent, app: a } = await enrolled();
    const res = await agent.post('/api/admin/users', { username: ' Jo.Smith ', display_name: 'Jo', role: 'member' });
    expect(res.status).toBe(201);
    expect(res.json.user.username).toBe('jo.smith');
    expect(res.json.enrolment_url).toMatch(/^https:\/\/assessor\.example\.test\/enrol\/[\w-]{20,}$/);
    expect((await new Agent(a).get(`/api/enrol/${tokenFrom(res.json.enrolment_url)}`)).json.username).toBe('jo.smith');

    const list = await agent.get('/api/admin/users');
    expect(list.json.users.find((u: { username: string }) => u.username === 'jo.smith')).toMatchObject({ passkeys: 0, enrolment_expires_at: expect.any(String) });

    expect((await agent.post('/api/admin/users', { username: 'jo.smith', display_name: 'Jo', role: 'member' })).status).toBe(409);
    expect((await agent.post('/api/admin/users', { username: 'no spaces', display_name: 'X', role: 'member' })).status).toBe(400);
  });

  it('reissuing a link invalidates the previous one', async () => {
    const { agent, app: a } = await enrolled();
    const created = await agent.post('/api/admin/users', { username: 'jo', display_name: 'Jo', role: 'member' });
    const reissued = await agent.post(`/api/admin/users/${created.json.user.id}/enrolment`);
    expect((await new Agent(a).get(`/api/enrol/${tokenFrom(created.json.enrolment_url)}`)).status).toBe(410);
    expect((await new Agent(a).get(`/api/enrol/${tokenFrom(reissued.json.enrolment_url)}`)).status).toBe(200);
  });

  it('disabling a user signs them out and blocks sign-in', async () => {
    const { agent: admin, app: a } = await enrolled();
    const { agent: sam, user } = await enrolled(a, 'sam', 'member');
    expect((await admin.patch(`/api/admin/users/${user.id}`, { disabled: true })).json.user.disabled).toBe(true);
    expect((await sam.get('/api/auth/me')).status).toBe(401);
    expect((await signIn(a, 'sam', 'cred-sam')).res.status).toBe(401);
    await admin.patch(`/api/admin/users/${user.id}`, { disabled: false });
    expect((await signIn(a, 'sam', 'cred-sam')).res.status).toBe(200);
  });

  it('prevents admins locking themselves or everyone out', async () => {
    const { agent, user } = await enrolled();
    expect((await agent.patch(`/api/admin/users/${user.id}`, { disabled: true })).status).toBe(400);
    expect((await agent.patch(`/api/admin/users/${user.id}`, { role: 'member' })).status).toBe(400);
    expect((await agent.delete('/api/admin/passkeys/cred-alex')).status).toBe(400);
  });

  it("lists and removes a user's passkeys", async () => {
    const { agent, app: a } = await enrolled();
    const { user } = await enrolled(a, 'sam', 'member');
    const list = await agent.get(`/api/admin/users/${user.id}/passkeys`);
    expect(list.json.passkeys).toMatchObject([{ id: 'cred-sam', nickname: 'Phone', backed_up: true }]);
    expect((await agent.delete('/api/admin/passkeys/cred-sam')).status).toBe(200);
    expect((await signIn(a, 'sam', 'cred-sam')).res.status).toBe(401);
  });
});

describe('shared state', () => {
  it('requires sign-in', async () => {
    expect((await new Agent(app()).get('/api/state')).status).toBe(401);
  });

  it('applies actions for everyone, stamping time and author', async () => {
    const { agent: alex, app: a } = await enrolled();
    const { agent: sam } = await enrolled(a, 'sam', 'member');
    expect((await alex.get('/api/state')).json.version).toBe(0);
    // A new database starts with the starter pack's shortlist at the interview stage.
    expect((await alex.get('/api/state')).json.state.selection.map((e: { provider_id: string }) => e.provider_id)).toEqual([
      'bolton-clarke',
      'anglicare-southern-queensland',
      'right-at-home-brisbane-bayside-south',
      'bluecare-unitingcare-qld',
      'five-good-friends-brisbane-east-bayside',
      'carers-link',
    ]);

    await alex.post('/api/actions', { action: { type: 'selection/add', providerId: 'envigor-brisbane-bayside', at: '1999-01-01T00:00:00Z' } });
    const res = await sam.post('/api/actions', {
      action: { type: 'note/add', note: { id: 'n1', provider_id: 'bolton-clarke', text: 'Rang them', created_at: 'x', source: 'manual', author: 'Someone else' } },
    });
    expect(res.json.version).toBe(2);
    expect(res.json.state.notes[0]).toMatchObject({ text: 'Rang them', author: 'Sam' });
    expect(res.json.state.notes[0].created_at).not.toBe('x');

    const seen = await alex.get('/api/state');
    const added = seen.json.state.selection.find((e: { provider_id: string }) => e.provider_id === 'envigor-brisbane-bayside');
    expect(added).toMatchObject({ stage: 'scan' });
    expect(added.added_at).not.toMatch(/^1999/);
    const [log] = await db.query<{ n: string }>('SELECT count(*) AS n FROM state_actions');
    expect(Number(log.n)).toBe(2);
  });

  it('serialises concurrent changes so none are lost', async () => {
    const { agent } = await enrolled();
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((id) => agent.post('/api/actions', { action: { type: 'selection/add', providerId: id, at: '' } })),
    );
    const { json } = await agent.get('/api/state');
    expect(json.version).toBe(5);
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(json.state.selection.some((e: { provider_id: string }) => e.provider_id === id)).toBe(true);
  });

  it('rejects malformed actions', async () => {
    const { agent } = await enrolled();
    expect((await agent.post('/api/actions', { action: { type: 'selection/stage', providerId: 'x', stage: 'final', at: '' } })).status).toBe(400);
    expect((await agent.post('/api/actions', { action: { type: 'nuke' } })).status).toBe(400);
  });
});

describe('interview notes', () => {
  const body = { provider_name: 'Example Care', interview_date: '25 Oct 2026', transcript: 'We have a dedicated veterans team here.' };

  it('requires sign-in', async () => {
    expect((await new Agent(app()).post('/api/interview-notes', body)).status).toBe(401);
  });

  it('explains when notes are not configured', async () => {
    getAnthropic = () => {
      throw new NotesError(503, 'Notes generation is not configured');
    };
    const { agent } = await enrolled();
    const res = await agent.post('/api/interview-notes', body);
    expect(res.status).toBe(503);
    expect(res.json.error).toMatch(/not configured/);
  });

  it('returns notes from Claude', async () => {
    const notes = { summary: 'Good', strengths: [], concerns: [], commitments: [], pricing_mentions: [], follow_up_questions: [] };
    const parse = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', parsed_output: notes });
    getAnthropic = () => ({ beta: { messages: { parse } } }) as unknown as Anthropic;
    const { agent } = await enrolled();
    const res = await agent.post('/api/interview-notes', body);
    expect(res.status).toBe(200);
    expect(res.json.notes).toEqual(notes);
  });
});

describe('security headers', () => {
  it('sets a strict content security policy', async () => {
    const res = await new Agent(app()).get('/api/health');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
  });
});
