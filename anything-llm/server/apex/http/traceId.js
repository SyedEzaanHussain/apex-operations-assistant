const { randomUUID } = require("crypto");
const SAFE = /^[A-Za-z0-9._-]{8,64}$/;

// Correlation id: accept a well-formed inbound one, otherwise mint one.
// Echoed in the X-Request-Id header, every error body, logs and audit rows.
function traceId() {
  return (req, res, next) => {
    const inbound = req.header("x-request-id");
    req.traceId = inbound && SAFE.test(inbound) ? inbound : randomUUID();
    res.setHeader("X-Request-Id", req.traceId);
    next();
  };
}

function requestLogger(logger) {
  return (req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info("http_request", {
        traceId: req.traceId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
        userId: req.user ? req.user.id : null,
      });
    });
    next();
  };
}

module.exports = { traceId, requestLogger };
