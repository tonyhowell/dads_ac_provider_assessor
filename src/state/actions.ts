import { z } from 'zod';
import {
  BoundingAnswerSchema,
  CustomQuestionSchema,
  InterviewNotesSchema,
  InterviewSchema,
  ParticipantSchema,
  PlanItemSchema,
  ProviderNoteSchema,
  ProviderSchema,
  SelectionStageSchema,
} from '../schemas';
import { CRITERION_IDS } from '../scoring';

// Every change to shared state is one of these actions. The browser applies it optimistically;
// the server validates it with this schema and applies the same reducer to the stored state.

const id = z.string().min(1).max(100);
const at = z.string().max(40);
const text = z.string().max(20_000);

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('note/add'), note: ProviderNoteSchema.extend({ text: text.min(1) }) }),
  z.object({ type: z.literal('note/edit'), id, text: text.min(1), at }),
  z.object({ type: z.literal('note/delete'), id }),
  z.object({ type: z.literal('selection/add'), providerId: id, at }),
  z.object({ type: z.literal('selection/remove'), providerId: id }),
  z.object({ type: z.literal('selection/stage'), providerId: id, stage: SelectionStageSchema, at }),
  z.object({ type: z.literal('selection/move'), providerId: id, toIndex: z.number().int().min(0).max(10_000) }),
  z.object({ type: z.literal('selection/update'), providerId: id, why: text.optional(), watch: text.optional() }),
  z.object({ type: z.literal('interview/save'), interview: InterviewSchema.extend({ transcript: z.string().max(400_000) }) }),
  z.object({ type: z.literal('interview/notes'), id, notes: InterviewNotesSchema, at }),
  z.object({ type: z.literal('interview/delete'), id }),
  z.object({ type: z.literal('participant/set'), participant: ParticipantSchema }),
  z.object({ type: z.literal('plan/set'), plan: z.array(PlanItemSchema).max(50).nullable() }),
  z.object({ type: z.literal('settings/serviceDate'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }),
  z.object({ type: z.literal('provider/upsert'), provider: ProviderSchema }),
  z.object({ type: z.literal('provider/import'), providers: z.array(ProviderSchema).max(500) }),
  z.object({ type: z.literal('provider/revert'), id }),
  z.object({ type: z.literal('bounding/answer'), questionId: id, answer: BoundingAnswerSchema }),
  z.object({ type: z.literal('question/add'), question: CustomQuestionSchema }),
  z.object({ type: z.literal('question/delete'), id }),
  z.object({ type: z.literal('response/set'), providerId: id, questionId: id, text: text.optional(), satisfactory: z.boolean().nullable().optional() }),
  z.object({ type: z.literal('score/set'), providerId: id, criterion: z.enum(CRITERION_IDS), score: z.number().int().min(1).max(5).nullable() }),
  z.object({ type: z.literal('weight/set'), criterion: z.enum(CRITERION_IDS), weight: z.number().min(0).max(10) }),
  z.object({ type: z.literal('decision/set'), text }),
]);

export type Action = z.infer<typeof ActionSchema>;
