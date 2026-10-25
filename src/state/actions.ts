import { z } from 'zod';
import { InterviewNotesSchema, InterviewSchema, ProviderNoteSchema, SelectionStageSchema } from '../schemas';

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
]);

export type Action = z.infer<typeof ActionSchema>;
