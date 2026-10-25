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

**Seed data:** the starter pack in `data/` (see `data/README.md`). Help text, the glossary and contact numbers are in `data/help.json`.

## What works so far

The full v1 build plan is in place: the SPEC §8 screens, calculations, question filtering, scoring and the printable pack. It runs on top of passkey sign-in, and v2 adds **applications**.

### Applications and family access (v2)
- **Separate applications:** each application is one applicant's assessment. All the steps are private to the people added to it; provider data is shared by all applications.
- **Who creates them:** only site admins create applications, each with a **coordinator** (an existing user, or a new person who gets a one-time passkey link).
- **Roles:**
  - the coordinator adds family on **People in this application**;
  - people join as **Viewers** (read-only) by default;
  - the coordinator can make them **Contributors** (can change things) or coordinators;
  - there is always at least one coordinator, and anyone can leave.
- **Your applications:** the list of applications you belong to, with a switcher in the header.
- **Site admins:**
  - see each application's details (area, people, status, last change) but **not its contents**, unless they're also a member;
  - can archive an application (read-only) or restore it;
  - can make someone coordinator.
- **Common provider catalogue:** site admins edit it directly or import a spreadsheet, and every change is recorded. Contributors **suggest corrections** with a note on where the information came from; admins approve or reject them on **Suggested corrections**.
- **Special rates:** rates a provider offered one applicant are recorded on the provider's page. They are costed only in that application and marked "★ Special rate for you".
- **Service areas:** each provider lists the postcodes it serves (for example `4178`, `4150-4169`). Providers outside the applicant's postcode are hidden by default; providers without a confirmed area always show.
- **Server checks:** the server checks membership and role on every request.
- **Upgrading:** the v1 shared record moved into the first application on upgrade. Admins became its coordinators and everyone else a contributor. Family edits to providers moved into the catalogue.

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
- **Selection in three stages:** initial scan → refinement → providers to interview (ranked, with why and what to watch for). Dropping a provider can be undone.
- **Bounding questions:** 8 groups and 29 questions, answered Yes/No/Unsure with notes and a "not relevant" toggle, plus a live count of interview questions included.
- **Interview pack:**
  - sections A–Q filtered by the bounding answers, with "must" questions always kept;
  - your own questions added per section;
  - answers per provider, marked "Answered well?" (Yes/Partly/No) and "Got it in writing";
  - a printable A4 pack, one section per provider with ruled answer lines (Print or Save as PDF).
- **Interviews:** in-browser recording with optional live transcription; drafting structured notes with Claude.
- **Scoring and decision:**
  - 8 weighted criteria (weights editable) with a ranking;
  - scores in words (1 Poor … 5 Excellent);
  - a "disqualify?" flag when a must-ask question has no written answer, or was answered poorly;
  - a suggested price score from the plan cost against the benchmark;
  - shared decision notes and a printable decision summary.
- **Site administration:** applications, people (passkeys, enrolment links, roles, disabling access), suggested corrections and the provider catalogue.

### Interface (docs/UI-SPEC.md)
- Quantivate design tokens (`design/tokens.css`), with light, dark and high-contrast themes.
- A four-step journey bar: Your situation → Compare → Choose who to meet → Interview & decide.
- Layered help:
  - a "What is this screen for?" link and field hints;
  - "Why?" breakdowns for every figure;
  - glossary terms;
  - a searchable help panel (press `?`) with contact numbers.
- Problems show as cards that say how to fix them (missing prices, over budget, no microphone, sync errors).
- Inputs: choice cards, hours steppers (15-minute steps) and scores in words.
- Other screens: a first-run welcome and a "welcome back" card, notes for the family on any screen, and an About page.
- Display settings: text size 18–24px, theme, high contrast, motion and hints.
- Less text on screen: detail sits in expandable sections with a one-line summary (care plan, price comparison, rules, interview sections, "What we know"). Field hints show their first sentence with "More". Visual summaries: stat tiles, share rings for contributions, progress meters and a price-vs-guide scale. Printing opens every section.
- Accessibility: axe checks every screen in the test suite (`src/test/a11y.test.tsx`).
- Fonts use the system fallback stack. The spec's Archivo and Newsreader fonts aren't bundled yet.

### Security and privacy
- Passkeys are bound to the site's domain, so they can't be phished. The server stores only their public keys.
- Session cookies are HttpOnly, Secure and SameSite=Lax. State-changing requests must come from the app's own origin. Sign-in attempts are rate-limited, and pages carry a strict Content Security Policy.
- **Interview audio is never uploaded.** It stays on the device that recorded it, and only the transcript and notes are shared.
- If live transcription is on, the browser's speech service may send audio to the browser maker to convert it to text. You can turn this off.
- "Draft notes" sends only the transcript to Anthropic's API.
