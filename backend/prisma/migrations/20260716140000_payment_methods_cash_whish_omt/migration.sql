-- Replace payment methods with the ones actually used by the store:
-- CASH, WHISH, OMT (STORE_CREDIT kept for the store-credit feature).
-- Existing rows with removed methods are remapped to CASH.

CREATE TYPE "PaymentMethod_new" AS ENUM ('CASH', 'WHISH', 'OMT', 'STORE_CREDIT');

UPDATE "Payment"
SET "method" = 'CASH'
WHERE "method"::text IN ('BANK_TRANSFER', 'CHEQUE', 'CARD', 'MOBILE');

UPDATE "Expense"
SET "paymentMethod" = 'CASH'
WHERE "paymentMethod"::text IN ('BANK_TRANSFER', 'CHEQUE', 'CARD', 'MOBILE');

ALTER TABLE "Payment"
  ALTER COLUMN "method" TYPE "PaymentMethod_new" USING ("method"::text::"PaymentMethod_new");

ALTER TABLE "Expense"
  ALTER COLUMN "paymentMethod" DROP DEFAULT,
  ALTER COLUMN "paymentMethod" TYPE "PaymentMethod_new" USING ("paymentMethod"::text::"PaymentMethod_new"),
  ALTER COLUMN "paymentMethod" SET DEFAULT 'CASH';

DROP TYPE "PaymentMethod";
ALTER TYPE "PaymentMethod_new" RENAME TO "PaymentMethod";
