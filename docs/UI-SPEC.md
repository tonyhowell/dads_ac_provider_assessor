# UI Design Specification — Support at Home Provider Assessor

Version 1.0 · 25 October 2026 · Companion to `SPEC.md` (features and rules) and `docs/PLAN.md` (build order)

This document sets the look, feel and behaviour of the app. `SPEC.md` decides **what** the app does; this
document decides **how it looks and how it helps people use it**. Where they conflict, `SPEC.md` wins on
rules and calculations, and this document wins on presentation.

Ready-to-use tokens: `design/tokens.css`.

---

## 1. Who we are designing for

### 1.1 Primary user — the care recipient

- Aged 60+, approved for a Support at Home classification (or a transitioned Home Care Package).
- **Tech-savvy:** uses a tablet or laptop daily, does online banking, video-calls family, reads the news on a
  screen. Does not need to be taught what a button is. Does not want to be talked down to.
- **But:** may have reduced near vision, contrast sensitivity, fine motor control or hearing; may tire in
  a long session; may use the app over several days; may be under stress (a care decision is personal and
  often comes after a health event).
- Knows their own life well. Does not know the program jargon (classification, contribution category,
  care management, no-worse-off, IHACPA).

### 1.2 Secondary user — the family helper

- An adult child, partner or friend. Often more time-poor than the recipient, sometimes in another city.
- Helps with numbers, research and interviews. Often sits beside the recipient, or on a video call with
  the screen shared.
- Needs to see **what has been decided, what is still open, and why** — without re-doing the work.

### 1.3 The setting

| Situation | Implication for design |
|---|---|
| Kitchen table, two people, one laptop or tablet | Large type readable at arm's length; no tiny controls; one clear focus per screen |
| Video call with screen share | Content must survive compression — no hairline rules or tiny grey text carrying meaning |
| Provider interview by phone or in person | Interview screens must be usable one-handed on a tablet, quickly, while listening |
| Printing the interview pack or decision summary | Every key screen has a deliberate print layout |
| Coming back after three days | The app must say where you were and what is next |

### 1.4 Design goals, in priority order

1. **Understand, then decide.** Every number, rule and recommendation can be explained in place. The user
   should never need to leave the app to find out what something means.
2. **Self-resolution.** When something is empty, wrong, missing, stale or blocked, the screen says what
   happened and the one thing to do about it.
3. **Calm confidence.** Quiet, steady, unhurried. No alarms unless something genuinely needs attention.
4. **Respect.** Plain language, not childish language. Big enough, not oversized. Helpful, not nagging.
5. **Shared decision.** The recipient decides; the family supports. The interface makes the reasoning
   visible so it can be discussed and handed over.

---

## 2. Brand: derived from Quantivate

The assessor is a Quantivate product. It inherits the Quantivate brand system (source:
`tonyhowell/quantivate-website` — `docs/design-brief.md`, `src/styles/tokens.css`), adapted for an
older consumer audience using an interactive tool rather than a government reader scanning a website.

### 2.1 What carries over unchanged

| Quantivate element | Use in the assessor |
|---|---|
| **Charcoal `#2E3236`** — primary text, dark panels | Primary text, header bar, chart bars |
| **Signal amber `#E8A33D`** — "one use per screen" | The **one next action** on each screen (the primary button). Same discipline: if amber appears three times, two are wrong |
| **Paper `#F4F1EA`** — warm off-white background | Page background. Warm, low-glare, easier for older eyes than pure white |
| **Grey `#676C71`** (AA-corrected from `#6B7075`) | Secondary text — but used less than on the website (see §3.1) |
| **The nine-cell grid with one amber cell** — "the anomaly found among the ordinary" | Re-read as **"the right provider among many"**. Used as the app mark, the phase marker and the "working…" state. Never as wallpaper |
| **Archivo** (display / UI) | All UI: headings, labels, buttons, tables, numbers |
| **Newsreader** (body serif) | Long-form explanations in help panels, and the printed interview pack |
| Plain Australian English, short sentences, no hype vocabulary | Same rules, plus the plain-language glossary in §9 |
| WCAG 2.2 AA as non-negotiable | Same, and we go further for target size and text size (§8) |
| Focus ring: amber outer ring + charcoal inner ring | Same (amber alone is 1.91:1 on paper; the inner ring carries the 3:1) |
| Motion: micro-transitions only, respect `prefers-reduced-motion` | Same |
| No stock photography | Same. No smiling-grandparent imagery, no hands-holding-hands. Diagrams and real data only |

### 2.2 What changes for this audience, and why

| Website rule | Assessor adaptation | Reason |
|---|---|---|
| Body 19px, serif | **UI text 18px Archivo** by default, user-adjustable to 20 / 22 / 24px. Serif kept for long explanations only | A tool is scanned and operated, not read top to bottom. A sans at 18px with open apertures reads better in forms and tables |
| Grey used for captions and secondary text | Grey only for genuinely secondary text, **never** for instructions, hints or labels. Hints use charcoal at regular weight | Contrast sensitivity drops with age; important guidance must be at full contrast |
| Amber marks one data point *or* one action | Amber marks the **next action** only. Highlighted data uses weight and a charcoal underline bar, not amber | Older users told "look for the gold button" should never find two gold things |
| No status colours in the palette | Adds four **status colours** (good, caution, over/stop, info), each always paired with an icon and words | Costs over budget, stale prices and failed "must" questions need a status language. Colour alone is never the signal |
| No client JavaScript, static pages | Interactive app (React) | It is an app. The website's restraint becomes restraint in *behaviour*: nothing moves unless the user did something |
| Light only | Light **and** dark theme (SPEC §9), plus a high-contrast option | Some older users find dark mode easier in the evening or with cataracts; others need maximum contrast |
| Corner radius 5px, used only on the mark | Radius 8px on controls and cards, 12px on panels | Slightly softer shapes help separate touch targets; still restrained |

### 2.3 Product name and lockup

