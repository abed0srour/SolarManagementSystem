-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "taxAmount";

-- AlterTable
ALTER TABLE "InvoiceItem" DROP COLUMN "taxRatePct";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "purchaseOrderId" TEXT;

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "taxRatePct";

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Quotation" DROP COLUMN "taxAmount";

-- AlterTable
ALTER TABLE "QuotationItem" DROP COLUMN "taxRatePct";

-- AlterTable
ALTER TABLE "SalesOrder" DROP COLUMN "taxAmount";

-- AlterTable
ALTER TABLE "SalesOrderItem" DROP COLUMN "taxRatePct";

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

