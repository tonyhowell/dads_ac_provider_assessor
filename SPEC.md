# Support at Home Provider Assessor — Product Specification

Version 1.0 · 25 October 2026 · Australia (Support at Home program, Aged Care Act 2024)

## 1. Purpose

Help a family choose an Australian Government–approved Support at Home provider for an older person, by:

1. Comparing providers that service the person's suburb on **coverage, price and fit**.
2. Modelling **relative cost** of a care plan at each provider, against the person's **classification budget** and **contribution rates**.
3. Producing a **ranked shortlist** of providers to interview.
4. Generating a **tailored interview question set**, filtered by the answers to a set of **bounding questions**.
5. **Scoring** providers after interview to reach a decision.

First user: a family arranging care for a veteran in **Wynnum QLD 4178** who holds a DVA card and receives an army pension, a CSS pension and a DVA disability (PTSD) pension. The app must not hard-code this person; it must work for any participant profile.

## 2. Users and core flows

| Flow | Steps |
|---|---|
| Set up participant | Enter suburb/postcode, pension status, DVA card type, classification (1–8 or transitioned HCP level), lifetime contributions paid to date |
| Answer bounding questions | 8 groups / 29 questions (`data/bounding_questions.json`); each answer can include or exclude interview sections |
| Build care plan | List services and weekly hours (start from `data/sample_plan.json`) |
| Compare providers | Table of rates + variance vs benchmark; plan cost per provider vs budget; out-of-pocket range |
| Shortlist | Ranked list with rationale and "probe at interview" notes; user can reorder, add, remove |
| Interview pack | Generated question set (sections A–Q, 74 questions) filtered by bounding answers; "must" questions always included; export to PDF/print |
| Score and decide | Score each interviewed provider 1–5 on weighted criteria; ranked result |

## 3. Domain rules (verified 25 Oct 2026 — keep configurable, they change)

### 3.1 Program
- Support at Home replaced Home Care Packages and Short-Term Restorative Care on 1 Nov 2025.
- **Single provider rule:** a participant receives all Support at Home services from one registered provider (which may subcontract).
- Three contribution categories: **Clinical**, **Independence**, **Everyday living**.
- **From 1 Oct 2026 personal care is in the Clinical category (0% contribution)**. Services delivered before that date keep the old Independence rate. Model this as a dated rule, not a constant.
- Assistive Technology & Home Modifications (AT-HM), Restorative Care Pathway and End-of-Life Pathway are separate short-term budgets (out of scope for v1 costing; capture as notes).

### 3.2 Budgets (`data/budgets.json`)
- 8 ongoing classifications; budgets effective 1 Oct 2026; indexed each 1 July.
- Transitioned HCP levels: L1 $2,823.55, L2 $4,965.14, L3 $10,808.30, L4 $16,385.99 per quarter (add to data in v1).
- **10% of each quarterly budget is deducted for care management** before services. `for_services = quarterly × 0.9`.
- Unspent funds carry over, capped at the greater of **$1,000 or 10%** of the quarterly budget.

### 3.3 Contributions (`data/contributions.json`)
- Contribution = service price × category rate. Clinical always 0%.
- Full pensioner: Independence 5%, Everyday living 17.5%.
- Part pensioner / CSHC holder: assessed rate between 5–50% and 17.5–80% (from DVA/Services Australia letter — user enters).
- Self-funded or means not disclosed: 50% and 80%.
- **No-worse-off principle** for people approved for a HCP on or before 12 Sep 2024: lower rates (full pensioner 0%/0%, self-funded up to 25%/25%) and lower lifetime cap.
- Lifetime cap on non-clinical contributions: **$140,652.80** standard; **$88,934.57** no-worse-off (as at 20 Sep 2026; indexed 20 Mar and 20 Sep). Shared with residential-care non-clinical contributions.

