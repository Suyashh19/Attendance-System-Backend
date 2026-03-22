/**
 * notificationService.js
 * Socket.IO event emitters for real-time attendance notifications.
 * Requires the socket singleton (config/socket.js) to be initialized first.
 */

const { getIO } = require("../config/socket");

/**
 * Broadcast a new attendance session to all students in the subject room.
 * Students in the room receive: session details + shuffled options.
 *
 * @param {number} subjectId
 * @param {Object} sessionData - Serializable session object
 */
function broadcastSessionStarted(subjectId, sessionData) {
  const io = getIO();
  // Emit to everyone in the subject room EXCEPT the faculty who started it
  io.to(`subject_${subjectId}`).emit("session_started", {
    sessionId: sessionData.id,
    subjectId: sessionData.subjectId,
    subjectName: sessionData.subject?.name,
    subjectCode: sessionData.subject?.code,
    options: sessionData.fakeOptions, // shuffled — correctCode is NOT sent here
    startTime: sessionData.startTime,
    timeLimitSeconds: 15,
  });
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
function notifyStudent(studentId, result) {
  const io = getIO();
  io.to(`user_${studentId}`).emit("attendance_result", {
    status: result.status,
    reason: result.reason ?? null,
    sessionId: result.sessionId,
    message:
      result.status === "PRESENT"
        ? "✅ Attendance marked PRESENT"
        : `❌ Attendance marked ${result.status}: ${result.reason}`,
  });
}

module.exports = { broadcastSessionStarted, broadcastSessionEnded, notifyStudent };
