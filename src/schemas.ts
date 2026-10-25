import { z } from 'zod';

// Zod schemas mirroring SPEC §4. Seed files and imports are validated against these,
// and `types.ts` derives the TypeScript types from them.

const rate = z.number().nonnegative().nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const RATE_KEYS = ['rn', 'en', 'pc', 'domestic', 'social', 'respite', 'gardening', 'care_mgmt'] as const;
export const RateKeySchema = z.enum(RATE_KEYS);

export const ProviderSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  type: z.string().nullable(),
  outlet: z.string().nullable(),
  rn: rate,
  en: rate,
  pc: rate,
  domestic: rate,
  social: rate,
  respite: rate,
  gardening: rate,
  care_mgmt: rate,
  prices_as_at: isoDate,
  veteran_fit: z.string().nullable(),
  flags: z.array(z.string()),
  source_url: z.url().nullable(),
  registration_status: z.string().optional(),
  postcodes_served: z.array(z.string()).optional(),
});

export const BenchmarkSchema = z.object({
  provider: z.string(),
  rn: rate,
  en: rate,
  pc: rate,
  domestic: rate,
  social: rate,
  respite: rate,
  gardening: rate,
  care_mgmt: rate,
});

export const CategorySchema = z.enum(['clinical', 'independence', 'everyday']);

export const PlanItemSchema = z.object({
  service: z.string(),
  key: RateKeySchema,
  hours_per_week: z.number().nonnegative(),
  category: CategorySchema,
});

export const BudgetSeedSchema = z.object({
  classification: z.string(),
  quarterly: z.number().positive(),
});

export const PensionStatusSchema = z.enum([
  'full_pensioner',
  'part_pensioner',
  'self_funded',
  'nwop_full_pensioner',
  'nwop_self_funded',
]);

export const ContributionRateSchema = z.object({
  status: PensionStatusSchema,
  clinical: z.number().min(0).max(1),
  ind_low: z.number().min(0).max(1),
  ind_high: z.number().min(0).max(1),
  ev_low: z.number().min(0).max(1),
  ev_high: z.number().min(0).max(1),
});

export const ShortlistSeedSchema = z.object({
  rank: z.number().int().positive(),
  provider: z.string(),
  why: z.string(),
  watch: z.string(),
});

export const BoundingGroupSchema = z.object({
  group: z.string(),
  questions: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      informs_sections: z.array(z.string()),
      note: z.string().optional(),
    }),
  ),
});

export const InterviewSectionSchema = z.object({
  code: z.string(),
  section: z.string(),
  questions: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      priority: z.enum(['must', 'should']),
    }),
  ),
});

export const ParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
  suburb: z.string(),
  postcode: z.string(),
  pension_status: PensionStatusSchema,
  ind_rate: z.number().min(0).max(1),
  ev_rate: z.number().min(0).max(1),
  dva_card: z.enum(['gold', 'white', 'none']),
  nwop: z.boolean(),
  classification: z.string(),
  lifetime_contributions_paid: z.number().nonnegative(),
});

// --- Assessment features (beyond SPEC §4) ---

export const ProviderNoteSchema = z.object({
  id: z.string(),
  provider_id: z.string(),
  text: z.string().min(1),
  created_at: z.string(),
  updated_at: z.string().optional(),
  source: z.enum(['manual', 'interview']),
  interview_id: z.string().optional(),
  /** Display name of the family member who wrote it. Set by the server. */
  author: z.string().optional(),
});

/** Provider selection runs in three stages: initial scan → refinement → interview shortlist. */
export const SELECTION_STAGES = ['scan', 'refine', 'interview'] as const;
export const SelectionStageSchema = z.enum(SELECTION_STAGES);

/** A provider the user has selected. Order within a stage is the rank. */
export const SelectionEntrySchema = z.object({
  provider_id: z.string(),
  stage: SelectionStageSchema,
  why: z.string(),
  watch: z.string(),
  added_at: z.string(),
  stage_changed_at: z.string(),
});

/** Structured notes generated from an interview transcript. */
export const InterviewNotesSchema = z.object({
  summary: z.string(),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  commitments: z.array(z.string()),
  pricing_mentions: z.array(z.string()),
  follow_up_questions: z.array(z.string()),
});

export const InterviewSchema = z.object({
  id: z.string(),
  provider_id: z.string(),
  started_at: z.string(),
  duration_seconds: z.number().nonnegative(),
  consent_confirmed: z.boolean(),
  interviewer: z.string(),
  /** Key of the recording in the recording device's own browser storage. Audio is never uploaded. */
  audio_id: z.string().nullable(),
  audio_mime: z.string().nullable(),
  transcript: z.string(),
  notes: InterviewNotesSchema.nullable(),
  notes_generated_at: z.string().nullable(),
});
