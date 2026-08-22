-- ============================================================
-- Multi-tenancy: every business table gains an owning tenant.
--
-- Additive and re-runnable. Written by hand rather than generated, because
-- the generated form adds NOT NULL columns to tables that already hold rows,
-- which fails outright on a database with data in it. The order here is:
-- create the tenant table, adopt all existing data into one default tenant,
-- and only then tighten the columns to NOT NULL.
--
-- No table, column or row is ever dropped. The one thing removed is a set of
-- GLOBAL unique indexes, each immediately replaced by the same uniqueness
-- scoped per tenant. That is a relaxation rather than a loss: every row that
-- satisfied the old index still satisfies the new one, and it is unavoidable
-- because two stores must each be able to hold an invoice numbered
-- INV-00001. Postgres has no "ALTER INDEX ... ADD COLUMN".
--
-- Safe on an empty database too: the default tenant is then simply an empty
-- store, which the super admin can rename or delete.
-- ============================================================

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "maxUsers" INTEGER,
    "maxProducts" INTEGER,
    "maxClients" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_slug_key" ON "Tenant"("slug");

CREATE INDEX IF NOT EXISTS "Tenant_status_idx" ON "Tenant"("status");

-- ------------------------------------------------------------
-- The tenant that adopts every pre-existing row. Fixed id so the seeder and
-- any later migration agree on which store that is.
-- ------------------------------------------------------------
INSERT INTO "Tenant" ("id", "name", "slug", "status", "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Store', 'default', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ------------------------------------------------------------
-- Step 1: add every tenantId column as NULLABLE, so existing rows survive.
-- ------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "LoginHistory" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "SubCategory" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "AttributeDefinition" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "PriceHistory" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "CompatibilityLink" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "StockLevel" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "ProductUnit" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "ClientAddress" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "SupplierProduct" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "QuotationItem" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "GoodsReceipt" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "PaymentSchedule" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "ReturnItem" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "SupplierReturn" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "WarrantyClaim" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "ServiceJob" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Installation" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "EnergyReading" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "MaintenanceContract" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "NumberSequence" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "BackupLog" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Worker" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "AttendanceEntry" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

-- Setting swaps its natural key primary key for a surrogate id: a settings
-- key is only unique *within* a tenant now, and the backup exporter pages on
-- a single-column primary key. The key column itself is untouched.
ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
UPDATE "Setting" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;

-- ------------------------------------------------------------
-- Step 2: adopt existing rows into the default tenant.
-- ------------------------------------------------------------
-- Users first, and role-aware: a SUPER_ADMIN belongs to no store, so it keeps
-- tenantId NULL. Everyone else becomes a member of the default store.
UPDATE "User" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "role" <> 'SUPER_ADMIN' AND "tenantId" IS NULL;

-- History tables follow the user they belong to, so the trail left by a super
-- admin never lands inside the view of any tenant.
UPDATE "AuditLog" a SET "tenantId" = u."tenantId" FROM "User" u WHERE a."userId" = u."id" AND a."tenantId" IS NULL;
UPDATE "LoginHistory" h SET "tenantId" = u."tenantId" FROM "User" u WHERE h."userId" = u."id" AND h."tenantId" IS NULL;
-- Anonymous rows (failed logins for unknown emails, system actions) predate
-- tenancy and belong to the store that existed at the time.
UPDATE "AuditLog" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "userId" IS NULL AND "tenantId" IS NULL;
UPDATE "LoginHistory" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "userId" IS NULL AND "tenantId" IS NULL;
UPDATE "BackupLog" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;

-- Everything else is unambiguously store data.
UPDATE "Attachment" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Category" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "SubCategory" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "AttributeDefinition" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Product" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "PriceHistory" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "CompatibilityLink" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Warehouse" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "StockLevel" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "ProductUnit" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "StockMovement" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Client" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "ClientAddress" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Supplier" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "SupplierProduct" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Quotation" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "QuotationItem" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "SalesOrder" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "SalesOrderItem" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "PurchaseOrder" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "PurchaseOrderItem" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "GoodsReceipt" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Invoice" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "InvoiceItem" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Payment" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "PaymentSchedule" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Refund" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "ReturnItem" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "SupplierReturn" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "WarrantyClaim" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "ServiceJob" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Installation" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "EnergyReading" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "MaintenanceContract" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Expense" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Notification" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "NumberSequence" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Worker" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "AttendanceEntry" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Setting" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;

-- ------------------------------------------------------------
-- Step 3: tighten. From here the database itself refuses an untenanted row.
-- ------------------------------------------------------------
ALTER TABLE "Attachment" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Category" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "SubCategory" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "AttributeDefinition" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "PriceHistory" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "CompatibilityLink" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Warehouse" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "StockLevel" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ProductUnit" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "StockMovement" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Client" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ClientAddress" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Supplier" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "SupplierProduct" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Quotation" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "QuotationItem" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "SalesOrder" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "SalesOrderItem" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "PurchaseOrderItem" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "GoodsReceipt" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "InvoiceItem" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "PaymentSchedule" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Refund" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ReturnItem" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "SupplierReturn" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "WarrantyClaim" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ServiceJob" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Installation" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "EnergyReading" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "MaintenanceContract" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Expense" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Notification" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "NumberSequence" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Worker" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "AttendanceEntry" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Setting" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Setting" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "Setting" DROP CONSTRAINT IF EXISTS "Setting_pkey";
DO $$
BEGIN
  ALTER TABLE "Setting" ADD CONSTRAINT "Setting_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- Step 4: uniqueness becomes per-tenant rather than global. See the note at
-- the top: each dropped index is replaced on the very next lines.
-- ------------------------------------------------------------
DROP INDEX IF EXISTS "Category_name_key";
DROP INDEX IF EXISTS "Product_sku_key";
DROP INDEX IF EXISTS "Warehouse_name_key";
DROP INDEX IF EXISTS "ProductUnit_serialNumber_key";
DROP INDEX IF EXISTS "Quotation_number_key";
DROP INDEX IF EXISTS "SalesOrder_number_key";
DROP INDEX IF EXISTS "SalesOrder_pickupCode_key";
DROP INDEX IF EXISTS "PurchaseOrder_number_key";
DROP INDEX IF EXISTS "Invoice_number_key";
DROP INDEX IF EXISTS "Payment_number_key";
DROP INDEX IF EXISTS "Refund_number_key";
DROP INDEX IF EXISTS "SupplierReturn_number_key";
DROP INDEX IF EXISTS "WarrantyClaim_number_key";
DROP INDEX IF EXISTS "ServiceJob_number_key";
DROP INDEX IF EXISTS "Installation_number_key";
DROP INDEX IF EXISTS "MaintenanceContract_number_key";
DROP INDEX IF EXISTS "Expense_number_key";
DROP INDEX IF EXISTS "NumberSequence_entity_key";
DROP INDEX IF EXISTS "Worker_code_key";

CREATE INDEX IF NOT EXISTS "User_tenantId_idx" ON "User"("tenantId");

CREATE INDEX IF NOT EXISTS "LoginHistory_tenantId_idx" ON "LoginHistory"("tenantId");

CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");

CREATE INDEX IF NOT EXISTS "Attachment_tenantId_idx" ON "Attachment"("tenantId");

CREATE INDEX IF NOT EXISTS "Category_tenantId_idx" ON "Category"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "Category_tenantId_name_key" ON "Category"("tenantId", "name");

CREATE INDEX IF NOT EXISTS "SubCategory_tenantId_idx" ON "SubCategory"("tenantId");

CREATE INDEX IF NOT EXISTS "AttributeDefinition_tenantId_idx" ON "AttributeDefinition"("tenantId");

CREATE INDEX IF NOT EXISTS "Product_tenantId_idx" ON "Product"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");

CREATE INDEX IF NOT EXISTS "PriceHistory_tenantId_idx" ON "PriceHistory"("tenantId");

CREATE INDEX IF NOT EXISTS "CompatibilityLink_tenantId_idx" ON "CompatibilityLink"("tenantId");

CREATE INDEX IF NOT EXISTS "Warehouse_tenantId_idx" ON "Warehouse"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "Warehouse_tenantId_name_key" ON "Warehouse"("tenantId", "name");

CREATE INDEX IF NOT EXISTS "StockLevel_tenantId_idx" ON "StockLevel"("tenantId");

CREATE INDEX IF NOT EXISTS "ProductUnit_tenantId_idx" ON "ProductUnit"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "ProductUnit_tenantId_serialNumber_key" ON "ProductUnit"("tenantId", "serialNumber");

CREATE INDEX IF NOT EXISTS "StockMovement_tenantId_idx" ON "StockMovement"("tenantId");

CREATE INDEX IF NOT EXISTS "Client_tenantId_idx" ON "Client"("tenantId");

CREATE INDEX IF NOT EXISTS "ClientAddress_tenantId_idx" ON "ClientAddress"("tenantId");

CREATE INDEX IF NOT EXISTS "Supplier_tenantId_idx" ON "Supplier"("tenantId");

CREATE INDEX IF NOT EXISTS "SupplierProduct_tenantId_idx" ON "SupplierProduct"("tenantId");

CREATE INDEX IF NOT EXISTS "Quotation_tenantId_idx" ON "Quotation"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "Quotation_tenantId_number_key" ON "Quotation"("tenantId", "number");

CREATE INDEX IF NOT EXISTS "QuotationItem_tenantId_idx" ON "QuotationItem"("tenantId");

CREATE INDEX IF NOT EXISTS "SalesOrder_tenantId_idx" ON "SalesOrder"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "SalesOrder_tenantId_number_key" ON "SalesOrder"("tenantId", "number");

CREATE UNIQUE INDEX IF NOT EXISTS "SalesOrder_tenantId_pickupCode_key" ON "SalesOrder"("tenantId", "pickupCode");

CREATE INDEX IF NOT EXISTS "SalesOrderItem_tenantId_idx" ON "SalesOrderItem"("tenantId");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_tenantId_idx" ON "PurchaseOrder"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrder_tenantId_number_key" ON "PurchaseOrder"("tenantId", "number");

CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_tenantId_idx" ON "PurchaseOrderItem"("tenantId");

CREATE INDEX IF NOT EXISTS "GoodsReceipt_tenantId_idx" ON "GoodsReceipt"("tenantId");

CREATE INDEX IF NOT EXISTS "Invoice_tenantId_idx" ON "Invoice"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_tenantId_number_key" ON "Invoice"("tenantId", "number");

CREATE INDEX IF NOT EXISTS "InvoiceItem_tenantId_idx" ON "InvoiceItem"("tenantId");

CREATE INDEX IF NOT EXISTS "Payment_tenantId_idx" ON "Payment"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_tenantId_number_key" ON "Payment"("tenantId", "number");

CREATE INDEX IF NOT EXISTS "PaymentSchedule_tenantId_idx" ON "PaymentSchedule"("tenantId");

CREATE INDEX IF NOT EXISTS "Refund_tenantId_idx" ON "Refund"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "Refund_tenantId_number_key" ON "Refund"("tenantId", "number");

CREATE INDEX IF NOT EXISTS "ReturnItem_tenantId_idx" ON "ReturnItem"("tenantId");

CREATE INDEX IF NOT EXISTS "SupplierReturn_tenantId_idx" ON "SupplierReturn"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierReturn_tenantId_number_key" ON "SupplierReturn"("tenantId", "number");

CREATE INDEX IF NOT EXISTS "WarrantyClaim_tenantId_idx" ON "WarrantyClaim"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "WarrantyClaim_tenantId_number_key" ON "WarrantyClaim"("tenantId", "number");

CREATE INDEX IF NOT EXISTS "ServiceJob_tenantId_idx" ON "ServiceJob"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceJob_tenantId_number_key" ON "ServiceJob"("tenantId", "number");

CREATE INDEX IF NOT EXISTS "Installation_tenantId_idx" ON "Installation"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "Installation_tenantId_number_key" ON "Installation"("tenantId", "number");

CREATE INDEX IF NOT EXISTS "EnergyReading_tenantId_idx" ON "EnergyReading"("tenantId");

CREATE INDEX IF NOT EXISTS "MaintenanceContract_tenantId_idx" ON "MaintenanceContract"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "MaintenanceContract_tenantId_number_key" ON "MaintenanceContract"("tenantId", "number");

CREATE INDEX IF NOT EXISTS "Expense_tenantId_idx" ON "Expense"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "Expense_tenantId_number_key" ON "Expense"("tenantId", "number");

CREATE INDEX IF NOT EXISTS "Notification_tenantId_idx" ON "Notification"("tenantId");

CREATE INDEX IF NOT EXISTS "Setting_tenantId_idx" ON "Setting"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "Setting_tenantId_key_key" ON "Setting"("tenantId", "key");

CREATE INDEX IF NOT EXISTS "NumberSequence_tenantId_idx" ON "NumberSequence"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "NumberSequence_tenantId_entity_key" ON "NumberSequence"("tenantId", "entity");

CREATE INDEX IF NOT EXISTS "BackupLog_tenantId_idx" ON "BackupLog"("tenantId");

CREATE INDEX IF NOT EXISTS "Worker_tenantId_idx" ON "Worker"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "Worker_tenantId_code_key" ON "Worker"("tenantId", "code");

CREATE INDEX IF NOT EXISTS "AttendanceEntry_tenantId_idx" ON "AttendanceEntry"("tenantId");

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "LoginHistory" ADD CONSTRAINT "LoginHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Category" ADD CONSTRAINT "Category_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "SubCategory" ADD CONSTRAINT "SubCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "AttributeDefinition" ADD CONSTRAINT "AttributeDefinition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CompatibilityLink" ADD CONSTRAINT "CompatibilityLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Client" ADD CONSTRAINT "Client_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ClientAddress" ADD CONSTRAINT "ClientAddress_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Refund" ADD CONSTRAINT "Refund_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Installation" ADD CONSTRAINT "Installation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "EnergyReading" ADD CONSTRAINT "EnergyReading_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MaintenanceContract" ADD CONSTRAINT "MaintenanceContract_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Setting" ADD CONSTRAINT "Setting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "NumberSequence" ADD CONSTRAINT "NumberSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "BackupLog" ADD CONSTRAINT "BackupLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Worker" ADD CONSTRAINT "Worker_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "AttendanceEntry" ADD CONSTRAINT "AttendanceEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
