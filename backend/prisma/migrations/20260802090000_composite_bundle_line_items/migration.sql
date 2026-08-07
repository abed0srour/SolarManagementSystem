-- DropForeignKey
ALTER TABLE "QuotationItem" DROP CONSTRAINT "QuotationItem_productId_fkey";

-- DropForeignKey
ALTER TABLE "SalesOrderItem" DROP CONSTRAINT "SalesOrderItem_productId_fkey";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "showSubItemsOnInvoice" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "isComposite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentItemId" TEXT,
ADD COLUMN     "unit" TEXT,
ALTER COLUMN "quantity" SET DEFAULT 1,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "QuotationItem" ADD COLUMN     "autoPrice" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isComposite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentItemId" TEXT,
ADD COLUMN     "unit" TEXT,
ALTER COLUMN "productId" DROP NOT NULL,
ALTER COLUMN "quantity" SET DEFAULT 1,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "showSubItemsOnInvoice" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SalesOrderItem" ADD COLUMN     "autoPrice" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isComposite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentItemId" TEXT,
ADD COLUMN     "unit" TEXT,
ALTER COLUMN "productId" DROP NOT NULL,
ALTER COLUMN "quantity" SET DEFAULT 1,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "newEmail" TEXT,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationCode_userId_purpose_idx" ON "VerificationCode"("userId", "purpose");

-- CreateIndex
CREATE INDEX "InvoiceItem_parentItemId_idx" ON "InvoiceItem"("parentItemId");

-- CreateIndex
CREATE INDEX "QuotationItem_parentItemId_idx" ON "QuotationItem"("parentItemId");

-- CreateIndex
CREATE INDEX "SalesOrderItem_parentItemId_idx" ON "SalesOrderItem"("parentItemId");

-- AddForeignKey
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "QuotationItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "SalesOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "InvoiceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

