# Seed data

**These files are placeholders.** The starter pack's `data/*.json` files were not available when the skeleton was built. Replace each file with the starter-pack version (prices captured 25 Oct 2026).

What the placeholders contain:

| File | Status |
|---|---|
| `providers.json` | The four providers named in SPEC §5, with no rates (`null` = not captured). Source URLs only where SPEC §11 lists them. |
| `benchmark.json` | IHACPA benchmark with no rates. |
| `budgets.json` | Transitioned HCP L1–L4 only (SPEC §3.2). Classifications 1–8 are still to come from the starter pack. |
| `contributions.json` | Rate bands from SPEC §3.3. |
| `sample_plan.json`, `shortlist.json`, `bounding_questions.json`, `interview_questions.json` | Empty. |

All files are checked against `src/schemas.ts` at startup. If the starter-pack files use a different shape, change the schemas (not the components).
