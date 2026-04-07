const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Setting all existing enrollments to APPROVED...");
  const result = await prisma.enrollment.updateMany({
    where: {
      status: "PENDING"
    },
    data: {
      status: "APPROVED"
    }
  });
  console.log(`Successfully updated ${result.count} enrollments to APPROVED.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
