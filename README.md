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

### Data checks (enrichment)
- **Site administration → Data checks** runs the enrichment service; it can also run on a schedule (`ENRICH_EVERY_HOURS`) or from the command line (`npm run enrich`). See `server/enrich.ts`.
- **Price lists:** each provider's published price page is fetched and compared with its last content hash. Only a changed page is read by Claude Haiku 5.5. Prices that differ from the catalogue by 50c or more, or a newer "prices as at" date, become a suggested correction for a site admin to approve. Nothing changes automatically.
- **Extra sources:** admins add public pages to watch (registers, government lists, notices). When one changes, Haiku summarises what it says about catalogue providers.
- **Public claims after 60 days**, cheapest first:
  - re-fetch the pages the claims came from; if none changed, the claims are confirmed as current with no model call;
  - if some changed, Haiku re-reads only those pages;
  - a full web search (Claude Sonnet 5.5) runs only the first time, when pages are gone, or when the last full search is 180+ days old, and at most `ENRICH_MAX_RESEARCH` (default 3) per run;
  - "Check again" on a provider page still forces a full search.
- Each run records what it did, token use by model and an estimated cost. Only one run at a time; a page that couldn't be read is retried next run.
- **Fetching:** a site has 20 seconds to start answering and 150 seconds to finish a download (up to 25 MB). Timeouts, dropped connections, 429 and 5xx answers are tried 3 times. PDFs are turned into text on the server (`unpdf`) and compared on that text; only a scanned PDF with no text goes to Claude as a document. Claude calls allow 5 minutes and are retried 3 times.
- **Live view:** every item a run will check is planned first. The admin page shows progress (done of total), an estimated time left (from this run's pace and recent runs), what each item is doing now (connecting, downloading with size, reading with Claude, searching), problems with the stage and reason, and a Stop button that stops after the items in hand. Finished runs list each item with its result and time taken.

### Loading providers, and prices on shortlist
- **Load from the government list** (Site administration → Provider catalogue): upload GEN's *Aged care service list* (one Excel file per state, current to 30 June). It's read in the browser: the columns are found automatically (and can be changed), home care services are kept, the regions your applications are in are ticked, and providers not already in the catalogue are added without prices, marked as loaded. See `src/genLoad.ts`.
- **Automatic import of the government list** (same screen, and on a schedule): the server fetches the newest *Aged care service list* itself — from GEN's providers page (it follows the link to the newest release and takes every state file there), a release page, or a file link — and does nothing if the files haven't changed (SHA-256). Home care providers new to the catalogue are added without prices, marked "from the government list"; providers loaded from an earlier list have their outlets updated; ones no longer on the list are flagged ("Not on the government service list as at …") but never removed; providers entered by hand are never overwritten (only missing outlet locations are filled in). Choose the whole country or only the regions around active applications. Checked weekly by default (`GEN_IMPORT_EVERY_HOURS`); no Claude calls. GEN currently blocks automated requests from the hosting provider (403), so the same screen takes an **uploaded** file (the Australia-wide .xlsx downloaded in a browser) and runs the same import. See `server/genImport.ts`; DB migration 8.
- **Area for loaded providers:** a provider with no listed service postcodes but known outlets counts as outside the area when none of its outlets is within 60 km of home (`/api/near`), so a national load doesn't fill every family's list. "Bring back" on the Filtered out page still shows one.
- **Find providers near each application** (Data checks, optional): Claude Sonnet searches the web and My Aged Care for providers serving each active application's postcode. It adds new ones, marked as found by search, and fills in missing websites and price list links. It uses the run's search limit and keeps only links the search actually retrieved. See `server/discover.ts`.
- **Loaded providers are checked only once shortlisted:** scheduled and manual data checks skip loaded providers no one has shortlisted.
- **Prices on shortlist:** when a family shortlists a provider, the server reads its prices. If there's no price list link it runs one small search to find it (Sonnet), then Haiku reads the list.
  - A provider with no prices yet gets them straight into the catalogue, marked "read automatically" with the date; fees on the page become flags.
  - Changes to existing prices still become suggestions for an admin.
  - It isn't repeated within a week unless someone asks ("Try again").
- **"What we know"** box (provider page and insight panel, shortlisted providers only) shows the price read and offers **Enrich this provider** (check what they say publicly), or **Update** when that's been done before.

### Gather (improvement plan, package 1 — `docs/IMPROVEMENT-PLAN.md`)
- **Three stages:** the journey is now Gather → Find → Select, prep & interview.
- **Gather is a seven-step wizard:** Situation, Money, Care plan, Needs and home, What matters, About me, Brief. It shows progress, who's doing each step, and back/next. See `src/screens/GatherScreen.tsx` and `src/gather.ts`.
- **Find opens once Gather has the essentials:** level, budget and pension; the care plan; priorities and deal-breakers. Until then the Find screens list what's missing, with links.
- **Care plan:**
  - Upload the support plan or Notice of Decision, after a consent tick. Claude Haiku reads services, hours and level; a PDF is read as text first. The family ticks and corrects each service before anything is saved, and can update the level. The file isn't stored.
  - With no plan yet, services are entered by hand and marked unconfirmed.
  - Costs are now edited only here; Compare costs links back to it.
- **Family conversation:** record a conversation (or type notes). Only the transcript is sent to Claude Haiku, which suggests answers with the quote each came from. The family accepts or skips each one.
- **The applicant:** the coordinator marks which member is being assessed. That member sees only What matters, About me and the brief, in larger text, with "Speak instead" buttons (browser speech recognition, en-AU) on text boxes.
- **Assigned steps:** the coordinator assigns steps to members.
- **Assessment brief:** one printable page covering situation, money, care plan, priorities, must-haves and deal-breakers. The coordinator confirms it; anyone with edit access can comment.
- State v9 adds `gather`.

### Find (improvement plan, package 2)
- **Map and list:** Find opens on the ranked list beside a map (Leaflet, OpenStreetMap tiles) showing home and providers' outlets at suburb level. Each card shows the distance ("4 km away · outlet in Manly"). Suburb centres come from `data/postcodes.csv` (Matthew Proctor's Australian Postcodes) via `/api/geo`; only postcodes are sent. On phones there's a List / Map switch. Providers appear on the map once their outlet suburbs (from the government list) or service postcodes are known.
- **Insight tabs:** Why it fits, Cost, Quality, Public claims, Ask, Notes.
  - **Cost** adds your contribution and how much of the plan the budget covers.
  - **Quality:** when shortlisted (or on request), Claude Sonnet searches only `agedcarequality.gov.au` for sanctions, non-compliance and audit findings, and Haiku structures them, keeping only links it retrieved. The result is shared across applications and refreshed after 60 days. Cards warn about sanctions or non-compliance.
  - **Ask:** a question gets a fresh web search (Sonnet) and an answer with its sources, kept for the family.
