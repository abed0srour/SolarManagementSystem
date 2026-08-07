-- CreateEnum
CREATE TYPE "PayPeriod" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PayBasis" AS ENUM ('DAILY', 'HOURLY');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY');

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "claimNotes" TEXT,
ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "claimedById" TEXT,
ADD COLUMN     "pickupCode" TEXT;

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "jobTitle" TEXT,
    "payBasis" "PayBasis" NOT NULL DEFAULT 'DAILY',
    "dailyRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "hourlyRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expectedHoursPerDay" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "lateDeductionPerHour" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payPeriod" "PayPeriod" NOT NULL DEFAULT 'MONTHLY',
    "hiredOn" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceEntry" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "hoursWorked" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lateHours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "bonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Worker_code_key" ON "Worker"("code");

-- CreateIndex
CREATE INDEX "Worker_name_idx" ON "Worker"("name");

-- CreateIndex
CREATE INDEX "AttendanceEntry_date_idx" ON "AttendanceEntry"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceEntry_workerId_date_key" ON "AttendanceEntry"("workerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_pickupCode_key" ON "SalesOrder"("pickupCode");

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEntry" ADD CONSTRAINT "AttendanceEntry_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