- Product name in the UI: **Provider Assessor** (full: "Support at Home Provider Assessor").
- Endorsement line under the name in the header and on print: **"from Quantivate"**, in grey, 14px.
- **App mark:** a 3×3 grid of 6px squares, 3px gaps, 1px radius; eight cells in charcoal at 25% opacity,
  the centre-right cell (position 6) in amber. On the charcoal header the resting cells use `--on-dark-quiet`.
- Do not use the Quantivate animated logo inside the app. It belongs to the company website.
- Before any public release: confirm the Quantivate trade mark clearance noted in the Quantivate design brief §11.

### 2.4 Personality

| We are | We are not |
|---|---|
| Steady, like a good GP explaining test results | Cheerful, bubbly, "Yay! You did it!" |
| Plain and specific: "BlueCare costs $4,512 a quarter more than your services budget" | Vague: "This provider may exceed your budget" |
| On your side, not the providers' | A comparison site selling leads |
| Honest about uncertainty: "Not published — we used the benchmark price" | Falsely precise |

---

## 3. Design tokens

All values live in `design/tokens.css` as CSS custom properties and a Tailwind v4 `@theme` block.
Components must use tokens; never hard-code a hex value or pixel size in a component.

### 3.1 Colour — light theme (default)

All contrast ratios measured against the background they are used on.

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--paper` | `#F4F1EA` | Page background | — |
| `--surface` | `#FFFDF8` | Cards, inputs, tables, dialogs | — |
| `--sunken` | `#EAE5DA` | Wells, table headers, the help panel background | — |
| `--charcoal` | `#2E3236` | Body text, headings, icons, hints | 11.45 on paper · 12.71 on surface |
| `--grey` | `#676C71` | Secondary text on paper/surface only (timestamps, "as at") | 4.70 on paper · 5.22 on surface |
| `--grey-strong` | `#5C6166` | Secondary text on `--sunken` | 4.98 on sunken |
| `--line` | `#7A7F84` | Input borders, control outlines (non-text 3:1) | 3.58 on paper · 3.98 on surface |
| `--rule` | `rgba(46,50,54,.18)` | Decorative dividers only — never the only edge of a control | — |
| `--amber` | `#E8A33D` | The one primary action; the app mark's signal cell; selected step | Charcoal text on amber 5.99 |
| `--amber-press` | `#D9942F` | Hover/pressed amber | Charcoal on it 5.06 |
| `--amber-tint` | `#FBEFD9` | Background of the current step in the journey bar | Charcoal on it 11.35 |

**Status colours** (always with icon + word; text colour on its own tint ≥ 5:1):

| Status | Text/icon | Tint | Meaning in this app | Icon |
|---|---|---|---|---|
| `good` | `#2F6B4F` | `#E6F0EA` | Within budget; ≥ 5% below benchmark; "must" question answered | ✓ check |
| `caution` | `#8A5A12` | `#FBEFD9` | Price stale (> 60 days); filled from benchmark; "unsure" answer; travel/admin fee mentioned | ! triangle |
| `stop` | `#B3261E` | `#FBE9E7` | Over budget; ≥ 5% above benchmark; "must" question unanswered → "disqualify?" | ✕ octagon |
| `info` | `#2F5D7C` | `#E7EEF3` | DVA prompts, rule explanations, "did you know" | i circle |

Note `caution` text is a deep amber-brown, not signal amber. **Signal amber never appears as text** on a
light background (1.91:1).

### 3.2 Colour — dark theme

| Token | Hex | Contrast |
|---|---|---|
| `--paper` | `#1E2124` | — |
| `--surface` | `#2A2E32` | — |
| `--sunken` | `#17191C` | — |
| `--charcoal` (text) | `#ECE8E0` | 13.24 on paper |
| `--grey` | `#ADB2B8` | 7.58 on paper · 6.41 on surface |
| `--line` | `#858B91` | 4.70 on paper · 3.97 on surface |
| `--amber` | `#E8A33D` | Text on amber is `#1E2124` (7.50) |
| `good` / `caution` / `stop` / `info` text | `#7FC4A0` / `#F2C77A` / `#FF9E99` / `#8FB8D6` | 7.94 / 10.19 / 8.17 / 7.70 on paper |

Status tints in dark mode are the status colour at 14% opacity over `--surface`.

### 3.3 High-contrast option

A toggle in **Display settings** (§5.6). Sets background `#FFFFFF`, text `#000000`, `--line` `#000000`, borders
2px, removes all tints except status tints, underlines every link and turns secondary grey into charcoal.
Respects `prefers-contrast: more` automatically.

### 3.4 Typography

| Token | Value | Notes |
|---|---|---|
| `--font-ui` | `'Archivo', 'Helvetica Neue', Arial, sans-serif` | All UI. Use `font-variant-numeric: tabular-nums` for every money, rate and hour figure |
| `--font-read` | `'Newsreader', Georgia, serif` | Help panel body, explainers > 3 sentences, printed pack |
| `--text-base` | `18px` (user setting: 18 / 20 / 22 / 24) | Everything scales from this via `rem` |
| `--leading` | `1.55` UI · `1.65` reading | |
| `--measure` | `66ch` | Max line length for any paragraph |

Type scale (at 18px base):

| Role | Size | Weight | Line height |
|---|---|---|---|
| Page title (`h1`, one per screen) | 2rem (36px) | 600 | 1.15 |
| Section (`h2`) | 1.5rem (27px) | 600 | 1.2 |
| Card / group title (`h3`) | 1.2rem (21.6px) | 600 | 1.3 |
| Body / labels / buttons | 1rem (18px) | 400 / 500 for labels and buttons | 1.55 |
| Big figure (headline cost, budget) | 2.25rem (40px) | 600, tabular | 1.1 |
| Small (as-at dates, sources) | 0.875rem (15.75px) — **minimum size anywhere** | 400 | 1.5 |

