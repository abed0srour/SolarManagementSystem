# Deploying to Vercel

Two Vercel projects from this one repository:

| Project | Root Directory | What it is |
| --- | --- | --- |
| `solar-frontend` | `frontend` | Next.js app (zero config) |
| `solar-backend` | `backend` | NestJS API as a single serverless function |

Plus **Supabase** for Postgres and **Vercel Blob** for files.

Do the backend first — the frontend needs its URL.

---

## Supabase Auth

Identity is Supabase Auth, not the API. The browser signs in directly; NestJS
only verifies the tokens it is handed.

1. **Authentication → Hooks → Customize Access Token**: enable it and point it
   at `public.custom_access_token_hook`. Without this, `role` and `tenant_id`
   never reach the JWT, and every request falls back to the `app_metadata`
   mirror — workable, but the hook is the intended source.
2. **Authentication → URL Configuration**: set the Site URL to the frontend
   origin and add `<origin>/reset-password` as a redirect URL, or password
   recovery links will bounce.
3. **Authentication → Providers → Email**: leave signups disabled. Stores are
   provisioned by the super admin; nobody self-registers.

### Environment variables

| Where | Variable | Notes |
| --- | --- | --- |
| backend | `SUPABASE_URL` | project URL |
| backend | `SUPABASE_JWT_SECRET` | legacy HS256 secret; omit if the project signs with keys |
| backend | `SUPABASE_SERVICE_ROLE_KEY` | **server only** — creates and deletes accounts, bypasses RLS |
| backend | `APP_URL` | where invite and recovery links land |
| frontend | `NEXT_PUBLIC_SUPABASE_URL` | public |
| frontend | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public by design; RLS is what constrains it |

The service role key must never be given a `NEXT_PUBLIC_` name. Anything with
that prefix is compiled into the JavaScript every visitor downloads, and this
key can read and rewrite every store on the platform.

---

## Multi-tenancy

Each store is a `Tenant` row, and every business table carries `tenantId`.

Isolation is enforced in `backend/src/prisma/tenant-scope.ts`, a Prisma client
extension that rewrites every query: reads gain `WHERE tenantId = …`, writes are
stamped with it, and anything running with no tenant established is refused
outright rather than quietly spanning all of them.

RLS policies exist too (`supabase/migrations/…_rls_policies.sql`) but are
**defense-in-depth, not the primary boundary** — Prisma connects as the table
owner, and a table owner bypasses RLS in Postgres. They protect anything that
reaches the database with a user JWT instead: supabase-js from the browser,
Realtime, Edge Functions.

---

## 1. Supabase (database)

1. Create a project. Save the database password.
2. **Project Settings → Database → Connection string**. Take two URLs:
   - **Transaction pooler**, port `6543` → `DATABASE_URL`
   - **Session / direct**, port `5432` → `DIRECT_URL`
3. Append `?pgbouncer=true&connection_limit=1` to `DATABASE_URL`.

Why both: a serverless function opens a connection per invocation, so normal
traffic would exhaust Postgres' connection limit within seconds. The pooler
handles that. But PgBouncer's transaction pooling cannot run migrations, so
Prisma needs the direct URL for those — hence `directUrl` in `schema.prisma`.

`connection_limit=1` is not a typo. Each function instance should hold one
connection and let the pooler do the multiplexing.

---

## 2. Backend project

**New Project → import this repo → Root Directory: `backend`.**

Vercel reads `backend/vercel.json`, which routes every path to
`api/index.ts` and declares the cron jobs.

### Environment variables

