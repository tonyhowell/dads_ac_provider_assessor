import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import * as simpleWebAuthn from '@simplewebauthn/server';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import {
  addCredential,
  countActiveAdmins,
  createSession,
  createUser,
  deleteCredential,
  deleteSession,
  deleteUserSessions,
  findEnrolment,
  getCredential,
  getUser,
  getUserByUsername,
  hashToken,
  issueEnrolment,
  listCredentials,
  listUsers,
  markEnrolmentUsed,
  recordCredentialUse,
  saveChallenge,
  SESSION_TTL_MS,
  CHALLENGE_TTL_MS,
  takeChallenge,
  updateUser,
  userForSession,
  USERNAME_RE,
  normaliseUsername,
  type User,
} from './users.ts';
import { applyAction, readState } from './state.ts';
import { ActionSchema } from '../src/state/actions.ts';
import { generateInterviewNotes, NotesError, NotesRequestSchema } from './interviewNotes.ts';

export type WebAuthn = Pick<
  typeof simpleWebAuthn,
  'generateRegistrationOptions' | 'verifyRegistrationResponse' | 'generateAuthenticationOptions' | 'verifyAuthenticationResponse'
>;

export interface AppDeps {
  db: Db;
  config: Config;
  /** Injected so tests can stand in for a real authenticator. */
  webauthn?: WebAuthn;
  /** Returns a Claude client, or throws NotesError when notes aren't configured. */
  getAnthropic?: () => Anthropic;
}

type Env = { Variables: { user: User } };

const SESSION_COOKIE = 'sah_session';
const CHALLENGE_COOKIE = 'sah_challenge';

/** Public view of a user, safe to send to the browser. */
const publicUser = (u: User) => ({
  id: u.id,
  username: u.username,
  display_name: u.display_name,
  role: u.role,
  disabled: u.disabled_at !== null,
  last_login_at: u.last_login_at,
  created_at: u.created_at,
});

/** Very small fixed-window limiter for the sign-in endpoints. */
function rateLimit(max: number, windowMs: number): MiddlewareHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  return async (c, next) => {
    // Use the address the hosting proxy saw; the left-most X-Forwarded-For entry can be forged by the client.
    const key = c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',').pop()?.trim() ?? 'local';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) hits.set(key, { count: 1, reset: now + windowMs });
    else if (++entry.count > max) return c.json({ error: 'Too many attempts. Wait a minute and try again.' }, 429);
    await next();
  };
}

