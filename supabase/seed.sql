-- ============================================================
-- Local development seed. Runs on `supabase db reset`.
--
-- This creates a super admin with a KNOWN password so a fresh local stack is
-- immediately usable. It is deliberately not suitable for anything else --
-- for a real environment use the CLI instead, which takes the password from
-- the environment and never writes it anywhere:
--
--     npm --prefix backend run superadmin:create
--
-- Every statement is ON CONFLICT DO NOTHING, so re-seeding never overwrites a
-- password someone has already changed.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- The store that adopted all pre-tenancy data. Recreated here so a reset
-- database still has somewhere for the demo tenant admin to live.
INSERT INTO public."Tenant" ("id", "name", "slug", "status", "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Store', 'default', 'ACTIVE', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- ------------------------------------------------------------
-- Super admin. No tenant_id in app_metadata, so on_auth_user_created gives it
-- the platform role.
-- ------------------------------------------------------------
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000aa',
  'authenticated',
  'authenticated',
  'superadmin@solarstore.local',
  extensions.crypt('SuperAdmin!2026', extensions.gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"],"role":"super_admin"}'::JSONB,
  '{"full_name":"Platform Owner"}'::JSONB,
  NOW(),
  NOW(),
  '', '', '', '', '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

-- GoTrue will not accept a password login for an account with no matching
-- identity row, however valid the user row looks.
INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-0000000000ab',
  '00000000-0000-0000-0000-0000000000aa',
  '00000000-0000-0000-0000-0000000000aa',
  '{"sub":"00000000-0000-0000-0000-0000000000aa","email":"superadmin@solarstore.local","email_verified":true,"phone_verified":false}'::JSONB,
  'email',
  NOW(), NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- A tenant admin for the default store, so the non-super-admin path is
-- testable straight after a reset.
-- ------------------------------------------------------------
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000ba',
  'authenticated',
  'authenticated',
  'admin@solarstore.local',
  extensions.crypt('TenantAdmin!2026', extensions.gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"],"role":"tenant_admin","app_role":"ADMIN","tenant_id":"00000000-0000-0000-0000-000000000001"}'::JSONB,
  '{"full_name":"Store Admin"}'::JSONB,
  NOW(),
  NOW(),
  '', '', '', '', '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-0000000000bb',
  '00000000-0000-0000-0000-0000000000ba',
  '00000000-0000-0000-0000-0000000000ba',
  '{"sub":"00000000-0000-0000-0000-0000000000ba","email":"admin@solarstore.local","email_verified":true,"phone_verified":false}'::JSONB,
  'email',
  NOW(), NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE '--------------------------------------------------------';
  RAISE NOTICE ' Local accounts seeded:';
  RAISE NOTICE '   superadmin@solarstore.local / SuperAdmin!2026   -> /superadmin/dashboard';
  RAISE NOTICE '   admin@solarstore.local      / TenantAdmin!2026  -> /dashboard (Default Store)';
  RAISE NOTICE ' Local only. Use `npm --prefix backend run superadmin:create` elsewhere.';
  RAISE NOTICE '--------------------------------------------------------';
END $$;
