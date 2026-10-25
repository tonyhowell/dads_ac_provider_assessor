import type { z } from 'zod';
import type {
  BenchmarkSchema,
  BoundingAnswerSchema,
  CustomQuestionSchema,
  HelpDataSchema,
  InterviewResponseSchema,
  ScreenNoteSchema,
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
  SpecialRateSchema,
  ApplicantProfileSchema,
  StoredSummarySchema,
  DossierSectionSchema,
  ClaimsSchema,
  ClaimItemSchema,
  SelectionEntrySchema,
  SelectionStageSchema,
  ShortlistSeedSchema,
} from './schemas';

export type RateKey = z.infer<typeof RateKeySchema>;
export type Provider = z.infer<typeof ProviderSchema> & {
  /** Set in an application when special rates replace some catalogue prices (never stored in the catalogue). */
  special_rates?: RateKey[];
};
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
export type SelectionEntry = z.infer<typeof SelectionEntrySchema>;
export type SelectionStage = z.infer<typeof SelectionStageSchema>;
export type InterviewNotes = z.infer<typeof InterviewNotesSchema>;
export type Interview = z.infer<typeof InterviewSchema>;

/** SPEC §4 Budget, with derived fields. */
export interface Budget {
  classification: string;
  quarterly: number;
  annual: number;
  for_services: number;
}

export type BoundingAnswer = z.infer<typeof BoundingAnswerSchema>;
export type CustomQuestion = z.infer<typeof CustomQuestionSchema>;
export type InterviewResponse = z.infer<typeof InterviewResponseSchema>;
export type ScreenNote = z.infer<typeof ScreenNoteSchema>;

export type HelpData = z.infer<typeof HelpDataSchema>;
export type HelpTopic = HelpData['topics'][number];
export type GlossaryTerm = HelpData['glossary'][number];
export type SpecialRate = z.infer<typeof SpecialRateSchema>;
export type ApplicantProfile = z.infer<typeof ApplicantProfileSchema>;
export type StoredSummary = z.infer<typeof StoredSummarySchema>;
export type DossierSection = z.infer<typeof DossierSectionSchema>;
export type Claims = z.infer<typeof ClaimsSchema>;
export type ClaimItem = z.infer<typeof ClaimItemSchema>;
