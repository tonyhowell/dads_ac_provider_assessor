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
  /** As published, e.g. "1 Jul 2026 (schedule updated 22 Sep 2026)" or "Not captured". */
  prices_as_at: z.string(),
  /** Latest date in `prices_as_at`, used for the staleness warning. Null when no date is given. */
  prices_as_at_date: isoDate.nullable(),
  veteran_fit: z.string().nullable(),
  flags: z.array(z.string()),
  source_url: z.url().nullable(),
  registration_status: z.string().optional(),
  postcodes_served: z.array(z.string()).optional(),
});

/** Provider as written in the starter pack: no id, flags as one string, free-text "prices as at". */
export const ProviderSeedSchema = ProviderSchema.omit({ id: true, flags: true, prices_as_at_date: true, source_url: true }).extend({
  id: z.string().min(1).optional(),
  flags: z.union([z.array(z.string()), z.string()]).nullable(),
  source_url: z.union([z.url(), z.literal('')]).nullable(),
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
  annual: z.number().positive().optional(),
  for_services: z.number().positive().optional(),
});

export const PensionStatusSchema = z.enum([
  'full_pensioner',
  'part_pensioner',
  'self_funded',
  'nwop_full_pensioner',
  'nwop_self_funded',
]);

export const ContributionRateSchema = z.object({
  /** Label from the starter pack, e.g. "Part pensioner / CSHC holder". */
  status: z.string(),
  key: PensionStatusSchema,
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
      note: z.string().nullable().optional(),
      /** "What I'm looking for" (v3): one answer or several, from set options. Without options: Yes / No / Not sure. */
      type: z.enum(['single', 'multi']).optional(),
      options: z
        .array(
          z.object({
            value: z.string(),
            label: z.string(),
            /** Choosing this answer makes the question "not relevant" for the interview sections it informs. */
            rules_out: z.boolean().optional(),
          }),
        )
        .optional(),
      /** Most options that can be chosen (multi only). */
      max: z.number().int().positive().optional(),
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
  /** Assessed rates from the contribution letter (part pensioners, no-worse-off). Null until entered. */
  ind_rate: z.number().min(0).max(1).nullable(),
  ev_rate: z.number().min(0).max(1).nullable(),
  dva_card: z.enum(['gold', 'white', 'none']),
  nwop: z.boolean(),
  /** Answered "I'm not sure" to the no-worse-off question; costed as not no-worse-off. */
  nwop_unsure: z.boolean().optional(),
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

/** Answer to a bounding question (SPEC §4 BoundingAnswer). "Not relevant" rules out the sections it informs. */
export const BoundingAnswerSchema = z.object({
  /** The chosen option for a single-answer question ("" = unanswered). */
  answer: z.string().max(5000),
  /** The chosen options for a multiple-answer question. */
  choices: z.array(z.string().max(200)).max(30).optional(),
  notes: z.string().max(5000).optional(),
  not_relevant: z.boolean(),
});

/** A question the family adds to an interview section. Treated as "should". */
export const CustomQuestionSchema = z.object({
  id: z.string().min(1).max(100),
  section: z.string().min(1).max(10),
  text: z.string().trim().min(1).max(2000),
});

/** A provider's answer to one interview question (SPEC §4 InterviewResponse). */
export const InterviewResponseSchema = z.object({
  text: z.string().max(20_000),
  /** "Answered well?" */
  rating: z.enum(['yes', 'partly', 'no']).nullable(),
  /** "Got it in writing" — SPEC §7: must questions need a written answer. */
  in_writing: z.boolean(),
});

/** A note left on a screen for the rest of the family (UI-SPEC §5.9). Shown until marked done. */
export const ScreenNoteSchema = z.object({
  id: z.string().min(1).max(100),
  route: z.string().max(200),
  text: z.string().trim().min(1).max(5000),
  author: z.string().max(100).optional(),
  created_at: z.string(),
  done: z.boolean(),
});

// --- Help content (UI-SPEC §5.8) ---

export const HelpTopicSchema = z.object({
  id: z.string(),
  screen_route: z.string(),
  title: z.string(),
  purpose: z.string(),
  steps: z.array(z.string()),
  outcome: z.string(),
  faqs: z.array(z.object({ q: z.string(), a: z.string() })),
  troubleshooting: z.array(z.object({ symptom: z.string(), cause: z.string(), fix: z.string(), action_route: z.string().optional() })),
  glossary_ids: z.array(z.string()),
});

export const GlossaryTermSchema = z.object({
  id: z.string(),
  term: z.string(),
  plain: z.string(),
  example: z.string().optional(),
  more_topic_id: z.string().optional(),
  source_url: z.url().optional(),
});

export const FieldHelpSchema = z.object({
  field_id: z.string(),
  label: z.string(),
  hint: z.string(),
  explain: z.string().optional(),
  /** Uses {placeholders} filled from the user's own numbers. */
  example_template: z.string().optional(),
});

export const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  hours: z.string(),
  url: z.url(),
  purpose: z.string(),
  /** Date a person confirmed the number. Null = not yet confirmed (must be before public release). */
  verified_on: z.string().nullable(),
});

