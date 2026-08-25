-- Dynamic Product Variant & Attribute Management Migration

DO $$ BEGIN
  CREATE TYPE "DynamicAttributeType" AS ENUM ('STRING', 'INTEGER', 'DECIMAL', 'FLOAT', 'BOOLEAN');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "ProductAttribute" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tenantId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "DynamicAttributeType" NOT NULL DEFAULT 'STRING',
  "unit" TEXT,
  "isFreeForm" BOOLEAN NOT NULL DEFAULT false,
  "permittedValues" JSONB,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductAttribute_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductAttribute_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProductAttribute_tenantId_idx" ON "ProductAttribute"("tenantId");
CREATE INDEX IF NOT EXISTS "ProductAttribute_productId_idx" ON "ProductAttribute"("productId");

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "parentProductId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isVariant" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "hasVariants" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "variantAttributes" JSONB;

DO $$ BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_parentProductId_fkey" FOREIGN KEY ("parentProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "Product_parentProductId_idx" ON "Product"("parentProductId");

ALTER TABLE "ProductAttribute" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "tenant_isolation_product_attribute" ON "ProductAttribute"
    AS RESTRICTIVE
    FOR ALL
    USING ("tenantId" = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'))
    WITH CHECK ("tenantId" = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
