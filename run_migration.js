const { PrismaClient } = require("@prisma/client");
require("dotenv").config();

const prisma = new PrismaClient();

async function run(name, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`✅ ${name}`);
  } catch (err) {
    if (err.message.includes("already exists") || err.message.includes("duplicate")) {
      console.log(`⚠️  ${name} — already exists, skipping`);
    } else {
      console.error(`❌ ${name} FAILED:`, err.message);
    }
  }
}

async function main() {
  console.log("─── Running attendance system migration ───\n");

  // ── 1. Extend User ──────────────────────────────────────────────────────────
  await run("User.name column",     `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "name" TEXT`);
  await run("User.rollNo column",   `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "rollNo" TEXT`);
  await run("User.deviceId column", `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deviceId" TEXT`);
  await run("User.createdAt column",`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await run("User.updatedAt column",`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);

  // Partial unique index: only enforce uniqueness on non-null rollNo values
  await run("User.rollNo index", `
    CREATE UNIQUE INDEX IF NOT EXISTS "User_rollNo_key"
    ON "User"("rollNo")
    WHERE "rollNo" IS NOT NULL
  `);

  // ── 2. Subject ──────────────────────────────────────────────────────────────
  await run("Subject table", `
    CREATE TABLE IF NOT EXISTS "Subject" (
      "id"        SERIAL NOT NULL,
      "name"      TEXT NOT NULL,
      "code"      TEXT NOT NULL,
      "facultyId" INTEGER NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
    )
  `);
  await run("Subject.code unique index", `
    CREATE UNIQUE INDEX IF NOT EXISTS "Subject_code_key" ON "Subject"("code")
  `);
  await run("Subject.facultyId FK", `
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'Subject_facultyId_fkey'
      ) THEN
        ALTER TABLE "Subject" ADD CONSTRAINT "Subject_facultyId_fkey"
          FOREIGN KEY ("facultyId") REFERENCES "User"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END $$
  `);

  // ── 3. Enrollment ───────────────────────────────────────────────────────────
  await run("Enrollment table", `
    CREATE TABLE IF NOT EXISTS "Enrollment" (
      "id"         SERIAL NOT NULL,
      "studentId"  INTEGER NOT NULL,
      "subjectId"  INTEGER NOT NULL,
      "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
    )
  `);
  await run("Enrollment unique index", `
    CREATE UNIQUE INDEX IF NOT EXISTS "Enrollment_studentId_subjectId_key"
    ON "Enrollment"("studentId", "subjectId")
  `);
  await run("Enrollment.studentId FK", `
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'Enrollment_studentId_fkey'
      ) THEN
        ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_studentId_fkey"
          FOREIGN KEY ("studentId") REFERENCES "User"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END $$
  `);
  await run("Enrollment.subjectId FK", `
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'Enrollment_subjectId_fkey'
      ) THEN
        ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_subjectId_fkey"
          FOREIGN KEY ("subjectId") REFERENCES "Subject"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END $$
  `);

  // ── 4. Session ──────────────────────────────────────────────────────────────
  await run("Session table", `
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
    )
  `);
  await run("Session.subjectId FK", `
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'Session_subjectId_fkey'
      ) THEN
        ALTER TABLE "Session" ADD CONSTRAINT "Session_subjectId_fkey"
          FOREIGN KEY ("subjectId") REFERENCES "Subject"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END $$
  `);
  await run("Session.facultyId FK", `
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'Session_facultyId_fkey'
      ) THEN
        ALTER TABLE "Session" ADD CONSTRAINT "Session_facultyId_fkey"
          FOREIGN KEY ("facultyId") REFERENCES "User"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END $$
  `);

  // ── 5. Attendance ───────────────────────────────────────────────────────────
  await run("Attendance table", `
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
    )
  `);
  await run("Attendance unique index", `
    CREATE UNIQUE INDEX IF NOT EXISTS "Attendance_sessionId_studentId_key"
    ON "Attendance"("sessionId", "studentId")
  `);
  await run("Attendance.sessionId FK", `
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'Attendance_sessionId_fkey'
      ) THEN
        ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_sessionId_fkey"
          FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END $$
  `);
  await run("Attendance.studentId FK", `
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'Attendance_studentId_fkey'
      ) THEN
        ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_studentId_fkey"
          FOREIGN KEY ("studentId") REFERENCES "User"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END $$
  `);

  console.log("\n─── Migration finished ───");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
