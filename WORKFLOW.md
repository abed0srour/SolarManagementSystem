# Git Workflow & 3-Tier Environment Architecture

This document establishes the official branching conventions, deployment pipelines, environment isolation policies, and database migration protocols for the **Solar Store Management System**.

---

## 1. 3-Tier Environment Architecture

```
+-----------------------------------------------------------------------------+
|                                  LOCAL DEV                                  |
|  - Host: localhost (3000 / 5173)                                            |
|  - DB: Local Postgres (Docker / Supabase CLI)                               |
|  - Storage: Local Disk (backend/uploads)                                    |
+-----------------------------------------------------------------------------+
                                     │
                                     ▼ (PR & Merge)
+-----------------------------------------------------------------------------+
|                                   STAGING                                   |
|  - Branch: `staging`                                                        |
|  - Host: Vercel Preview / Staging Domain                                    |
|  - DB: Staging Supabase Project (Strictly Isolated)                         |
|  - Storage: Staging Vercel Blob Store                                       |
|  - Data: Realistic dummy datasets (`seed-staging.ts`)                      |
+-----------------------------------------------------------------------------+
                                     │
                                     ▼ (Release PR & Merge)
+-----------------------------------------------------------------------------+
|                                 PRODUCTION                                  |
|  - Branch: `main`                                                           |
|  - Host: Vercel Production / Live Domain                                    |
|  - DB: Production Supabase Project (Encrypted, High Availability)           |
|  - Storage: Production Vercel Blob Store                                    |
|  - Data: Live customer & tenant data only (NO TEST SEEDS ALLOWED)           |
+-----------------------------------------------------------------------------+
```

---

## 2. Branching Conventions

| Branch | Base Branch | Target Environment | Protection Rules |
|---|---|---|---|
| `main` | - | **Production** | Protected: Require PR, 1+ approval, passing CI, no direct push |
| `staging` | `main` | **Staging** | Protected: Require PR, passing CI |
| `feature/<name>` | `staging` | Local | Feature development |
| `fix/<name>` | `staging` | Local | Bug fixes |
| `hotfix/<name>` | `main` | Production & Staging | Urgent production bug fixes |

### Branch Naming Conventions
- `feature/solar-calculator-v2`
- `feature/inverter-attribute-filters`
- `fix/tax-rounding-issue`
- `hotfix/invoice-number-collision`
- `chore/upgrade-prisma-6`

---

## 3. Step-by-Step Development Lifecycle

### Step 1: Local Development
1. Ensure your local branch is up-to-date with `staging`:
   ```bash
   git checkout staging
   git pull origin staging
   git checkout -b feature/my-feature
   ```
2. Start the local database and stack:
   ```bash
   docker compose up -d
   cd backend && npm run start:dev
   cd frontend && npm run dev
   ```
3. Test schema changes locally if modifying models:
   ```bash
   # Create a migration
   npx supabase migration new my_feature_migration
   # Test applying locally
   npm --prefix backend run db:reset
   ```

### Step 2: Quality Assurance & Automated CI
1. Run local checks before pushing:
   ```bash
   npm --prefix backend run typecheck
   npm --prefix backend run test
   npm --prefix frontend run build
   ```
2. Push branch and open a Pull Request targeting `staging`:
   ```bash
   git push origin feature/my-feature
   ```
3. GitHub Actions automatically executes `.github/workflows/ci.yml` (backend tests, typechecks, frontend compilation).

### Step 3: Staging Deployment & Acceptance Testing
1. Merge the PR into `staging`.
2. GitHub Actions `.github/workflows/deploy-staging.yml` triggers automatically:
   - Applies database migrations to the **Staging Supabase project**.
   - Generates Prisma client.
   - Deploys backend API and Next.js frontend to the Staging environment.
3. QA / Product team tests the feature on the Staging preview URL.
4. If testing fresh features, populate or reset staging demo data:
   ```bash
   npm --prefix backend run prisma:seed:staging
   ```

### Step 4: Production Release
1. When staging changes are verified, open a Release PR from `staging` into `main`.
2. Review release diff, confirm automated checks pass, and approve the PR.
3. Merging to `main` triggers `.github/workflows/deploy-production.yml`:
   - Runs database migrations against the **Production Supabase project**.
   - Deploys backend & frontend to the live production domain with zero-downtime.

---

## 4. Production Hotfix Procedure

When a critical bug is discovered in Production:
1. Create a hotfix branch directly from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b hotfix/fix-payment-calc
   ```
2. Implement and test the fix locally.
3. Open a PR targeting `main`.
4. Once merged and deployed to Production, **back-merge `main` into `staging`**:
   ```bash
   git checkout staging
   git pull origin staging
   git merge main
   git push origin staging
   ```

---

## 5. Database Isolation & Zero Crossover Rules

1. **Strict Project Separation**:
   - Staging and Production **must** reside in separate Supabase projects with distinct API keys, database credentials, and service role keys.
2. **Never Mix Secrets**:
   - `STAGING_DATABASE_URL` and `PRODUCTION_DATABASE_URL` must never be stored in shared configuration or default files.
3. **Production Seeding Ban**:
   - The staging seeder (`seed-staging.ts`) contains hardcoded guards rejecting execution if `NODE_ENV=production` or if database URLs contain production identifiers.
4. **Migration Forward-Only Policy**:
   - Never edit or delete applied migrations in `supabase/migrations/`. Always add a new incremental migration file.

---

## 6. GitHub Secrets Configuration Matrix

Configure these repository secrets in GitHub (`Settings -> Secrets and variables -> Actions`):

| Secret Name | Environment / Purpose |
|---|---|
| `VERCEL_TOKEN` | Vercel CLI automation token |
| `VERCEL_ORG_ID` | Vercel Organization ID |
| `VERCEL_BACKEND_PROJECT_ID` | Vercel Project ID for Backend API |
| `VERCEL_FRONTEND_PROJECT_ID` | Vercel Project ID for Frontend Web App |
| `STAGING_DIRECT_URL` | Staging Supabase Direct PostgreSQL Connection (port 5432) |
| `STAGING_SUPABASE_URL` | Staging Supabase Project URL (`https://<staging_ref>.supabase.co`) |
| `STAGING_SUPABASE_ANON_KEY` | Staging Supabase Anonymous Public Key |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY`| Staging Supabase Service Role Key |
| `PRODUCTION_DIRECT_URL` | Production Supabase Direct PostgreSQL Connection (port 5432) |
| `PRODUCTION_SUPABASE_URL` | Production Supabase Project URL (`https://<prod_ref>.supabase.co`) |
| `PRODUCTION_SUPABASE_ANON_KEY` | Production Supabase Anonymous Public Key |
| `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY`| Production Supabase Service Role Key |
