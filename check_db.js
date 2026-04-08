const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const counts = await prisma.enrollment.groupBy({
    by: ['status'],
    _count: true
  });
  console.log("Enrollment Status Counts:", JSON.stringify(counts, null, 2));

  const sample = await prisma.enrollment.findFirst();
  console.log("Sample Enrollment:", JSON.stringify(sample, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
