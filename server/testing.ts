import type { Hono } from 'hono';
import type { Config } from './config.ts';
import type { WebAuthn } from './app.ts';

export const testConfig: Config = {
  port: 0,
  origin: 'https://assessor.example.test',
  rpID: 'assessor.example.test',
  rpName: 'Provider Assessor',
  dataDir: '',
  production: true,
};

/**
 * Stand-in authenticator. A "response" is `{ id, challenge }`: it verifies when it echoes the
 * challenge the server issued (and, for sign-in, names the stored credential).
 */
export function fakeWebAuthn(): WebAuthn {
  let n = 0;
  return {
    generateRegistrationOptions: async (o) =>
      ({ challenge: `reg-${++n}`, rp: { name: o.rpName, id: o.rpID }, user: { id: 'u', name: o.userName, displayName: '' }, pubKeyCredParams: [], excludeCredentials: o.excludeCredentials }) as never,
    verifyRegistrationResponse: async (o) => {
      const r = o.response as unknown as { id: string; challenge: string };
      if (r.challenge !== o.expectedChallenge) throw new Error('challenge mismatch');
      return {
        verified: true,
        registrationInfo: {
          credential: { id: r.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] },
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
        },
      } as never;
    },
    generateAuthenticationOptions: async (o) => ({ challenge: `auth-${++n}`, rpId: o.rpID, allowCredentials: o.allowCredentials }) as never,
    verifyAuthenticationResponse: async (o) => {
      const r = o.response as unknown as { id: string; challenge: string };
      const ok = r.challenge === o.expectedChallenge && r.id === o.credential.id;
      return { verified: ok, authenticationInfo: { newCounter: o.credential.counter + 1, credentialBackedUp: true } } as never;
    },
  };
}

/** Minimal cookie-keeping client for `app.request`. */
export class Agent {
  cookies = new Map<string, string>();
  constructor(
    private app: Hono<never>,
    private origin = testConfig.origin,
  ) {}

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.request(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { origin: this.origin } : {}),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const [name, value] = pair.split('=');
      if (attrs.some((a) => /max-age=0/i.test(a)) || value === '') this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value);
    }
    const json = (await res.json().catch(() => undefined)) as Record<string, any>;
    return { status: res.status, json, headers: res.headers };
  }
  get = (path: string) => this.req('GET', path);
  post = (path: string, body: unknown = {}) => this.req('POST', path, body);
  patch = (path: string, body: unknown) => this.req('PATCH', path, body);
  delete = (path: string) => this.req('DELETE', path);
}