Rules: sentence case everywhere; never all-caps for more than two words; never italic for more than a phrase;
no text below 15.75px (0.875rem at the default base); bold for emphasis, not colour.

Font loading: self-host Archivo and Newsreader (e.g. `@fontsource`) so the app makes no third-party requests,
matching the Quantivate rule. Weights: Archivo 400/500/600, Newsreader 400/400 italic.

### 3.5 Space, size and shape

| Token | Value |
|---|---|
| Spacing scale (8px base) | `--s1` 8 · `--s2` 16 · `--s3` 24 · `--s4` 32 · `--s5` 48 · `--s6` 72 |
| `--target-min` | **48px** — minimum height and width of anything tappable (WCAG 2.2 AA asks for 24px; we choose 48px) |
| `--target-gap` | 8px minimum between adjacent targets |
| `--radius-control` | 8px (buttons, inputs, chips) |
| `--radius-panel` | 12px (cards, dialogs, help panel) |
| `--border-control` | 1.5px `--line`; 2px when focused or invalid |
| `--wrap` | 1120px content max width; 760px for single-column forms |
| Elevation | One level only: `0 1px 2px rgba(46,50,54,.08), 0 4px 12px rgba(46,50,54,.06)` for dialogs and the help panel. Cards use a border, not a shadow |

### 3.6 Motion

- Durations 120–200ms, ease-out. Only for: opening/closing disclosures, the help panel sliding in, a row
  moving after reorder, the "Saved" indicator.
- **Nothing moves on its own.** No auto-advancing, no carousels, no attention-seeking pulses, no timeouts.
- `prefers-reduced-motion: reduce` → all transitions instant.
- The grid-motif "working" state (§6.14) fades cells in at 70ms intervals; with reduced motion it shows a
  static grid with the amber cell lit and the word "Working…".

### 3.7 Iconography

- Line icons, 1.75px stroke, 24px default (Lucide is acceptable — ask before adding the dependency).
- **Every icon has a visible text label**, except the close (✕) button, which has an accessible name and a
  48px target. No icon-only toolbars.
- Status icons differ in **shape**, not just colour (check / triangle / octagon / circle) so they work in
  greyscale print and for colour-blind users.

---

## 4. Layout and navigation

### 4.1 Page frame

```
┌───────────────────────────────────────────────────────────────────────────┐
│ HEADER (charcoal)  [mark] Provider Assessor        Help ?   Display Aa  ☰ │
│                    from Quantivate                                        │
├───────────────────────────────────────────────────────────────────────────┤
│ JOURNEY BAR   ① Your situation  ② Compare  ③ Choose who to meet  ④ Interview & decide │
├───────────────────────────────────────────────────────────────────────────┤
│ STATUS STRIP (only when needed: preview mode, stale data, unsaved)        │
├───────────────────────────────────────────────────────────────────────────┤
│  Breadcrumb: Compare › Relative costs                    ✓ Saved 2:14 pm   │
│                                                                           │
│  H1  Compare the cost of your care plan                                   │
│  One-sentence purpose of this screen, in charcoal.                        │
│  [What is this screen for?]  ← opens help panel                           │
│                                                                           │
│  ……… screen content ………                                                   │
│                                                                           │
│  ┌ NEXT STEP CARD ───────────────────────────────────────────────────────┐ │
│  │ You've compared 6 providers. Next: pick which ones to look at closer. │ │
│  │                                    [ Back ]  [ Continue to shortlist ]│ │
│  └───────────────────────────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────────────────┤
│ FOOTER  General information only — not financial or legal advice. …       │
│         Prices as at … · Data sources · Accessibility · Privacy           │
└───────────────────────────────────────────────────────────────────────────┘
```

### 4.2 The journey bar (replaces the current nine-tab nav)

Nine flat tabs are too many to hold in mind. Group the SPEC §8 screens into **four phases** the user can
name out loud:

| Phase | Plain name in UI | Screens (route) |
|---|---|---|
| 1 | **Your situation** | Participant setup (`/`), Overview of rules and budget (`/overview`), Bounding questions → renamed **"What matters to you"** (`/bounding`) |
| 2 | **Compare** | Relative costs (`/costs`), Providers (`/providers`, `/providers/:id`) |
| 3 | **Choose who to meet** | Selection: Initial scan → Refinement → Interview shortlist (`/selection/:stage`) |
| 4 | **Interview & decide** | Interview pack (`/interview-pack`), Interviews (`/interviews…`), Scoring & decision (`/scoring`) |

Moving "What matters to you" into phase 1 is deliberate: the answers shape the interview pack, and people
answer them best while they are thinking about their own situation.

Behaviour:
- Each phase shows a number, its name, and a state: **Not started** (outline), **In progress** (amber-tint
  background, charcoal text, "In progress" label), **Done** (✓ and "Done"). State is words, not only colour.
- Selecting a phase opens a short list of its screens, each with its own ✓ when complete.
- **Never locked.** Users may jump anywhere. If a screen needs earlier data, it shows a *dependency card*
  (§6.12) instead of being disabled.
- At ≤ 720px the bar becomes "Step 2 of 4 · Compare ▾" — a single button that opens the full list.

### 4.3 Screen anatomy (every screen)

1. **Breadcrumb** (phase › screen) and the **Saved** indicator.
2. **`h1`** — a plain statement of the task ("Compare the cost of your care plan", not "Relative costs").
3. **Purpose line** — one sentence: what this screen does for you.
4. **"What is this screen for?"** link → opens the help panel at this screen's topic.
5. Content.
6. **Next step card** — what you have done, what comes next, Back and Continue. Continue is the screen's
   amber primary action unless a more important action exists on the screen.

### 4.4 Responsive

