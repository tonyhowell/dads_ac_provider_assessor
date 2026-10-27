// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { apiMessage, resetFallbacks, withFallbacks } from './fallbacks.ts';
import { researchClaims } from './claims.ts';
import { NotesError } from './interviewNotes.ts';
import { loadSeedData } from '../src/data/load.ts';

const bad = (message: string) => new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message } }, message, new Headers());
const bolton = loadSeedData().providers.find((p) => p.id === 'bolton-clarke')!;

beforeEach(() => {
  resetFallbacks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('server-side fallbacks', () => {
  it("retries without them when the account can't use the beta, and stops asking", async () => {
    const seen: unknown[] = [];
    const call = async (extra: object) => {
      seen.push(extra);
      if ('fallbacks' in extra) throw bad('anthropic-beta: server-side-fallback-2026-07-01 is not available for your organization');
      return 'ok';
    };
    expect(await withFallbacks(call)).toBe('ok');
    expect(await withFallbacks(call)).toBe('ok');
    expect(seen).toEqual([{ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, {}, {}]);
  });

  it('passes on other 400s untouched', async () => {
    const call = vi.fn(async () => {
      throw bad('messages: text content blocks must be non-empty');
    });
    await expect(withFallbacks(call)).rejects.toThrow(/non-empty/);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("shows the API's own reason when public-claims research fails", async () => {
    const stream = vi.fn(() => ({
      finalMessage: async () => {
        throw bad('tools.0.max_uses: must be at most 5');
      },
    }));
    const client = { beta: { messages: { stream } } } as unknown as Anthropic;
    const err = await researchClaims(client, bolton, [{ id: 'E1', text: 'Veterans?' }]).catch((e) => e);
    expect(err).toBeInstanceOf(NotesError);
    expect(err.message).toBe('Claude returned an error (400): tools.0.max_uses: must be at most 5');
    expect(apiMessage(bad('x'))).toBe('x');
  });

  it('researches without fallbacks when the beta is rejected', async () => {
    const stream = vi.fn((params: { fallbacks?: string }) => ({
      finalMessage: async () => {
        if (params.fallbacks) throw bad('Unexpected value for anthropic-beta header');
        return { stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: 'notes' }] };
      },
    }));
    const parse = vi.fn(async () => ({ stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: { website: null, overview: 'o', items: [] } }));
    const client = { beta: { messages: { stream, parse } } } as unknown as Anthropic;
    expect(await researchClaims(client, bolton, [{ id: 'E1', text: 'Veterans?' }])).toMatchObject({ overview: 'o' });
    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[1][0]).not.toHaveProperty('betas');
  });
});
