const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const { validateRegister } = require("../middleware/validationMiddleware");
const { rejectWeb } = require("../middleware/platformMiddleware");

// On the web, register only accepts faculty (checked in the controller)
router.post("/register", validateRegister, authController.register);
router.post("/login", authController.login);

// OTP Flows
router.post("/send-signup-otp", authController.sendSignupOtp);
router.post("/verify-signup-otp", authController.verifySignupOtp);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);

// Used by the public /delete-account page; works for students and faculty alike
router.post("/delete-account/with-password", authController.deleteAccountWithPassword);

// Current user profile
const authMiddleware = require("../middleware/authMiddleware");
router.get("/me", authMiddleware, authController.getProfile);
router.post("/update-prn", authMiddleware, authController.updatePrn);
router.post("/push-token", authMiddleware, authController.savePushToken);
router.delete("/delete-account", authMiddleware, authController.deleteAccount);
router.post("/update-password", authMiddleware, authController.updatePassword);
// Change password with a code emailed to the account's own address
router.post("/update-password/request", authMiddleware, authController.requestPasswordChange);
router.post("/update-password/confirm", authMiddleware, authController.confirmPasswordChange);
router.post("/device-change/request", authMiddleware, rejectWeb, authController.requestDeviceChange);
router.post("/device-change/confirm", authMiddleware, rejectWeb, authController.confirmDeviceChange);

module.exports = router;
