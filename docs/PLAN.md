# Development Plan — Support at Home Provider Assessor

Based on `SPEC.md` v1.0 (25 Oct 2026) and `CLAUDE.md`. The phases follow the build order in `CLAUDE.md`. Each phase ends with `npm test` and `npm run build` passing, a short summary, and a commit.

---

## 0. Before starting: blockers and decisions

| # | Item | Action |
|---|---|---|
| B1 | **`data/` folder is missing.** The README lists seed files (providers, benchmark, budgets, contributions, sample plan, shortlist, 29 bounding questions, 74 interview questions), but only SPEC/CLAUDE/README were supplied. | Add the `data/*.json` files to the repo before Phase 2. The calc tests (SPEC §5 reference table) depend on the exact seed values. |
| B2 | Transitioned HCP levels L1–L4 are not in `budgets.json` (SPEC §3.2 says to add them in v1). | Add them in Phase 1 with `for_services = quarterly × 0.9`. |
| B3 | **Personal-care date rule vs reference table.** The SPEC §5 fixtures don't say which service date they assume (before or after 1 Oct 2026). | Default to the current date (≥ 2026-10-01, so personal care is Clinical). If the fixtures don't match, try the pre-Oct rule and record which one reproduces them. |
| B4 | Rounding in the reference table (whole dollars). | Calculate at full precision and round only in tests and display. Confirm the tests match within ±$0.50. |
| D1 | Stack: Vite + React + TS + Tailwind + Recharts + Vitest, `localStorage` behind a storage interface (CLAUDE.md default). | Keep it as is. Add `zod` for validating seed data at load time, React Router for the 8 screens and `@dnd-kit` for drag-to-reorder. |
| D2 | Bounding-question answers: SPEC §4 has `'yes'\|'no'\|'unsure'\|text` plus a "not relevant" marker (§6). | Model "rules out" as an explicit flag per answer (`excludes_sections[]`) that the user sets with a "not relevant" toggle. Never infer it from the yes/no answer. |

---

## Target structure

```
data/                      seed JSON (read-only at runtime)
src/
  types.ts                 SPEC §4 types
  schemas.ts               zod schemas mirroring types (validate seed + imports)
  data/load.ts             loads + validates data/*.json
  rules.ts                 dated program rules (single source of truth)
  calc.ts                  SPEC §5 pure functions
  questions.ts             SPEC §6 filtering
  scoring.ts               SPEC §7 weighted scoring + disqualify flag
  dva.ts                   SPEC §3.4 prompts (pure: profile + plan → prompts[])
  flags.ts                 provider note flags (travel/admin fees, staleness)
  format.ts                AUD / percent / date (en-AU)
  storage/                 Storage interface + LocalStorageAdapter
  state/                   app store (participant, plan, providers, shortlist, answers, responses, scores)
  components/              Layout, Footer (disclaimer), PriceCell (as-at + source link), StaleBadge, ThemeToggle
  screens/                 1–8 per SPEC §8
  test/                    fixtures + unit tests
```

---

## Phase 1 — Scaffold, types, rules, data loaders

**Tasks**
1. Scaffold Vite React-TS, Tailwind (with a `dark` class strategy), Vitest + Testing Library, ESLint/Prettier. Add the `test`, `build`, `lint` and `typecheck` scripts.
2. `types.ts`: every entity in SPEC §4. Provider rate fields are `number | null`. `PlanItem.category` is `'clinical' | 'independence' | 'everyday'`, with personal care flagged so the dated rule can apply.
3. `schemas.ts` + `data/load.ts`: validate every seed file at startup and show a clear error screen if one fails.
4. `rules.ts`: each rule is a list of `{ effective_from, value }` with a `ruleAt(name, date)` accessor:
   - care-management deduction 10%
   - carry-over cap `max($1,000, 10% × quarterly)`
   - lifetime caps: standard $140,652.80 / no-worse-off $88,934.57 (as at 2026-09-20)
   - personal-care category: Independence before 2026-10-01, Clinical from then
   - contribution rate bands per status (full / part / self-funded / no-worse-off)
   - staleness threshold 60 days
