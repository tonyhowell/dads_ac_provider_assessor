// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { readSupportPlan, suggestAnswers } from './gatherAi.ts';
import { NotesError } from './interviewNotes.ts';
import { loadSeedData } from '../src/data/load.ts';

const seed = loadSeedData();
const fake = (parsed_output: unknown) => {
  const parse = vi.fn(async (_params: unknown) => ({ stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, parsed_output }));
  return { parse, client: { beta: { messages: { parse } } } as unknown as Anthropic };
};
const plan = { document_kind: 'Support plan', classification: '5', services: [], notes: [] };

describe('reading a support plan', () => {
  it('sends a PDF as its text (cheaper), with Claude Haiku at low effort', async () => {
    const { parse, client } = fake(plan);
    const pdf = readFileSync(new URL('./fixtures/price-list.pdf', import.meta.url)).toString('base64');
    expect(await readSupportPlan(client, { name: 'plan.pdf', mime: 'application/pdf', data: pdf })).toEqual(plan);
    const sent = parse.mock.calls[0][0] as { model: string; output_config: { effort: string }; messages: { content: { type: string; text?: string }[] }[] };
    expect(sent.model).toBe('claude-haiku-5-5');
    expect(sent.output_config.effort).toBe('low');
    expect(sent.messages[0].content[0]).toMatchObject({ type: 'text' });
    expect(sent.messages[0].content[0].text).toContain('Personal care $126.00 per hour');
  });

  it('sends a photo as an image, and refuses other file types', async () => {
    const { parse, client } = fake(plan);
    await readSupportPlan(client, { name: 'plan.jpg', mime: 'image/jpeg', data: Buffer.from('jpeg').toString('base64') });
    expect((parse.mock.calls[0][0] as { messages: { content: { type: string }[] }[] }).messages[0].content[0].type).toBe('image');
    await expect(readSupportPlan(client, { name: 'plan.docx', mime: 'application/msword', data: Buffer.from('doc').toString('base64') })).rejects.toBeInstanceOf(NotesError);
  });
});

describe('suggesting answers from a conversation', () => {
  it('keeps only real questions and options, within each question’s limit', async () => {
    const { parse, client } = fake({
      suggestions: [
        { question_id: 'B8.1', choices: ['continuity', 'veteran', 'local', 'price'], detail: '', quote: 'q' },
        { question_id: 'B8.3', choices: ['made-up'], detail: '', quote: 'q' },
        { question_id: 'B8.2', choices: [], detail: 'Church matters to him', quote: 'q' },
        { question_id: 'ZZ', choices: ['yes'], detail: '', quote: 'q' },
      ],
    });
    const groups = seed.boundingGroups.filter((g) => g.group === 'What matters most');
    const out = await suggestAnswers(client, 'a long enough transcript about Dad and what he needs from carers', groups);
    expect(out.map((s) => [s.question_id, s.choices])).toEqual([
      ['B8.1', ['continuity', 'veteran', 'local']],
      ['B8.2', []],
    ]);
    expect(JSON.stringify(parse.mock.calls[0][0])).toContain('B8.1 (choose up to 3)');
  });
});
