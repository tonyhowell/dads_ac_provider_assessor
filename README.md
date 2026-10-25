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

- **Sign-in with passkeys only.** There are no passwords and no self sign-up. An admin creates each username and sends a one-time enrolment link (valid 24 hours), and the person creates a passkey on their own device.
- **Admin page:** add people, choose their role (administrator or family member), issue a new link (for a lost device or to add another device), view and remove passkeys, disable or re-enable access, and see when each person last signed in.
- **Shared assessment:** the selection, notes, interviews, transcripts and drafted notes are stored on the server, so every family member sees the same thing. Notes show who wrote them. Every change is logged with who made it and when.
- **Providers:** searchable list, filterable by selection stage, with "prices as at", source link and a warning once prices are over 60 days old.
- **Provider selection, in three stages:**
  1. **Initial scan:** providers you add from the full list for a first look.
  2. **Refinement:** the ones worth comparing more closely.
  3. **Interview shortlist:** the ones you'll interview, ranked, with "why" and "probe at interview" notes.
- **Interviews:** record in the browser after confirming consent, with optional live transcription. You can correct the transcript, have Claude draft structured notes, and save them to the provider's notes.
- The other screens are placeholders for the later phases in `docs/PLAN.md`.

### Security and privacy
- Passkeys are bound to the site's domain, so they can't be phished. The server stores only their public keys.
- Session cookies are HttpOnly, Secure and SameSite=Lax. State-changing requests must come from the app's own origin. Sign-in attempts are rate-limited, and pages carry a strict Content Security Policy.
- **Interview audio is never uploaded.** It stays on the device that recorded it, and only the transcript and notes are shared.
- If live transcription is on, the browser's speech service may send audio to the browser maker to convert it to text. You can turn this off.
- "Draft notes" sends only the transcript to Anthropic's API.
