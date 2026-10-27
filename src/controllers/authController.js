const prisma = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { sendOtpEmail } = require("../services/emailService");
const { generateOTP } = require("../services/otpService");
const { WEB, APP, isWebRequest } = require("../middleware/platformMiddleware");
const { isBlocked, recordFailure, recordSuccess } = require("../middleware/attemptLimiter");

const MIN_PASSWORD_LENGTH = 6;
const MAX_OTP_ATTEMPTS = 5;
const ALLOWED_ROLES = ["student", "faculty"];
const DEVICE_CHANGE_COOLDOWN_DAYS = 30;

// REGISTER
exports.register = async (req, res) => {
  const { email, password, name, rollNo, prn, role, otp } = req.body || {};

  // The web app signs up faculty only. Students must sign up in the app, which binds their phone.
  const web = isWebRequest(req);
  if (web && role !== "faculty") {
    return res.status(403).json({ error: "Students sign up in the mobile app" });
  }
  // Faculty on the web have no phone to bind
  const deviceId = web ? null : req.body?.deviceId;

  try {
    if (!web && !deviceId) return res.status(400).json({ error: "Device ID is required for registration" });
    if (!otp) return res.status(400).json({ error: "OTP is required for registration" });
    if (role && !ALLOWED_ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });

    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) return res.status(400).json({ error: "Email already exists" });

    // Verify OTP
    const otpCheck = await checkOtp(email, otp);
    if (otpCheck.error) return res.status(400).json({ error: otpCheck.error });

    // One phone, one student account: otherwise a single device could mark two students present
    if (role !== "faculty") {
      const deviceInUse = await prisma.user.findFirst({ where: { deviceId, role: "student" } });
      if (deviceInUse) {
        return res.status(400).json({ error: "This device is already registered to another student account" });
      }
    }

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
        deviceId: deviceId || null,
        deviceLocked: !!deviceId // Lock immediately if ID is provided
      },
      select: { id: true, email: true, role: true, name: true, rollNo: true, prn: true }
    });

    // Delete OTP after successful use
    await prisma.otp.deleteMany({ where: { email } });

    res.status(201).json(user);
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Error creating user" });
  }
};

// LOGIN
exports.login = async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  // Wrong passwords are counted per account and per caller, so a password cannot be guessed endlessly
  const gate = isBlocked("login", email, req.ip);
  if (gate.blocked) return res.status(429).json({ error: gate.message });

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Same answer for both cases so the response does not reveal which emails are registered
    const valid = user ? await bcrypt.compare(password, user.password) : false;

    if (!valid) {
      recordFailure("login", email, req.ip);
      return res.status(401).json({ error: "Incorrect email or password" });
    }
    recordSuccess("login", email);

    // The web app is for faculty only; students are bound to their phone
    const platform = isWebRequest(req) ? WEB : APP;
    if (platform === WEB && user.role !== "faculty") {
      return res.status(403).json({
        error: "This account is linked to a mobile device. Please use the mobile app.",
      });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role, platform },
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
  const { token } = req.body || {};
  const userId = req.user.userId;

  if (!token) return res.status(400).json({ error: "Token is required" });

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { pushToken: token },
    });
    res.json({ message: "Push token saved successfully" });
  } catch (err) {
    console.error("Error saving push token:", err);
    res.status(500).json({ error: "Failed to save push token" });
  }
};

// UPDATE PRN (ONE-TIME FOR STUDENTS)
exports.updatePrn = async (req, res) => {
  const { prn } = req.body || {};
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

// Removes a user and everything tied to them. A faculty member's subjects go too,
// along with their sessions, enrollments and attendance records.
const removeUserAndData = async (user) => {
  const userId = user.id;
  await prisma.$transaction(async (tx) => {
    // 1. Delete Attendances
    await tx.attendance.deleteMany({ where: { studentId: userId } });
    // 2. Delete Leave requests and Enrollments
    await tx.leaveRequest.deleteMany({ where: { studentId: userId } });
    await tx.enrollment.deleteMany({ where: { studentId: userId } });
    // 3. Delete Subjects/Sessions if Faculty
    const ownedSubjects = await tx.subject.findMany({ where: { facultyId: userId }, select: { id: true } });
    if (ownedSubjects.length > 0) {
      const sIds = ownedSubjects.map(s => s.id);
      await tx.attendance.deleteMany({ where: { session: { subjectId: { in: sIds } } } });
      await tx.leaveRequest.deleteMany({ where: { subjectId: { in: sIds } } });
      await tx.session.deleteMany({ where: { subjectId: { in: sIds } } });
      await tx.enrollment.deleteMany({ where: { subjectId: { in: sIds } } });
      await tx.subject.deleteMany({ where: { facultyId: userId } });
    }
    // 4. Pending OTPs for the email
    await tx.otp.deleteMany({ where: { email: user.email } });
    // 5. Finally delete the User profile
    await tx.user.delete({ where: { id: userId } });
  });
};

// DELETE ACCOUNT (CASCADING). The password is required, so a borrowed unlocked phone cannot wipe an account.
exports.deleteAccount = async (req, res, next) => {
  const { password } = req.body || {};
  if (typeof password !== "string" || !password) {
    return res.status(400).json({ error: "Password is required to delete your account" });
  }

  const key = `user:${req.user.userId}`;
  const gate = isBlocked("deleteApp", key, req.ip);
  if (gate.blocked) return res.status(429).json({ error: gate.message });

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    // 400, not 401: the session is still valid, only the typed password is wrong
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      recordFailure("deleteApp", key, req.ip);
      return res.status(400).json({ error: "Incorrect password" });
    }
    recordSuccess("deleteApp", key);

    await removeUserAndData(user);
    res.json({ message: "Account deleted permanently" });
  } catch (err) {
    console.error("Error deleting account:", err);
    res.status(500).json({ error: "Failed to delete account" });
  }
};

