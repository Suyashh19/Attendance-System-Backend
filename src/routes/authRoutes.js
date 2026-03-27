const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");

router.post("/register", authController.register);
router.post("/login", authController.login);

// Current user profile
const authMiddleware = require("../middleware/authMiddleware");
router.get("/me", authMiddleware, authController.getProfile);
router.post("/update-prn", authMiddleware, authController.updatePrn);
router.post("/push-token", authMiddleware, authController.savePushToken);
router.delete("/delete-account", authMiddleware, authController.deleteAccount);

module.exports = router;