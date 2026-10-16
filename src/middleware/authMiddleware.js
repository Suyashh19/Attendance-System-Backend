const jwt = require("jsonwebtoken");
const { isAllowedToken } = require("./platformMiddleware");

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "No token provided" });
  }

  // Handle "Bearer <token>" format
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]

    : authHeader;

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }

  if (!isAllowedToken(decoded)) {
    return res.status(403).json({ error: "This account can only be used in the mobile app" });
  }

  req.user = decoded; // attach user info
  next();
};

module.exports = authMiddleware;
