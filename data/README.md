# Seed data

Starter-pack data, with prices captured 25 Oct 2026. Refresh them from My Aged Care before relying on them.

| File | Contents |
|---|---|
| `providers.json` | 7 providers servicing Wynnum 4178: weekday rates (`null` = not published), "prices as at", flags, source links |
| `benchmark.json` | IHACPA advised prices 2026-27 |
| `budgets.json` | Classifications 1–8 (effective 1 Oct 2026), plus transitioned HCP L1–L4 from SPEC §3.2 |
| `contributions.json` | Contribution rates by pension status |
| `sample_plan.json` | Sample weekly care plan |
| `shortlist.json` | Suggested interview shortlist with rationale |
| `bounding_questions.json` | 8 groups, 29 bounding questions |
| `interview_questions.json` | Sections A–Q, 74 interview questions (11 "must") |

The loader (`src/data/load.ts`) accepts the files as written and normalises them:
- **Providers:** ids are derived from the names, and the flags text is split on semicolons. "Prices as at" stays as published; the latest date in it drives the 60-day staleness warning, and no date counts as stale.
- **Benchmark:** may be a one-item list.
- **Labels:** contribution statuses and plan categories are matched by their labels.

No-worse-off contribution bands are program rules, so they live in `src/rules.ts`, not here. Files are validated at startup; a bad value names the file and field.
