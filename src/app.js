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

const app = express();

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

// Main App Routing
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);

// Attendance domain routing
app.use("/api/subjects", subjectRoutes);
app.use("/api/enrollments", enrollmentRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/analytics", analyticsRoutes);

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Global Error Handler
app.use(errorMiddleware);

module.exports = app;