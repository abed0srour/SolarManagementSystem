-- Split serial tracking into its two directions.
--
-- `trackSerials` governed both capture on receipt and matching on sale, which
-- forced an all-or-nothing choice. Panels arrive 270 at a time and are
-- interchangeable to the customer: worth recording against a supplier on the
-- way in, not worth picking one by one on the way out. An inverter is worth
-- both, because a warranty claim has to know which unit went where.
--
-- Defaults to true so behaviour is unchanged until a product is opted out.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "requireSerialOnSale" BOOLEAN NOT NULL DEFAULT true;
