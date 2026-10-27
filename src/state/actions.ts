import { z } from 'zod';
import {
  BoundingAnswerSchema,
  CustomQuestionSchema,
  InterviewNotesSchema,
  InterviewSchema,
  ParticipantSchema,
  PlanItemSchema,
  ProviderNoteSchema,
  ScreenNoteSchema,
  SelectionEntrySchema,
  SelectionStageSchema,
  SpecialRateSchema,
  ApplicantProfileSchema,
  StoredSummarySchema,
  DossierSectionSchema,
  RateKeySchema,
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
  /** The provider picked for one service; null clears the pick. */
  z.object({ type: z.literal('servicePick/set'), key: RateKeySchema, providerId: id.nullable() }),
  /** Undo of a drop: puts the entry back at its old position. */
  z.object({ type: z.literal('selection/restore'), entry: SelectionEntrySchema, index: z.number().int().min(0).max(10_000) }),
  z.object({ type: z.literal('selection/stage'), providerId: id, stage: SelectionStageSchema, at }),
  z.object({ type: z.literal('selection/move'), providerId: id, toIndex: z.number().int().min(0).max(10_000) }),
  z.object({ type: z.literal('selection/update'), providerId: id, why: text.optional(), watch: text.optional() }),
  z.object({ type: z.literal('interview/save'), interview: InterviewSchema.extend({ transcript: z.string().max(400_000) }) }),
  z.object({ type: z.literal('interview/notes'), id, notes: InterviewNotesSchema, at }),
  z.object({ type: z.literal('interview/delete'), id }),
  z.object({ type: z.literal('participant/set'), participant: ParticipantSchema }),
  z.object({ type: z.literal('plan/set'), plan: z.array(PlanItemSchema).max(50).nullable() }),
  z.object({ type: z.literal('settings/serviceDate'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }),
  z.object({ type: z.literal('specialRate/set'), providerId: id, rate: SpecialRateSchema }),
  z.object({ type: z.literal('specialRate/clear'), providerId: id }),
  z.object({ type: z.literal('profile/update'), patch: ApplicantProfileSchema.partial() }),
  z.object({ type: z.literal('lookingFor/set'), summary: StoredSummarySchema.nullable() }),
  z.object({ type: z.literal('dossier/sections'), sections: z.array(DossierSectionSchema).max(20) }),
  z.object({ type: z.literal('bounding/answer'), questionId: id, answer: BoundingAnswerSchema }),
  z.object({ type: z.literal('question/add'), question: CustomQuestionSchema }),
  z.object({ type: z.literal('question/delete'), id }),
  z.object({
    type: z.literal('response/set'),
    providerId: id,
    questionId: id,
    text: text.optional(),
    rating: z.enum(['yes', 'partly', 'no']).nullable().optional(),
    in_writing: z.boolean().optional(),
  }),
  z.object({ type: z.literal('screenNote/add'), note: ScreenNoteSchema }),
  z.object({ type: z.literal('screenNote/done'), id, done: z.boolean() }),
  z.object({ type: z.literal('screenNote/delete'), id }),
  z.object({ type: z.literal('score/set'), providerId: id, criterion: z.enum(CRITERION_IDS), score: z.number().int().min(1).max(5).nullable() }),
  z.object({ type: z.literal('weight/set'), criterion: z.enum(CRITERION_IDS), weight: z.number().min(0).max(10) }),
  z.object({ type: z.literal('decision/set'), text }),
]);

export type Action = z.infer<typeof ActionSchema>;
