-- Repairs environments that ran 20260825000000 before it was corrected.
--
-- That migration added Product.variantAttributes as a nullable JSONB with no
-- default, while schema.prisma declares `Json @default("{}")` -- which is NOT
-- NULL. Every row that existed at the time kept a NULL the generated client
-- refuses to read, so every query touching Product failed. Production went down
-- this way on 2026-08-26; clients and payments were unaffected because they
-- never select that column.
--
-- 20260825000000 is already recorded as applied in staging and production, so
-- fixing it in place does nothing for them. This runs as its own migration so
-- those environments actually get repaired.
--
-- Idempotent: an environment already fixed by hand passes straight through.

UPDATE "Product" SET "variantAttributes" = '{}'::jsonb WHERE "variantAttributes" IS NULL;

ALTER TABLE "Product" ALTER COLUMN "variantAttributes" SET DEFAULT '{}'::jsonb;
ALTER TABLE "Product" ALTER COLUMN "variantAttributes" SET NOT NULL;

-- Backs `@@unique([productId, name])` on ProductAttribute, which the original
-- migration also omitted.
CREATE UNIQUE INDEX IF NOT EXISTS "ProductAttribute_productId_name_key"
  ON "ProductAttribute"("productId", "name");
