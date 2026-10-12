const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Checking DB columns for Enrollment table...");
  try {
    const columns = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'Enrollment'
    `;
    console.log("Columns in Enrollment table:", JSON.stringify(columns, null, 2));

    const statusColumn = columns.find(c => c.column_name === 'status');
    if (statusColumn) {
      console.log("SUCCESS: 'status' column exists.");
    } else {
      console.error("FAILURE: 'status' column DOES NOT exist in the database.");
    }
  } catch (err) {
    console.error("Error querying information_schema:", err);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
