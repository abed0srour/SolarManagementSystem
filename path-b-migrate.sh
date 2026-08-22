#!/usr/bin/env bash
#
# path-b-migrate.sh — Bundles Path B's three commands into one checked run:
#   1. Drop & recreate the public schema on the LOCAL Supabase stack (port 54322 only)
#   2. Load solar_store_backup.sql into that stack
#   3. Apply supabase/migrations/*.sql in order
#
# Stops on the first error, never touches your original solar_store DB on
# port 5432, and writes a timestamped log you can send along if something
# goes wrong.
#
# Run from the project root (same folder as this script / the supabase/ dir):
#   cd /c/Users/HP/SolarManagementSystem
#   ./path-b-migrate.sh
#
# Add --yes to skip the confirmation prompt (e.g. for a re-run you've already
# reviewed). Everything else is unattended.

set -euo pipefail

# ---- config: the LOCAL STACK only, never your real DB on 5432 ----
PGHOST="127.0.0.1"
PGPORT="54322"
PGUSER="postgres"
PGDATABASE="postgres"
export PGPASSWORD="${PGPASSWORD:-postgres}"

BACKUP_FILE="solar_store_backup.sql"
MIGRATIONS_DIR="supabase/migrations"
LOG_FILE="path-b-migrate_$(date +%Y%m%d_%H%M%S).log"

SKIP_CONFIRM=0
for arg in "$@"; do
  [ "$arg" = "--yes" ] && SKIP_CONFIRM=1
done

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

fail() {
  log "❌ FAILED at: $1"
  log "   Nothing after this point ran."
  log "   Your original solar_store database (port 5432) was never touched."
  log "   Full details are in: $LOG_FILE"
  log "   To start Path B over: npx supabase db reset   (resets the LOCAL stack only — never add --linked)"
  exit 1
}

log "=== Path B migration ==="
log "Target: postgresql://$PGUSER@$PGHOST:$PGPORT/$PGDATABASE (local Supabase stack)"

# --- Safety net: refuse to ever run against the real DB port ---
if [ "$PGPORT" = "5432" ]; then
  log "❌ Refusing to run: PGPORT is 5432 (your original database), not the stack's 54322."
  exit 1
fi

# --- Pre-flight checks, before anything destructive happens ---
[ -f "$BACKUP_FILE" ] || { log "❌ Backup file not found: $BACKUP_FILE (run Step 0 first, from this same folder)"; exit 1; }
[ -d "$MIGRATIONS_DIR" ] || { log "❌ Migrations folder not found: $MIGRATIONS_DIR"; exit 1; }

shopt -s nullglob
migration_files=("$MIGRATIONS_DIR"/*.sql)
if [ ${#migration_files[@]} -eq 0 ]; then
  log "❌ No .sql files found in $MIGRATIONS_DIR"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  log "❌ psql not found on PATH. Open it from a shell where psql works (e.g. Git Bash with Postgres installed)."
  exit 1
fi

log "Found backup: $BACKUP_FILE"
log "Found ${#migration_files[@]} migration file(s) in $MIGRATIONS_DIR:"
for f in "${migration_files[@]}"; do log "    - $f"; done

if [ "$SKIP_CONFIRM" -ne 1 ]; then
  echo
  echo "This will DROP and rebuild the 'public' schema on the local stack"
  echo "(127.0.0.1:54322), then restore your backup and apply migrations."
  echo "Your original database on port 5432 is not touched either way."
  read -r -p "Type 'yes' to continue: " confirm
  if [ "$confirm" != "yes" ]; then
    log "Aborted by user before making any changes."
    exit 1
  fi
fi

# ---- Step 1: drop & recreate public schema on the stack ----
log "Step 1/3: Dropping and recreating public schema on port $PGPORT..."
psql -U "$PGUSER" -h "$PGHOST" -p "$PGPORT" -d "$PGDATABASE" \
  -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" \
  >>"$LOG_FILE" 2>&1 || fail "Step 1 (drop/recreate public schema)"
log "✅ Step 1 done."

# ---- Step 2: load the old backup ----
log "Step 2/3: Loading $BACKUP_FILE into the stack..."
psql -U "$PGUSER" -h "$PGHOST" -p "$PGPORT" -d "$PGDATABASE" \
  -v ON_ERROR_STOP=1 \
  -f "$BACKUP_FILE" \
  >>"$LOG_FILE" 2>&1 || fail "Step 2 (restore solar_store_backup.sql)"
log "✅ Step 2 done."

# ---- Step 3: apply migrations in order ----
log "Step 3/3: Applying migrations from $MIGRATIONS_DIR..."
for f in "${migration_files[@]}"; do
  log "  --- applying: $f"
  psql -U "$PGUSER" -h "$PGHOST" -p "$PGPORT" -d "$PGDATABASE" \
    -v ON_ERROR_STOP=1 -f "$f" \
    >>"$LOG_FILE" 2>&1 || fail "Step 3 ($f)"
  log "  ✅ applied: $f"
done

log "=== ✅ Path B complete — all three steps succeeded. ==="
log "Next: from backend/, run the dry run:"
log "  DATABASE_URL=\"postgresql://postgres:postgres@127.0.0.1:54322/postgres\" DIRECT_URL=\"postgresql://postgres:postgres@127.0.0.1:54322/postgres\" npm run users:migrate"
log "Full output saved to: $LOG_FILE"
