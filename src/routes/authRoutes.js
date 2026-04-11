const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");

router.post("/register", authController.register);
router.post("/login", authController.login);

// OTP Flows
router.post("/send-signup-otp", authController.sendSignupOtp);
router.post("/verify-signup-otp", authController.verifySignupOtp);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);

// Current user profile
const authMiddleware = require("../middleware/authMiddleware");
router.get("/me", authMiddleware, authController.getProfile);
router.post("/update-prn", authMiddleware, authController.updatePrn);
router.post("/push-token", authMiddleware, authController.savePushToken);
router.delete("/delete-account", authMiddleware, authController.deleteAccount);
router.post("/update-password", authMiddleware, authController.updatePassword);

module.exports = router;