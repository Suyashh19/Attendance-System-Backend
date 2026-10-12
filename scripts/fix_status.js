const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Checking for enrollments with missing status...");
  // Use raw query to check for nulls if Prisma client won't even load them
  // or just use updateMany which usually works if the field is present in schema
  try {
    const updated = await prisma.enrollment.updateMany({
      where: {
        status: {
          equals: null
        }
      },
      data: {
        status: "APPROVED"
      }
    });
    console.log(`Updated ${updated.count} records with null status.`);
  } catch (e) {
    // If Prisma client fails because status is mandatory, use raw SQL
    console.log("Prisma updateMany failed, trying raw SQL...");
    try {
        await prisma.$executeRaw`UPDATE "Enrollment" SET "status" = 'APPROVED' WHERE "status" IS NULL`;
        console.log("Raw SQL update successful.");
    } catch (sqlErr) {
        console.error("Raw SQL update failed:", sqlErr);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