// DELETE ACCOUNT FROM THE WEB PAGE (/delete-account)
// Google Play requires a way to delete an account without the app. This takes the
// password directly instead of a login token, because students cannot log in on the web.
exports.deleteAccountWithPassword = async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const gate = isBlocked("deleteWeb", email, req.ip);
  if (gate.blocked) return res.status(429).json({ error: gate.message });

  try {
    const user = await prisma.user.findUnique({ where: { email: email.trim() } });

    // Same answer for both cases so the response does not reveal which emails are registered
    const valid = user ? await bcrypt.compare(password, user.password) : false;
    if (!valid) {
      recordFailure("deleteWeb", email, req.ip);
      return res.status(401).json({ error: "Incorrect email or password" });
    }
    recordSuccess("deleteWeb", email);

    await removeUserAndData(user);
    res.json({ message: "Account deleted permanently" });
  } catch (err) {
    console.error("Error deleting account with password:", err);
    res.status(500).json({ error: "Failed to delete account" });
  }
};

// --- OTP Helpers ---
const validateRateLimit = async (email) => {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);

  const recentOtps = await prisma.otp.findMany({
    where: { email, createdAt: { gte: tenMinutesAgo } },
    orderBy: { createdAt: "desc" }
  });

  if (recentOtps.length >= 3) {
    return { valid: false, error: "Maximum OTP request limit reached. Please try again in 10 minutes." };
  }

  if (recentOtps.length > 0 && recentOtps[0].createdAt > thirtySecondsAgo) {
    return { valid: false, error: "Please wait 30 seconds before requesting a new OTP." };
  }

  return { valid: true };
};

// Checks the newest OTP for an email. Wrong guesses are counted so a code cannot be brute-forced.
const checkOtp = async (email, otp) => {
  if (typeof email !== "string" || !email) return { error: "Email is required" };

  const record = await prisma.otp.findFirst({
    where: { email },
    orderBy: { createdAt: "desc" },
  });

  if (!record) return { error: "Invalid OTP" };
  if (new Date() > record.expiresAt) return { error: "OTP has expired" };
  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    return { error: "Too many incorrect attempts. Please request a new OTP." };
  }

  if (record.code !== String(otp).trim()) {
    await prisma.otp.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    return { error: "Invalid OTP" };
  }

  return { record };
};

const createAndSendOtp = async (email) => {
  // Recent OTPs are kept (only the newest one is accepted) because the rate limit counts them
  await prisma.otp.deleteMany({
    where: { email, createdAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
  });

  const otpCode = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

  await prisma.otp.create({
    data: {
      email,
      code: otpCode,
      expiresAt,
    }
  });

  // Synchronous email send to ensure it runs before response
  try {
    await sendOtpEmail(email, otpCode);
  } catch (error) {
    console.error("Failed to send OTP email during creation:", error);
    throw error;
  }
};

// --- OTP Controllers ---

exports.sendSignupOtp = async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: "Email already exists" });

    const limitCheck = await validateRateLimit(email);
    if (!limitCheck.valid) return res.status(429).json({ error: limitCheck.error });

    await createAndSendOtp(email);
    res.json({ message: "OTP sent successfully" });
  } catch (err) {
    console.error("Send Signup OTP Error:", err);
    res.status(500).json({ error: "Failed to send OTP" });
  }
};

exports.verifySignupOtp = async (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp) return res.status(400).json({ error: "Email and OTP are required" });

  try {
    const otpCheck = await checkOtp(email, otp);
    if (otpCheck.error) return res.status(400).json({ error: otpCheck.error });

    // Note: We don't delete the OTP here, because it will be needed during the actual `/register` call.
    res.json({ message: "OTP verified" });
  } catch (err) {
    console.error("Verify Signup OTP Error:", err);
    res.status(500).json({ error: "Failed to verify OTP" });
  }
};

exports.forgotPassword = async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    // Same response whether or not the email is registered, to avoid email enumeration
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) return res.json({ message: "If this email is registered, an OTP has been sent." });

    const limitCheck = await validateRateLimit(email);
    if (!limitCheck.valid) return res.status(429).json({ error: limitCheck.error });

    await createAndSendOtp(email);
    res.json({ message: "If this email is registered, an OTP has been sent." });
  } catch (err) {
    console.error("Forgot Password Error:", err);
    res.status(500).json({ error: "Failed to process request" });
  }
};

