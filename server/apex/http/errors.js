// One error shape for the whole API:
// { "error": { "code": "...", "message": "...", "traceId": "...", "details": ... } }
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const E = {
  badRequest: (m, d) => new AppError(400, "VALIDATION_ERROR", m, d),
  unauthenticated: (m = "Authentication required") => new AppError(401, "UNAUTHENTICATED", m),
  forbidden: (m = "You are not allowed to perform this action") => new AppError(403, "FORBIDDEN", m),
  notFound: (m = "Not found") => new AppError(404, "NOT_FOUND", m),
  conflict: (m, d) => new AppError(409, "CONFLICT", m, d),
  tooLarge: (m) => new AppError(413, "PAYLOAD_TOO_LARGE", m),
  unsupported: (m) => new AppError(415, "UNSUPPORTED_MEDIA_TYPE", m),
  unavailable: (m, code = "SERVICE_UNAVAILABLE") => new AppError(503, code, m),
};

function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    const traceId = req.traceId;
    if (err instanceof AppError) {
      return res.status(err.status).json({
        error: { code: err.code, message: err.message, traceId, details: err.details },
      });
    }
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: { code: "PAYLOAD_TOO_LARGE", message: "File exceeds the size limit", traceId },
      });
    }
    // Unknown: log full detail server-side, return nothing sensitive.
    logger.error("unhandled_error", { traceId, message: err && err.message, stack: err && err.stack });
    return res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error", traceId },
    });
  };
}

module.exports = { AppError, E, errorHandler };
