/**
 * controllers/analyticsController.js
 */

const { generateAttendanceMatrix } = require("../services/analyticsService");

exports.exportAttendance = async (req, res, next) => {
  try {
    const { subjectId } = req.params;
    const { startDate, endDate, sessionIds } = req.query;

    // Parse sessionIds if they are sent as comma-separated string
    let parsedSessionIds = sessionIds;
    if (typeof sessionIds === "string") {
      parsedSessionIds = sessionIds.split(",").map(Number);
    }

    const buffer = await generateAttendanceMatrix(subjectId, {
      startDate,
      endDate,
      sessionIds: parsedSessionIds,
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=attendance_subject_${subjectId}.xlsx`
    );

    res.send(buffer);
  } catch (err) {
    next(err);
  }
};
