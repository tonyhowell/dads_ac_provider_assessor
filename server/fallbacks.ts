import Anthropic from '@anthropic-ai/sdk';

// Server-side fallbacks re-run a request on Anthropic's recommended model if a safety classifier declines it.
// They need a beta header; an organisation without access to that beta gets a 400 for every request that
// sends it. So: try with fallbacks, and if the API rejects them, send the request again without and stop
// asking for the rest of this process's life.

export const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };

let available = true;

/** For tests. */
export function resetFallbacks() {
  available = true;
}

/** The API's own message from an error, e.g. "fallbacks: unknown field". */
export function apiMessage(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    const body = err.error as { error?: { message?: string } } | undefined;
    return body?.error?.message ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

const rejectsFallbacks = (err: unknown) => err instanceof Anthropic.BadRequestError && /fallback|anthropic-beta|beta header|beta/i.test(apiMessage(err));

/**
 * Runs `call` with the fallback settings to spread into the request (or `{}` once they've been rejected).
 * Retries without them only when the 400 is about the fallbacks or the beta header.
 */
export async function withFallbacks<T>(call: (extra: typeof FALLBACK | Record<string, never>) => Promise<T>): Promise<T> {
  if (available) {
    try {
      return await call(FALLBACK);
    } catch (err) {
      if (!rejectsFallbacks(err)) throw err;
      available = false;
      console.warn(`[claude] Server-side fallbacks were rejected (${apiMessage(err)}); continuing without them.`);
    }
  }
  return call({});
}
