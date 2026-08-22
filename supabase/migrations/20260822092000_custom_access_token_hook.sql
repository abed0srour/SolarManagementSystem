-- ============================================================
-- Custom Access Token Hook: put role and tenant into the JWT itself.
--
-- Why this exists: without it, every single request would have to ask the
-- database "who is this and which store are they in?" before it could do
-- anything. That is one extra round trip on the hot path of every page load,
-- for a value that changes about once in an account's lifetime. Signing it into
-- the token instead makes the answer free -- `auth.jwt() ->> 'tenant_id'` in
-- Postgres, a decoded claim in the middleware, a claim on `request.user` in
-- NestJS -- and it is trustworthy because the token is signed.
--
-- The trade-off is staleness: a claim is fixed until the token is refreshed.
-- Anything that changes a role or suspends a tenant must therefore also revoke
-- that user's sessions, which is what the super admin endpoints do.
--
-- Enable it in supabase/config.toml (already set) or, on a hosted project, at
-- Authentication -> Hooks -> Customize Access Token.
-- ============================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims   JSONB;
  profile  RECORD;
  tenant   RECORD;
BEGIN
  claims := COALESCE(event -> 'claims', '{}'::JSONB);

  SELECT p.role, p.tenant_id, p.app_role, p.permissions, p.is_active
    INTO profile
    FROM public.profiles p
   WHERE p.id = (event ->> 'user_id')::UUID;

  IF profile IS NULL THEN
    -- No profile means the account was created outside the normal flow. Give it
    -- claims that grant nothing rather than claims that are simply absent --
    -- an absent claim is easy to mistake for "not checked yet".
    claims := jsonb_set(claims, '{role}', '"none"');
    claims := jsonb_set(claims, '{tenant_id}', 'null'::JSONB);
    claims := jsonb_set(claims, '{app_role}', '"NONE"');
    claims := jsonb_set(claims, '{permissions}', '[]'::JSONB);
    claims := jsonb_set(claims, '{tenant_status}', '"UNKNOWN"');
    RETURN jsonb_set(event, '{claims}', claims);
  END IF;

  SELECT t."status"::text AS status, t."name" AS name, t."deletedAt" AS deleted_at
    INTO tenant
    FROM public."Tenant" t
   WHERE t."id" = profile.tenant_id;

  claims := jsonb_set(claims, '{role}', to_jsonb(profile.role));
  claims := jsonb_set(claims, '{tenant_id}', COALESCE(to_jsonb(profile.tenant_id), 'null'::JSONB));
  claims := jsonb_set(claims, '{app_role}', to_jsonb(profile.app_role));
  claims := jsonb_set(claims, '{permissions}', to_jsonb(profile.permissions));
  claims := jsonb_set(claims, '{is_active}', to_jsonb(profile.is_active));
  claims := jsonb_set(claims, '{tenant_name}', COALESCE(to_jsonb(tenant.name), 'null'::JSONB));
  claims := jsonb_set(
    claims,
    '{tenant_status}',
    to_jsonb(
      CASE
        WHEN profile.role = 'super_admin' THEN 'PLATFORM'
        WHEN tenant IS NULL THEN 'MISSING'
        WHEN tenant.deleted_at IS NOT NULL THEN 'ARCHIVED'
        ELSE tenant.status
      END
    )
  );

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- GoTrue calls the hook as `supabase_auth_admin`, which by default cannot see
-- the public schema at all.
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) FROM authenticated, anon, public;

GRANT SELECT ON TABLE public.profiles TO supabase_auth_admin;
GRANT SELECT ON TABLE public."Tenant" TO supabase_auth_admin;

-- The hook runs before RLS would apply to it; this policy makes that explicit
-- so a future reader does not "tidy up" the grant above and silently break
-- every login.
DO $$
BEGIN
  CREATE POLICY "auth admin reads profiles for the token hook"
    ON public.profiles AS PERMISSIVE FOR SELECT
    TO supabase_auth_admin
    USING (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- app_metadata mirror.
--
-- Belt and braces for the hosted case where the hook has not been switched on
-- yet: Supabase copies `raw_app_meta_data` into the token unconditionally, so
-- role and tenant_id reach the client either way. The hook is still the
-- authority -- this only keeps the two from disagreeing.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_profile_to_app_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::JSONB) || jsonb_build_object(
           'role', NEW.role,
           'tenant_id', NEW.tenant_id,
           'app_role', NEW.app_role,
           'permissions', to_jsonb(NEW.permissions)
         )
   WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_synced_to_metadata ON public.profiles;
CREATE TRIGGER on_profile_synced_to_metadata
  AFTER INSERT OR UPDATE OF role, tenant_id, app_role, permissions ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_to_app_metadata();
