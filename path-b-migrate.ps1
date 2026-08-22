#
# path-b-migrate.ps1 — Windows/PowerShell version of the Path B bundle.
#
# Bundles Path B's three commands into one checked run:
#   1. Drop & recreate the public schema on the LOCAL Supabase stack (port 54322 only)
#   2. Load solar_store_backup.sql into that stack
#   3. Apply supabase\migrations\*.sql in order
#
# Stops on the first error, never touches your original solar_store DB on
# port 5432, and writes a timestamped log you can send along if something
# goes wrong.
#
# Run from the project root (same folder as this script / the supabase\ dir).
# Easiest: double-click path-b-migrate.bat, or from cmd.exe just type:
#   path-b-migrate.bat
#
# Add -Yes to skip the confirmation prompt (e.g. for a re-run you've already
# reviewed): powershell -ExecutionPolicy Bypass -File .\path-b-migrate.ps1 -Yes

param(
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

# ---- config: the LOCAL STACK only, never your real DB on 5432 ----
$PGHOST     = "127.0.0.1"
$PGPORT     = "54322"
$PGUSER     = "postgres"
$PGDATABASE = "postgres"
if (-not $env:PGPASSWORD) { $env:PGPASSWORD = "postgres" }

$BackupFile     = "solar_store_backup.sql"
$MigrationsDir  = "supabase\migrations"
$Timestamp      = Get-Date -Format "yyyyMMdd_HHmmss"
$LogFile        = "path-b-migrate_$Timestamp.log"

function Write-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

function Invoke-Fail {
    param([string]$Where)
    Write-Log "FAILED at: $Where"
    Write-Log "  Nothing after this point ran."
    Write-Log "  Your original solar_store database (port 5432) was never touched."
    Write-Log "  Full details are in: $LogFile"
    Write-Log "  To start Path B over: npx supabase db reset   (resets the LOCAL stack only -- never add --linked)"
    exit 1
}

function Invoke-Psql {
    param(
        [string[]]$PsqlArgs,
        [string]$Label
    )
    Write-Log "  running: psql $($PsqlArgs -join ' ')"
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & psql @PsqlArgs 2>&1
        $output | ForEach-Object { Add-Content -Path $LogFile -Value "$_" }
        if ($LASTEXITCODE -ne 0) {
            $output | ForEach-Object { Write-Host "$_" }
            Invoke-Fail $Label
        }
    } finally {
        $ErrorActionPreference = $prevEAP
    }
}

Write-Log "=== Path B migration ==="
Write-Log "Target: postgresql://$PGUSER@${PGHOST}:$PGPORT/$PGDATABASE (local Supabase stack)"

# --- Safety net: refuse to ever run against the real DB port ---
if ($PGPORT -eq "5432") {
    Write-Log "Refusing to run: PGPORT is 5432 (your original database), not the stack's 54322."
    exit 1
}

# --- Pre-flight checks, before anything destructive happens ---
if (-not (Test-Path $BackupFile)) {
    Write-Log "Backup file not found: $BackupFile (run Step 0 first, from this same folder)"
    exit 1
}
if (-not (Test-Path $MigrationsDir)) {
    Write-Log "Migrations folder not found: $MigrationsDir"
    exit 1
}

$migrationFiles = Get-ChildItem -Path $MigrationsDir -Filter "*.sql" | Sort-Object Name
if ($migrationFiles.Count -eq 0) {
    Write-Log "No .sql files found in $MigrationsDir"
    exit 1
}

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Write-Log "psql not found on PATH. Install/locate PostgreSQL client tools and try again."
    exit 1
}

Write-Log "Found backup: $BackupFile"
Write-Log "Found $($migrationFiles.Count) migration file(s) in ${MigrationsDir}:"
foreach ($f in $migrationFiles) { Write-Log "    - $($f.Name)" }

if (-not $Yes) {
    Write-Host ""
    Write-Host "This will DROP and rebuild the 'public' schema on the local stack"
    Write-Host "(127.0.0.1:54322), then restore your backup and apply migrations."
    Write-Host "Your original database on port 5432 is not touched either way."
    $confirm = Read-Host "Type 'yes' to continue"
    if ($confirm -ne "yes") {
        Write-Log "Aborted by user before making any changes."
        exit 1
    }
}

# ---- Step 1: drop & recreate public schema on the stack ----
Write-Log "Step 1/3: Dropping and recreating public schema on port $PGPORT..."
Invoke-Psql -PsqlArgs @(
    "-U", $PGUSER, "-h", $PGHOST, "-p", $PGPORT, "-d", $PGDATABASE,
    "-v", "ON_ERROR_STOP=1",
    "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
) -Label "Step 1 (drop/recreate public schema)"
Write-Log "Step 1 done."

# ---- Step 2: load the old backup ----
Write-Log "Step 2/3: Loading $BackupFile into the stack..."
Invoke-Psql -PsqlArgs @(
    "-U", $PGUSER, "-h", $PGHOST, "-p", $PGPORT, "-d", $PGDATABASE,
    "-v", "ON_ERROR_STOP=1",
    "-f", $BackupFile
) -Label "Step 2 (restore solar_store_backup.sql)"
Write-Log "Step 2 done."

# ---- Step 3: apply migrations in order ----
Write-Log "Step 3/3: Applying migrations from $MigrationsDir..."
foreach ($f in $migrationFiles) {
    Write-Log "  --- applying: $($f.Name)"
    Invoke-Psql -PsqlArgs @(
        "-U", $PGUSER, "-h", $PGHOST, "-p", $PGPORT, "-d", $PGDATABASE,
        "-v", "ON_ERROR_STOP=1",
        "-f", $f.FullName
    ) -Label "Step 3 ($($f.Name))"
    Write-Log "  applied: $($f.Name)"
}

Write-Log "=== Path B complete - all three steps succeeded. ==="
Write-Log "Next: from backend\, run the dry run:"
Write-Log '  set DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres'
Write-Log '  set DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres'
Write-Log '  npm run users:migrate'
Write-Log "Full output saved to: $LogFile"
