/**
 * validationMiddleware.js
 * Request body validators using plain JS — no external validation library needed.
 * Each function is a middleware that validates req.body and calls next() or returns 400.
 */

const validate = (rules) => (req, res, next) => {
  const errors = [];
  for (const [field, checks] of Object.entries(rules)) {
    const value = req.body[field];
    if (checks.required && (value === undefined || value === null || value === "")) {
      errors.push(`'${field}' is required`);
      continue;
    }
    if (value !== undefined && checks.type && typeof value !== checks.type) {
      errors.push(`'${field}' must be of type ${checks.type}`);
    }
    if (value !== undefined && checks.minLength && String(value).length < checks.minLength) {
      errors.push(`'${field}' must be at least ${checks.minLength} characters`);
    }
  }
  if (errors.length > 0) {
    return res.status(400).json({ error: "Validation failed", details: errors });
  }
  next();
};

// ── Validators ────────────────────────────────────────────────────────────────

const validateRegister = validate({
  email:    { required: true, type: "string" },
  password: { required: true, type: "string", minLength: 6 },
  role:     { required: false, type: "string" },
  name:     { required: false, type: "string" },
  rollNo:   { required: false, type: "string" },
  deviceId: { required: false, type: "string" },
});

const validateCreateSubject = validate({
  name: { required: true, type: "string" },
  code: { required: true, type: "string" },
});

const validateEnrollment = validate({
  studentId: { required: true },
  subjectId: { required: true },
});

const validateStartSession = validate({
  subjectId: { required: true },
});

const validateSubmitAttendance = validate({
  sessionId:    { required: true },
  selectedCode: { required: true },
  deviceId:     { required: true, type: "string" },
});

module.exports = {
  validateRegister,
  validateCreateSubject,
  validateEnrollment,
  validateStartSession,
  validateSubmitAttendance,
};
