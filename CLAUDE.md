# CLAUDE.md — Support at Home Provider Assessor

Read `SPEC.md` first; it is the source of truth for features, rules and calculations.

## Stack (default — change if the user asks)
- Vite + React + TypeScript, Tailwind CSS, Recharts for charts.
- State persisted to `localStorage` (v1). Keep a storage interface so SQLite/Supabase can replace it.
- Vitest for unit tests.

## Data
- Seed data lives in `data/*.json`. Load it at startup; never hard-code prices, budgets or rates in components.
- Treat program rules (contribution rates, 10% care management, carry-over cap, lifetime caps, personal-care date rule) as config in one module (`src/rules.ts`) with effective dates.
- Provider rates may be `null` = not published. Fill from benchmark in calculations and show which items were filled.

## Build order
1. Types from SPEC §4 and data loaders.
2. `src/calc.ts` implementing SPEC §5, with tests reproducing the reference table in SPEC §5 exactly.
3. Screens in SPEC §8 order.
4. Question filtering (SPEC §6) and scoring (SPEC §7) with tests.
5. Print/PDF export of the interview pack.

## Conventions
- AUD formatting via `Intl.NumberFormat('en-AU', {style:'currency', currency:'AUD', maximumFractionDigits:0})`.
- Every displayed price shows its `prices_as_at` and links its `source_url`.
- Show the "not financial or legal advice" disclaimer in the footer.
- Run `npm test` and `npm run build` before declaring a task done.
