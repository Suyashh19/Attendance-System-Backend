/*
  Warnings:

  - A unique constraint covering the columns `[code,type]` on the table `Subject` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[prn]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Subject_code_key";

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "windowExpiry" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Subject" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'theory';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "prn" TEXT,
ADD COLUMN     "pushToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Subject_code_type_key" ON "Subject"("code", "type");

-- CreateIndex
CREATE UNIQUE INDEX "User_prn_key" ON "User"("prn");