### 3.4 Veteran (DVA) rules
- DVA, not Services Australia, performs the income and assets assessment for DVA pensioners.
- DVA **Disability Compensation Payment** is non-means-tested (not counted as income). Defined-benefit super (e.g. CSS, DFRDB/MSBS) is counted. Service Pension recipients are part/full pensioners.
- Veterans' Home Care (VHC) is available to Gold Card and White Card (specific conditions) holders living at home: domestic assistance, home and garden maintenance, personal care, respite. DVA community nursing and Gold/White Card treatment (incl. Open Arms mental health) sit outside the Support at Home budget.
- App should flag: "Consider funding X via DVA to preserve the Support at Home budget" when card type and services overlap. Do not assert eligibility — prompt the user to confirm with DVA.

### 3.5 Pricing
- **Government price caps (planned 1 Jul 2026) were deferred indefinitely on 19 May 2026.** Providers set their own prices.
- Prices must be all-inclusive: no separate travel, admin, package-management or exit fees. Disclosed mark-ups on purchased items/consumables are permitted. App should flag any provider note mentioning travel/admin fees.
- Benchmark = IHACPA Support at Home Pricing Advice 2026-27 (`data/benchmark.json`) — advice, not a cap.
- Rates differ for weekday, evening, Saturday, Sunday, public holiday. v1 compares weekday standard; v2 adds time-of-day mix.
- Hourly services are claimed in 15-minute increments; providers may set minimum visit lengths.

## 4. Data model

```
Participant { id, name, suburb, postcode, pension_status, ind_rate, ev_rate,
              dva_card: 'gold'|'white'|'none', nwop: bool, classification,
              lifetime_contributions_paid }
Provider    { id, provider, type, outlet, rn, en, pc, domestic, social, respite,
              gardening, care_mgmt, prices_as_at, veteran_fit, flags, source_url,
              registration_status?, postcodes_served[]? }
Benchmark   { provider, rn, en, pc, domestic, social, respite, gardening, care_mgmt }
PlanItem    { service, key (matches Provider rate field), hours_per_week, category }
Budget      { classification, quarterly, annual, for_services }
ContributionRate { status, clinical, ind_low, ind_high, ev_low, ev_high }
ShortlistEntry { rank, provider, why, watch }
BoundingGroup { group, questions[{ id, text, informs_sections[], note }] }
BoundingAnswer { question_id, answer: 'yes'|'no'|'unsure'|text, excludes_sections[] }
InterviewSection { code (A–Q), section, questions[{ id, text, priority:'must'|'should' }] }
InterviewResponse { provider_id, question_id, response_text, satisfactory: bool? }
Score { provider_id, criterion, score 1–5 }
```

All seed data is in `data/`. Nulls in provider rates mean "not published / not captured".

## 5. Calculations

**Plan cost per provider (per quarter):**
```
for each plan item s:
  price = provider[s.key] ?? benchmark[s.key]   // record s.service in benchmark_filled[]
  cost  = price × s.hours_per_week × 13
  contrib_low  += cost × rate(s.category, low)
  contrib_high += cost × rate(s.category, high)
quarterly_cost = Σ cost
over_budget    = quarterly_cost − budget.for_services   (flag if > 0)
hours_affordable_factor = budget.for_services / quarterly_cost
```
`rate(category)`: Clinical → 0; Independence → ind rate; Everyday living → ev rate. Personal care category depends on service date (≥ 2026-10-01 → Clinical).

**Variance vs benchmark:** `(provider_rate − benchmark_rate) / benchmark_rate`; colour > +5% red, < −5% green.

**Headline:** cheapest and dearest provider for the plan; spread % = (dearest − cheapest) / cheapest.

**Lifetime cap:** years to cap = (cap − paid) / (annual contributions).

Reference results with seed data (weekday rates, sample plan, 13 weeks) — use as unit-test fixtures:

