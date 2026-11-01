// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { askAboutProvider, checkCompliance } from './insights.ts';
import { loadSeedData } from '../src/data/load.ts';

const bolton = loadSeedData().providers.find((p) => p.id === 'bolton-clarke')!;
const usage = { input_tokens: 1, output_tokens: 1 };

function fake(content: unknown[], parsed?: unknown) {
  const stream = vi.fn((_p: unknown) => ({ finalMessage: async () => ({ stop_reason: 'end_turn', usage, content }) }));
  const parse = vi.fn(async (_p: unknown) => ({ stop_reason: 'end_turn', usage, parsed_output: parsed }));
  return { stream, parse, client: { beta: { messages: { stream, parse } } } as unknown as Anthropic };
}

describe('quality and compliance', () => {
  it("searches only the Commission's site and keeps findings with retrieved links", async () => {
    const page = 'https://www.agedcarequality.gov.au/sector/compliance/notice-123';
    const f = fake([{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: page, title: 'Notice' }] }, { type: 'text', text: 'A notice of non-compliance in 2025.' }], {
      summary: 'One notice of non-compliance in 2025.',
      none_found: false,
      findings: [
        { kind: 'non_compliance', date: 'March 2025', text: 'Notice about care planning', source_url: page, source_title: 'Notice' },
        { kind: 'sanction', date: null, text: 'Invented', source_url: 'https://elsewhere.example/x', source_title: 'x' },
      ],
    });
    const out = await checkCompliance(f.client, bolton);
    expect(out.findings.map((x) => x.kind)).toEqual(['non_compliance']);
    expect(out.checked_pages).toBe(1);
    const sent = f.stream.mock.calls[0][0] as { model: string; tools: { allowed_domains?: string[] }[] };
    expect(sent.model).toBe('claude-sonnet-5-5');
    expect(sent.tools.map((t) => t.allowed_domains)).toEqual([['agedcarequality.gov.au'], ['agedcarequality.gov.au']]);
    expect((f.parse.mock.calls[0][0] as { model: string }).model).toBe('claude-haiku-5-5');
  });
});

describe('ask Claude about a provider', () => {
  it('answers from a web search, citing its sources', async () => {
    const f = fake([
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://bc.example/weekends', title: 'Weekend care' }] },
      { type: 'text', text: 'Yes, weekend visits are available at a higher rate.', citations: [{ type: 'web_search_result_location', url: 'https://bc.example/weekends', title: 'Weekend care', cited_text: 'x' }] },
    ]);
    const out = await askAboutProvider(f.client, bolton, 'Do they offer weekend visits?');
    expect(out).toEqual({ answer: 'Yes, weekend visits are available at a higher rate.', sources: [{ url: 'https://bc.example/weekends', title: 'Weekend care' }] });
    const sent = f.stream.mock.calls[0][0] as { tools: { allowed_domains?: string[] }[]; messages: { content: string }[] };
    expect(sent.tools[0].allowed_domains).toBeUndefined();
    expect(sent.messages[0].content).toContain('Question: Do they offer weekend visits?');
  });

  it('says plainly when nothing was found', async () => {
    const f = fake([]);
    expect((await askAboutProvider(f.client, bolton, 'Do they have a pool?')).answer).toMatch(/couldn't find an answer/);
  });
});
