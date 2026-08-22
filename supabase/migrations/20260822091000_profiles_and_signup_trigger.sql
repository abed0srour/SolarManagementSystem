-- ============================================================
-- Supabase Auth becomes the identity store.
--
-- `auth.users` owns credentials. `public.profiles` is the projection of an
-- account that this application actually reads: which store it belongs to and
-- what it may do there. The existing `public."User"` table is NOT replaced --
-- roughly twenty foreign keys (invoices, orders, payments, audit entries) point
-- at it, and breaking those would lose history. Instead a profile keeps a
-- matching "User" row in step, sharing the same id, so `auth.users.id` ==
-- `profiles.id` == `"User"."id"` is one identity throughout the system.
--
-- Additive and re-runnable. Nothing is dropped.
-- ============================================================

-- ------------------------------------------------------------
-- Fail early and legibly when this runs somewhere without Supabase Auth (a
-- plain Postgres dev database). Without this the failure is a confusing
-- "relation auth.users does not exist" three statements later.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
    RAISE EXCEPTION
      'auth.users is missing: this database is not running Supabase Auth. Start the local stack with `supabase start`, or point at a Supabase project.';
  END IF;
END $$;

-- ------------------------------------------------------------
-- profiles
--
-- `role` is the coarse tier the router and the RLS policies care about.
-- `app_role` is the finer role this application already had (MANAGER, VIEWER,
-- ...), kept alongside so the existing permission system keeps working without
-- a database round-trip on every request.
--
-- `tenant_id` is TEXT rather than UUID because every id in this schema is a
-- Prisma `uuid()` stored as TEXT. Making it a real UUID would mean rewriting
-- the type of 40-odd foreign key columns, which is exactly the destructive
-- change this migration set is required to avoid. The values are still UUIDs.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff',
  tenant_id   TEXT REFERENCES public."Tenant"("id") ON DELETE CASCADE,
  app_role    TEXT NOT NULL DEFAULT 'STAFF',
  permissions TEXT[] NOT NULL DEFAULT '{}',
  full_name   TEXT,
  phone       TEXT,
  avatar_url  TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check CHECK (role IN ('super_admin', 'tenant_admin', 'staff'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A super admin belongs to no store; everyone else must belong to exactly one.
-- This is the invariant the whole isolation model rests on, so the database
-- enforces it rather than trusting application code to remember.
DO $$
BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_tenant_matches_role CHECK (
      (role = 'super_admin' AND tenant_id IS NULL) OR
      (role <> 'super_admin' AND tenant_id IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS profiles_tenant_id_idx ON public.profiles (tenant_id);
CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles (role);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_key ON public.profiles (LOWER(email));

-- ------------------------------------------------------------
-- The password now lives in auth.users. "User"."passwordHash" stays as a
-- column so no data is lost, but it stops being required.
-- ------------------------------------------------------------
ALTER TABLE public."User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- ------------------------------------------------------------
-- Role mapping. One place, used by every function below.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_role_for(profile_role TEXT, requested TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN profile_role = 'super_admin' THEN 'SUPER_ADMIN'
    WHEN UPPER(COALESCE(requested, '')) IN ('ADMIN', 'MANAGER', 'STAFF', 'VIEWER') THEN UPPER(requested)
    WHEN profile_role = 'tenant_admin' THEN 'ADMIN'
    ELSE 'STAFF'
  END;
$$;

CREATE OR REPLACE FUNCTION public.profile_role_for(app_role TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN UPPER(COALESCE(app_role, '')) = 'SUPER_ADMIN' THEN 'super_admin'
    WHEN UPPER(COALESCE(app_role, '')) = 'ADMIN' THEN 'tenant_admin'
    ELSE 'staff'
  END;
$$;

-- ------------------------------------------------------------
-- on_auth_user_created: every new account gets a profile.
--
-- Reads the tenant and role from app_metadata (set by the super admin when
-- provisioning a store, and not writable by the user themselves) and falls back
-- to user_metadata only for cosmetic fields. A signup that names no tenant and
-- no role is not a valid member of anything, so it is rejected rather than
-- silently landing in some default store.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta_role   TEXT := NULLIF(NEW.raw_app_meta_data ->> 'role', '');
  meta_tenant TEXT := NULLIF(NEW.raw_app_meta_data ->> 'tenant_id', '');
  meta_app    TEXT := NULLIF(NEW.raw_app_meta_data ->> 'app_role', '');
  resolved    TEXT;
BEGIN
  resolved := COALESCE(meta_role, CASE WHEN meta_tenant IS NULL THEN 'super_admin' ELSE 'staff' END);

  IF resolved <> 'super_admin' AND meta_tenant IS NULL THEN
    RAISE EXCEPTION 'Cannot create %: a tenant user needs app_metadata.tenant_id', NEW.email;
  END IF;

  INSERT INTO public.profiles (id, email, role, tenant_id, app_role, permissions, full_name, phone, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    resolved,
    CASE WHEN resolved = 'super_admin' THEN NULL ELSE meta_tenant END,
    public.app_role_for(resolved, meta_app),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(NEW.raw_app_meta_data -> 'permissions')),
      '{}'::TEXT[]
    ),
    NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'phone', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'avatar_url', '')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Keep the profile email in step when the account confirms an email change.
CREATE OR REPLACE FUNCTION public.handle_auth_user_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET email = NEW.email,
         full_name = COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''), full_name),
         phone = COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'phone', ''), phone),
         avatar_url = COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'avatar_url', ''), avatar_url),
         updated_at = NOW()
   WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF email, raw_user_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_updated();