| Provider | Quarterly cost | Contribution @ full pensioner | @ self-funded |
|---|---|---|---|
| Right at Home Brisbane Bayside South | 12,500 | 811 | 4,525 |
| Bolton Clarke | 12,701 | 784 | 4,373 |
| Anglicare Southern Queensland | 12,980 | 836 | 4,670 |
| BlueCare (UnitingCare QLD) | 14,239 | 922 | 5,167 |
| IHACPA benchmark | 11,521 | 773 | 4,249 |

(Rounded to whole dollars; missing rates filled from benchmark: Right at Home → gardening; BlueCare → RN, gardening.)

## 6. Question logic

- Bounding questions tag interview sections (A–Q). Rule: a section is **included** unless every bounding question that informs it is answered in a way that rules it out (user marks "not relevant"). Default = include all.
- "Must" questions are always included regardless of filtering.
- User can add custom questions per section.
- Interview pack groups by section; one column per shortlisted provider for responses; export print-friendly PDF.

## 7. Scoring

Criteria (default weights): veteran/PTSD capability ×2, continuity of workers ×2, clinical depth ×2, care-management quality ×1, local availability ×1, price vs benchmark ×1, contract terms ×1, DVA coordination ×1. Weighted total → ranking. Rule: a provider that fails to answer any "must" question in writing is flagged "disqualify?".

## 8. Screens

1. **Participant setup** — form; derived contribution rates; DVA prompts.
2. **Overview** — key rules, budget for selected classification, contribution table.
3. **Relative costs** — plan editor, horizontal bar chart (cost per provider, dashed line = services budget, red when over), out-of-pocket table, variance table.
4. **Providers** — sortable/searchable table with flags, source links, "prices as at"; add/edit provider; import from CSV.
5. **Shortlist** — drag to reorder; notes.
6. **Bounding questions** — accordion of groups, answer controls, live count of included interview questions.
7. **Interview pack** — filtered questions; response capture per provider; export.
8. **Scoring & decision** — score matrix, weighted ranking, decision notes.

## 9. Non-functional

- Runs locally; no login in v1. Persist to local storage or SQLite.
- Accessible (WCAG AA), works at phone width, light/dark theme.
- All money AUD, formatted `$12,345`; rates as `5%` / `17.5%`.
- Every price shows its source URL and "as at" date; show a staleness warning when > 60 days old (providers must review prices at least every two months).
- Disclaimer on every page: general information, not financial or legal advice.

## 10. Out of scope (v1)

Live scraping of My Aged Care; DVA/Services Australia integrations; AT-HM costing; residential care; multi-user sharing.

## 11. Sources

- Bolton Clarke pricing: https://www.boltonclarke.com.au/support-at-home/support-at-home-program/sah-pricing/
- Anglicare SQ fee schedule: https://anglicaresq.org.au/hcp-fees
- Price caps deferred: https://www.minterellison.com/articles/support-at-home-program-price-caps-deferred-indefinitely
- IHACPA Pricing Advice 2026-27: https://www.ihacpa.gov.au/resources/support-home-pricing-advice-2026-27-0 (table via https://carevo.com.au/tools/support-at-home-pricing)
- Personal care change: https://www.myagedcare.gov.au/news-and-updates/support-home-personal-care-contribution-changes
- Income and assets assessment: https://www.health.gov.au/our-work/support-at-home/charging-for-support-at-home-services/income-and-assets-assessment-for-support-at-home-participants
- SA456 form (non-means-tested DVA payments): https://www.servicesaustralia.gov.au/sites/default/files/2025-10/sa456-2511.pdf
- Budgets, contribution rates, lifetime cap: https://www.wagecalculator.com.au/support-at-home-calculator (cross-check with https://www.myagedcare.gov.au/support-at-home-costs-and-contributions)
- DVA Veterans' Home Care: https://www.dva.gov.au/about-us/inquiries-and-reviews/veterans-legislation-reform/veterans-legislation-reform-resources/household-services-attendant-care-and-veterans-home-care
- Per-provider sources: `source_url` in `data/providers.json`