5. Add the HCP L1–L4 budgets (B2).
6. `storage/`: a `Storage` interface (`load<T>(key)`, `save<T>(key, value)`, `clear()`) and a versioned `localStorage` adapter that supports schema migration.
7. `format.ts`: AUD via `Intl.NumberFormat('en-AU', {style:'currency', currency:'AUD', maximumFractionDigits:0})`. Percentages show as `5%` or `17.5%`.
8. Layout shell: nav for the 8 screens, a footer with the "general information, not financial or legal advice" disclaimer on every page, and a theme toggle.

**Tests:** seed files pass validation; `ruleAt` returns the right value on either side of each effective date; the formatters give the expected output; the storage round-trip works.

---

## Phase 2 — Calculations (`calc.ts`)

Pure functions, with no React or storage dependencies:

- `contributionRates(participant, date)` → `{ ind_low, ind_high, ev_low, ev_high }`. Full pensioner is fixed at 5% / 17.5%. Part pensioners use the rates they enter, validated within 5–50% and 17.5–80%. Self-funded is 50% / 80%. No-worse-off uses its lower bands.
- `categoryFor(planItem, serviceDate)`: applies the personal-care date rule.
- `planCost(provider, benchmark, plan, budget, rates, serviceDate)` → `{ items[], quarterly_cost, contrib_low, contrib_high, over_budget, hours_affordable_factor, benchmark_filled[] }`
- `variance(providerRate, benchmarkRate)` plus a colour band (> +5% red, < −5% green, otherwise neutral).
- `headline(results)` → cheapest, dearest and spread %.
- `yearsToCap(cap, paid, annualContrib)`: returns ∞ or "n/a" when annual contributions are 0.
- `carryOverCap(quarterly)`: shown for information only.

**Tests (required):** reproduce the SPEC §5 table exactly, after rounding:

| Provider | Cost | Full pensioner | Self-funded | Filled |
|---|---|---|---|---|
| Right at Home Brisbane Bayside South | 12,500 | 811 | 4,525 | gardening |
| Bolton Clarke | 12,701 | 784 | 4,373 | — |
| Anglicare Southern Queensland | 12,980 | 836 | 4,670 | — |
| BlueCare (UnitingCare QLD) | 14,239 | 922 | 5,167 | rn, gardening |
| IHACPA benchmark | 11,521 | 773 | 4,249 | — |

Also test: personal care before and after 2026-10-01; null-rate fallback; over-budget flag; variance bands; spread %; years-to-cap edge cases; that part-pensioner rate validation rejects out-of-band values.

---

## Phase 3 — Screens (SPEC §8 order)

Every screen works at 360 px width, uses semantic HTML with labelled controls and keyboard support, and meets AA contrast in light and dark themes.

| Step | Screen | Key deliverables |
|---|---|---|
| 3.1 | **Participant setup** | Form fields: name (optional), suburb, postcode, pension status, assessed rates (part pensioners only), DVA card, no-worse-off, classification (1–8 or HCP L1–L4), lifetime contributions paid. Shows the derived contribution rates live. Shows DVA prompts from `dva.ts`, phrased as "Consider funding X via DVA… confirm with DVA" and never as an eligibility claim. Ships with no pre-filled personal data. |
| 3.2 | **Overview** | Key rules (single provider, categories, personal-care change, price caps deferred, all-inclusive pricing); quarterly, annual and for-services budget; carry-over cap; contribution table; lifetime cap with years-to-cap. |
| 3.3 | **Relative costs** | Plan editor (starts from `sample_plan.json`; add/remove/edit hours; category). Recharts horizontal bar chart of cost per provider, with a dashed reference line at `for_services` and red bars when over budget. Out-of-pocket table (low–high range). Variance table with colour bands. Headline: cheapest, dearest and spread. "Filled from benchmark" badges. Service-date selector (default today). |
| 3.4 | **Providers** | Sortable, searchable table; `PriceCell` shows `prices_as_at` and links `source_url`; stale badge after 60 days; flag chips (including auto-flagging notes that mention travel or admin fees); add/edit form; CSV import (papaparse + zod validation, with a preview and per-row error report). |
| 3.5 | **Shortlist** | Seeded from `shortlist.json`. Drag to reorder (keyboard-accessible with dnd-kit), add from providers, remove, edit "why" and "watch" notes. |
| 3.6 | **Bounding questions** | Accordion of 8 groups (29 questions); yes/no/unsure/text controls plus a "not relevant" toggle; live count of included interview questions (uses Phase 4 logic, see note). |
| 3.7 | **Interview pack** | Questions grouped A–Q and filtered; "must" questions always shown and badged; custom questions per section; one response column per shortlisted provider (text plus a satisfactory toggle). |
| 3.8 | **Scoring & decision** | Matrix of providers × 8 criteria (1–5), editable weights, weighted total and ranking, "disqualify?" flag, decision notes. Price vs benchmark can be suggested from the calc results, but the user can override it. |

