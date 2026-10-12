/**
 * sockets/attendanceSocket.js
 * Socket event listeners related to attendance flows.
 */

const { joinSubjectRoom, leaveSubjectRoom } = require("./rooms");

/**
 * Register attendance socket events.
 *
 * @param {import("socket.io").Server} io
 * @param {import("socket.io").Socket} socket
 */
function registerAttendanceHandlers(io, socket) {
  // Client requests to join a subject room (e.g. when opening a subject's page)
  socket.on("join_subject", (payload) => {
    const subjectId = Number(payload?.subjectId);
    if (Number.isInteger(subjectId) && subjectId > 0) joinSubjectRoom(socket, subjectId);
  });

  // Client requests to leave a subject room
  socket.on("leave_subject", (payload) => {
    const subjectId = Number(payload?.subjectId);
    if (Number.isInteger(subjectId) && subjectId > 0) leaveSubjectRoom(socket, subjectId);
  });
}

module.exports = { registerAttendanceHandlers };
