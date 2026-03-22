-- Migration: add_attendance_models
-- Extends User and adds Subject, Enrollment, Session, Attendance

-- ─── EXTEND USER TABLE ────────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "rollNo" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Unique index for rollNo (only on non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS "User_rollNo_key" ON "User"("rollNo") WHERE "rollNo" IS NOT NULL;

-- ─── SUBJECT ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Subject" (
    "id"        SERIAL NOT NULL,
    "name"      TEXT NOT NULL,
    "code"      TEXT NOT NULL,
    "facultyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Subject_code_key" ON "Subject"("code");

ALTER TABLE "Subject" ADD CONSTRAINT "Subject_facultyId_fkey"
    FOREIGN KEY ("facultyId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── ENROLLMENT ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Enrollment" (
    "id"         SERIAL NOT NULL,
    "studentId"  INTEGER NOT NULL,
    "subjectId"  INTEGER NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Enrollment_studentId_subjectId_key"
    ON "Enrollment"("studentId", "subjectId");

ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_subjectId_fkey"
    FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── SESSION ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Session" (
    "id"          SERIAL NOT NULL,
    "subjectId"   INTEGER NOT NULL,
    "facultyId"   INTEGER NOT NULL,
    "correctCode" TEXT NOT NULL,
    "fakeOptions" TEXT NOT NULL,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "latitude"    DOUBLE PRECISION,
    "longitude"   DOUBLE PRECISION,
    "startTime"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime"     TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Session" ADD CONSTRAINT "Session_subjectId_fkey"
    FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_facultyId_fkey"
    FOREIGN KEY ("facultyId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── ATTENDANCE ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Attendance" (
    "id"            SERIAL NOT NULL,
    "sessionId"     INTEGER NOT NULL,
    "studentId"     INTEGER NOT NULL,
    "status"        TEXT NOT NULL,
    "reason"        TEXT,
    "submittedCode" TEXT,
    "deviceId"      TEXT,
    "latitude"      DOUBLE PRECISION,
    "longitude"     DOUBLE PRECISION,
    "submittedAt"   TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Attendance_sessionId_studentId_key"
    ON "Attendance"("sessionId", "studentId");

ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
