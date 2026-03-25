/*
  Warnings:

  - A unique constraint covering the columns `[rollNo]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Attendance" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "date" TIMESTAMP(3),
ADD COLUMN     "scheduledEndTime" TEXT,
ADD COLUMN     "scheduledStartTime" TEXT,
ADD COLUMN     "status" TEXT DEFAULT 'active',
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Subject" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "updatedAt" DROP DEFAULT;
