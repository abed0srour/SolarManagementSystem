-- Roles and per-account permission overrides.

-- The enum is recreated rather than extended with ALTER TYPE ... ADD VALUE,
-- because a value added inside a transaction cannot be used by a statement in
-- that same transaction — and this migration needs to assign SUPER_ADMIN below.
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
-- New accounts start at the least privilege; the creator raises them on purpose.
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'STAFF';
DROP TYPE "Role_old";

-- Empty means "use the role's defaults", so existing accounts are unaffected.
ALTER TABLE "User" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The owner's account becomes the super admin.
UPDATE "User" SET "role" = 'SUPER_ADMIN' WHERE lower("email") = 'abd.srour313@gmail.com';

-- Safety net: if that address does not exist in this database, promote the
-- oldest account instead. Without a super admin nobody could manage accounts,
-- which would lock the owner out of the feature entirely.
UPDATE "User" SET "role" = 'SUPER_ADMIN'
WHERE "id" = (SELECT "id" FROM "User" WHERE "deletedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "role" = 'SUPER_ADMIN');
