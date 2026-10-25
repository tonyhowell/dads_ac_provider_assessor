import { z } from 'zod';
import providersJson from '../../data/providers.json';
import benchmarkJson from '../../data/benchmark.json';
import budgetsJson from '../../data/budgets.json';
import contributionsJson from '../../data/contributions.json';
import samplePlanJson from '../../data/sample_plan.json';
import shortlistJson from '../../data/shortlist.json';
import boundingJson from '../../data/bounding_questions.json';
import interviewJson from '../../data/interview_questions.json';
import helpJson from '../../data/help.json';
import {
  BenchmarkSchema,
  BoundingGroupSchema,
  BudgetSeedSchema,
  ContributionRateSchema,
  InterviewSectionSchema,
  PlanItemSchema,
  CategorySchema,
  HelpDataSchema,
  ProviderSeedSchema,
  RATE_KEYS,
  ShortlistSeedSchema,
} from '../schemas';
import { ruleAt } from '../rules';
import { categoryFromLabel, latestDateIn, slugify, statusFromLabel } from './normalise';
import type {
  Benchmark,
  BoundingGroup,
  Budget,
  ContributionRate,
  HelpData,
  InterviewSection,
  PlanItem,
  Provider,
  ShortlistSeed,
} from '../types';

export interface SeedData {
  providers: Provider[];
  benchmark: Benchmark;
  budgets: Budget[];
  contributions: ContributionRate[];
  samplePlan: PlanItem[];
  shortlist: ShortlistSeed[];
  boundingGroups: BoundingGroup[];
  interviewSections: InterviewSection[];
  help: HelpData;
}

export class SeedDataError extends Error {
  constructor(
    public file: string,
    public issues: string[],
  ) {
    super(`Invalid seed data in ${file}:\n${issues.join('\n')}`);
  }
}

function parse<T>(file: string, schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new SeedDataError(
      file,
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

/** Fills in annual and for-services amounts the data leaves out (published figures win, as they are rounded officially). */
export function deriveBudget(
  b: { classification: string; quarterly: number; annual?: number; for_services?: number },
  onDate: string | Date = new Date(),
): Budget {
  const careMgmt = ruleAt('careManagementShare', onDate);
  return {
    classification: b.classification,
    quarterly: b.quarterly,
    annual: b.annual ?? b.quarterly * 4,
    for_services: b.for_services ?? b.quarterly * (1 - careMgmt),
  };
}

const RawContributionSchema = ContributionRateSchema.omit({ key: true });
const RawPlanItemSchema = PlanItemSchema.extend({ category: z.string() });

/** Validates raw seed objects. Exposed separately so tests can feed in bad data. */
export function parseSeedData(raw: Record<string, unknown>): SeedData {
  const providers: Provider[] = parse('providers.json', z.array(ProviderSeedSchema), raw.providers).map((p) => ({
    ...p,
    id: p.id ?? slugify(p.provider),
    flags: (Array.isArray(p.flags) ? p.flags : (p.flags ?? '').split(';')).map((f) => f.trim()).filter(Boolean),
    prices_as_at_date: latestDateIn(p.prices_as_at),
    source_url: p.source_url || null,
  }));
  const ids = new Set<string>();
  for (const p of providers) {
    if (ids.has(p.id)) throw new SeedDataError('providers.json', [`duplicate id "${p.id}"`]);
    ids.add(p.id);
  }
  return {
    providers,
    // The starter pack ships the benchmark as a one-item list.
    benchmark: parse('benchmark.json', BenchmarkSchema, Array.isArray(raw.benchmark) ? raw.benchmark[0] : raw.benchmark),
    budgets: parse('budgets.json', z.array(BudgetSeedSchema), raw.budgets).map((b) => deriveBudget(b)),
    contributions: parse('contributions.json', z.array(RawContributionSchema), raw.contributions).map((c, i) => {
      const key = statusFromLabel(c.status);
      if (!key) throw new SeedDataError('contributions.json', [`${i}.status: unrecognised status "${c.status}"`]);
      return { ...c, key };
    }),
    samplePlan: parse('sample_plan.json', z.array(RawPlanItemSchema), raw.samplePlan).map((item, i) => {
      const category = categoryFromLabel(item.category);
      if (!category) throw new SeedDataError('sample_plan.json', [`${i}.category: unrecognised category "${item.category}"`]);
      return { ...item, category: CategorySchema.parse(category) };
    }),
    shortlist: parse('shortlist.json', z.array(ShortlistSeedSchema), raw.shortlist),
    boundingGroups: parse('bounding_questions.json', z.array(BoundingGroupSchema), raw.boundingGroups),
    interviewSections: parse('interview_questions.json', z.array(InterviewSectionSchema), raw.interviewSections),
    help: raw.help === undefined ? { topics: [], glossary: [], fields: [], contacts: [] } : parse('help.json', HelpDataSchema, raw.help),
  };
}

export function loadSeedData(): SeedData {
  return parseSeedData({
    providers: providersJson,
    benchmark: benchmarkJson,
    budgets: budgetsJson,
    contributions: contributionsJson,
    samplePlan: samplePlanJson,
    shortlist: shortlistJson,
    boundingGroups: boundingJson,
    interviewSections: interviewJson,
    help: helpJson,
  });
}

/** True when no provider has any published rate — i.e. the placeholder seed is still in use. */
export function pricesMissing(providers: Provider[]): boolean {
  return providers.length === 0 || providers.every((p) => RATE_KEYS.every((k) => p[k] === null));
}