| Width | Layout |
|---|---|
| ≥ 1120px | Content max 1120px; help panel opens as a 400px side column, pushing content (does not cover it) |
| 721–1119px (tablets, landscape) | Help panel overlays from the right at 420px with a scrim; tables keep columns, scroll horizontally inside their own frame with a visible "Scroll for more →" cue |
| ≤ 720px (phones, tablets portrait) | Single column; tables become stacked cards (§6.8); help panel full-screen sheet; journey bar collapses |
| Zoom 200% / text 24px | No horizontal page scroll; nothing clipped; labels wrap |

---

## 5. The helper system

The heart of this spec. Help is **layered**, so a confident user is never slowed down and an unsure user is
never stuck. Each layer is a reusable component with content stored as data (`data/help.json`, §5.8), so
wording can be reviewed and updated without code changes.

```
L0  Plain labels           "Weekly hours", not "hours_per_week"
L1  Hint text              Always visible, under the label, full contrast
L2  "What does this mean?" Inline disclosure: 2–4 sentences + optional example
L3  Help panel             Per-screen guide: purpose, steps, common questions, troubleshooting
L4  Glossary terms         Dotted-underlined terms → definition on tap
+   "Why this number?"     Calculation breakdown for every derived figure
+   "Where this came from" Source and as-at date for every price and rule
+   Self-resolution cards  Empty, missing, stale, blocked and error states with the fix
+   Family notes           Leave a note for (or from) a family helper on any screen
```

### 5.1 L1 — Hint text

- Sits between the label and the control. Charcoal, regular weight, 1rem. **Not grey, not a placeholder.**
- Says what to enter and where to find it: *"The level on your My Aged Care approval letter, from 1 to 8.
  If you moved over from a Home Care Package, choose 'Transitioned HCP' and your level."*
- Placeholders are never used to carry instructions (they vanish when typing and fail contrast).

### 5.2 L2 — "What does this mean?" disclosure

- A text button with an ⓘ icon and the words "What does this mean?" (or a specific question: "Why 10%?",
  "What is a contribution?"). 48px target.