- **Filtered out** (`/providers?view=filtered`): providers hidden by filters (and which), with deal-breakers found (with evidence), outside the area (with distance), and low matches. **Bring back** shows one in the list whatever the filters, marked "Brought back". Filters are kept for the browser session.
- **Shortlisting:**
  - A target (default 5) with progress in the bottom bar; Find counts as done when it's reached.
  - Quick reasons on each shortlisted card ("Why?"), saved as the shortlist reason and shown on the comparison.
  - Family thumbs up or down with a comment.
  - "I rang them" call notes (saved as notes).
  - Shortlisting also reads prices, checks public claims and checks compliance.
- State v10 adds `find`. DB migration 7 adds provider compliance and questions.

### Select, prep and interview (improvement plan, package 3)
- **Family vote** (on Compare): each voter (coordinators, contributors and the applicant) picks up to three to meet. Results stay hidden until everyone has voted; the applicant's picks break ties. The coordinator moves the choice to "to interview" in one click. Hidden in the interface only: the vote data is shared with the application.
- **Prepare** (`/prepare`), per provider you'll meet:
  - **Questions** built from the predefined list, with what matters for this provider first and why: compliance findings, missing prices and possible extra fees, priorities with nothing found publicly, claims they only partly answer, your own questions, then must-asks. Add your own question for this provider or for every provider.
  - **Booking:** date, time, in person/phone/video, where, who's attending and who leads, with a calendar file (.ics, Australia/Sydney).
  - **Send the pack:** an email draft in your own mail app with the questions, plus the dossier to save as PDF; ticks for what's been sent.
  - **Family briefing** (`/prepare/:provider/briefing`, printable): listen for, red flags, must ask, how to score.
- **In the interview** (record screen):
  - **Question checklist:** tick each tailored question Answered, Partly or Not answered, with a short note (saved as interview responses).
  - **Live gap prompts:** while recording with live transcription, Claude Haiku checks the transcript about once a minute (only when there's new speech) and marks what it heard answered, so you can see the must-asks still to go. Only the transcript is sent; nothing is saved from the check.
  - **Phone interview mode:** guidance for speakerphone calls, one question at a time in larger text. On by default when the booking is by phone.
- **Decide:** each member scores separately; scores combine with the applicant's counting double, and differences of two points or more are flagged. The decision record names who, why and the next steps (tell them, agree the service agreement, tell the others, start date).
- State v11 adds `select` (votes, bookings, member scores, decision); older shared scores carry over as "Family (earlier scores)".

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
