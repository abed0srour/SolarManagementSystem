-- Returning purchased goods to a supplier: stock goes out, money comes back.

-- CreateEnum
CREATE TYPE "SupplierRefundMethod" AS ENUM ('CASH', 'WHISH', 'OMT', 'CREDIT_NOTE');

-- AlterTable: value of goods sent back, so the effective bill is total - returnedAmount
ALTER TABLE "PurchaseOrder" ADD COLUMN "returnedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable: per-line returned counter, mirrors receivedQty
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "returnedQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: link returns to the originating PO and warehouse, and price them
ALTER TABLE "SupplierReturn" ADD COLUMN "purchaseOrderId" TEXT;
ALTER TABLE "SupplierReturn" ADD COLUMN "warehouseId" TEXT;
ALTER TABLE "SupplierReturn" ADD COLUMN "refundMethod" "SupplierRefundMethod" NOT NULL DEFAULT 'CASH';
ALTER TABLE "SupplierReturn" ADD COLUMN "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "SupplierReturn" ADD COLUMN "createdById" TEXT;

-- CreateIndex
CREATE INDEX "SupplierReturn_purchaseOrderId_idx" ON "SupplierReturn"("purchaseOrderId");
CREATE INDEX "SupplierReturn_supplierId_idx" ON "SupplierReturn"("supplierId");

-- AddForeignKey
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
