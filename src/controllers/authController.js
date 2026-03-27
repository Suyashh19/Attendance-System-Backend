const prisma = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// REGISTER
exports.register = async (req, res) => {
  const { email, password, name, rollNo, prn, deviceId, role } = req.body;

  try {
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) return res.status(400).json({ error: "Email already exists" });

    // Ensure rollNo is unique if provided
    if (rollNo) {
      const existingRollNo = await prisma.user.findUnique({ where: { rollNo } });
      if (existingRollNo) return res.status(400).json({ error: "Roll number already exists" });
    }

    // PRN Logic: Students only, mandatory if student
    if (role === "student" && !prn) {
      return res.status(400).json({ error: "PRN is required for students" });
    }
    if (role === "faculty" && prn) {
      return res.status(400).json({ error: "Faculty cannot have a PRN" });
    }
    if (prn) {
      const existingPrn = await prisma.user.findUnique({ where: { prn } });
      if (existingPrn) return res.status(400).json({ error: "PRN already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        role: role || "student",
        name: name || null,
        rollNo: rollNo || null,
        prn: role === "student" ? prn : null,
        deviceId: deviceId || null
      },
      select: { id: true, email: true, role: true, name: true, rollNo: true, prn: true }
    });

    res.status(201).json(user);
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Error creating user" });
  }
};

// LOGIN
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) return res.status(401).json({ error: "Wrong password" });

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Exclude password from user object
    const { password: _, ...userWithoutPassword } = user;

    res.json({ token, user: userWithoutPassword });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login error" });
  }
};

// GET PROFILE
exports.getProfile = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true, role: true, name: true, rollNo: true, prn: true, deviceId: true }
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Error fetching profile" });
  }
};

// SAVE PUSH TOKEN
exports.savePushToken = async (req, res) => {
  const { token } = req.body;
  const userId = req.user.userId;

  if (!token) return res.status(400).json({ error: "Token is required" });

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { pushToken: token },
    });
    console.log(`[DEBUG] Saved push token for user ${userId}`);
    res.json({ message: "Push token saved successfully" });
  } catch (err) {
    console.error("Error saving push token:", err);
    res.status(500).json({ error: "Failed to save push token" });
  }
};

// UPDATE PRN (ONE-TIME FOR STUDENTS)
exports.updatePrn = async (req, res) => {
  const { prn } = req.body;
  const userId = req.user.userId;

  if (!prn) return res.status(400).json({ error: "PRN is required" });

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, prn: true }
    });

    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role !== "student") return res.status(403).json({ error: "Only students can have a PRN" });
    if (user.prn) return res.status(400).json({ error: "PRN is already set and cannot be changed" });

    // Check if PRN is globally unique
    const existingPrn = await prisma.user.findUnique({ where: { prn } });
    if (existingPrn) return res.status(400).json({ error: "PRN already in use" });

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { prn },
      select: { id: true, email: true, role: true, name: true, rollNo: true, prn: true }
    });

    res.json(updatedUser);
  } catch (err) {
    console.error("Error updating PRN:", err);
    res.status(500).json({ error: "Failed to update PRN" });
  }
};

// DELETE ACCOUNT (CASCADING)
exports.deleteAccount = async (req, res, next) => {
  const userId = req.user.userId;
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Delete Attendances
      await tx.attendance.deleteMany({ where: { studentId: userId } });
      // 2. Delete Enrollments
      await tx.enrollment.deleteMany({ where: { studentId: userId } });
      // 3. Delete Subjects/Sessions if Faculty
      const ownedSubjects = await tx.subject.findMany({ where: { facultyId: userId }, select: { id: true } });
      if (ownedSubjects.length > 0) {
        const sIds = ownedSubjects.map(s => s.id);
        await tx.attendance.deleteMany({ where: { session: { subjectId: { in: sIds } } } });
        await tx.session.deleteMany({ where: { subjectId: { in: sIds } } });
        await tx.subject.deleteMany({ where: { facultyId: userId } });
      }
      // 4. Finally delete the User profile
      await tx.user.delete({ where: { id: userId } });
    });
    res.json({ message: "Account deleted permanently" });
  } catch (err) {
    console.error("Error deleting account:", err);
    res.status(500).json({ error: "Failed to delete account" });
  }
};