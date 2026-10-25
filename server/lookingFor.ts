import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { LookingForSummarySchema, COMMUNICATION_NEEDS, DVA_CONDITIONS, DVA_SERVICES } from '../src/schemas.ts';
import { answeredQuestions } from '../src/lookingFor.ts';
import type { AppState } from '../src/state/reducer.ts';
import type { SeedData } from '../src/data/load.ts';
import { MODEL, NotesError } from './interviewNotes.ts';

export type LookingForSummary = z.infer<typeof LookingForSummarySchema>;

const SYSTEM = `You help an older Australian, and their family, describe what they are looking for in a Support at Home (aged care) provider. You are given what they have recorded in an app: a short profile, DVA details if they are a veteran, their weekly care plan, and their answers to a "What I'm looking for in a provider" questionnaire (set answers plus their own words).

Write a summary they will check, edit, and give to providers before interviews:
- summary: one short paragraph, in the first person ("I'm looking for…"), that a provider could read in under a minute.
- priorities: what matters most, most important first.
- must_haves: things a provider has to offer or commit to.
- deal_breakers: things that would rule a provider out or end the relationship.
Use only what the input supports; never invent conditions, history or preferences. Leave a list empty rather than guessing. Use plain Australian English, short items (one sentence each), and no jargon. Don't include money, pension or contribution details.`;

const labels = (list: readonly (readonly [string, string])[], values: string[]) => values.map((v) => list.find(([k]) => k === v)?.[1] ?? v);

/** The applicant's recorded information, as text for the request. Money and contributions are left out. */
export function summaryInput(state: AppState, seed: SeedData): string {
  const p = state.profile;
  const parts: string[] = [];
  if (state.participant) {
    const card = { gold: 'DVA Gold Card', white: 'DVA White Card', none: 'No DVA card' }[state.participant.dva_card];
    parts.push(`Support at Home level: ${state.participant.classification}. ${card}. Lives in ${state.participant.suburb || 'an unstated suburb'}.`);
  }
  if (p) {
    const line = (label: string, v: string | string[]) => {
      const text = Array.isArray(v) ? v.join('; ') : v;
      if (text.trim()) parts.push(`${label}: ${text}`);
    };
    line('Preferred name', p.preferred_name);
    line('Languages', p.languages);
    line('Communication needs', labels(COMMUNICATION_NEEDS, p.communication));
    line('More about communication', p.communication_other);
    line('Accepted DVA conditions', [...labels(DVA_CONDITIONS, p.dva_conditions), p.dva_conditions_other].filter(Boolean));
    line('Current DVA services', [...labels(DVA_SERVICES, p.dva_services), p.dva_services_detail].filter(Boolean));
    line('Current supports', p.current_supports);
    line('Anything else', p.anything_else);
  }
  const plan = state.plan ?? seed.samplePlan;
  if (plan.length) parts.push(`Weekly care plan: ${plan.map((i) => `${i.service} ${i.hours_per_week} hr`).join('; ')}`);
  const answers = answeredQuestions(seed.boundingGroups, state.answers);
  if (answers.length) {
    parts.push(
      'Questionnaire answers:\n' +
        answers.map((a) => `- ${a.question} → ${a.answers.join(', ') || '(no set answer)'}${a.detail ? ` — in their words: "${a.detail}"` : ''}`).join('\n'),
    );
  }
  return parts.join('\n');
}

export async function generateLookingForSummary(client: Anthropic, input: string): Promise<LookingForSummary> {
  if (input.trim().length < 40) throw new NotesError(400, 'Answer a few questions first, so there is something to summarise.');
  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Re-run on Anthropic's recommended model if a safety classifier declines.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(LookingForSummarySchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `<recorded>\n${input}\n</recorded>` }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new NotesError(503, 'Drafting is not configured: check ANTHROPIC_API_KEY on the server.');
    if (err instanceof Anthropic.RateLimitError) throw new NotesError(429, 'The drafting service is busy. Wait a minute and try again.');
    if (err instanceof Anthropic.APIConnectionError) throw new NotesError(502, 'Could not reach the drafting service. Check your internet connection.');
    if (err instanceof Anthropic.APIError) throw new NotesError(502, `The drafting service returned an error (${err.status ?? 'unknown'}).`);
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new NotesError(422, 'The drafting service declined to write this summary.');
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) throw new NotesError(502, 'The summary came back incomplete. Try again.');
  return response.parsed_output;
}
