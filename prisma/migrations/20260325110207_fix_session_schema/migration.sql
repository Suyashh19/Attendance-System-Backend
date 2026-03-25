/*
  Warnings:

  - A unique constraint covering the columns `[rollNo]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
DROP INDEX IF EXISTS "User_rollNo_key";
CREATE UNIQUE INDEX "User_rollNo_key" ON "User"("rollNo");