export function createApp({ db, config, webauthn = simpleWebAuthn, getAnthropic }: AppDeps) {
  const app = new Hono<Env>();
  const cookieOpts = { httpOnly: true, secure: config.production, sameSite: 'Lax' as const, path: '/' };

  const setSession = async (c: Context, user: User) => {
    const token = await createSession(db, user.id, c.req.header('user-agent') ?? '');
    setCookie(c, SESSION_COOKIE, token, { ...cookieOpts, maxAge: SESSION_TTL_MS / 1000 });
  };
  const setChallenge = (c: Context, id: string) =>
    setCookie(c, CHALLENGE_COOKIE, id, { ...cookieOpts, path: '/api', maxAge: CHALLENGE_TTL_MS / 1000 });
  const popChallenge = async (c: Context, purpose: 'register' | 'authenticate') => {
    const id = getCookie(c, CHALLENGE_COOKIE);
    deleteCookie(c, CHALLENGE_COOKIE, { path: '/api' });
    return id ? takeChallenge(db, id, purpose) : undefined;
  };

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
      strictTransportSecurity: config.production ? 'max-age=63072000; includeSubDomains' : false,
      permissionsPolicy: { microphone: ['self'], camera: [], geolocation: [] },
    }),
  );

  app.get('/api/health', (c) => c.json({ ok: true }));

  // Cross-site request protection: state-changing API calls must come from our own origin.
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('origin') !== config.origin) {
      return c.json({ error: 'Request blocked: unexpected origin.' }, 403);
    }
    await next();
  });
  app.use('/api/*', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ error: 'Request is too large.' }, 413) }));

  const parse = async <T>(c: Context, schema: z.ZodType<T>): Promise<T | Response> => {
    const body = await c.req.json().catch(() => undefined);
    const result = schema.safeParse(body);
    if (!result.success) return c.json({ error: result.error.issues.map((i) => i.message).join('; ') }, 400);
    return result.data;
  };

  // --- Enrolment (public: the one-time link is the credential) ---

  app.get('/api/enrol/:token', async (c) => {
    const found = await findEnrolment(db, c.req.param('token'));
    if (!found) return c.json({ error: 'This enrolment link has expired or already been used. Ask your administrator for a new one.' }, 410);
    return c.json({ username: found.user.username, display_name: found.user.display_name, expires_at: found.expires_at });
  });

  app.post('/api/enrol/:token/options', rateLimit(20, 60_000), async (c) => {
    const token = c.req.param('token');
    const found = await findEnrolment(db, token);
    if (!found) return c.json({ error: 'This enrolment link has expired or already been used.' }, 410);
    const existing = await listCredentials(db, found.user.id);
    const options = await webauthn.generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userName: found.user.username,
      userDisplayName: found.user.display_name,
      userID: new TextEncoder().encode(found.user.webauthn_user_id),
      attestationType: 'none',
      excludeCredentials: existing.map((cr) => ({ id: cr.id, transports: cr.transports })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    });
    setChallenge(c, await saveChallenge(db, { challenge: options.challenge, purpose: 'register', user_id: found.user.id, enrolment_token_hash: hashToken(token) }));
    return c.json(options);
  });

  app.post('/api/enrol/:token/verify', rateLimit(20, 60_000), async (c) => {
    const token = c.req.param('token');
    const body = await parse(c, z.object({ response: z.any(), nickname: z.string().max(60).optional() }));
    if (body instanceof Response) return body;
    const challenge = await popChallenge(c, 'register');
    const found = await findEnrolment(db, token);
    if (!challenge || !found || challenge.enrolment_token_hash !== hashToken(token) || challenge.user_id !== found.user.id) {
      return c.json({ error: 'Passkey setup timed out. Reload the page and try again.' }, 400);
    }
    let verification;
    try {
      verification = await webauthn.verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
      });
    } catch {
      return c.json({ error: 'Your device returned a passkey the app could not verify. Try again.' }, 400);
    }
    if (!verification.verified) return c.json({ error: 'Passkey could not be verified. Try again.' }, 400);
    const info = verification.registrationInfo;
    await addCredential(db, {
      id: info.credential.id,
      user_id: found.user.id,
      public_key: info.credential.publicKey,
      counter: info.credential.counter,
      transports: info.credential.transports ?? [],
      device_type: info.credentialDeviceType,
      backed_up: info.credentialBackedUp,
      nickname: body.nickname?.trim() ?? '',
    });
    await markEnrolmentUsed(db, token);
    await setSession(c, found.user);
    return c.json({ user: publicUser(found.user) });
  });

  // --- Sign in ---

  app.post('/api/auth/options', rateLimit(20, 60_000), async (c) => {
    const body = await parse(c, z.object({ username: z.string().max(64) }));
    if (body instanceof Response) return body;
    const user = await getUserByUsername(db, body.username);
    // Unknown or disabled users get the same response, so usernames can't be probed.
    const usable = user && !user.disabled_at ? user : undefined;
    const creds = usable ? await listCredentials(db, usable.id) : [];
    const options = await webauthn.generateAuthenticationOptions({
      rpID: config.rpID,
      allowCredentials: creds.map((cr) => ({ id: cr.id, transports: cr.transports })),
      userVerification: 'required',
    });
    setChallenge(c, await saveChallenge(db, { challenge: options.challenge, purpose: 'authenticate', user_id: usable?.id ?? null }));
    return c.json(options);
  });

  app.post('/api/auth/verify', rateLimit(20, 60_000), async (c) => {
    const body = await parse(c, z.object({ response: z.object({ id: z.string() }).passthrough() }));
    if (body instanceof Response) return body;
    const fail = () => c.json({ error: 'Sign-in failed. Check your username and use the passkey you set up for this app.' }, 401);
    const challenge = await popChallenge(c, 'authenticate');
    if (!challenge?.user_id) return fail();
    const credential = await getCredential(db, body.response.id);
    if (!credential || credential.user_id !== challenge.user_id) return fail();
    const user = await getUser(db, credential.user_id);
    if (!user || user.disabled_at) return fail();
    let verification;
    try {
      verification = await webauthn.verifyAuthenticationResponse({
        response: body.response as never,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        credential: { id: credential.id, publicKey: credential.public_key as never, counter: credential.counter, transports: credential.transports },
        requireUserVerification: true,
      });
    } catch {
      return fail();
    }
    if (!verification.verified) return fail();
    await recordCredentialUse(db, credential.id, verification.authenticationInfo.newCounter, verification.authenticationInfo.credentialBackedUp);
    await setSession(c, user);
    return c.json({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // --- Everything below needs a signed-in user ---

  const requireUser: MiddlewareHandler<Env> = async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const user = token ? await userForSession(db, token) : undefined;
    if (!user) return c.json({ error: 'Please sign in.' }, 401);
    c.set('user', user);
    await next();
  };
  const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
    if (c.get('user').role !== 'admin') return c.json({ error: 'Administrators only.' }, 403);
    await next();
  };

  app.get('/api/auth/me', requireUser, (c) => c.json({ user: publicUser(c.get('user')) }));

  app.get('/api/state', requireUser, async (c) => c.json(await readState(db)));

  app.post('/api/actions', requireUser, async (c) => {
    const body = await parse(c, z.object({ action: ActionSchema }));
    if (body instanceof Response) return body;
    return c.json(await applyAction(db, body.action, c.get('user')));
  });

  app.post('/api/interview-notes', requireUser, async (c) => {
    const body = await parse(c, NotesRequestSchema);
    if (body instanceof Response) return body;
    try {
      if (!getAnthropic) throw new NotesError(503, 'Notes generation is not configured: set ANTHROPIC_API_KEY on the server.');
      return c.json({ notes: await generateInterviewNotes(getAnthropic(), body) });
    } catch (err) {
      if (err instanceof NotesError) return c.json({ error: err.message }, err.status as 400);
      console.error('[interview-notes]', err);
      return c.json({ error: 'Unexpected error generating notes.' }, 500);
    }
  });

  // --- Administration ---

  const admin = new Hono<Env>();
  admin.use('*', requireUser, requireAdmin);

  admin.get('/users', async (c) => {
    const users = await listUsers(db);
    return c.json({ users: users.map((u) => ({ ...publicUser(u), passkeys: u.passkeys, enrolment_expires_at: u.enrolment_expires_at })) });
  });

  const enrolmentUrl = (token: string) => `${config.origin}/enrol/${token}`;

  admin.post('/users', async (c) => {
    const body = await parse(
      c,
      z.object({
        username: z.string().transform(normaliseUsername).pipe(z.string().regex(USERNAME_RE, 'Username: 2–32 lowercase letters, digits, dots, dashes or underscores')),
        display_name: z.string().trim().min(1, 'Enter a display name').max(80),
        role: z.enum(['admin', 'member']),
      }),
    );
    if (body instanceof Response) return body;
    if (await getUserByUsername(db, body.username)) return c.json({ error: `The username "${body.username}" is already taken.` }, 409);
    const user = await createUser(db, body);
    const token = await issueEnrolment(db, user.id, c.get('user').id);
    return c.json({ user: publicUser(user), enrolment_url: enrolmentUrl(token) }, 201);
  });

  admin.patch('/users/:id', async (c) => {
    const body = await parse(
      c,
      z.object({ display_name: z.string().trim().min(1).max(80).optional(), role: z.enum(['admin', 'member']).optional(), disabled: z.boolean().optional() }),
    );
    if (body instanceof Response) return body;
    const target = await getUser(db, c.req.param('id'));
    if (!target) return c.json({ error: 'User not found.' }, 404);
    const removesAdmin = target.role === 'admin' && !target.disabled_at && (body.role === 'member' || body.disabled === true);
    if (removesAdmin && target.id === c.get('user').id) {
      return c.json({ error: "You can't remove your own admin access or disable yourself." }, 400);
    }
    if (removesAdmin && (await countActiveAdmins(db)) <= 1) return c.json({ error: 'There must be at least one active administrator.' }, 400);
    const user = await updateUser(db, target.id, body);
    if (body.disabled) await deleteUserSessions(db, target.id);
    return c.json({ user: publicUser(user!) });
  });

  admin.post('/users/:id/enrolment', async (c) => {
    const target = await getUser(db, c.req.param('id'));
    if (!target) return c.json({ error: 'User not found.' }, 404);
    if (target.disabled_at) return c.json({ error: 'Enable this user before issuing an enrolment link.' }, 400);
    const token = await issueEnrolment(db, target.id, c.get('user').id);
    return c.json({ enrolment_url: enrolmentUrl(token) });
  });

  admin.get('/users/:id/passkeys', async (c) => {
    const creds = await listCredentials(db, c.req.param('id'));
    return c.json({
      passkeys: creds.map((cr) => ({
        id: cr.id,
        nickname: cr.nickname,
        device_type: cr.device_type,
        backed_up: cr.backed_up,
        created_at: cr.created_at,
        last_used_at: cr.last_used_at,
      })),
    });
  });

  admin.delete('/passkeys/:id', async (c) => {
    const cred = await getCredential(db, c.req.param('id'));
    if (!cred) return c.json({ error: 'Passkey not found.' }, 404);
    const own = await listCredentials(db, c.get('user').id);
    if (cred.user_id === c.get('user').id && own.length <= 1) {
      return c.json({ error: "You can't remove your only passkey — you would be locked out." }, 400);
    }
    await deleteCredential(db, cred.id);
    return c.json({ ok: true });
  });

  app.route('/api/admin', admin);

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));
  return app;
}
