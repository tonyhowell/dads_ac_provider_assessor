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

### Applicant profile, questionnaire, dossier and public claims (v3)
- **For providers** (on About you, saves as you go):
  - preferred name and a contact person for providers;
  - communication needs and languages;
  - current supports.
  - **DVA details** for card holders: accepted conditions and current DVA services. No DVA file or card numbers are collected.
- **"What I'm looking for in a provider"** replaces the bounding questions. There are 27 questions with set answers (one or several, some with a limit) and an "Add more detail" box on each. An answer can rule out the interview sections a question covers, for example "I live alone and no one cares for me" drops the carer-respite questions.
- **Claude summary:** "Draft my summary with Claude" turns the questionnaire, profile and care plan into priorities, must-haves, deal-breakers and a short first-person paragraph. The family can edit it or draft it again. Money and contribution details are never sent.
- **Dossier for each provider** (provider page → "Dossier for this provider"), printable or saved as PDF:
  - the family ticks which sections to include; budget and contributions are off by default;
  - they must confirm they're choosing to share it before Print works;
  - private notes and scores are never included;
  - it includes the provider's public claims as a "please confirm in writing" checklist.
- **Public claims:** "Check what they say publicly" (provider page), or check everyone in the initial scan at once.
  - Claude searches the provider's website and public listings with web search and web fetch. For each interview topic it records what the provider says (Stated or Partly), with a quote and a direct link. Claims whose link the search didn't actually return are dropped.
  - Results are cached for each provider for every application, and searched again after 60 days or on request.
  - Each family sees the claims for the topics their answers keep in. Claims also show under the matching interview questions ("They say: …").

### Finding providers (v4)
- **Find providers** starts with two ways to look, on one set of pages:
  - **One provider for my whole plan:** providers ranked by fit, best first, each with the reasons why and where each reason came from.
  - **The best provider for each service:** pick one service or several. Providers are ranked for those services, with hourly prices against the price guide, "Choose for …" picks for each service, and "best combinations" (one provider against the cheapest mix). Support at Home pays one provider, so a mix needs one provider to subcontract the others; the page says so.
- **How the fit is worked out** (`src/matching.ts`):
  - points for the family's top three priorities from "What I'm looking for" (30, 25, 20), for published prices for their services (15) and for price against the guide (10);
  - each priority scores from reviewed provider data, published prices or the provider's public claims, with the source shown;
  - anything not found scores nothing but never counts against the provider; when more than half the priority weight is unknown the verdict is "Not enough known";
  - providers with no published prices go in a "needs a quote" group;
  - fee flags are marked as a deal-breaker when the family named unexpected fees. Filtering them out is opt-in (Refine).
- **Insight panel:** beside the list on wide screens, its own page below 1024px. Tabs: why it fits, cost, public claims, notes. Includes "How the score is worked out" and Next provider.
- **Compare your shortlist** (`/compare`): the shortlist side by side, the same for both ways of looking. "Interview them?" moves a provider to the interview list. The selection board is still there for ranking and reasons.
- **Phones (under 768px)** get a reduced version: one thing per screen, verdict words instead of scores, the top three first, three quick filters, one service at a time and stacked cards instead of the comparison table. Scores, the comparison table and combinations stay on bigger screens, with one line saying so.
- The old alphabetical list is still under "Look up a provider by name".
- State v8 adds the per-service picks.

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
