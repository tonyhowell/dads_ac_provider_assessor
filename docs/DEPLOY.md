# Deploying to Railway at assessor.quantivate.com.au

The app is one Node service (API plus the built React app) and one Postgres database.

## 1. Create the Railway project

1. In Railway, create a project from the GitHub repo `tonyhowell/dads_ac_provider_assessor` (choose the branch to deploy).
2. Add a **Postgres** database to the same project.
3. Railway reads `railway.json`: it builds with `npm run build`, starts with `npm start`, and health-checks `/api/health`.

## 2. Service variables

Set these on the app service (Variables tab):

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference to the Postgres service) |
| `APP_ORIGIN` | `https://assessor.quantivate.com.au` |
| `BOOTSTRAP_ADMIN_USERNAME` | your username, e.g. `tony` |
| `ANTHROPIC_API_KEY` | your Claude API key (needed to draft interview notes) |

`NODE_ENV=production` is set by `npm start`. Railway sets `PORT`.

## 3. Custom domain and GoDaddy DNS

1. In the service's **Settings → Networking**, add the custom domain `assessor.quantivate.com.au`. Railway then shows the DNS records it needs, usually:
   - a **CNAME**: name `assessor`, value `<something>.up.railway.app`
   - sometimes a **TXT** verification record (name like `_railway-verify.assessor`).
2. In GoDaddy, go to **My Products → quantivate.com.au → DNS → Add record** and add each record exactly as Railway shows it (name `assessor`, not the full domain). Leave TTL at the default.
3. Railway issues the HTTPS certificate once DNS resolves. This usually takes a few minutes, and can take up to an hour.

Passkeys are bound to `assessor.quantivate.com.au`. If you change the domain later, everyone has to enrol again.

## 4. First admin

On first start with an empty database, the server creates the `BOOTSTRAP_ADMIN_USERNAME` admin and prints a one-time link in the deploy logs:

```
[bootstrap] Created admin "tony". Set up their passkey within 24 hours at:
  https://assessor.quantivate.com.au/enrol/…
```

Open it on your phone or computer and create your passkey. Then add family members on the **Admin** page.

If the link expires, or an admin loses every passkey, run this in the service's shell (or with `railway run`):

```
npm run admin:enrol -- tony "Tony"
```

It prints a fresh one-time link and re-enables the user if they were disabled.

## Data

- Shared in Postgres: users, passkeys (public keys only), sessions, the selection, notes, interview transcripts and drafted notes, and a log of every change (who and when).
- Never uploaded: interview audio, which stays in the browser of the device that recorded it.
- Back up the database with Railway's Postgres backups.
