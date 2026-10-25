import type { z } from 'zod';
import type {
  BenchmarkSchema,
  BoundingGroupSchema,
  CategorySchema,
  ContributionRateSchema,
  InterviewNotesSchema,
  InterviewSchema,
  InterviewSectionSchema,
  ParticipantSchema,
  PensionStatusSchema,
  PlanItemSchema,
  ProviderNoteSchema,
  ProviderSchema,
  RateKeySchema,
  ShortlistEntrySchema,
  ShortlistSeedSchema,
} from './schemas';

export type RateKey = z.infer<typeof RateKeySchema>;
export type Provider = z.infer<typeof ProviderSchema>;
export type Benchmark = z.infer<typeof BenchmarkSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type PlanItem = z.infer<typeof PlanItemSchema>;
export type PensionStatus = z.infer<typeof PensionStatusSchema>;
export type ContributionRate = z.infer<typeof ContributionRateSchema>;
export type ShortlistSeed = z.infer<typeof ShortlistSeedSchema>;
export type BoundingGroup = z.infer<typeof BoundingGroupSchema>;
export type InterviewSection = z.infer<typeof InterviewSectionSchema>;
export type Participant = z.infer<typeof ParticipantSchema>;

export type ProviderNote = z.infer<typeof ProviderNoteSchema>;
export type ShortlistEntry = z.infer<typeof ShortlistEntrySchema>;
export type InterviewNotes = z.infer<typeof InterviewNotesSchema>;
export type Interview = z.infer<typeof InterviewSchema>;

/** SPEC §4 Budget, with derived fields. */
export interface Budget {
  classification: string;
  quarterly: number;
  annual: number;
  for_services: number;
}
