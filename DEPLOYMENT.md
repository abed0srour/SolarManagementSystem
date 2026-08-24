# 3-Tier Deployment & Infrastructure Architecture

This guide covers deploying the **Solar Store Management System** across three strictly isolated tiers:
1. **Local Development** (`localhost` / Docker / Supabase CLI)
2. **Staging / Preview** (`staging` branch &rarr; Staging Supabase + Preview Host)
3. **Production** (`main` branch &rarr; Production Supabase + Live Host)

For branching policies and PR promotion workflows, see [WORKFLOW.md](file:///c:/Users/HP/SolarManagementSystem/WORKFLOW.md).

---

## 1. Architecture Overview

```
                      +─────────────────────────────────────────+
                      |         GitHub Repository               |
                      |  - PRs to `staging` / `main`            |
                      +────────────────────┬────────────────────+
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    ▼                                             ▼
       +─────────────────────────+                   +─────────────────────────+
       |   Push to `staging`     |                   |     Push to `main`      |
       |  (Staging Deployment)   |                   | (Production Deployment) |
       +────────────┬────────────+                   +────────────┬────────────+
                    │                                             │
      ┌─────────────┴─────────────┐                 ┌─────────────┴─────────────┐
      ▼                           ▼                 ▼                           ▼
+─────────────+             +───────────+     +─────────────+             +───────────+
|   Staging   |             |  Staging  |     | Production  |             |Production |
|  Supabase   |             |  Vercel   |     |  Supabase   |             |  Vercel   |
| (DB + Auth) |             | (API+Web) |     | (DB + Auth) |             | (API+Web) |
+─────────────+             +───────────+     +─────────────+             +───────────+
```

### Core Architecture Components
- **Frontend**: Next.js App Router (located in [`frontend`](file:///c:/Users/HP/SolarManagementSystem/frontend))
- **Backend**: NestJS Serverless API (located in [`backend`](file:///c:/Users/HP/SolarManagementSystem/backend))
- **Databases**: Supabase PostgreSQL with PgBouncer connection pooler
- **Blob Storage**: Vercel Blob (for documents, PDFs, and database snapshots)
- **CI/CD**: GitHub Actions automated pipelines in [`.github/workflows/`](file:///c:/Users/HP/SolarManagementSystem/.github/workflows)

---

## 2. Supabase Provisioning (Staging & Production)

> [!IMPORTANT]
> **Database Isolation Boundary**: You must create **two separate Supabase projects** in the Supabase Dashboard:
> - `solar-store-staging`
> - `solar-store-production`

### Step A: Configure Supabase Auth (Perform on both Staging & Prod)
1. **Authentication &rarr; Hooks &rarr; Customize Access Token**:
   - Enable hook and point to `public.custom_access_token_hook`.
   - This injects `tenant_id` and `role` claims directly into user session JWTs.
2. **Authentication &rarr; URL Configuration**:
   - **Site URL**: Point to your frontend origin (e.g. `https://staging.solarstore.example.com` or `https://app.solarstore.example.com`).
   - **Redirect URLs**: Add `<origin>/reset-password` so password recovery links route correctly.
3. **Authentication &rarr; Providers &rarr; Email**:
   - Leave public signups **disabled**. Stores and users are provisioned by administrators.

### Step B: Database Connection Strings
For each Supabase project, navigate to **Project Settings &rarr; Database &rarr; Connection string**:
- **DATABASE_URL (Transaction Pooler - Port 6543)**:
  `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1`
- **DIRECT_URL (Session / Direct - Port 5432)**:
  `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`

---

## 3. Environment Variables Reference

### Backend (`backend/.env.*`)

| Variable | Staging | Production | Description |
|---|---|---|---|
| `NODE_ENV` | `staging` | `production` | Runtime mode |
| `DATABASE_URL` | Staging Pooled URL (6543) | Prod Pooled URL (6543) | Pooled PostgreSQL connection string |
| `DIRECT_URL` | Staging Direct URL (5432) | Prod Direct URL (5432) | Direct connection for schema migrations |
| `SUPABASE_URL` | `https://<staging_ref>.supabase.co` | `https://<prod_ref>.supabase.co` | Supabase API endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging Service Role Key | Prod Service Role Key | **Server-only secret** (bypasses RLS) |
| `APP_URL` | `https://staging.solarstore.com` | `https://app.solarstore.com` | Frontend URL for user invites/recovery |
| `JWT_SECRET` | 48-char random secret | 48-char random secret | Signs receipt QR codes and internal tokens |
| `CRON_SECRET` | 32-char hex secret | 32-char hex secret | Secures `/api/cron/*` endpoints |
| `CORS_ORIGINS` | Staging frontend origin | Production frontend origin | Allowed browser origins |
| `BLOB_READ_WRITE_TOKEN` | Staging Blob Token | Production Blob Token | Vercel Blob access token |

### Frontend (`frontend/.env.*`)

| Variable | Staging | Production | Description |
|---|---|---|---|
| `API_URL` | `https://staging-api.solarstore.com` | `https://api.solarstore.com` | Backend API URL (rewritten at `/api/*`) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<staging_ref>.supabase.co` | `https://<prod_ref>.supabase.co` | Public Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`| Staging Public Anon Key | Production Public Anon Key | Public Supabase Anon Key |

---

## 4. Database Migrations & Seeding Strategy

### Applying Migrations
Migrations are stored sequentially in [`supabase/migrations/`](file:///c:/Users/HP/SolarManagementSystem/supabase/migrations).

#### Automated (Recommended):
- Merging into `staging` triggers [`.github/workflows/deploy-staging.yml`](file:///c:/Users/HP/SolarManagementSystem/.github/workflows/deploy-staging.yml), applying migrations to the Staging DB.
- Merging into `main` triggers [`.github/workflows/deploy-production.yml`](file:///c:/Users/HP/SolarManagementSystem/.github/workflows/deploy-production.yml), applying migrations to the Production DB.

#### Manual Migration (CLI):
```bash
# Push migrations to Staging:
STAGING_DIRECT_URL="<staging_direct_url>" npm --prefix backend run db:migrate:staging

# Push migrations to Production:
PRODUCTION_DIRECT_URL="<prod_direct_url>" npm --prefix backend run db:migrate:prod
```

### Seeding Dummy Data (Local & Staging Only)
To populate a fresh local or staging database with realistic multi-tenant data:
```bash
# Runs safety-guarded multi-tenant seeder (Refuses to run in production):
npm --prefix backend run prisma:seed:staging
```

### Creating Initial Super Admin (Production & Staging)
To bootstrap the platform owner in a hosted environment:
```bash
cd backend
SUPABASE_URL="https://<ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service_role_key>" \
SUPER_ADMIN_EMAIL="admin@yourcompany.com" \
npm run superadmin:create
```

---

## 5. Scheduled Jobs (Vercel Cron)

Serverless functions use Vercel Cron to invoke scheduled maintenance tasks:

| Endpoint | Schedule | Purpose |
|---|---|---|
| `/api/cron/notifications` | `0 7 * * *` | Check low stock, overdue payments, expiring quotes |
| `/api/cron/daily` | `0 3 * * *` | Daily contract maintenance check + scheduled backup |

Manually test an endpoint:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<api-host>/api/cron/notifications
```
