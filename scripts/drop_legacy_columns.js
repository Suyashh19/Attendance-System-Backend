/**
 * Drops the columns left over from the GPS / multiple-choice-code design:
 *   Session.fakeOptions, Session.latitude, Session.longitude,
 *   Attendance.latitude, Attendance.longitude
 *
 * Runs as part of `npm run build`, before `prisma db push`: db push refuses to
 * drop a column that holds data, so the columns are removed here first.
 * Safe to run any number of times, and on a database that has no tables yet.
 *
 * THIS DELETES DATA: the old GPS coordinates stored with past sessions and
 * attendance records are gone for good once it has run.
 */

const { PrismaClient } = require("@prisma/client");
require("dotenv").config();

const LEGACY_COLUMNS = {
  Session: ["fakeOptions", "latitude", "longitude"],
  Attendance: ["latitude", "longitude"],
};

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const [table, columns] of Object.entries(LEGACY_COLUMNS)) {
      for (const column of columns) {
        // Identifiers come from the fixed list above, never from input
        await prisma.$executeRawUnsafe(
          `ALTER TABLE IF EXISTS "${table}" DROP COLUMN IF EXISTS "${column}"`
        );
      }
      console.log(`[drop_legacy_columns] ${table}: ${columns.join(", ")} removed (or already gone)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[drop_legacy_columns] Failed:", err);
  process.exit(1);
});