> **Sequencing note:** screens 3.6–3.8 need the Phase 4 logic. Write `questions.ts` and `scoring.ts` (with their tests) right before 3.6 rather than after all the screens. This keeps every step shippable and doesn't change the order of the deliverables.

**Tests:** component tests for the participant form (derived rates), the plan editor (recalculates on hours change), provider CSV import (valid and invalid rows), shortlist reorder persistence, and filter counts updating live.

---

## Phase 4 — Question filtering and scoring

**`questions.ts`**
- `includedSections(boundingGroups, answers)`: a section is excluded only if **every** bounding question that informs it is marked "not relevant". Unanswered means included, so the default includes all sections.
- `interviewPack(sections, includedSections, customQuestions)`: "must" questions are always included, and custom questions are merged in by section.
- `includedQuestionCount(...)`: drives the live counter.

**`scoring.ts`**
- Default weights: veteran/PTSD ×2, continuity ×2, clinical depth ×2, care management ×1, local availability ×1, price vs benchmark ×1, contract terms ×1, DVA coordination ×1.
- `weightedTotal(scores, weights)` (normalised to /5 for display) and `rank(providers)`.
- `disqualifyFlag(provider, responses, mustQuestions)`: true if any included "must" question has no written response or is marked unsatisfactory.

**Tests:** default includes all 74 questions; a section is excluded only when all its informing questions are "not relevant"; one relevant question keeps it in; "must" questions survive exclusion; custom questions appear; weighting maths; tie handling; disqualify flag.

---

## Phase 5 — Print / PDF export

- Print stylesheet (`@media print`) for the interview pack. Includes a participant summary header (no unnecessary personal data), shortlisted providers with prices and as-at dates, sections A–Q with must/should markers, a response column per provider, and the disclaimer on every page.
- Use browser print-to-PDF (no server needed). Add page-break rules per section and repeating table headers.
- Optional: an export button that runs `window.print()` with the print route opened.
- Also offer a JSON export and import of all app state, for backup and moving between devices (low effort, high value given there's no login).

**Tests:** the print route renders the right filtered questions and provider columns; snapshot of the print DOM.

---

## Phase 6 — Hardening (non-functional, SPEC §9)

- Accessibility pass: axe in component tests, keyboard-only walkthrough, focus management in the accordion and drag-and-drop, chart has a text alternative (the table already gives one).
- Phone-width pass on every screen (tables become horizontally scrollable or stacked cards).
- Light/dark theme, respecting `prefers-color-scheme`.
- Staleness warnings checked against today's date (prices captured 25 Oct 2026 go stale after 24 Dec 2026).
- README: how to refresh prices from My Aged Care and how to update `rules.ts` when indexation dates pass (20 Mar, 20 Sep, 1 Jul).

---

## Definition of done (v1)

- All SPEC §2 flows work end to end for **any** participant profile, with nothing hard-coded for the first user.
- The SPEC §5 reference table is reproduced by unit tests.
- Every price shows its as-at date and source link, and goes stale after 60 days.
- The disclaimer appears on every page and in the printout.
- `npm test`, `npm run build`, lint and typecheck are clean.

## Deferred (v2 and beyond, per SPEC)

Time-of-day rate mix (evening, weekend, public holiday); 15-minute increments and minimum visit lengths in costing; AT-HM, restorative and end-of-life budgets; SQLite/Supabase storage adapter; live My Aged Care data; multi-user sharing.

## Risks

| Risk | Mitigation |
|---|---|
| Program rules change (indexation, further reforms) | All rules live in dated config in `rules.ts`; the Overview shows "rules verified as at". |
| Seed prices go stale quickly | Staleness badges, CSV import and an editable provider form. |
| Users read results as advice | Persistent disclaimer; DVA prompts are phrased as "confirm with DVA". |
| Fixture mismatch caused by the date rule or rounding | Resolve B3 and B4 early in Phase 2 and record the assumption in the tests. |