- Expands inline (pushes content down; never a hover tooltip, never a popover that covers the field).
- Contains: 2–4 plain sentences; optionally a **worked example** in a sunken box using the user's own
  numbers when available ("With a transitioned Level 3 budget of $10,808 a quarter, $1,081 goes to
  care management and $9,727 is left for services"); optionally a "Read more" link into the L3 panel.
- Stays open until closed. State remembered per user for the session.

### 5.3 L3 — Help panel

Opened from the header **Help ?** button, from "What is this screen for?", or by pressing `?`.

Structure for every screen topic:

| Section | Content |
|---|---|
| **What this screen is for** | 1–2 sentences |
| **What to do here** | Numbered steps (3–6) |
| **What you'll have at the end** | The outcome, so the user knows when they're finished |
| **Common questions** | 3–6 expandable Q&As specific to the screen |
| **If something looks wrong** | Troubleshooting: symptom → cause → fix (see §5.7) |
| **Words on this screen** | Glossary entries used on the screen |
| **Talk to a person** | My Aged Care 1800 200 422; DVA 1800 VETERAN (1800 838 372); Older Persons Advocacy Network 1800 700 600. Phone numbers must be confirmed before release and stored in `data/help.json`, not in components |

Behaviour: panel title shows which screen it's about; a search field ("Search help") searches all topics and
the glossary; the panel keeps scroll position; `Esc` closes and returns focus to the button that opened it.
Body text in the panel uses `--font-read` (Newsreader) at the user's text size.

### 5.4 L4 — Glossary terms

- First use of a jargon term on a screen gets a dotted charcoal underline and is a button. Tapping it shows
  a small inline definition card under the line of text (not a hover tooltip) with "More in Help".
- Only the **first** occurrence per screen is marked, to avoid a page full of underlines.
- Minimum glossary (wording to be reviewed by a human, as SPEC requires):
  Support at Home · classification · quarterly budget · care management (10%) · contribution ·
  Clinical / Independence / Everyday living categories · full pensioner / part pensioner / self-funded ·
  no-worse-off principle · lifetime cap · carry-over · benchmark (IHACPA) · single provider rule ·
  Veterans' Home Care · Gold / White Card · AT-HM · price "as at" · "must" question · bounding question
  (shown as "What matters to you" question) · weighted score.

### 5.5 "Why this number?" and "Where this came from"

Every derived figure (plan cost, contribution, over-budget amount, variance %, years to lifetime cap,
weighted score) is a button-styled figure with a small "Why?" affordance. Activating it opens a breakdown:

```
Bolton Clarke — quarterly cost $12,701
─────────────────────────────────────────────────────────
Personal care     $78.50 × 6 hrs × 13 weeks   = $6,123
Domestic          $72.00 × 3 hrs × 13 weeks   = $2,808
Gardening         $68.00 × 1 hr  × 13 weeks   =   $884   ⚠ filled from benchmark
…
Total                                          $12,701
Your services budget                           $9,727
Over budget by                                 $2,974   ✕
─────────────────────────────────────────────────────────
13 weeks = one quarter. Prices as at 1 Oct 2026 · Source ↗
```

(Totals from the SPEC §5 reference table and the HCP Level 3 budget; line items illustrative.) Every price shows **"as at {date}"** and a **Source ↗** link that opens in a new tab
with the text "(opens in new tab)" for screen readers. Benchmark-filled values are marked with the caution
icon and the words "filled from benchmark" — never only an asterisk.

### 5.6 Display settings (header "Aa")

A small panel, remembered per device:
- **Text size:** Standard (18) · Large (20) · Larger (22) · Largest (24) — shown as live "Aa" samples.
- **Theme:** Light · Dark · Match my device.
- **High contrast:** On / Off.
- **Reduce motion:** On / Off / Match my device.
- **Show all hints:** On (default) / Off — for confident users who want a denser screen; L2+ help remains.

### 5.7 Self-resolution patterns

Every non-happy state uses one **self-resolution card**: icon + status word, what happened, why it matters,
and one primary fix (plus an optional secondary). Never a dead end, never just "Error".

| Situation | Card text (pattern) | Fix action |
|---|---|---|
| No participant set up | "We need a few details about you first. The costs and budgets on this screen depend on your classification and pension." | **Set up your details** (→ `/`) |
| Classification chosen, no care plan | "Your care plan is empty, so there is nothing to cost yet." | **Start from the sample plan** · Add a service |
| Provider rate missing | "⚠ Not published. Bolton Clarke hasn't published a gardening price, so we used the benchmark ($68.00). Ask them at interview." | **Add to interview questions** · Enter a price |
| Price older than 60 days | "⚠ Prices may be out of date. These were collected on 2 Aug 2026 (84 days ago). Providers must review prices every two months." | **Update prices** · Check source ↗ |
| Travel/admin fee mentioned in notes | "⚠ Possible extra fee. The notes mention a travel fee. Support at Home prices must be all-inclusive." | **Add to interview questions** |
| Plan over budget for every provider | "✕ Your plan costs more than your budget at every provider. You could reduce hours, ask about DVA services, or check unspent funds carried over." | **Adjust plan hours** · What are my options? |
| DVA card overlaps planned services | "ⓘ You may be able to get gardening through Veterans' Home Care, which would save your Support at Home budget. Check with DVA — we can't confirm eligibility." | **Add to my questions for DVA** |
| Fewer than 2 providers shortlisted | "Interviewing at least two providers helps you compare." | **Go to the shortlist** |
| "Must" question not answered by a provider | "✕ Disqualify? Anglicare hasn't answered 2 must-ask questions in writing." | **See the questions** |
| Storage blocked (private browsing) | "Your browser isn't letting us save. Your work will be lost when you close this tab." | **How to fix this** · Download a copy |
| Recording / microphone denied | "We can't reach your microphone. Your browser blocked it." | **Show me how to allow it** (browser-specific steps) · Type notes instead |
| Network failure drafting notes | "We couldn't draft the notes just now. Your transcript is safe on this device." | **Try again** · Write notes myself |
| Seed data failed validation | "Some built-in data couldn't be loaded (providers.json, line 14). The app can't calculate costs until this is fixed." | Show technical details (for the family helper) |

Form validation follows the same pattern: errors appear **under the field** on leaving it (not on every
keystroke), in `stop` colour with the octagon icon, saying how to fix: *"Enter a whole number of hours
between 0 and 40. For half an hour, enter 0.5."* An error summary at the top of the form links to each field
on submit.

### 5.8 Help content model

`data/help.json` (loaded and validated with zod at start-up, like other seed data):

```ts
HelpTopic   { id, screen_route, title, purpose, steps[], outcome, faqs[{q, a}],
              troubleshooting[{symptom, cause, fix, action_route?}], glossary_ids[] }
GlossaryTerm{ id, term, plain, example?, more_topic_id?, source_url? }
FieldHelp   { field_id, label, hint, explain?, example_template? }   // example_template uses {budget} etc.
Contact     { id, name, phone, hours, url, purpose, verified_on }
```

All help copy is reviewed by a human before release (SPEC rule for Australian Consumer Law wording applies).

### 5.9 Family notes and handover

- **Leave a note** (on any screen, from the screen's overflow and the help panel): free text, labelled
  author ("Me" / "Family helper" / a typed name), timestamp. Shown as a note card at the top of that screen
  until marked done.
- **Who's using this now?** An optional switch in the header menu: "I'm the person receiving care" / "I'm
  helping someone". It changes pronouns in copy ("your budget" ↔ "Dad's budget" using the participant's
  first name) and nothing else. It is **not** a login and grants nothing.
- **Decision summary** (end of phase 4, also printable at any time): participant situation, budget, plan,
  costs table, shortlist with reasons, interview highlights, scores, decision and open notes — so a family
  member who wasn't present can catch up in five minutes.
- No data leaves the device for sharing in v1 (SPEC §10). Sharing = print or download PDF.

---

## 6. Components

All components meet: 48px targets, visible focus (amber + charcoal rings), keyboard operability, accessible
names, and states for default / hover / focus / pressed / disabled / invalid / loading.

### 6.1 Buttons

| Variant | Look | Rule |
|---|---|---|
| **Primary** | Amber fill, charcoal text, 500 weight, 48px min height, 20px horizontal padding | **One per screen.** The next step |
| **Secondary** | Surface fill, 1.5px `--line` border, charcoal text | Everything else |
| **Quiet** | Text only, charcoal, underlined on hover/focus | Disclosures, "What does this mean?", "Why?" |
| **Danger** | Surface fill, `stop` border and text, octagon icon | Remove/drop/delete; always confirmed or undoable |

- Label = verb + object: "Add provider", "Save score", "Continue to shortlist". Never "OK", "Submit", "Go".
- Disabled buttons are avoided. If an action isn't available, show it enabled and explain on press, or show
  the dependency card. If disabled is unavoidable, the reason is written next to it.

### 6.2 Text and number inputs

- Label above (500 weight), hint below label, control below hint, error below control.
- Height 52px, 1.5px `--line` border, surface fill, 8px radius; 2px charcoal border on focus plus focus ring.
- Money fields: "$" prefix inside the field, `inputmode="decimal"`, accepts "1,234" or "1234.50".
- Hours: number field **with − / + steppers** (48px each) in steps of 0.25 (15-minute claiming, SPEC §3.5);
  displays "1 hr 15 min" beside the number.
- Postcode/suburb: type-ahead with a full list fallback; never a 4,000-item select.

### 6.3 Choice controls

- **Choice cards** for yes / no / unsure and other ≤ 5-option questions: full-width tappable cards with a
  radio circle, the label, and optional one-line description. Selected = 2px charcoal border + amber-tint
  fill + ✓ ("Selected" for screen readers). Never a tiny radio dot alone.
- Checkboxes 28px box inside a 48px target.
- Switches only for settings that take effect immediately (display settings). Never for answers.
- Selects only for > 7 options; native `<select>` styled to 52px.

### 6.4 Money and figures

- AUD via `Intl.NumberFormat('en-AU', {style:'currency', currency:'AUD', maximumFractionDigits:0})`;
  hourly rates show cents (`$78.50`). Rates `5%` / `17.5%`.
- Tabular numerals, right-aligned in tables.
- Always say the period: "$12,701 **a quarter**", "$2,974 **over budget a quarter**". Offer a
  "Show per year / per week" toggle on the costs screen; quarter is the default because budgets are quarterly.
- Negative amounts written as words where possible ("$420 under budget") rather than "−$420".

### 6.5 Price cell (extends `src/components/Price.tsx`)

`$78.50 /hr` · line 2 small: "as at 1 Oct 2026 · Source ↗". States: published (default), filled from
benchmark (caution icon + words), stale (caution chip "84 days old"), not published and no benchmark
("—  Not published" in grey, with "Ask at interview").

### 6.6 Variance chip

`▲ 8% above benchmark` (stop) · `▼ 6% below benchmark` (good) · `Within 5% of benchmark` (neutral, no colour).
Arrow + words + colour; thresholds from `src/rules.ts` (±5%).

### 6.7 Cost-vs-budget chart (Relative costs)

- Horizontal bars, one per provider, sorted cheapest first, provider name left of bar (not in a legend).
- Bars charcoal; bars over budget use a `stop` hatched pattern **and** the label "Over by $2,974" at the bar end.
- Services budget as a vertical **dashed** charcoal line labelled directly "Your services budget $9,727".
- Benchmark row in grey with the label "Benchmark (guide only)".
- Below the chart, the same data as an accessible table ("Show as table" toggle; table is what prints).
- No interactions required to read it: values are printed on the bars, not in hover tooltips.

### 6.8 Tables and their mobile cards

- Row height ≥ 56px, zebra striping off; 1px `--rule` row dividers plus a sunken header row.
- Sortable columns: header is a button with the sort direction in words ("Sorted by cost, lowest first").
- First column sticky when horizontally scrolling.
- ≤ 720px: each row becomes a card: provider name as `h3`, key figure large, other fields as a definition
  list, actions at the bottom as full-width buttons.

### 6.9 Accordion (What matters to you; interview sections)

- Header row: chevron + title + status ("4 of 6 answered", "Included · 7 questions"). Whole row is the
  button, 56px min.
- "Open all / Close all" control above.
- Opening one does **not** close others (older users lose their place when content jumps).

### 6.10 Stage board (Selection)

- Three columns on desktop (Initial scan · Refinement · Interview shortlist), stacked sections on mobile.
- Each provider card: name, headline cost vs budget, variance chip, flag count, notes count, and explicit
  buttons **"Move to Refinement →"**, **"← Back to Initial scan"**, **"Drop"**. Drag is an optional extra,
  never the only way.
- Shortlist order: "Move up" / "Move down" buttons plus drag handle (keyboard: select then arrow keys).
- Dropping shows an inline "Dropped Bolton Clarke. **Undo**" bar that stays until dismissed or the next
  action (no timed toast).

### 6.11 Score input (Scoring & decision)

- Segmented control of five 56px buttons labelled **1 Poor · 2 Weak · 3 OK · 4 Good · 5 Excellent**, the words
  visible, not only numbers. Criterion name, weight ("counts double") and a one-line "What good looks like".
- Matrix view on desktop (criteria rows × providers columns); one-provider-at-a-time view on tablets/phones.
- Weighted total shown live with "Why this number?" breakdown.

### 6.12 Dependency card

Used when a screen needs data from an earlier step. Info status, says what's missing and links directly:
*"To cost your plan we need your classification. **Add your classification** (takes about 1 minute)."*
Time estimates help people decide whether to do it now.

### 6.13 Saved indicator and undo

- Autosave on change. Header-right shows "✓ Saved 2:14 pm" (grey, small). On failure it changes to the
  storage self-resolution card.
- Every destructive action is either undoable (undo bar) or confirmed in a dialog that names the thing:
  "Delete the note from 12 Oct about weekend staff?" with **Delete note** (danger) and **Keep note**.

### 6.14 "Working…" state (grid motif)

For anything > 400ms (drafting interview notes, PDF export): the 3×3 grid, cells fading in, the amber cell
last, with a sentence saying what's happening and roughly how long: "Drafting notes from your transcript.
This usually takes about 20 seconds." Plus **Cancel**. Never a spinner without words.

### 6.15 Recorder (Interview capture)

- One large 72px round **Record** button (stop colour dot icon + word "Record"), elapsed time in big tabular
  figures, a live level meter, and **Pause** / **Stop and save** as labelled buttons.
- Consent step before recording: a checkbox card "Everyone on this call has agreed to be recorded" — Record
  stays available but pressing it without consent explains why it can't start.
- Persistent banner while recording: "● Recording — stored on this device only".
- Live transcription disclosed in plain words: "Your browser's speech service turns speech into text. On some
  browsers this sends audio to Google or Apple."

### 6.16 Disclaimer footer

Fixed text on every page, charcoal on paper at 0.875rem minimum, never collapsed:
"General information only — not financial or legal advice. Check prices and eligibility with the provider,
My Aged Care and DVA before deciding." Plus links: Data sources · Accessibility · Privacy.

---

## 7. Screen specifications

Each screen lists purpose (purpose line), layout, helpers and self-resolution. Copy is indicative; final copy
goes through human review.

### Phase 1 — Your situation

**1. About you** (`/`, SPEC Participant setup) — *"Tell us about your situation so we can work out your
budget and what you'll pay."*
- Single-column form (760px), grouped into short fieldsets with `h2`s: Where you live · Your approval ·
  Your pension · DVA card · Contributions paid so far.
- Derived results update live in a sticky side summary (desktop) / a summary card at the end (mobile):
  "Your contribution rates: Independence 5% · Everyday living 17.5% · Clinical 0%" with "Why these rates?".
- Helpers: hint text on every field naming the letter where the user finds the answer (My Aged Care approval
  letter; DVA or Services Australia income and assets letter). Part-pensioner path explains that the rate is
  on the letter and offers "I don't have my letter yet — use a range" (uses low/high band).
- DVA prompts (info cards) appear when card type is Gold or White.
- No-worse-off: a yes / no / "I'm not sure" choice card with "How do I know?" explanation (approved for a
  Home Care Package on or before 12 Sep 2024).
- Privacy note at the top: "Stored only on this device. We ask only what's needed to work out costs."

**2. Your budget and the rules** (`/overview`) — *"See your budget and the rules that affect what you pay."*
- Hero figures: quarterly budget, care management (10%), **available for services** (largest), carry-over cap.
- A simple stacked bar: "Of your $10,808 a quarter: $1,081 care management · $9,727 for services".
- Contribution table by category with the user's rates and a plain example for each ("For an hour of
  cleaning at $72, you'd pay $12.60").
- "Rules that changed recently" card: personal care moved to Clinical (0%) from 1 Oct 2026; price caps
  deferred. Each with date and source.
- Lifetime cap: years-to-cap figure with "Why this number?".

**3. What matters to you** (`/bounding`, SPEC Bounding questions) — *"Answer these so your interview
questions fit your needs. You can skip any question."*
- Accordion of the 8 groups; choice cards (Yes / No / Not sure) per question; "Not relevant to me" as a
  separate quiet action that rules sections out (SPEC §6).
- Live counter, sticky on desktop: "Your interview pack: **58 questions** in 14 sections (all must-ask
  questions are always included)".