export const HelpDataSchema = z.object({
  topics: z.array(HelpTopicSchema),
  glossary: z.array(GlossaryTermSchema),
  fields: z.array(FieldHelpSchema),
  contacts: z.array(ContactSchema),
});

/**
 * Special hourly rates a provider has offered this applicant (v2). Costed only in this application;
 * the common catalogue is unchanged. A missing key means the catalogue price applies.
 */
export const SpecialRateSchema = z.object({
  rates: z.partialRecord(RateKeySchema, z.number().nonnegative().max(10_000)),
  note: z.string().max(2000),
  recorded_at: z.string().max(40),
  author: z.string().max(80).optional(),
});

/** Communication needs, accepted DVA conditions and DVA services offered as set answers (v3). */
export const COMMUNICATION_NEEDS = [
  ['hearing', 'Hearing loss — speak clearly, face me'],
  ['vision', 'Low vision — large print'],
  ['speech', 'Speech difficulty'],
  ['memory', 'Memory — please write things down'],
  ['interpreter', 'I need an interpreter'],
  ['phone_first', 'Please phone before visiting'],
] as const;
export const DVA_CONDITIONS = [
  ['ptsd', 'PTSD'],
  ['mental_health', 'Depression or anxiety'],
  ['hearing', 'Hearing loss or tinnitus'],
  ['musculoskeletal', 'Back, joints or other injuries'],
  ['heart', 'Heart or circulation'],
  ['respiratory', 'Breathing or lungs'],
] as const;
export const DVA_SERVICES = [
  ['vhc_domestic', "Veterans' Home Care — domestic help"],
  ['vhc_personal', "Veterans' Home Care — personal care"],
  ['vhc_respite', "Veterans' Home Care — respite"],
  ['vhc_garden', "Veterans' Home Care — home and garden"],
  ['nursing', 'DVA community nursing'],
  ['open_arms', 'Open Arms counselling'],
  ['rap', 'Aids and equipment (RAP)'],
  ['transport', 'DVA transport to appointments'],
  ['cvc', "Coordinated Veterans' Care"],
] as const;

const short = z.string().max(200);
const long = z.string().max(5000);

/**
 * What providers should know about the applicant (v3). Shared in the dossier only for sections the
 * family ticks when printing. No DVA file or card numbers are collected.
 */
export const ApplicantProfileSchema = z.object({
  preferred_name: short,
  contact_name: short,
  contact_relationship: short,
  contact_phone: z.string().max(40),
  contact_email: z.string().max(200),
  communication: z.array(short).max(20),
  communication_other: long,
  languages: short,
  dva_conditions: z.array(short).max(30),
  dva_conditions_other: long,
  dva_services: z.array(short).max(30),
  dva_services_detail: long,
  current_supports: long,
  anything_else: long,
});

/** Claude's draft of what the applicant is looking for, which the family can edit. */
export const LookingForSummarySchema = z.object({
  summary: z.string().max(4000),
  priorities: z.array(z.string().max(500)).max(10),
  must_haves: z.array(z.string().max(500)).max(10),
  deal_breakers: z.array(z.string().max(500)).max(10),
});
export const StoredSummarySchema = LookingForSummarySchema.extend({
  generated_at: z.string().max(40).nullable(),
  edited: z.boolean(),
});

export const DOSSIER_SECTIONS = ['profile', 'dva', 'plan', 'looking_for', 'answers', 'questions', 'claims', 'money'] as const;
export const DossierSectionSchema = z.enum(DOSSIER_SECTIONS);

/** One public claim a provider makes about an interview topic, with where it was found (v3). */
export const ClaimItemSchema = z.object({
  question_id: z.string().max(20),
  status: z.enum(['stated', 'partly']),
  claim: z.string().max(1000),
  quote: z.string().max(1000),
  source_url: z.string().max(2000),
  source_title: z.string().max(300),
});
export const ClaimsSchema = z.object({
  website: z.string().max(2000).nullable(),
  overview: z.string().max(2000),
  items: z.array(ClaimItemSchema).max(200),
});

