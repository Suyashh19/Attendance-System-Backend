const path = require("path");
const express = require("express");
const cors = require("cors");
const { corsOrigin } = require("./config/cors");

const { errorMiddleware } = require("./middleware/errorMiddleware");

// Routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const subjectRoutes = require("./routes/subjectRoutes");
const enrollmentRoutes = require("./routes/enrollmentRoutes");
const sessionRoutes = require("./routes/sessionRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const leaveRoutes = require("./routes/leaveRoutes");

const app = express();

// Render puts one proxy in front of the server. Without this every request would appear to come
// from the proxy's address, and the per-caller attempt limits would count everyone together.
app.set("trust proxy", 1);

// Only the web app's origin (FRONTEND_URL) may call the API from a browser.
// Content-Disposition is exposed so the web app can read report file names.
app.use(cors({
  origin: corsOrigin,
  exposedHeaders: ["Content-Disposition"],
}));
app.use(express.json());

// Health check for uptime pingers and the app's launch warm-up.
// ?db=1 also wakes the database (Neon suspends it when idle).
app.get("/health", async (req, res) => {
  if (req.query.db !== "1") return res.json({ ok: true });
  try {
    const prisma = require("./config/db");
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true });
  } catch (err) {
    console.error("[Health] Database check failed:", err.message);
    res.status(503).json({ ok: false, db: false });
  }
});

// Public pages linked from the Google Play listing
const PAGES = path.join(__dirname, "pages");
// App version check for automatic in-app update prompts
app.get("/api/app-version", (req, res) => {
  const latestVersion = process.env.APP_LATEST_VERSION || "1.2.6";
  const latestVersionCode = parseInt(process.env.APP_LATEST_VERSION_CODE || "13", 10);
  const minSupportedVersion = process.env.APP_MIN_SUPPORTED_VERSION || "1.2.0";
  const minSupportedVersionCode = parseInt(process.env.APP_MIN_SUPPORTED_VERSION_CODE || "10", 10);
  const forceUpdate = process.env.APP_FORCE_UPDATE === "true";

  let releaseNotes = [
    "Uno Academic Assistant guided onboarding",
    "Share & Refer to fellow faculty and professors",
    "Refined dashboard design and performance improvements"
  ];
  if (process.env.APP_RELEASE_NOTES) {
    try {
      const parsed = JSON.parse(process.env.APP_RELEASE_NOTES);
      if (Array.isArray(parsed)) releaseNotes = parsed;
    } catch (_) {}
  }

  res.json({
    latestVersion,
    latestVersionCode,
    minSupportedVersion,
    minSupportedVersionCode,
    forceUpdate,
    storeUrl: process.env.APP_STORE_URL || "https://play.google.com/store/apps/details?id=com.suyashpatil.attendance",
    title: process.env.APP_UPDATE_TITLE || (forceUpdate ? "Update Required" : "New Update Available"),
    message: process.env.APP_UPDATE_MESSAGE || (forceUpdate 
      ? "An important update is required to continue using the Attendance System app. Please update now from Google Play."
      : "A new version of Attendance System is available on Google Play with new features and improvements."),
    releaseNotes
  });
});

app.get("/privacy", (req, res) => res.sendFile(path.join(PAGES, "privacy.html")));
app.get("/delete-account", (req, res) => res.sendFile(path.join(PAGES, "delete-account.html")));

// Main App Routing
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);

// Attendance domain routing
app.use("/api/subjects", subjectRoutes);
app.use("/api/enrollments", enrollmentRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/leaves", leaveRoutes);

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Global Error Handler
app.use(errorMiddleware);

module.exports = app;