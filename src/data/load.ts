import { z } from 'zod';
import providersJson from '../../data/providers.json';
import benchmarkJson from '../../data/benchmark.json';
import budgetsJson from '../../data/budgets.json';
import contributionsJson from '../../data/contributions.json';
import samplePlanJson from '../../data/sample_plan.json';
import shortlistJson from '../../data/shortlist.json';
import boundingJson from '../../data/bounding_questions.json';
import interviewJson from '../../data/interview_questions.json';
import {
  BenchmarkSchema,
  BoundingGroupSchema,
  BudgetSeedSchema,
  ContributionRateSchema,
  InterviewSectionSchema,
  PlanItemSchema,
  ProviderSchema,
  RATE_KEYS,
  ShortlistSeedSchema,
} from '../schemas';
import { ruleAt } from '../rules';
import type {
  Benchmark,
  BoundingGroup,
  Budget,
  ContributionRate,
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

export function deriveBudget(classification: string, quarterly: number, onDate: string | Date = new Date()): Budget {
  const careMgmt = ruleAt('careManagementShare', onDate);
  return { classification, quarterly, annual: quarterly * 4, for_services: quarterly * (1 - careMgmt) };
}

/** Validates raw seed objects. Exposed separately so tests can feed in bad data. */
export function parseSeedData(raw: Record<string, unknown>): SeedData {
  const providers = parse('providers.json', z.array(ProviderSchema), raw.providers);
  const ids = new Set<string>();
  for (const p of providers) {
    if (ids.has(p.id)) throw new SeedDataError('providers.json', [`duplicate id "${p.id}"`]);
    ids.add(p.id);
  }
  return {
    providers,
    benchmark: parse('benchmark.json', BenchmarkSchema, raw.benchmark),
    budgets: parse('budgets.json', z.array(BudgetSeedSchema), raw.budgets).map((b) =>
      deriveBudget(b.classification, b.quarterly),
    ),
    contributions: parse('contributions.json', z.array(ContributionRateSchema), raw.contributions),
    samplePlan: parse('sample_plan.json', z.array(PlanItemSchema), raw.samplePlan),
    shortlist: parse('shortlist.json', z.array(ShortlistSeedSchema), raw.shortlist),
    boundingGroups: parse('bounding_questions.json', z.array(BoundingGroupSchema), raw.boundingGroups),
    interviewSections: parse('interview_questions.json', z.array(InterviewSectionSchema), raw.interviewSections),
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
  });
}

/** True when no provider has any published rate — i.e. the placeholder seed is still in use. */
export function pricesMissing(providers: Provider[]): boolean {
  return providers.every((p) => RATE_KEYS.every((k) => p[k] === null));
}
