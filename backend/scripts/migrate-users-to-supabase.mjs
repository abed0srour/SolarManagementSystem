#!/usr/bin/env node
/**
 * Move existing accounts into Supabase Auth, keeping their passwords.
 *
 *   node scripts/migrate-users-to-supabase.mjs            # dry run (default)
 *   node scripts/migrate-users-to-supabase.mjs --apply    # actually write
 *
 * Why this can keep the passwords: this application hashed with bcryptjs
 * (`bcrypt.hash(pw, 10)` -> `$2b$10$…`) and Supabase's auth server stores
 * `encrypted_password` as a bcrypt hash too. Go's bcrypt accepts any `$2x$`
 * minor variant, so the hash string is copied across verbatim. Nobody's
 * password changes and no reset emails go out.
 *
 * Each account keeps its existing id: `auth.users.id` is set to the current
 * `"User"."id"`. That is the whole trick that makes this safe — every invoice,
 * order, payment and audit row already points at that id, so nothing is
 * re-keyed and no foreign key moves. The `on_auth_user_created` trigger then
 * writes the matching `profiles` row, and its own trigger upserts `"User"` by
 * that same id, which updates the existing row rather than creating a second.
 *
 * INSERT-ONLY. It writes rows to `auth.users` and `auth.identities` and touches
 * nothing else. It never updates or deletes a business record, and an account
 * that already exists in Supabase is skipped, so re-running is safe.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*?)"?\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$/;

/** App role -> the coarse tier the token hook and RLS policies read. */
function profileRoleFor(appRole) {
  if (appRole === 'SUPER_ADMIN') return 'super_admin';
  if (appRole === 'ADMIN') return 'tenant_admin';
  return 'staff';
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function preflight() {
  const [{ present: authPresent }] = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users'
    ) AS present`;
  if (!authPresent) {
    fail('auth.users is missing — this database is not running Supabase Auth. Point DATABASE_URL at the Supabase project or local stack.');
  }

  const [{ present: tenantPresent }] = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'tenantId'
    ) AS present`;
  if (!tenantPresent) {
    fail('"User"."tenantId" is missing — apply supabase/migrations/ first. Running this before the tenancy migration would create accounts belonging to no store.');
  }

  const [{ present: triggerPresent }] = await prisma.$queryRaw`
    SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') AS present`;
  if (!triggerPresent) {
    fail('The on_auth_user_created trigger is missing — apply the profiles migration first, or no profile rows will be created.');
  }
}

async function main() {
  await preflight();

  const users = await prisma.$queryRaw`
    SELECT u."id", u."email", u."name", u."role"::text AS role, u."passwordHash",
           u."tenantId", u."isActive", u."permissions", u."createdAt"
      FROM "User" u
     WHERE u."deletedAt" IS NULL
     ORDER BY u."createdAt" ASC`;

  const existing = await prisma.$queryRaw`SELECT id::text AS id, lower(email) AS email FROM auth.users`;
  const haveId = new Set(existing.map((r) => r.id));
  const haveEmail = new Set(existing.map((r) => r.email));

  const migrate = [];
  const skipped = [];

  for (const u of users) {
    const email = (u.email ?? '').trim().toLowerCase();
    const note = (reason) => skipped.push({ email: u.email, reason });

    if (haveId.has(u.id) || haveEmail.has(email)) { note('already in Supabase Auth'); continue; }
    if (!UUID_RE.test(u.id)) { note(`id is not a UUID (${u.id}) — cannot be an auth.users id`); continue; }
    if (!email) { note('no email address'); continue; }
    if (!u.passwordHash) { note('no password hash — invite this account instead'); continue; }
    if (!BCRYPT_RE.test(u.passwordHash)) { note(`password hash is not bcrypt (${u.passwordHash.slice(0, 4)}…) — invite instead`); continue; }
    if (u.role !== 'SUPER_ADMIN' && !u.tenantId) { note('not a super admin but belongs to no store'); continue; }

    migrate.push({
      id: u.id,
      email,
      name: u.name,
      hash: u.passwordHash,
      isActive: u.isActive,
      createdAt: u.createdAt,
      appRole: u.role,
      profileRole: profileRoleFor(u.role),
      tenantId: u.role === 'SUPER_ADMIN' ? null : u.tenantId,
      permissions: u.permissions ?? [],
    });
  }

  console.log(`\n  ${users.length} active account(s) found.`);
  console.log(`  ${migrate.length} to migrate, ${skipped.length} skipped.\n`);

  if (migrate.length) {
    console.log('  Will create a Supabase account for:');
    for (const m of migrate) {
      console.log(`    ${m.email.padEnd(34)} ${m.appRole.padEnd(12)} ${m.tenantId ? `tenant ${m.tenantId.slice(0, 8)}…` : 'platform'}${m.isActive ? '' : '  (inactive -> banned)'}`);
    }
    console.log('');
  }
  if (skipped.length) {
    console.log('  Skipped:');
    for (const s of skipped) console.log(`    ${(s.email ?? '(no email)').padEnd(34)} ${s.reason}`);
    console.log('');
  }

  if (!APPLY) {
    console.log('  Dry run — nothing was written. Re-run with --apply to migrate.\n');
    return;
  }
  if (!migrate.length) {
    console.log('  Nothing to do.\n');
    return;
  }

  // One transaction: either every account moves or none does, so a failure
  // half-way cannot leave some people able to sign in and others not.
  await prisma.$transaction(async (tx) => {
    for (const m of migrate) {
      const appMeta = {
        provider: 'email',
        providers: ['email'],
        role: m.profileRole,
        tenant_id: m.tenantId,
        app_role: m.appRole,
        permissions: m.permissions,
      };
      const userMeta = { full_name: m.name ?? '' };

      await tx.$executeRaw`
        INSERT INTO auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at, banned_until,
          confirmation_token, recovery_token, email_change_token_new, email_change,
          email_change_token_current, phone_change, phone_change_token, reauthentication_token
        ) VALUES (
          '00000000-0000-0000-0000-000000000000',
          ${m.id}::uuid,
          'authenticated',
          'authenticated',
          ${m.email},
          ${m.hash},
          ${m.createdAt},
          ${JSON.stringify(appMeta)}::jsonb,
          ${JSON.stringify(userMeta)}::jsonb,
          ${m.createdAt},
          NOW(),
          ${m.isActive ? null : new Date('2999-01-01T00:00:00Z')},
          '', '', '', '', '', '', '', ''
        )
        ON CONFLICT (id) DO NOTHING`;

      // Password sign-in is refused for an account with no matching identity,
      // however valid the user row looks.
      await tx.$executeRaw`
        INSERT INTO auth.identities (
          id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
        ) VALUES (
          ${randomUUID()}::uuid,
          ${m.id}::uuid,
          ${m.id},
          ${JSON.stringify({ sub: m.id, email: m.email, email_verified: true, phone_verified: false })}::jsonb,
          'email',
          NULL,
          ${m.createdAt},
          NOW()
        )
        ON CONFLICT DO NOTHING`;
    }
  });

  const [{ profiles }] = await prisma.$queryRaw`SELECT count(*)::int AS profiles FROM public.profiles`;
  console.log(`  Migrated ${migrate.length} account(s). ${profiles} profile row(s) now exist.`);
  console.log('  Everyone signs in with the same email and password as before.\n');
}

main()
  .catch((e) => {
    console.error('\n  Migration failed — nothing was committed.\n');
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
