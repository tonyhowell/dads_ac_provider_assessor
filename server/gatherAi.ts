import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { NotesError } from './interviewNotes.ts';
import { apiMessage } from './fallbacks.ts';
import { pdfToText } from './pages.ts';
import { EXTRACT_MODEL, UsageTally } from './usage.ts';
import { RATE_KEYS } from '../src/schemas.ts';
import type { BoundingGroup } from '../src/types.ts';

// Gather (improvement plan, package 1): Claude Haiku reads a support plan, or a family conversation, and
// suggests what to fill in. Nothing here is saved: the family confirms every item in the browser first.
// Uploaded files go only to Claude and are not stored.

const REQUEST = { timeout: 5 * 60_000, maxRetries: 3 };

export const SupportPlanSchema = z.object({
  /** e.g. "Support plan", "Notice of Decision". */
  document_kind: z.string().max(100),
  /** Support at Home classification (level), "1" to "8", if stated. */
  classification: z.string().max(10).nullable(),
  services: z
    .array(
      z.object({
        /** As the document names it. */
        name: z.string().max(200),
        key: z.enum(RATE_KEYS).nullable(),
        /** Hours a week; null when the document doesn't say, or gives only visits. */
        hours_per_week: z.number().nonnegative().nullable(),
        /** How the document states frequency, e.g. "1.5 hrs x 2 per week". */
        frequency: z.string().max(200),
        start_date: z.string().max(40).nullable(),
      }),
    )
    .max(40),
  notes: z.array(z.string().max(300)).max(20),
});
export type SupportPlan = z.infer<typeof SupportPlanSchema>;

const PLAN_SYSTEM = `You read an Australian Support at Home document — a support plan, care plan or Notice of Decision — so a family can set up their weekly care plan. Extract:
- the Support at Home classification (level 1–8), if stated;
- each service with its weekly hours. Convert frequencies to hours a week (e.g. "1 hour, 3 times a week" = 3; "2 hours a fortnight" = 1). If only visits are given with no length, leave hours null.
- which standard service each one is: rn (registered nurse), en (enrolled nurse), pc (personal care), domestic (cleaning and household tasks), social (individual social support), respite (in-home respite), gardening (gardening or home maintenance); null for anything else (equipment, meals, transport, allied health).
Copy names and frequencies as written. Never guess a number that isn't in the document. Put anything the family should check (e.g. unclear hours, temporary services) in notes.`;

export interface UploadedFile {
  name: string;
  mime: string;
  /** Base64. */
  data: string;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

function apiError(err: unknown): never {
  if (err instanceof NotesError) throw err;
  if (err instanceof Anthropic.AuthenticationError) throw new NotesError(503, 'Claude features are not configured: check ANTHROPIC_API_KEY on the server.');
  if (err instanceof Anthropic.RateLimitError) throw new NotesError(429, 'Claude is busy. Try again in a minute.');
  if (err instanceof Anthropic.APIConnectionError) throw new NotesError(502, 'Could not reach Claude. Try again.');
  if (err instanceof Anthropic.APIError) {
    console.error('[claude]', err.status, apiMessage(err));
    throw new NotesError(502, `Claude returned an error (${err.status ?? 'unknown'}): ${apiMessage(err)}`);
  }
  throw err;
}

/** The document as Claude should see it: a PDF's text when it has one (faster, cheaper), else the file itself. */
async function fileBlocks(file: UploadedFile): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const buf = Buffer.from(file.data, 'base64');
  if (file.mime === 'application/pdf' || buf.subarray(0, 5).toString() === '%PDF-') {
    const pdf = await pdfToText(buf);
    if (pdf) return [{ type: 'text', text: `<document name="${file.name}" pages="${pdf.pages}">\n${pdf.text.slice(0, 300_000)}\n</document>` }];
    return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } }];
  }
  const mime = IMAGE_TYPES.find((t) => t === file.mime);
  if (mime) return [{ type: 'image', source: { type: 'base64', media_type: mime, data: file.data } }];
  throw new NotesError(400, 'Upload a PDF or a photo (JPEG, PNG or WebP).');
}

export async function readSupportPlan(client: Anthropic, file: UploadedFile, usage = new UsageTally()): Promise<SupportPlan> {
  const blocks = await fileBlocks(file);
  let result;
  try {
    result = await client.beta.messages.parse(
      {
        model: EXTRACT_MODEL,
        max_tokens: 8000,
        output_config: { effort: 'low', format: betaZodOutputFormat(SupportPlanSchema) },
        system: PLAN_SYSTEM,
        messages: [{ role: 'user', content: [...blocks, { type: 'text', text: 'Read this document and extract the care plan.' }] }],
      },
      REQUEST,
    );
  } catch (err) {
    apiError(err);
  }
  usage.add(EXTRACT_MODEL, result.usage);
  if (result.stop_reason === 'refusal') throw new NotesError(422, 'Claude declined to read this document.');
  if (!result.parsed_output) throw new NotesError(502, "The document couldn't be read. Try a clearer copy.");
  return result.parsed_output;
}

