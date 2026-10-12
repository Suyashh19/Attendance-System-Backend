/**
 * controllers/analyticsController.js
 */

const { generateAttendanceMatrix } = require("../services/analyticsService");
const prisma = require("../config/db");

exports.exportAttendance = async (req, res, next) => {
  try {
    const subjectId = Number(req.params.subjectId);
    const { startDate, endDate, sessionIds } = req.query;

    const subject = await prisma.subject.findFirst({
      where: { id: subjectId, facultyId: req.user.userId },
    });
    if (!subject) {
      return res.status(403).json({ error: "You do not have permission for this subject" });
    }

    // Parse sessionIds if they are sent as comma-separated string
    let parsedSessionIds = sessionIds;
    if (typeof sessionIds === "string") {
      parsedSessionIds = sessionIds.split(",").map(Number).filter(Number.isInteger);
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
