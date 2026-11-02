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
  /** Select, prep & interview (v11). The server sets userId, name, at and by from the signed-in person. */
  z.object({ type: z.literal('select/vote'), userId: z.string().max(100), name: z.string().max(200), picks: z.array(id).max(3), at }),
  z.object({
    type: z.literal('select/booking'),
    providerId: id,
    booking: z
      .object({
        date: z.string().max(20),
        time: z.string().max(20),
        mode: z.enum(['in_person', 'phone', 'video']),
        place: z.string().max(300),
        attendees: z.string().max(500),
        lead: z.string().max(200),
        sent: z.object({ questions: z.boolean(), dossier: z.boolean(), price_list_request: z.boolean() }),
      })
      .nullable(),
  }),
  z.object({ type: z.literal('select/score'), userId: z.string().max(100), name: z.string().max(200), providerId: id, criterion: z.enum(CRITERION_IDS), score: z.number().int().min(1).max(5).nullable() }),
  z.object({
    type: z.literal('select/decision'),
    provider_id: id.nullable().optional(),
    at: z.string().max(40).nullable().optional(),
    by: z.string().max(200).nullable().optional(),
    steps: z.object({ told_chosen: z.boolean(), agreement: z.boolean(), told_others: z.boolean(), start_date: z.boolean() }).partial().optional(),
    start_date: z.string().max(20).optional(),
  }),
  /** Find stage (v10). */
  z.object({ type: z.literal('find/target'), target: z.number().int().min(1).max(20) }),
  z.object({ type: z.literal('find/bringBack'), providerId: id, back: z.boolean() }),
  /** Providers found on My Aged Care for this family (added to the list, or replacing it). */
  z.object({ type: z.literal('find/macList'), providerIds: z.array(id).max(200), shareUrl: z.url().max(300).nullable().optional(), at: z.string().max(40), replace: z.boolean().optional() }),
  z.object({ type: z.literal('find/macRemove'), providerId: id }),
  /** One reaction per person: the server sets user_id, name and at. A null value removes it. */
  z.object({
    type: z.literal('find/react'),
    providerId: id,
    reaction: z.object({ user_id: z.string().max(100), name: z.string().max(200), value: z.enum(['up', 'down']).nullable(), comment: z.string().max(1000), at }),
  }),
  /** Gather stage (v9). */
  z.object({ type: z.literal('gather/applicant'), userId: id.nullable() }),
  z.object({ type: z.literal('gather/assign'), step: z.enum(['situation', 'money', 'plan', 'needs', 'matters', 'about', 'brief']), userId: id.nullable() }),
  z.object({ type: z.literal('gather/planSource'), source: z.enum(['support_plan', 'manual']).nullable() }),
  /** The server sets `at` and `by`. */
  z.object({ type: z.literal('gather/briefConfirm'), at, by: z.string().max(200) }),
  z.object({ type: z.literal('gather/briefComment'), comment: z.object({ id, author: z.string().max(200), text: text.min(1).max(4000), at }) }),
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
