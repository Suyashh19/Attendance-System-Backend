-- Leave requests: a student asks for time off in a subject; approved leave excuses the missed classes.
-- IF NOT EXISTS keeps this safe on a database where `prisma db push` already created the table.
CREATE TABLE IF NOT EXISTS "LeaveRequest" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LeaveRequest_subjectId_status_idx" ON "LeaveRequest"("subjectId", "status");
CREATE INDEX IF NOT EXISTS "LeaveRequest_studentId_idx" ON "LeaveRequest"("studentId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaveRequest_studentId_fkey') THEN
        ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_studentId_fkey"
            FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaveRequest_subjectId_fkey') THEN
        ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_subjectId_fkey"
            FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