| Variable | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | pooled Supabase URL (6543) | with `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | direct Supabase URL (5432) | migrations only |
| `JWT_SECRET` | `openssl rand -base64 48` | **also signs pickup QR codes** — changing it logs everyone out and voids every printed QR |
| `CRON_SECRET` | `openssl rand -hex 32` | Vercel sends this to `/api/cron/*`; without it those endpoints refuse everything |
| `CORS_ORIGINS` | `https://<frontend>.vercel.app` | set it — unset means "reflect any origin" |
| `SEED_ADMIN_EMAIL` | your email | optional |

### Blob storage

**Storage → Create → Blob → connect to the backend project.** Vercel injects
`BLOB_READ_WRITE_TOKEN` automatically.

`StorageService` switches on that token: present → Vercel Blob, absent → local
disk. Nothing else changes, so local development keeps writing to `uploads/`
and `backups/` exactly as before.

**Without a Blob store connected, uploads and backups will fail in production.**

### First deploy

`vercel-build` runs `prisma generate && prisma migrate deploy`, which applies
the historical Prisma migrations only.

**Schema changes now live in `supabase/migrations/` and are NOT applied by a
deploy.** They are pushed deliberately, from a machine linked to the project:

```bash
npx supabase link --project-ref <ref>
npm --prefix backend run db:push
```

That separation is on purpose. These migrations rewrite unique indexes and
backfill every table; running them automatically on each push means a routine
frontend deploy could reshape a production database at an unattended moment.

Then create the platform owner:

```bash
cd backend
SUPABASE_URL="https://<ref>.supabase.co" SUPABASE_SERVICE_ROLE_KEY="<service role key>" SUPER_ADMIN_EMAIL="you@example.com" npm run superadmin:create
```

It prints a generated password once. Save it. Signing in with it lands on
`/superadmin/dashboard`, where the first store is created.

### Check it

```bash
curl https://<backend>.vercel.app/api/products      # 401 = running, auth working
```

---

## 3. Frontend project

**New Project → same repo → Root Directory: `frontend`.**

| Variable | Value |
| --- | --- |
| `API_URL` | `https://<backend>.vercel.app` |

`next.config.ts` rewrites `/api/*` to that host, so the browser only ever talks
to its own origin — no CORS preflight, and the API URL is not baked into the
client bundle.

After it deploys, set `CORS_ORIGINS` on the **backend** to the frontend's URL
and redeploy the backend.

---

## 4. Scheduled jobs

In-process `@Cron` timers cannot fire on serverless — nothing is alive between
requests. The same service methods are exposed over HTTP and driven by Vercel
Cron instead:

| Endpoint | Does |
| --- | --- |
| `/api/cron/notifications` | low stock, overdue payments, expiring quotations |
| `/api/cron/maintenance` | expire contracts, upcoming visit reminders |
| `/api/cron/backup` | backup, if today matches the configured day |
| `/api/cron/daily` | maintenance + backup in one call |

`vercel.json` ships two jobs, because **Hobby allows a maximum of two cron jobs,
each running at most once per day**:

```json
{ "path": "/api/cron/notifications", "schedule": "0 7 * * *" }
{ "path": "/api/cron/daily",         "schedule": "0 3 * * *" }
```

On **Pro**, hourly notifications and separate jobs become possible:

```json
{ "path": "/api/cron/notifications", "schedule": "0 * * * *" }
{ "path": "/api/cron/maintenance",   "schedule": "0 6 * * *" }
{ "path": "/api/cron/backup",        "schedule": "0 3 * * *" }
```

The backup job reads the admin's configured weekly day from Settings and skips
any day that isn't it, with a 12-hour cooldown so an hourly schedule cannot take
24 backups in one day.

Test one by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<backend>.vercel.app/api/cron/notifications
```

---

## Known limits of running this on serverless

Worth knowing before they surprise you in production.

**Function timeout.** `vercel.json` sets `maxDuration: 60`, the Hobby ceiling.
A full backup or restore of a large database can exceed it. Restore in
particular is a ten-minute operation in the code's own timeout budget — for a
large database, run it from a machine with a direct connection rather than
through the API.

**Cold starts.** The first request after idle boots Nest and Prisma, typically
1–3 seconds. The app caches the booted instance per container, so subsequent
requests are fast.

**Cron precision.** Vercel Cron is best-effort and may fire minutes late. None
of these jobs are time-critical.

**PDF generation** holds the document in memory; fine for normal invoices, but
a several-hundred-line invoice on a 1 GB function is worth watching.

---

## Local development is unchanged

```bash
docker compose up -d      # Postgres
cd backend  && npm run start:dev
cd frontend && npm run dev
```

With no `BLOB_READ_WRITE_TOKEN` and no `VERCEL` env var, the app writes files to
disk and runs its own in-process schedulers, exactly as before.