- Each question's L2 disclosure explains *why we ask* and which interview sections it affects.
- Unsure answers are treated as include, and say so: "We'll keep these questions in, just in case."

### Phase 2 — Compare

**4. Compare costs** (`/costs`, SPEC Relative costs) — *"See what your care plan would cost at each
provider, and what you'd pay yourself."*
- Top: headline sentence generated from the data: "Your plan costs between **$12,500** and **$14,239** a
  quarter — a difference of 14%." (amber not used here; bold charcoal).
- Section A **Your care plan** editor: rows of service · category (with glossary) · hours per week (stepper) ·
  remove. "Start from the sample plan" when empty. Category column shows the dated-rule note for personal care.
- Section B chart (§6.7) + table.
- Section C **What you'd pay** table: contribution low–high per provider, as a range with "Why a range?".
- Section D **Prices vs benchmark** variance table with chips.
- Helpers: "What is the benchmark?" (IHACPA advice, not a cap); "Why 13 weeks?"; over-budget self-resolution.

**5. Providers** (`/providers`, `/providers/:id`) — *"Look up providers near you and check their prices and
notes."*
- Search field (by name) + filters as choice chips (Has veteran experience · Prices up to date · No flags).
- Sortable table/cards with flags, as-at, source links.
- Provider detail: rates grid with Price cells, flags explained in sentences, notes (manual and from
  interviews), "Add to shortlist" as primary, Edit prices, Add note.