exports.resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body || {};
  if (!email || !otp || !newPassword) return res.status(400).json({ error: "Email, OTP, and new password are required" });

  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  try {
    const otpCheck = await checkOtp(email, otp);
    if (otpCheck.error) return res.status(400).json({ error: otpCheck.error });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: "Invalid OTP" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { email },
      data: { password: hashed }
    });

    await prisma.otp.deleteMany({ where: { email } });

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Reset Password Error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
};

// --- Device change (student moved to a new phone, or reinstalled the app) ---

const daysUntilDeviceChange = (user) => {
  if (!user.deviceChangedAt) return 0;
  const nextAllowed = user.deviceChangedAt.getTime() + DEVICE_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((nextAllowed - Date.now()) / (24 * 60 * 60 * 1000)));
};

// Step 1: email an OTP to the account owner
exports.requestDeviceChange = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const waitDays = daysUntilDeviceChange(user);
    if (waitDays > 0) {
      return res.status(429).json({
        error: `You changed your device recently. You can change it again in ${waitDays} day(s).`,
      });
    }

    const limitCheck = await validateRateLimit(user.email);
    if (!limitCheck.valid) return res.status(429).json({ error: limitCheck.error });

    await createAndSendOtp(user.email);
    res.json({ message: "An OTP has been sent to your email." });
  } catch (err) {
    console.error("Request Device Change Error:", err);
    res.status(500).json({ error: "Failed to send OTP" });
  }
};

// Step 2: confirm the OTP and bind the account to the phone making the request
exports.confirmDeviceChange = async (req, res) => {
  const { otp, deviceId } = req.body || {};
  if (!otp || typeof deviceId !== "string" || !deviceId) {
    return res.status(400).json({ error: "OTP and device ID are required" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.deviceId === deviceId) {
      return res.status(400).json({ error: "This phone is already linked to your account" });
    }

    // The cooldown stops an account from hopping between friends' phones every lecture
    const waitDays = daysUntilDeviceChange(user);
    if (waitDays > 0) {
      return res.status(429).json({
        error: `You changed your device recently. You can change it again in ${waitDays} day(s).`,
      });
    }

    const otpCheck = await checkOtp(user.email, otp);
    if (otpCheck.error) return res.status(400).json({ error: otpCheck.error });

    if (user.role === "student") {
      const deviceInUse = await prisma.user.findFirst({
        where: { deviceId, role: "student", id: { not: user.id } },
      });
      if (deviceInUse) {
        return res.status(400).json({ error: "This device is already registered to another student account" });
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { deviceId, deviceLocked: true, deviceChangedAt: new Date() },
      select: { id: true, email: true, role: true, name: true, rollNo: true, prn: true, deviceId: true },
    });

    await prisma.otp.deleteMany({ where: { email: user.email } });

    res.json({ message: "This phone is now linked to your account.", user: updated });
  } catch (err) {
    console.error("Confirm Device Change Error:", err);
    res.status(500).json({ error: "Failed to change device" });
  }
};

// --- Change password with an emailed code (no email to type: it goes to the account's own address) ---

// Step 1: email a code to the logged-in user's registered address
exports.requestPasswordChange = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const limitCheck = await validateRateLimit(user.email);
    if (!limitCheck.valid) return res.status(429).json({ error: limitCheck.error });

    await createAndSendOtp(user.email);
    res.json({ message: "A code has been sent to your registered email." });
  } catch (err) {
    console.error("Request Password Change Error:", err);
    res.status(500).json({ error: "Failed to send code" });
  }
};

// Step 2: the code proves the person holds the registered email, then the new password is saved
exports.confirmPasswordChange = async (req, res) => {
  const { otp, newPassword } = req.body || {};

  if (!otp || !newPassword) return res.status(400).json({ error: "Code and new password are required" });
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const otpCheck = await checkOtp(user.email, otp);
    if (otpCheck.error) return res.status(400).json({ error: otpCheck.error });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    await prisma.otp.deleteMany({ where: { email: user.email } });

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Confirm Password Change Error:", err);
    res.status(500).json({ error: "Failed to update password" });
  }
};

exports.updatePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const userId = req.user.userId;

  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Both current and new password are required" });
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const key = `user:${userId}`;
  const gate = isBlocked("changePassword", key, req.ip);
  if (gate.blocked) return res.status(429).json({ error: gate.message });

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    // 400, not 401: the session is still valid, only the typed password is wrong
    const valid = await bcrypt.compare(String(currentPassword), user.password);
    if (!valid) {
      recordFailure("changePassword", key, req.ip);
      return res.status(400).json({ error: "Incorrect current password" });
    }
    recordSuccess("changePassword", key);

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashed }
    });

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Update Password Error:", err);
    res.status(500).json({ error: "Failed to update password" });
  }
};