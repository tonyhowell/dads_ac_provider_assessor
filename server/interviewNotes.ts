import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { InterviewNotesSchema } from '../src/schemas.ts';
import { apiMessage, withFallbacks } from './fallbacks.ts';
import type { InterviewNotes } from '../src/types.ts';

export const MODEL = 'claude-opus-5-5';

export const NotesRequestSchema = z.object({
  provider_name: z.string().trim().min(1).max(200),
  interview_date: z.string().max(40),
  transcript: z.string().trim().min(20, 'Transcript is too short to summarise').max(400_000),
  questions: z.array(z.string().max(1000)).max(200).optional(),
});
export type NotesRequest = z.infer<typeof NotesRequestSchema>;

export class NotesError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const SYSTEM = `You write assessment notes for a family choosing an Australian Support at Home (aged care) provider. You are given the transcript of the family's interview with one provider. The transcript may come from automatic speech recognition, so expect misheard words and missing speaker labels.

Write notes the family can use to compare providers later:
- Record only what the transcript supports. If something was not discussed, leave it out; do not guess.
- Attribute claims to the provider ("They said…"), since nothing has been verified.
- Quote prices, fees, hours and minimum visit lengths exactly as stated. Under Support at Home, prices must be all-inclusive, so call out any mention of separate travel, administration, package-management or exit fees as a concern.
- Note any commitment the provider made (worker continuity, response times, veteran or PTSD experience, DVA coordination) so the family can hold them to it.
- Suggest follow-up questions for anything that was unclear, unanswered or evasive.
- Use Australian English and plain language. Keep each list item to one or two sentences.`;

function userPrompt(req: NotesRequest): string {
  const questions = req.questions?.length
    ? `\n\nThe family planned to ask these questions. Note in follow_up_questions any that the transcript shows were not answered:\n${req.questions.map((q) => `- ${q}`).join('\n')}`
    : '';
  return `Provider: ${req.provider_name}\nInterview date: ${req.interview_date}${questions}\n\n<transcript>\n${req.transcript}\n</transcript>`;
}

/** Generates structured interview notes. `client` is injected so tests can use a fake. */
export async function generateInterviewNotes(client: Anthropic, req: NotesRequest): Promise<InterviewNotes> {
  let response;
  try {
    response = await withFallbacks((extra) => client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Re-run on Anthropic's recommended model if a safety classifier declines (when the account has it).
      ...extra,
      output_config: { effort: 'medium', format: betaZodOutputFormat(InterviewNotesSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt(req) }],
    }));
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new NotesError(503, 'Notes generation is not configured: check ANTHROPIC_API_KEY in .env.');
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new NotesError(429, 'The notes service is busy. Wait a minute and try again.');
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new NotesError(502, 'Could not reach the notes service. Check your internet connection.');
    }
    if (err instanceof Anthropic.APIError) {
      console.error('[claude]', err.status, apiMessage(err));
      throw new NotesError(502, `Claude returned an error (${err.status ?? 'unknown'}): ${apiMessage(err)}`);
    }
    throw err;
  }

  if (response.stop_reason === 'refusal') {
    throw new NotesError(422, 'The notes service declined to summarise this transcript.');
  }
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
    throw new NotesError(502, 'The notes came back incomplete. Try again.');
  }
  return response.parsed_output;
}
