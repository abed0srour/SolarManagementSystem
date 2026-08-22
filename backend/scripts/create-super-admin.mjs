#!/usr/bin/env node
/**
 * Create (or repair) the platform super admin.
 *
 * Run against any environment — local stack, staging, production:
 *
 *     SUPER_ADMIN_EMAIL=you@example.com npm run superadmin:create
 *
 * The password comes from SUPER_ADMIN_PASSWORD, or is generated and printed
 * once. It is never written to a file, a migration or the shell history, which
 * is the whole reason this exists as a CLI rather than a seed: a password
 * committed to `seed.sql` is a password every deployment of this system shares.
 *
 * Safe to re-run. An existing account keeps its password unless
 * SUPER_ADMIN_PASSWORD is set explicitly, so this can be used to repair a
 * profile without locking anyone out of an account they had already secured.
 */
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*?)"?\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.env.SUPER_ADMIN_EMAIL ?? '').trim().toLowerCase();

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!url || !serviceKey) die('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (backend/.env).');
if (!email) die('Set SUPER_ADMIN_EMAIL to the address that should own the platform.');

/** Ambiguity-free alphabet: this gets read off a terminal and typed by hand. */
function generatePassword() {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findByEmail(target) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die(`Could not list accounts: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

const metadata = {
  role: 'super_admin',
  tenant_id: null,
  app_role: 'SUPER_ADMIN',
  permissions: [],
};

const existing = await findByEmail(email);
const explicitPassword = process.env.SUPER_ADMIN_PASSWORD;

if (explicitPassword && explicitPassword.length < 8) {
  die('SUPER_ADMIN_PASSWORD must be at least 8 characters.');
}

let password = null;
let generated = false;

if (existing) {
  // Re-running to repair the profile must not silently reset a password the
  // owner has already changed.
  if (explicitPassword) password = explicitPassword;
  const { error } = await supabase.auth.admin.updateUserById(existing.id, {
    app_metadata: { ...existing.app_metadata, ...metadata },
    ...(password ? { password } : {}),
    ban_duration: 'none',
  });
  if (error) die(`Could not update the account: ${error.message}`);
  console.log(`\n  Existing account ${email} promoted to super admin.`);
  if (!password) console.log('  Password left unchanged (set SUPER_ADMIN_PASSWORD to reset it).');
} else {
  password = explicitPassword ?? generatePassword();
  generated = !explicitPassword;
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: metadata,
    user_metadata: { full_name: process.env.SUPER_ADMIN_NAME ?? 'Platform Owner' },
  });
  if (error) die(`Could not create the account: ${error.message}`);
  console.log(`\n  Super admin created: ${email}`);
}

if (password) {
  console.log('  ' + '='.repeat(60));
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  if (generated) console.log('  Generated once and not stored anywhere. Save it now.');
  console.log('  ' + '='.repeat(60));
}
console.log('  Sign in and you will land on /superadmin/dashboard.\n');
