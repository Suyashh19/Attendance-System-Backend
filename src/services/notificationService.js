/**
 * notificationService.js
 * Socket.IO event emitters for real-time attendance notifications.
 * Requires the socket singleton (config/socket.js) to be initialized first.
 */

const { getIO } = require("../config/socket");
const { Expo } = require("expo-server-sdk");

// Create a new Expo SDK client
const expo = new Expo();

/**
 * Send push notifications via Expo API.
 */
async function sendPushNotifications(tokens, title, body, data = {}) {
  const messages = [];
  for (let pushToken of tokens) {
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`Push token ${pushToken} is not a valid Expo push token`);
      continue;
    }
    messages.push({
      to: pushToken,
      sound: "default",
      title,
      body,
      data,
    });
  }

  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];
  for (let chunk of chunks) {
    try {
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error("Error sending push notifications:", error);
    }
  }
  return tickets;
}

/**
 * Broadcast a new attendance session to all students in the subject room.
 * Students in the room receive: session details + shuffled options.
 * Also sends push notifications to students.
 *
 * @param {number} subjectId
 * @param {Object} sessionData - Serializable session object
 * @param {string[]} pushTokens - Array of Expo push tokens for students
 */
async function broadcastSessionStarted(subjectId, sessionData, pushTokens = []) {
  const io = getIO();
  // Socket.IO emission
  // Emit to everyone in the subject room EXCEPT the faculty who started it
  io.to(`subject_${subjectId}`).emit("session_started", {
    sessionId: sessionData.id,
    subjectId: sessionData.subjectId,
    subjectName: sessionData.subject?.name,
    subjectCode: sessionData.subject?.code,
    options: sessionData.fakeOptions, // shuffled — correctCode is NOT sent here
    startTime: sessionData.startTime,
    windowSeconds: 15, // Fix for frontend NaN issue
    timeLimitSeconds: 15,
    serverTime: new Date().toISOString(),
  });

  // Push Notifications
  if (pushTokens.length > 0) {
    console.log(`[DEBUG] Sending push notifications to ${pushTokens.length} students...`);
    await sendPushNotifications(
      pushTokens,
      `Attendance Started: ${sessionData.subject?.name || "New Session"}`,
      "Open the app now to mark your attendance!",
      { subjectId, sessionId: sessionData.id }
    );
  }
}

/**
 * Broadcast session end to all students in the subject room.
 * @param {number} subjectId
 * @param {number} sessionId
 */
function broadcastSessionEnded(subjectId, sessionId) {
  const io = getIO();
  io.to(`subject_${subjectId}`).emit("session_ended", {
    sessionId,
    subjectId,
    message: "Attendance session has ended",
  });
}

/**
 * Send an individual attendance result directly to the student's socket.
 * Uses the student's socket room (user-specific room: `user_<userId>`).
 *
 * @param {number} studentId
 * @param {Object} result - { status, reason?, sessionId }
 */
/**
 * Send an individual attendance result directly to the student's socket.
 * Also optionally sends a push notification if pushToken is provided.
 *
 * @param {number} studentId
 * @param {Object} result - { status, reason?, sessionId, subjectName?, pushToken? }
 */
async function notifyStudent(studentId, result) {
  const io = getIO();
  
  // 1. Socket.IO emission
  io.to(`user_${studentId}`).emit("attendance_result", {
    status: result.status,
    reason: result.reason ?? null,
    sessionId: result.sessionId,
    message:
      result.status === "PRESENT"
        ? "✅ Attendance marked PRESENT"
        : `❌ Attendance marked ${result.status}: ${result.reason || "Did not submit"}`,
  });

  // 2. Push Notification (Individual)
  if (result.pushToken) {
    await sendPushNotifications(
      [result.pushToken],
      `Attendance: ${result.subjectName || "Report"}`,
      `Your attendance is marked as ${result.status}.`,
      { sessionId: result.sessionId, status: result.status }
    );
  }
}

/**
 * Send multiple personalized push notifications in chunks.
 * @param {Array<{to: string, title: string, body: string, data: Object}>} messages 
 */
async function sendManyPushNotifications(messages) {
  const chunks = expo.chunkPushNotifications(messages);
  for (let chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (error) {
      console.error("Error sending chunked push notifications:", error);
    }
  }
}

module.exports = { 
  broadcastSessionStarted, 
  broadcastSessionEnded, 
  notifyStudent,
  sendManyPushNotifications 
};