- Add / edit provider form; CSV import with a preview step showing exactly which rows will be added and
  which have problems (row-level self-resolution).

### Phase 3 — Choose who to meet

**6. Choose who to meet** (`/selection/:stage`) — *"Narrow down from all providers to the few you'll
interview."*
- Stage board (§6.10). Stage tabs show counts. Guidance line per stage:
  - Initial scan: "Anyone who services your area. Keep anyone worth a second look."
  - Refinement: "Compare costs and flags. Aim for 3 to 5."
  - Interview shortlist: "Put them in order. Add why you chose them and what to watch for."
- "Why" and "Watch for" fields per shortlisted provider; "Watch for" items flow into the interview pack as
  provider-specific prompts.

### Phase 4 — Interview & decide

**7. Interview pack** (`/interview-pack`) — *"Your questions for each provider, ready to use or print."*
- Section list (A–Q) with counts; each question shows a **Must ask** badge (charcoal outline, not colour only)
  where applicable; "Add your own question" per section.
- Per-provider response columns (desktop) / one provider at a time with a provider switcher (tablet/phone).
  Each response: text area + "Answered well? Yes / Partly / No" choice chips + "Got it in writing" checkbox.
- Primary action: **Print or save as PDF**. Print layout in §10.

**8. Interviews** (`/interviews`, `/interviews/new/:providerId`, `/interviews/:id`) — *"Record or note an
interview, then turn it into notes you can review."*
- Capture: consent → recorder (§6.15) → transcript (editable) → **Draft notes** (working state) → review.
- Review: drafted notes shown beside the transcript; every drafted item has Keep / Edit / Remove; unanswered
  must-ask questions listed as follow-ups. Nothing is saved to the provider until the user presses
  **Save to provider notes** (nothing auto-confirmed).

**9. Score and decide** (`/scoring`) — *"Score each provider you met and see how they compare."*
- Weights shown as "counts double" / "counts once", editable under "Change what matters most".
- Score inputs (§6.11); live ranked result with the disqualify flag; "Decision notes" text area.
- Primary action: **Make the decision summary** (opens printable summary, §5.9).
- Closing guidance card: "Before you sign: ask for the service agreement in writing, check the exit terms,
  and confirm prices are all-inclusive." Links to the relevant interview questions.

### First-run and return

- **First run:** a single welcome screen (not a carousel): what the app does in three sentences, the four
  phases as a list with time estimates, "Your information stays on this device", and **Get started**. A
  "Helping someone else?" link sets the family-helper copy mode.
- **Returning:** a "Welcome back" card at the top of the last-visited screen: "Last time you were scoring
  providers. 2 of 3 scored." with **Continue** and "See everything you've done".

---

## 8. Accessibility and age-friendly requirements

Baseline WCAG 2.2 AA (SPEC §9). In addition, for this audience:

