import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import Anthropic from '@anthropic-ai/sdk';
import { generateInterviewNotes, NotesError, NotesRequestSchema } from './interviewNotes.ts';

// The app is a local, single-user tool (SPEC §9), so its one server endpoint runs inside
// the Vite dev/preview server. This keeps the API key out of the browser bundle.

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new NotesError(413, 'Transcript is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new NotesError(400, 'Request body must be JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function createNotesHandler(getClient: () => Anthropic): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (req.url !== '/api/interview-notes') return next();
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    try {
      const parsed = NotesRequestSchema.safeParse(await readJson(req));
      if (!parsed.success) {
        return send(res, 400, { error: parsed.error.issues.map((i) => i.message).join('; ') });
      }
      const notes = await generateInterviewNotes(getClient(), parsed.data);
      send(res, 200, { notes });
    } catch (err) {
      if (err instanceof NotesError) return send(res, err.status, { error: err.message });
      console.error('[interview-notes]', err);
      send(res, 500, { error: 'Unexpected error generating notes.' });
    }
  };
}

export function apiPlugin(opts: { anthropicApiKey?: string }): Plugin {
  let client: Anthropic | undefined;
  const getClient = () => {
    if (!opts.anthropicApiKey) {
      throw new NotesError(503, 'Notes generation is not configured: set ANTHROPIC_API_KEY in .env and restart the app.');
    }
    client ??= new Anthropic({ apiKey: opts.anthropicApiKey });
    return client;
  };
  const handler = createNotesHandler(getClient);
  return {
    name: 'sah-assessor-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
