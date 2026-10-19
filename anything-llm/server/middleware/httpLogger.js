const httpLogger =
  ({ enableTimestamps = false }) =>
  (req, res, next) => {
    // Capture the original res.end to log response status
    const originalEnd = res.end;

    res.end = function (chunk, encoding) {
      console.log(
        JSON.stringify({
          level: res.statusCode >= 400 ? "warn" : "info",
          event: "http_request",
          statusCode: res.statusCode,
          method: req.method,
          path: req.path,
          traceId: req.traceId || null,
          ...(enableTimestamps ? { timestamp: new Date().toISOString() } : {}),
        })
      );

      // Call the original end method
      return originalEnd.call(this, chunk, encoding);
    };

    next();
  };

module.exports = {
  httpLogger,
};
