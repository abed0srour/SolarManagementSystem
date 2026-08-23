-- ============================================================
-- Re-read app_metadata when it arrives after the row was inserted.
--
-- `handle_new_user` runs AFTER INSERT on auth.users and takes the role and
-- tenant from raw_app_meta_data. Hosted GoTrue, unlike the local stack, does
-- not populate that column in the INSERT itself: admin.createUser inserts the
-- account first and applies app_metadata in a second UPDATE. The trigger
-- therefore sees no role and no tenant, and falls through to 'super_admin' --
-- turning every store owner into a platform administrator.
--
-- This closes the gap: when raw_app_meta_data changes, the profile is brought
-- back in line with it. It is the mirror of sync_profile_to_app_metadata, and
-- the two cannot loop because each only writes when a value actually differs,
-- so the second pass matches zero rows.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_app_metadata_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta_role   TEXT := NULLIF(NEW.raw_app_meta_data ->> 'role', '');
  meta_tenant TEXT := NULLIF(NEW.raw_app_meta_data ->> 'tenant_id', '');
  meta_app    TEXT := NULLIF(NEW.raw_app_meta_data ->> 'app_role', '');
BEGIN
  -- Metadata that names neither a role nor a store says nothing about
  -- privileges; GoTrue writes provider/providers on its own and that must not
  -- be mistaken for an instruction.
  IF meta_role IS NULL AND meta_tenant IS NULL THEN
    RETURN NEW;
  END IF;

  -- Hold the invariant profiles_tenant_matches_role enforces: a super admin
  -- belongs to no store, anyone else must belong to exactly one. Metadata that
  -- cannot satisfy it is ignored rather than raised, so a partial write by
  -- GoTrue never blocks a signup.
  IF meta_role = 'super_admin' THEN
    meta_tenant := NULL;
  ELSIF meta_tenant IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.profiles p
     SET role        = COALESCE(meta_role, p.role),
         tenant_id   = meta_tenant,
         app_role    = COALESCE(meta_app, p.app_role),
         permissions = COALESCE(
           ARRAY(SELECT jsonb_array_elements_text(NEW.raw_app_meta_data -> 'permissions')),
           p.permissions
         )
   WHERE p.id = NEW.id
     AND (
          p.role      IS DISTINCT FROM COALESCE(meta_role, p.role)
       OR p.tenant_id IS DISTINCT FROM meta_tenant
       OR p.app_role  IS DISTINCT FROM COALESCE(meta_app, p.app_role)
     );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_metadata_changed ON auth.users;
CREATE TRIGGER on_auth_user_metadata_changed
  AFTER UPDATE OF raw_app_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_app_metadata_to_profile();
