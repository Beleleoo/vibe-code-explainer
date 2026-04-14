/**
 * Authentication middleware — validates JWT tokens on every protected route.
 * ⚠️  Security-critical: changes here affect ALL authenticated endpoints.
 */
const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET;

function requireAuth(req, res, next) {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
