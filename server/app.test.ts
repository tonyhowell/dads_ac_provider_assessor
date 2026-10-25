// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createApp } from './app.ts';
import { createPgliteDb, migrate, type Db } from './db.ts';
import { createUser, issueEnrolment, type Role } from './users.ts';
import { Agent, fakeWebAuthn, testConfig } from './testing.ts';
import { NotesError } from './interviewNotes.ts';
import { moveLegacyState } from './state.ts';

let db: Db;
let getAnthropic: (() => Anthropic) | undefined;
const jobs: Promise<void>[] = [];
const app = () => createApp({ db, config: testConfig, webauthn: fakeWebAuthn(), getAnthropic, background: (w) => void jobs.push(w) }) as never;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
});
afterAll(() => db.close());
beforeEach(async () => {
  getAnthropic = undefined;
  await db.query(
    'TRUNCATE users, credentials, enrolments, sessions, auth_challenges, app_state, state_actions, applications, application_members, application_state, membership_log, provider_catalogue, provider_history, provider_suggestions, provider_claims CASCADE',
  );
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
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
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

/** Admin creates an application with the given coordinator (by user id). */
async function newApplication(admin: Agent, coordinatorId: string, name = 'Dad – Wynnum', postcode = '4178') {
  const res = await admin.post('/api/admin/applications', { name, suburb: 'Wynnum', postcode, coordinator: { user_id: coordinatorId } });
  expect(res.status).toBe(201);
  return res.json.application.id as string;
}
const add = (providerId: string) => ({ action: { type: 'selection/add', providerId, at: '1999-01-01T00:00:00Z' } });

describe('applications', () => {
  it('only site admins create applications, with a coordinator', async () => {
    const { agent: admin, user: alex, app: a } = await enrolled();
    const { agent: sam } = await enrolled(a, 'sam', 'member');
    expect((await sam.post('/api/admin/applications', { name: 'X', coordinator: { user_id: alex.id } })).status).toBe(403);

    // A new person as coordinator gets an enrolment link.
    const res = await admin.post('/api/admin/applications', { name: 'Mum', suburb: 'Manly', postcode: '4179', coordinator: { username: 'jo', display_name: 'Jo' } });
    expect(res.status).toBe(201);
    expect(res.json.enrolment_url).toMatch(/\/enrol\//);
    const list = await admin.get('/api/admin/applications');
    expect(list.json.applications).toMatchObject([{ name: 'Mum', postcode: '4179', members: 1, coordinators: [{ username: 'jo' }] }]);
  });

  it('keeps each application private to its members, including from site admins', async () => {
    const { agent: admin, user: alex, app: a } = await enrolled();
    const { agent: sam, user: samUser } = await enrolled(a, 'sam', 'member');
    const { agent: kim, user: kimUser } = await enrolled(a, 'kim', 'member');
    const samApp = await newApplication(admin, samUser.id, 'Dad');
    const kimApp = await newApplication(admin, kimUser.id, 'Aunt');

    expect((await sam.get('/api/applications')).json.applications).toMatchObject([{ id: samApp, name: 'Dad', role: 'coordinator' }]);
    expect((await sam.post(`/api/applications/${samApp}/actions`, add('bolton-clarke'))).status).toBe(200);

    // Other families and the site admin (not a member) can't read or change it.
    for (const outsider of [kim, admin]) {
      expect((await outsider.get(`/api/applications/${samApp}/state`)).status).toBe(404);
      expect((await outsider.post(`/api/applications/${samApp}/actions`, add('carers-link'))).status).toBe(404);
      expect((await outsider.get(`/api/applications/${samApp}/members`)).status).toBe(404);
    }
    expect((await kim.get(`/api/applications/${kimApp}/state`)).json.state.selection).toEqual([]);
    expect((await admin.get('/api/applications')).json.applications).toEqual([]);
    // The admin list shows details, never the contents.
    const listed = (await admin.get('/api/admin/applications')).json.applications.find((x: { id: string }) => x.id === samApp);
    expect(Object.keys(listed).sort()).toEqual(['coordinators', 'created_at', 'id', 'last_activity', 'members', 'name', 'postcode', 'status', 'suburb', 'updated_at']);
    void alex;
  });

  it('applies actions, stamping time and author, and serialises concurrent changes', async () => {
    const { agent: admin, user: alex, app: a } = await enrolled();
    const { agent: sam, user: samUser } = await enrolled(a, 'sam', 'member');
    const id = await newApplication(admin, alex.id);
    await admin.post(`/api/applications/${id}/members`, { username: 'sam', role: 'contributor' });
    void samUser;
    expect((await sam.get(`/api/applications/${id}/state`)).json).toMatchObject({ version: 0, state: { selection: [] } });
    const res = await sam.post(`/api/applications/${id}/actions`, {
      action: { type: 'note/add', note: { id: 'n1', provider_id: 'bolton-clarke', text: 'Rang them', created_at: 'x', source: 'manual', author: 'Someone else' } },
    });
    expect(res.json.state.notes[0]).toMatchObject({ text: 'Rang them', author: 'Sam' });
    expect(res.json.state.notes[0].created_at).not.toBe('x');

    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((p) => admin.post(`/api/applications/${id}/actions`, add(p))));
    const { json } = await admin.get(`/api/applications/${id}/state`);
    expect(json.version).toBe(6);
    expect(json.state.selection.map((e: { provider_id: string }) => e.provider_id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(json.state.selection[0].added_at).not.toMatch(/^1999/);
    const [log] = await db.query<{ n: string }>('SELECT count(*) AS n FROM state_actions WHERE application_id = $1', [id]);
    expect(Number(log.n)).toBe(6);
    expect((await admin.post(`/api/applications/${id}/actions`, { action: { type: 'nuke' } })).status).toBe(400);
  });

  it('family join as viewers (read-only) until the coordinator makes them contributors', async () => {
    const { agent: admin, user: alex, app: a } = await enrolled();
    const { agent: sam } = await enrolled(a, 'sam', 'member');
    const id = await newApplication(admin, alex.id);

    expect((await admin.post(`/api/applications/${id}/members`, { username: 'sam' })).status).toBe(201);
    const members = (await admin.get(`/api/applications/${id}/members`)).json.members;
    const samId = members.find((m: { username: string }) => m.username === 'sam').user_id;
    expect(members.map((m: { username: string; role: string }) => [m.username, m.role])).toEqual([['alex', 'coordinator'], ['sam', 'viewer']]);

    expect((await sam.get(`/api/applications/${id}/state`)).status).toBe(200);
    const blocked = await sam.post(`/api/applications/${id}/actions`, add('bolton-clarke'));
    expect(blocked.status).toBe(403);
    expect(blocked.json.error).toMatch(/view this application but not change it/);
    // Viewers can't manage people either.
    expect((await sam.post(`/api/applications/${id}/members`, { username: 'alex' })).status).toBe(403);

    expect((await admin.patch(`/api/applications/${id}/members/${samId}`, { role: 'contributor' })).status).toBe(200);
    expect((await sam.post(`/api/applications/${id}/actions`, add('bolton-clarke'))).status).toBe(200);
    const [entry] = await db.query<{ change: string }>('SELECT change FROM membership_log WHERE subject_id = $1 ORDER BY id DESC LIMIT 1', [samId]);
    expect(entry.change).toBe('role viewer → contributor');
  });

  it('invites a new person with a one-time link, and never issues links for people who have a passkey', async () => {
    const { agent: admin, user: alex, app: a } = await enrolled();
    await enrolled(a, 'sam', 'member');
    const id = await newApplication(admin, alex.id);
    await admin.post(`/api/applications/${id}/members`, { username: 'sam' });

    const res = await admin.post(`/api/applications/${id}/members`, { username: 'jo', display_name: 'Jo', new: true });
    expect(res.status).toBe(201);
    const jo = new Agent(a);
    expect((await jo.get(`/api/enrol/${tokenFrom(res.json.enrolment_url)}`)).json.username).toBe('jo');
    expect((await admin.post(`/api/applications/${id}/members`, { username: 'sam', display_name: 'Sam', new: true })).status).toBe(409);

    const members = (await admin.get(`/api/applications/${id}/members`)).json.members;
    const joMember = members.find((m: { username: string }) => m.username === 'jo');
    expect(joMember).toMatchObject({ role: 'viewer', enrolled: false });
    expect((await admin.post(`/api/applications/${id}/members/${joMember.user_id}/enrolment`)).status).toBe(200);
    const samId = members.find((m: { username: string }) => m.username === 'sam').user_id;
    expect((await admin.post(`/api/applications/${id}/members/${samId}/enrolment`)).status).toBe(400);
  });

  it('always keeps a coordinator, and lets people leave', async () => {
    const { agent: admin, user: alex, app: a } = await enrolled();
    const { agent: sam, user: samUser } = await enrolled(a, 'sam', 'member');
    const id = await newApplication(admin, alex.id);
    expect((await admin.patch(`/api/applications/${id}/members/${alex.id}`, { role: 'viewer' })).status).toBe(400);
    expect((await admin.delete(`/api/applications/${id}/members/${alex.id}`)).status).toBe(400);

    await admin.post(`/api/applications/${id}/members`, { username: 'sam', role: 'coordinator' });
    expect((await admin.patch(`/api/applications/${id}/members/${alex.id}`, { role: 'contributor' })).status).toBe(200);
    expect((await sam.delete(`/api/applications/${id}/members/${samUser.id}`)).status).toBe(400);
    expect((await admin.delete(`/api/applications/${id}/members/${alex.id}`)).status).toBe(200);
    expect((await admin.get(`/api/applications/${id}/state`)).status).toBe(404);

    // A site admin can reassign the coordinator, e.g. if they leave.
    expect((await admin.post(`/api/admin/applications/${id}/coordinator`, { user_id: alex.id })).status).toBe(200);
    expect((await admin.get(`/api/applications/${id}`)).json.role).toBe('coordinator');
  });

  it('archived applications are read-only', async () => {
    const { agent: admin, user: alex } = await enrolled();
    const id = await newApplication(admin, alex.id);
    await admin.patch(`/api/admin/applications/${id}`, { status: 'archived' });
    expect((await admin.post(`/api/applications/${id}/actions`, add('x'))).json.error).toMatch(/archived/);
    expect((await admin.get(`/api/applications/${id}/state`)).status).toBe(200);
  });
});

describe('provider catalogue', () => {
  const bolton = { id: 'bolton-clarke', provider: 'Bolton Clarke', type: null, outlet: null, rn: 1, en: null, pc: 130, domestic: null, social: null, respite: null, gardening: null, care_mgmt: null, prices_as_at: '1 Nov 2026', prices_as_at_date: '2026-11-01', veteran_fit: null, flags: [], source_url: null, postcodes_served: ['4150-4179'] };

  it('admins edit the common catalogue for every application, with history', async () => {
    const { agent: admin, app: a } = await enrolled();
    const { agent: sam } = await enrolled(a, 'sam', 'member');
    expect((await sam.req('PUT', '/api/admin/providers/bolton-clarke', { provider: bolton })).status).toBe(403);
    expect((await admin.req('PUT', '/api/admin/providers/bolton-clarke', { provider: bolton })).status).toBe(200);
    expect((await sam.get('/api/providers')).json.providers).toMatchObject([{ id: 'bolton-clarke', pc: 130, postcodes_served: ['4150-4179'] }]);
    expect((await admin.get('/api/admin/providers/bolton-clarke/history')).json.history).toMatchObject([{ change: 'Edited', by: 'Alex' }]);
    await admin.delete('/api/admin/providers/bolton-clarke');
    expect((await sam.get('/api/providers')).json.providers).toEqual([]);
  });

  it('families suggest corrections; admins approve or reject them', async () => {
    const { agent: admin, user: alex, app: a } = await enrolled();
    const { agent: sam } = await enrolled(a, 'sam', 'member');
    const id = await newApplication(admin, alex.id);
    await admin.post(`/api/applications/${id}/members`, { username: 'sam' });

    // Viewers can't suggest; contributors can.
    expect((await sam.post(`/api/applications/${id}/suggestions`, { provider: bolton, note: 'New price list' })).status).toBe(403);
    const samId = (await admin.get(`/api/applications/${id}/members`)).json.members.find((m: { username: string }) => m.username === 'sam').user_id;
    await admin.patch(`/api/applications/${id}/members/${samId}`, { role: 'contributor' });
    const created = await sam.post(`/api/applications/${id}/suggestions`, { provider: bolton, note: 'New price list' });
    expect(created.status).toBe(201);
    expect(created.json.suggestion).toMatchObject({ provider_id: 'bolton-clarke', is_new: false, status: 'pending', suggested_by: 'Sam', application_name: 'Dad – Wynnum' });
    expect(created.json.suggestion.current.pc).toBe(126);
    // Nothing changes until an admin approves.
    expect((await sam.get('/api/providers')).json.providers).toEqual([]);

    const pending = (await admin.get('/api/admin/suggestions?status=pending')).json.suggestions;
    expect(pending).toHaveLength(1);
    const decided = await admin.post(`/api/admin/suggestions/${pending[0].id}/decision`, { approve: true, note: 'Checked the price list' });
    expect(decided.json.suggestion).toMatchObject({ status: 'approved', decided_by: 'Alex' });
    expect((await sam.get('/api/providers')).json.providers).toMatchObject([{ id: 'bolton-clarke', pc: 130 }]);
    expect((await admin.post(`/api/admin/suggestions/${pending[0].id}/decision`, { approve: false })).status).toBe(409);
    expect((await sam.get(`/api/applications/${id}/suggestions`)).json.suggestions[0]).toMatchObject({ status: 'approved', decision_note: 'Checked the price list' });
  });
});

describe('moving v1 data', () => {
  it('turns the shared record into the first application and moves provider edits into the catalogue', async () => {
    const { user: alex, app: a } = await enrolled();
    const { agent: sam } = await enrolled(a, 'sam', 'member');
    const legacy = {
      version: 5,
      notes: [],
      selection: [{ provider_id: 'carers-link', stage: 'interview', why: '', watch: '', added_at: 'x', stage_changed_at: 'x' }],
      interviews: [],
      participant: null,
      plan: null,
      serviceDate: null,
      providerEdits: [{ id: 'new-co', provider: 'New Co', type: null, outlet: null, rn: null, en: null, pc: 101, domestic: null, social: null, respite: null, gardening: null, care_mgmt: null, prices_as_at: '1 Oct 2026', prices_as_at_date: '2026-10-01', veteran_fit: null, flags: [], source_url: null }],
      answers: {},
      customQuestions: [],
      responses: {},
      scores: {},
      weights: {},
      decisionNotes: '',
      screenNotes: [],
    };
    await db.query('INSERT INTO app_state (id, version, state) VALUES (1, 7, $1::jsonb)', [JSON.stringify(legacy)]);
    await db.query('INSERT INTO state_actions (user_id, action) VALUES ($1, $2::jsonb)', [alex.id, '{}']);

    const id = await moveLegacyState(db);
    expect(id).toBeDefined();
    expect(await moveLegacyState(db)).toBeUndefined();
    const mine = (await sam.get('/api/applications')).json.applications;
    expect(mine).toMatchObject([{ id, name: 'First application', role: 'contributor' }]);
    const state = (await sam.get(`/api/applications/${id}/state`)).json;
    expect(state.version).toBe(7);
    expect(state.state).toMatchObject({ version: 7, specialRates: {}, profile: null, selection: [{ provider_id: 'carers-link' }] });
    expect(state.state.providerEdits).toBeUndefined();
    expect((await sam.get('/api/providers')).json.providers).toMatchObject([{ id: 'new-co', pc: 101 }]);
    const [{ n }] = await db.query<{ n: string }>('SELECT count(*) AS n FROM state_actions WHERE application_id = $1', [id]);
    expect(Number(n)).toBe(1);
    const [admin] = await db.query<{ role: string }>('SELECT role FROM application_members WHERE user_id = $1', [alex.id]);
    expect(admin.role).toBe('coordinator');
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

describe("what I'm looking for summary", () => {
  it("drafts from the application's saved answers (not money), saves it, and refuses viewers", async () => {
    const draft = { summary: "I'm looking for the same worker each week.", priorities: ['Same workers'], must_haves: [], deal_breakers: ['Unannounced visits'] };
    const parse = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', parsed_output: draft });
    getAnthropic = () => ({ beta: { messages: { parse } } }) as unknown as Anthropic;
    const { agent: admin, user: alex, app: a } = await enrolled();
    const { agent: sam } = await enrolled(a, 'sam', 'member');
    const id = await newApplication(admin, alex.id);
    await admin.post(`/api/applications/${id}/members`, { username: 'sam' });
    for (const action of [
      { type: 'bounding/answer', questionId: 'B3.2', answer: { answer: 'essential', notes: 'Strangers upset him', not_relevant: false } },
      { type: 'participant/set', participant: { id: 'p', name: '', suburb: 'Wynnum', postcode: '4178', pension_status: 'part_pensioner', ind_rate: 0.2, ev_rate: 0.4, dva_card: 'gold', nwop: false, classification: '5', lifetime_contributions_paid: 12345 } },
      { type: 'profile/update', patch: { preferred_name: 'Bill', dva_services: ['nursing'] } },
    ]) {
      expect((await admin.post(`/api/applications/${id}/actions`, { action })).status).toBe(200);
    }

    expect((await sam.post(`/api/applications/${id}/looking-for/summary`)).status).toBe(403);
    const res = await admin.post(`/api/applications/${id}/looking-for/summary`);
    expect(res.status).toBe(200);
    expect(res.json.state.lookingFor).toMatchObject({ ...draft, edited: false });
    const sent = parse.mock.calls[0][0].messages[0].content as string;
    expect(sent).toContain('How much does having the same one or two workers matter to you? → It\'s essential — in their words: "Strangers upset him"');
    expect(sent).toContain('Preferred name: Bill');
    expect(sent).toContain('DVA community nursing');
    expect(sent).not.toMatch(/12345|12,345|part_pensioner|0\.2/);
  });
});

describe('public claims', () => {
  /** A fake Claude: the search finds one page; the structuring step returns one claim from it and one from a page never retrieved. */
  function fakeClaude() {
    const message = {
      stop_reason: 'end_turn',
      content: [
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Bolton Clarke veterans' } },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://www.boltonclarke.com.au/veterans/', title: 'Veterans', encrypted_content: 'x' }] },
        { type: 'text', text: 'Bolton Clarke says it has a dedicated veterans team (boltonclarke.com.au/veterans).' },
      ],
    };
    const stream = vi.fn((_params: unknown) => ({ finalMessage: async () => message }));
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: {
        website: 'https://www.boltonclarke.com.au',
        overview: 'Large not-for-profit with veteran services.',
        items: [
          { question_id: 'E1', status: 'stated', claim: 'Dedicated veterans team', quote: 'our dedicated veterans team', source_url: 'https://www.boltonclarke.com.au/veterans', source_title: 'Veterans' },
          { question_id: 'E2', status: 'partly', claim: 'Invented', quote: 'x', source_url: 'https://made-up.example/page', source_title: 'Nope' },
        ],
      },
    });
    return { stream, parse, client: { beta: { messages: { stream, parse } } } as unknown as Anthropic };
  }

  it('researches once, keeps only claims with retrieved links, and reuses the result until refreshed', async () => {
    const fake = fakeClaude();
    getAnthropic = () => fake.client;
    const { agent: admin, user: alex, app: a } = await enrolled();
    const { agent: sam } = await enrolled(a, 'sam', 'member');
    const id = await newApplication(admin, alex.id);
    await admin.post(`/api/applications/${id}/members`, { username: 'sam' });
    expect((await sam.post(`/api/applications/${id}/claims/bolton-clarke`, {})).status).toBe(403);

    const started = await admin.post(`/api/applications/${id}/claims/bolton-clarke`, {});
    expect(started.json.claims.status).toBe('running');
    await Promise.all(jobs.splice(0));
    const listed = (await sam.get('/api/claims')).json;
    expect(listed.max_age_days).toBe(60);
    expect(listed.claims[0]).toMatchObject({ provider_id: 'bolton-clarke', status: 'ready', claims: { overview: 'Large not-for-profit with veteran services.' } });
    expect(listed.claims[0].claims.items.map((i: { question_id: string }) => i.question_id)).toEqual(['E1']);
    // The search covered every interview topic and searched from Australia.
    const sent = fake.stream.mock.calls[0][0] as { messages: { content: string }[]; tools: { type: string }[] };
    expect(sent.messages[0].content).toContain('E1:');
    expect(sent.tools.map((t) => t.type)).toEqual(['web_search_20260209', 'web_fetch_20260209']);

    // Cached: no new search, unless a refresh is asked for.
    expect((await admin.post(`/api/applications/${id}/claims/bolton-clarke`, {})).json.claims.status).toBe('ready');
    expect(jobs).toHaveLength(0);
    expect((await admin.post(`/api/applications/${id}/claims/bolton-clarke`, { refresh: true })).json.claims.status).toBe('running');
    await Promise.all(jobs.splice(0));
    expect(fake.stream).toHaveBeenCalledTimes(2);
  });

  it('records a failure, keeping earlier claims', async () => {
    getAnthropic = () => ({ beta: { messages: { stream: () => ({ finalMessage: async () => ({ stop_reason: 'refusal', content: [] }) }) } } }) as unknown as Anthropic;
    const { agent: admin, user: alex } = await enrolled();
    const id = await newApplication(admin, alex.id);
    await admin.post(`/api/applications/${id}/claims/carers-link`, {});
    await Promise.all(jobs.splice(0));
    expect((await admin.get('/api/claims')).json.claims[0]).toMatchObject({ provider_id: 'carers-link', status: 'failed', error: expect.stringMatching(/declined/) });
  });
});

describe('security headers', () => {
  it('sets a strict content security policy', async () => {
    const res = await new Agent(app()).get('/api/health');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
  });
});
