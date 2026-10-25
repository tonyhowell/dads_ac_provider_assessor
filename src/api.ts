export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** JSON request to the app's own API. Throws ApiError with the server's message on failure. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your internet connection.");
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401 && !path.startsWith('/api/auth/') && !path.startsWith('/api/enrol/')) {
    window.dispatchEvent(new Event('sah:session-expired'));
  }
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Request failed (${res.status}).`);
  return json;
}
