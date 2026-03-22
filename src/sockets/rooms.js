/**
 * sockets/rooms.js
 * Helpers for Socket.IO room management (join/leave).
 */

/**
 * Join a student/faculty to a specific subject's room.
 *
 * @param {import("socket.io").Socket} socket
 * @param {number} subjectId
 */
function joinSubjectRoom(socket, subjectId) {
  const roomName = `subject_${subjectId}`;
  socket.join(roomName);
  console.log(`[Socket ${socket.id}] User ${socket.user?.userId} joined ${roomName}`);
}

/**
 * Leave a subject's room.
 *
 * @param {import("socket.io").Socket} socket
 * @param {number} subjectId
 */
function leaveSubjectRoom(socket, subjectId) {
  const roomName = `subject_${subjectId}`;
  socket.leave(roomName);
  console.log(`[Socket ${socket.id}] User ${socket.user?.userId} left ${roomName}`);
}

/**
 * Automatically join a user to their dedicated private room on connection.
 * This allows targeted notifications (e.g. attendance result).
 *
 * @param {import("socket.io").Socket} socket
 */
function joinUserPrivateRoom(socket) {
  if (socket.user && socket.user.userId) {
    const roomName = `user_${socket.user.userId}`;
    socket.join(roomName);
    console.log(`[Socket ${socket.id}] User joined private room ${roomName}`);
  }
}

module.exports = { joinSubjectRoom, leaveSubjectRoom, joinUserPrivateRoom };
