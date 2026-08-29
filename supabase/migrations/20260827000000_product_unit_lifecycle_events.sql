-- Lifecycle history for serialized units.
--
-- ProductUnit holds only a unit's current state, so the reason, date and person
-- behind a status change were lost the moment it changed. This records them, so
-- a failed unit can be traced from the supplier who shipped it through to
-- whatever happened to it since.
--
-- Nullability and defaults here mirror schema.prisma exactly. A column that is
-- optional in the schema and NOT NULL here (or the reverse) makes the generated
-- client refuse rows the database happily holds.

CREATE TABLE IF NOT EXISTS "ProductUnitEvent" (
  "id"         TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tenantId"   TEXT NOT NULL DEFAULT '',
  "unitId"     TEXT NOT NULL,
  "fromStatus" "UnitStatus",
  "toStatus"   "UnitStatus" NOT NULL,
  "note"       TEXT,
  "refType"    TEXT,
  "refId"      TEXT,
  "userId"     TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductUnitEvent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductUnitEvent_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "ProductUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- The event outlives the account that made it: who did it is worth less than
  -- the fact it happened, so the row stays with a null author.
  CONSTRAINT "ProductUnitEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProductUnitEvent_unitId_createdAt_idx"
  ON "ProductUnitEvent"("unitId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProductUnitEvent_tenantId_idx"
  ON "ProductUnitEvent"("tenantId");

ALTER TABLE "ProductUnitEvent" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "tenant_isolation_product_unit_event" ON "ProductUnitEvent"
    AS RESTRICTIVE
    FOR ALL
    USING ("tenantId" = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'))
    WITH CHECK ("tenantId" = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