// ---- Family conversation → suggested answers ----

export const SuggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        question_id: z.string().max(20),
        /** Option values chosen (for single-answer questions, one). */
        choices: z.array(z.string().max(100)).max(10),
        /** Extra detail in the family's words, for the "add more detail" box. */
        detail: z.string().max(1000),
        /** The words from the conversation this comes from. */
        quote: z.string().max(500),
      }),
    )
    .max(60),
});
export type Suggestion = z.infer<typeof SuggestionsSchema>['suggestions'][number];

const CONVERSATION_SYSTEM = `You listen to an Australian family's conversation about the care their relative needs, and suggest answers to a questionnaire. For each question the conversation actually answers, pick the option values that fit, add any useful detail in the family's own words, and quote the words it came from. Skip questions the conversation doesn't answer. Never guess. The transcript comes from speech recognition, so expect misheard words.`;

export async function suggestAnswers(client: Anthropic, transcript: string, groups: BoundingGroup[], usage = new UsageTally()): Promise<Suggestion[]> {
  const questions = groups.flatMap((g) => g.questions);
  const listing = questions
    .map((q) => `${q.id} (${q.type === 'multi' ? `choose up to ${q.max ?? 'several'}` : 'choose one'}): ${q.text}\n  options: ${(q.options ?? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unsure', label: 'Not sure' }]).map((o) => `${o.value} = ${o.label}`).join('; ')}`)
    .join('\n');
  let result;
  try {
    result = await client.beta.messages.parse(
      {
        model: EXTRACT_MODEL,
        max_tokens: 8000,
        output_config: { effort: 'low', format: betaZodOutputFormat(SuggestionsSchema) },
        system: CONVERSATION_SYSTEM,
        messages: [{ role: 'user', content: `Questions:\n${listing}\n\n<transcript>\n${transcript.slice(0, 200_000)}\n</transcript>` }],
      },
      REQUEST,
    );
  } catch (err) {
    apiError(err);
  }
  usage.add(EXTRACT_MODEL, result.usage);
  if (result.stop_reason === 'refusal') throw new NotesError(422, 'Claude declined to read this conversation.');
  if (!result.parsed_output) throw new NotesError(502, 'The conversation could not be turned into answers. Try again.');
  // Keep only real questions and real options, within each question's limit.
  const byId = new Map(questions.map((q) => [q.id, q]));
  return result.parsed_output.suggestions.flatMap((s) => {
    const q = byId.get(s.question_id);
    if (!q) return [];
    const values = new Set((q.options ?? [{ value: 'yes' }, { value: 'no' }, { value: 'unsure' }]).map((o) => o.value));
    const choices = s.choices.filter((c) => values.has(c)).slice(0, q.type === 'multi' ? (q.max ?? 10) : 1);
    return choices.length || s.detail.trim() ? [{ ...s, choices }] : [];
  });
}

// Interview (improvement plan 3.3): during a recorded interview, Claude Haiku checks the transcript so far
// against the question checklist about once a minute, and says which questions have been answered — so the
// family can see what's still to ask before the interview ends. Nothing is saved.

export const GapCheckSchema = z.object({
  answered: z.array(
    z.object({
      question_id: z.string(),
      /** "yes" fully answered; "partly" touched on but not settled. */
      level: z.enum(['yes', 'partly']),
      /** The provider's answer, in a few words. */
      answer: z.string().max(300),
    }),
  ),
});
export type GapAnswer = z.infer<typeof GapCheckSchema>['answered'][number];

const GAP_SYSTEM = `You help an Australian family during an interview with a home care provider. Given the transcript so far and their question checklist, list only the questions the provider has actually answered, with "yes" when fully answered or "partly" when touched on but not settled, and the answer in a few words. Skip questions not yet discussed. Never guess. The transcript comes from speech recognition, so expect misheard words.`;

export async function checkGaps(client: Anthropic, transcript: string, questions: { id: string; text: string }[], usage = new UsageTally()): Promise<GapAnswer[]> {
  const listing = questions.map((q) => `${q.id}: ${q.text}`).join('\n');
  let result;
  try {
    result = await client.beta.messages.parse(
      {
        model: EXTRACT_MODEL,
        max_tokens: 4000,
        output_config: { effort: 'low', format: betaZodOutputFormat(GapCheckSchema) },
        system: GAP_SYSTEM,
        messages: [{ role: 'user', content: `Checklist:\n${listing}\n\n<transcript>\n${transcript.slice(-150_000)}\n</transcript>` }],
      },
      { timeout: 60_000, maxRetries: 1 },
    );
  } catch (err) {
    apiError(err);
  }
  usage.add(EXTRACT_MODEL, result.usage);
  if (!result.parsed_output) return [];
  const ids = new Set(questions.map((q) => q.id));
  const seen = new Set<string>();
  return result.parsed_output.answered.filter((a) => ids.has(a.question_id) && !seen.has(a.question_id) && seen.add(a.question_id));
}
