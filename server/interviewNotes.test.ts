// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { generateInterviewNotes, MODEL, NotesError } from './interviewNotes.ts';
import { createNotesHandler } from './vitePlugin.ts';

const notes = {
  summary: 'They have a veterans team.',
  strengths: ['Worker continuity promised'],
  concerns: [],
  commitments: ['Same two workers each week'],
  pricing_mentions: [],
  follow_up_questions: ['Ask for the written price list'],
};
const request = {
  provider_name: 'Example Care',
  interview_date: '25 Oct 2026',
  transcript: 'We have a dedicated veterans team and keep the same two workers each week.',
  questions: ['Do you charge travel fees?'],
};

function fakeClient(parse: ReturnType<typeof vi.fn>) {
  return { beta: { messages: { parse } } } as unknown as Anthropic;
}

describe('generateInterviewNotes', () => {
  it('sends the transcript with structured output, effort and refusal fallback', async () => {
    const parse = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', parsed_output: notes });
    await expect(generateInterviewNotes(fakeClient(parse), request)).resolves.toEqual(notes);

    const params = parse.mock.calls[0][0];
    expect(params.model).toBe(MODEL);
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.output_config.effort).toBe('medium');
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.thinking).toBeUndefined();
    const prompt = params.messages[0].content as string;
    expect(prompt).toContain('<transcript>\nWe have a dedicated veterans team');
    expect(prompt).toContain('- Do you charge travel fees?');
  });

  it('reports a refusal', async () => {
    const parse = vi.fn().mockResolvedValue({ stop_reason: 'refusal', parsed_output: null });
    await expect(generateInterviewNotes(fakeClient(parse), request)).rejects.toMatchObject({ status: 422 });
  });

  it('reports truncated output', async () => {
    const parse = vi.fn().mockResolvedValue({ stop_reason: 'max_tokens', parsed_output: null });
    await expect(generateInterviewNotes(fakeClient(parse), request)).rejects.toMatchObject({ status: 502 });
  });

  it('maps a bad API key to a configuration message', async () => {
    const parse = vi.fn().mockRejectedValue(new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key', new Headers()));
    const err = await generateInterviewNotes(fakeClient(parse), request).catch((e) => e);
    expect(err).toBeInstanceOf(NotesError);
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('maps rate limiting to 429', async () => {
    const parse = vi.fn().mockRejectedValue(new Anthropic.RateLimitError(429, {}, 'rate limited', new Headers()));
    await expect(generateInterviewNotes(fakeClient(parse), request)).rejects.toMatchObject({ status: 429 });
  });
});

describe('POST /api/interview-notes', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function start(parse: ReturnType<typeof vi.fn>) {
    const handler = createNotesHandler(() => fakeClient(parse));
    server = createServer((req, res) => handler(req, res, () => {
      res.statusCode = 404;
      res.end();
    }));
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it('returns notes for a valid request', async () => {
    const base = await start(vi.fn().mockResolvedValue({ stop_reason: 'end_turn', parsed_output: notes }));
    const res = await fetch(`${base}/api/interview-notes`, { method: 'POST', body: JSON.stringify(request) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notes });
  });

  it('rejects a too-short transcript without calling the API', async () => {
    const parse = vi.fn();
    const base = await start(parse);
    const res = await fetch(`${base}/api/interview-notes`, { method: 'POST', body: JSON.stringify({ ...request, transcript: 'hi' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too short/);
    expect(parse).not.toHaveBeenCalled();
  });

  it('rejects non-JSON bodies and other methods', async () => {
    const base = await start(vi.fn());
    expect((await fetch(`${base}/api/interview-notes`, { method: 'POST', body: 'nope' })).status).toBe(400);
    expect((await fetch(`${base}/api/interview-notes`)).status).toBe(405);
  });

  it('passes other paths through', async () => {
    const base = await start(vi.fn());
    expect((await fetch(`${base}/other`)).status).toBe(404);
  });
});
