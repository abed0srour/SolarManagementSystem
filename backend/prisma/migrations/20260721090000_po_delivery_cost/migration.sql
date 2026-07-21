-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN "hasDeliveryCost" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PurchaseOrder" ADD COLUMN "deliveryCost" DECIMAL(12,2) NOT NULL DEFAULT 0;
