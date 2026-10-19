const { E } = require("./errors");

// Apex roles are a thin mapping over AnythingLLM's multi-user roles:
//   default -> user, manager -> reviewer, admin -> admin
const ROLE_MAP = { default: "user", manager: "reviewer", admin: "admin" };
const toApexRole = (upstreamRole) => ROLE_MAP[upstreamRole] || null;

/**
 * Builds auth middleware around an injected `resolveUser(req, res)`.
 * In production resolveUser = AnythingLLM's validatedRequest session (JWT);
 * in tests it is a fake. Everything fails CLOSED: no user => 401, unknown role => 403.
 */
function createAuth(resolveUser) {
  const authenticate = async (req, res, next) => {
    try {
      const u = await resolveUser(req, res);
      if (!u) throw E.unauthenticated();
      const role = toApexRole(u.role);
      if (!role) throw E.forbidden("Unrecognised role");
      req.user = { id: u.id, username: u.username, role };
      next();
    } catch (e) {
      next(e);
    }
  };
  const requireRole = (...roles) => (req, _res, next) =>
    req.user && roles.includes(req.user.role) ? next() : next(E.forbidden());
  return { authenticate, requireRole };
}

const isPrivileged = (user) => user.role === "reviewer" || user.role === "admin";

module.exports = { createAuth, toApexRole, isPrivileged };
