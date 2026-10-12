const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    console.log("Testing Theory Subject creation...");
    const s1 = await prisma.subject.create({
      data: {
        name: "Test Theory",
        code: "TEST_T_" + Date.now(),
        facultyId: 1, // Assume faculty with ID 1 exists
        type: "theory"
      }
    });
    console.log("Theory Success:", s1.id);

    console.log("Testing Practical Subject creation...");
    const s2 = await prisma.subject.create({
      data: {
        name: "Test Practical",
        code: "TEST_P_" + Date.now(),
        facultyId: 1,
        type: "practical"
      }
    });
    console.log("Practical Success:", s2.id);

  } catch (err) {
    console.error("FAILED!");
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

test();