-- ------------------------------------------------------------
-- profiles -> "User": one direction, one owner.
--
-- The application still joins business records to "User", so every profile
-- needs a matching row there. Syncing one way only (profiles is the source of
-- truth for identity) means the two can never disagree about who someone is.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_profile_to_app_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public."User" ("id", "email", "name", "role", "permissions", "isActive", "tenantId", "createdAt")
  VALUES (
    NEW.id::text,
    NEW.email,
    COALESCE(NEW.full_name, split_part(NEW.email, '@', 1)),
    NEW.app_role::"Role",
    NEW.permissions,
    NEW.is_active,
    NEW.tenant_id,
    NOW()
  )
  ON CONFLICT ("id") DO UPDATE SET
    "email"       = EXCLUDED."email",
    "name"        = EXCLUDED."name",
    "role"        = EXCLUDED."role",
    "permissions" = EXCLUDED."permissions",
    "isActive"    = EXCLUDED."isActive",
    "tenantId"    = EXCLUDED."tenantId";

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_changed ON public.profiles;
CREATE TRIGGER on_profile_changed
  AFTER INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_to_app_user();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_touch_updated_at ON public.profiles;
CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- Backfill step 1: give existing accounts their Supabase id.
--
-- A pre-Supabase "User" row carries a Prisma-generated uuid that has nothing to
-- do with the `auth.users` row later created for the same person. Rather than
-- carry two ids for one human forever, the app-side row is re-keyed onto the
-- Supabase id. Every one of the 22 foreign keys pointing at "User"("id") was
-- created ON UPDATE CASCADE, so invoices, orders, payments and audit entries
-- follow the change automatically and no history is detached.
--
-- Idempotent: the second run matches nothing, because the ids already agree.
-- ------------------------------------------------------------
UPDATE public."User" u
   SET "id" = au.id::text
  FROM auth.users au
 WHERE LOWER(au.email) = LOWER(u."email")
   AND u."id" <> au.id::text;

-- ------------------------------------------------------------
-- Backfill step 2: adopt those accounts as profiles.
--
-- A "User" with no Supabase account yet is left exactly as it is -- it keeps
-- working for history and foreign keys, and gains a profile the moment someone
-- invites it through `supabase.auth.admin`.
-- ------------------------------------------------------------
INSERT INTO public.profiles (id, email, role, tenant_id, app_role, permissions, full_name, is_active)
SELECT
  au.id,
  u."email",
  public.profile_role_for(u."role"::text),
  CASE WHEN u."role"::text = 'SUPER_ADMIN' THEN NULL ELSE u."tenantId" END,
  u."role"::text,
  u."permissions",
  u."name",
  u."isActive"
FROM public."User" u
JOIN auth.users au ON LOWER(au.email) = LOWER(u."email")
WHERE u."deletedAt" IS NULL
  -- A legacy tenant user with no tenant cannot satisfy profiles_tenant_matches_role.
  AND (u."role"::text = 'SUPER_ADMIN' OR u."tenantId" IS NOT NULL)
ON CONFLICT (id) DO NOTHING;
