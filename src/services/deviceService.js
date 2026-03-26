/**
 * deviceService.js
 * Validates that the device submitting attendance matches the registered
 * device for that student.
 */

const prisma = require("../config/db");

/**
 * Register or update the device ID for a user.
 * First call registers; subsequent calls from the SAME device are allowed.
 * A new, different device is rejected after the first registration.
 * @param {number} userId
 * @param {string} incomingDeviceId
 * @param {Object} [preFetchedUser] - Optional pre-fetched user object to save a DB call
 * @returns {{ valid: boolean, reason?: string }}
 */
async function validateDevice(userId, incomingDeviceId, preFetchedUser = null) {
  if (!incomingDeviceId || typeof incomingDeviceId !== "string") {
    return { valid: false, reason: "Missing or invalid device_id" };
  }

  const user = preFetchedUser || (await prisma.user.findUnique({ where: { id: userId } }));
  if (!user) return { valid: false, reason: "User not found" };

  // First-time registration: bind device to user
  if (!user.deviceId) {
    // Ensure no TWO users register with the same exact physical deviceId (prevent device sharing cheating)
    const deviceInUse = await prisma.user.findFirst({
      where: { deviceId: incomingDeviceId, id: { not: userId } }
    });
    
    if (deviceInUse) {
      return { valid: false, reason: "Device already registered to another user!" };
    }

    await prisma.user.update({
      where: { id: userId },
      data: { deviceId: incomingDeviceId },
    });
    return { valid: true };
  }

  // Subsequent requests: must match registered device
  if (user.deviceId !== incomingDeviceId) {
    return {
      valid: false,
      reason: `Device mismatch. Expected registered device.`,
    };
  }

  return { valid: true };
}

/**
 * Retrieve the registered deviceId for a user (used for audit/admin).
 * @param {number} userId
 * @returns {string|null}
 */
async function getRegisteredDevice(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deviceId: true },
  });
  return user?.deviceId ?? null;
}

module.exports = { validateDevice, getRegisteredDevice };
