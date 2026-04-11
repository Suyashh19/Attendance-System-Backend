const express = require("express");
const cors = require("cors");

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

// Enable CORS with wildcard for development/initial deployment
// In strict production, this should be replaced with `origin: process.env.FRONTEND_URL`
app.use(cors({
  origin: "*"
}));
app.use(express.json());

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