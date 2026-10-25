# Support at Home Provider Assessor — starter pack

Open this folder in Claude Code and start with:

> Read CLAUDE.md and SPEC.md, then build the app following the build order in CLAUDE.md.

Contents: `SPEC.md` (product spec), `CLAUDE.md` (build instructions), `data/` (seed providers, IHACPA benchmark, budgets, contribution rates, sample plan, shortlist, 29 bounding questions, 74 interview questions).
Prices captured 25 Oct 2026 — refresh from My Aged Care before relying on them.

## Running the app

```bash
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY to enable interview notes
npm run dev            # http://localhost:5173
npm test               # unit and component tests
npm run build          # typecheck + production build
```

Use `npm run dev` or `npm run preview` (after `npm run build`). The interview-notes endpoint (`/api/interview-notes`) runs inside the Vite server, so the API key never reaches the browser. If you serve `dist/` as plain static files, the endpoint isn't there and notes can't be drafted.

**Seed data:** `data/` currently holds placeholders. See `data/README.md`.

## What works so far

- **Providers:** searchable list with "prices as at", source link and a warning once prices are over 60 days old. Each provider has a detail page with rates against the benchmark.
- **Assessment notes:** add, edit and delete notes on each provider.
- **Provider selection, in three stages:**
  1. **Initial scan:** providers you add from the full list for a first look.
  2. **Refinement:** the ones worth comparing more closely.
  3. **Interview shortlist:** the ones you'll interview, ranked, with "why" and "probe at interview" notes.

  You can move a provider forward or back a stage, or drop it, from the Selection page or the provider's own page. The Providers list can be filtered by stage.
- **Interviews:** record an interview in the browser after confirming consent, with optional live transcription (en-AU). Recordings are stored only in this browser (IndexedDB). You can correct the transcript, then have Claude draft structured notes (summary, strengths, concerns, commitments, prices mentioned, follow-ups) and save them to the provider's notes.
- The other screens are placeholders for the later phases in `docs/PLAN.md`.

### Privacy
- Audio never leaves the device.
- If live transcription is on, the browser's speech service may send the audio to the browser maker to convert it to text. The capture screen says so, and you can turn it off.
- "Draft notes" sends only the transcript (after you've reviewed it) to Anthropic's API.
