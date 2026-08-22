-- ============================================================
-- Row Level Security.
--
-- READ THIS BEFORE RELYING ON IT.
--
-- These policies are defense-in-depth, not the primary boundary. The primary
-- boundary for this application is the Prisma client extension in
-- `backend/src/prisma/tenant-scope.ts`, which rewrites every query before it is
-- sent. The reason is mechanical: Prisma connects as the table owner, and in
-- Postgres a table owner bypasses RLS. These policies therefore do nothing at
-- all for traffic arriving through the NestJS API.
--
-- They are still worth having, and are enabled here, because they DO apply to
-- everything else that can reach this database with a user JWT: the browser
-- talking to PostgREST via supabase-js, Realtime subscriptions, Edge Functions,
-- and the SQL editor when impersonating a role. Without them, any of those is
-- an open door to every tenant.
--
-- `FORCE ROW LEVEL SECURITY` is deliberately NOT set: forcing it would apply
-- these policies to the owner too, and since a Prisma connection carries no
-- JWT, `auth.jwt()` would be empty and every query in the application would
-- return zero rows.
-- ============================================================

-- ------------------------------------------------------------
-- Claim readers. Written once so a policy never has to spell out the JSON path
-- and get it subtly wrong.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jwt_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role',
    'none'
  );
$$;

CREATE OR REPLACE FUNCTION public.jwt_tenant_id()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(
    NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'tenant_id',
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT public.jwt_role() = 'super_admin';
$$;

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "read own profile" ON public.profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "super admin reads every profile" ON public.profiles
    FOR SELECT TO authenticated
    USING (public.is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "tenant admin reads profiles in its own store" ON public.profiles
    FOR SELECT TO authenticated
    USING (public.jwt_role() = 'tenant_admin' AND tenant_id = public.jwt_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "update own profile" ON public.profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "super admin writes any profile" ON public.profiles
    FOR ALL TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The UPDATE policy above lets someone edit their own row, which must not
-- include promoting themselves. A policy cannot express "these columns are
-- off limits", so a trigger does. Privilege escalation is the one thing a
-- self-service profile form could get catastrophically wrong.
CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Server-side callers (service_role, or Prisma as the owner) carry no JWT
  -- claims and are already trusted; this guards the browser path.
  IF public.jwt_role() IN ('none', 'super_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.app_role IS DISTINCT FROM OLD.app_role
     OR NEW.permissions IS DISTINCT FROM OLD.permissions
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Only a super admin can change role, tenant or permissions';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_privileges ON public.profiles;
CREATE TRIGGER profiles_guard_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileges();

-- ------------------------------------------------------------
-- Tenant
-- ------------------------------------------------------------
ALTER TABLE public."Tenant" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "super admin manages tenants" ON public."Tenant"
    FOR ALL TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "a tenant user reads its own store" ON public."Tenant"
    FOR SELECT TO authenticated
    USING ("id" = public.jwt_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- Every tenant-scoped business table.
--
-- Driven off the catalog rather than a hand-written list, so a table added
-- later with a tenantId column is covered by re-running this migration instead
-- of being quietly left open.
-- ------------------------------------------------------------
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'tenantId'
       AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.table_name);

    -- Auto-assign on insert, exactly as the brief asks: a client that omits
    -- tenantId gets its own. Prisma always sends it explicitly, so this never
    -- fires there -- and if it somehow did, a connection with no JWT yields
    -- NULL and a NOT NULL violation, which fails loudly instead of writing a
    -- row into the wrong store.
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT public.jwt_tenant_id()',
      t.table_name, 'tenantId'
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tenant isolation', t.table_name);
    -- The read and write rules are deliberately identical. On a nullable
    -- tenantId column that means a tenant user can neither read nor create a
    -- row with no owner: such a row would be invisible to every tenant policy
    -- afterwards, which is a leak in the other direction (orphaned data).
    -- Platform rows with a NULL tenantId stay readable by the super admin only.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
      'tenant isolation',
      t.table_name,
      'public.is_super_admin() OR "tenantId" = public.jwt_tenant_id()',
      'public.is_super_admin() OR "tenantId" = public.jwt_tenant_id()'
    );
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- Tables that belong to the platform rather than to any store. Locking them to
-- the super admin keeps a tenant user from reading another store even by
-- accident, since these carry no tenantId to filter on.
-- ------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['RefreshToken', 'PasswordResetToken', 'VerificationCode']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'super admin only', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin())',
        'super admin only', t
      );
    END IF;
  END LOOP;
END $$;