| Requirement | Standard |
|---|---|
| Minimum text | 15.75px anywhere; 18px default body; user scaling to 24px without loss |
| Target size | 48 × 48px minimum, 8px apart |
| Contrast | 4.5:1 all text including secondary; 3:1 for control borders, focus and chart marks; hints at full charcoal |
| Colour independence | Every status has icon shape + words; charts have labels on marks |
| No hover-only content | All tooltips are tap/click disclosures; nothing essential on hover |
| No time limits | No timeouts, no auto-dismiss toasts, no auto-advance |
| Predictability | Primary action in the same place (next step card, bottom right on desktop, full width at the bottom on mobile); nav never changes order |
| Memory load | Each screen states where you are, what you've done, and what's next; the user never has to remember a number from another screen — it's repeated where needed |
| Error tolerance | Undo or confirm on every destructive action; autosave; forms keep input on error |
| Plain language | Target reading age ~ Year 8; jargon defined in place (§9) |
| Keyboard | All functions; logical order; skip link "Skip to main content"; `?` opens help, `Esc` closes overlays |
| Screen readers | Landmarks; one `h1`; live region for the saved indicator, counters and "working" state; tables with `<th scope>`; chart has a text alternative and the data table |
| Motion | §3.6 |
| Hearing | Nothing relies on sound; recordings have editable transcripts |
| Dexterity | Drag is never required; steppers alongside number entry; generous spacing between destructive and safe actions |
| Cognitive | One primary action per screen; progressive disclosure for detail; consistent wording for the same thing everywhere |

**Testing:** automated (axe via Vitest/Testing Library) on every screen; manual keyboard and screen-reader
pass (VoiceOver on iPad, NVDA on Windows); and **at least five moderated sessions with people aged 65+**, two of
them with a family member present, before calling v1 done.

---

## 9. Content and voice

- Australian English (organise, colour, program for government programs), sentence case, active voice,
  "you" for the person receiving care.
- Lead with the answer, then the detail. "You'd pay about $811 a quarter. Here's how we worked that out."
- Specific numbers over adjectives; say the period and the source.
- Banned (from the Quantivate rules, plus consumer additions): leverage, unlock, transform, journey,
  solutions, seamless, cutting-edge, revolutionary, "powered by AI", hassle-free, simply, just, easy,
  "Oops!", "Uh-oh".
- Never claim eligibility. Say "You may be able to…" + "Check with DVA".
- AI use is disclosed where it happens: "Notes drafted by Claude from your transcript. Check them before saving."

Plain-language swaps used in UI labels (the formal term stays in the glossary):

| Program term | UI label |
|---|---|
| Participant | You / {first name} |
| Classification | Your level (Classification 1–8) |
| Bounding questions | What matters to you |
| Quarterly budget for services | Money for your services each quarter |
| Contribution | What you pay |
| Out-of-pocket range | What you might pay (lowest to highest) |
| Variance vs benchmark | Compared with the guide price |
| Benchmark (IHACPA) | Guide price (from the government's pricing advice) |
| Shortlist | Providers to interview |
| Must question | Must ask |
| Weighted score | Overall score |

---

## 10. Print and PDF

Print is a first-class output (Quantivate rule: pages get printed and attached to emails).

- `@media print`: hide header controls, journey bar, help panel, buttons; show URL of source links in full
  after the link text; black on white; A4 portrait; 12pt Newsreader body, Archivo headings.
- **Interview pack:** one provider per section of pages; cover page with provider name, date, interviewer,
  "Watch for" notes; each question numbered with a must-ask marker (■) and ruled answer lines (≥ 3 lines,
  ≥ 9mm apart, for handwriting); a "Got it in writing ☐" box per must-ask question; page footer with provider
  name, page x of y, disclaimer.
- **Decision summary:** two to four pages, as §5.9.
- Avoid breaking a question from its answer lines (`break-inside: avoid`).
- Status colours print as their icons and words; charts print as tables.

---

## 11. Implementation notes

- **Tokens:** import `design/tokens.css` into `src/index.css` (it contains the custom properties and a
  Tailwind v4 `@theme` block mapping `paper`, `surface`, `sunken`, `ink`, `ink-muted`, `line`, `signal`,
  `good`, `caution`, `stop`, `info`). Replace the current teal/slate utilities (`teal-700`, `slate-*`) in
  `src/index.css` component classes and `src/components/Layout.tsx`.
- **Theming:** keep the existing `.dark` class strategy; add `.hc` for high contrast and `data-text-size`
  on `<html>` for the text-size setting (sets root font-size).
- **Help:** new `data/help.json` + zod schema in `src/schemas.ts`; components `HintText`, `Explain`
  (L2), `HelpPanel` (L3), `Term` (L4), `WhyNumber`, `SourceNote`, `ResolutionCard`, `DependencyCard`,
  `NextStepCard`, `SavedIndicator`, `UndoBar`, `WorkingGrid`, `ChoiceCards`, `HoursStepper`, `ScoreInput`.
- **Navigation:** replace the flat `NAV` array in `Layout.tsx` with a `PHASES` structure (§4.2); completion
  state derived from app state (e.g. phase 1 done when participant + classification + rates are set).
- **No new dependencies without asking** (fonts, icons, drag-and-drop are candidates; `@dnd-kit` is already
  in the plan).

### Acceptance checklist (per screen)

- [ ] One `h1` written as a task; purpose line; "What is this screen for?" opens the right help topic
- [ ] At most one amber element (the primary action)
- [ ] Every input has label + hint; every jargon term defined on first use
- [ ] Every derived figure has "Why this number?"; every price has as-at + source
- [ ] Empty, missing-data, stale and error states each show a self-resolution card with a working fix
- [ ] Next step card present and correct
- [ ] 48px targets; keyboard-only run-through passes; axe reports no violations
- [ ] Works at 320px wide and at 24px text size with no horizontal page scroll
- [ ] Light, dark and high-contrast checked
- [ ] Prints legibly
- [ ] Disclaimer in footer
