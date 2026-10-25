# Support at Home Provider Assessor — starter pack

Open this folder in Claude Code and start with:

> Read CLAUDE.md and SPEC.md, then build the app following the build order in CLAUDE.md.

Contents: `SPEC.md` (product spec), `CLAUDE.md` (build instructions), `data/` (seed providers, IHACPA benchmark, budgets, contribution rates, sample plan, shortlist, 29 bounding questions, 74 interview questions).
Prices captured 25 Oct 2026 — refresh from My Aged Care before relying on them.

## Running the app

```bash
npm install
cp .env.example .env   # set BOOTSTRAP_ADMIN_USERNAME, and ANTHROPIC_API_KEY for interview notes
npm run dev            # API on :3000 + app on http://localhost:5173
npm test               # server and browser tests
npm run build          # typecheck + production build
npm start              # production server (serves the built app and the API)
```

The first time the server starts with an empty database, it creates the `BOOTSTRAP_ADMIN_USERNAME` admin and prints a one-time enrolment link. Open it to create your passkey. Locally the database is embedded (PGlite in `.data/`); in production it's Postgres. Deployment steps are in `docs/DEPLOY.md`.

**Seed data:** `data/` currently holds placeholders. See `data/README.md`.

## What works so far

The full v1 build plan (SPEC §8 screens, calculations, question filtering, scoring and the printable pack) is in place, on top of passkey sign-in and shared family data.

- **Participant setup:** suburb, postcode, classification, pension status, assessed rates, DVA card and no-worse-off status. Shows contribution rates live, the budget, and DVA prompts (suggestions to check with DVA, never eligibility claims). The name is optional.
- **Overview:** key rules, the budget breakdown (care management, services, carry-over cap), the contribution table and years to the lifetime cap.
- **Relative costs:**
  - an editable weekly plan and a service date (personal care counts as Clinical from 1 Oct 2026);
  - the cheapest and dearest provider and the spread;
  - a cost chart against the services budget;
  - out-of-pocket contributions, and rates against the IHACPA benchmark (±5% colouring).
  Unpublished rates are filled from the benchmark and marked.
- **Providers:**
  - search and filter by stage;
  - "prices as at" and source links, with a warning once prices are over 60 days old;
  - flags for travel or admin fees;
  - add or edit providers (with undo back to the starter-pack data) and import from CSV;
  - assessment notes on each provider.
- **Selection in three stages:** initial scan → refinement → interview shortlist (ranked, with why and probe notes).
- **Bounding questions:** 8 groups and 29 questions, answered Yes/No/Unsure with notes and a "not relevant" toggle, plus a live count of interview questions included.
- **Interview pack:**
  - sections A–Q filtered by the bounding answers, with "must" questions always kept;
  - your own questions added per section;
  - answers and a "satisfactory?" mark per shortlisted provider;
  - a printable landscape pack (Print or Save as PDF).
- **Interviews:** in-browser recording with optional live transcription; drafting structured notes with Claude.
- **Scoring and decision:**
  - 8 weighted criteria (weights editable) with a ranking;
  - a "disqualify?" flag when a must question lacks a satisfactory written answer;
  - a suggested price score from the plan cost against the benchmark;
  - shared decision notes.
- **Admin:** passkey users, enrolment links and roles.

### Security and privacy
- Passkeys are bound to the site's domain, so they can't be phished. The server stores only their public keys.
- Session cookies are HttpOnly, Secure and SameSite=Lax. State-changing requests must come from the app's own origin. Sign-in attempts are rate-limited, and pages carry a strict Content Security Policy.
- **Interview audio is never uploaded.** It stays on the device that recorded it, and only the transcript and notes are shared.
- If live transcription is on, the browser's speech service may send audio to the browser maker to convert it to text. You can turn this off.
- "Draft notes" sends only the transcript to Anthropic's API.
