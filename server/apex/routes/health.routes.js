const express = require("express");
const fsp = require("fs/promises");
const { wrap } = require("./documents.routes");

// /health = liveness (process is up). /ready = can serve traffic (DB + storage).
// The enterprise API is reported but does NOT gate readiness: when it is down, approvals degrade to UNKNOWN/retry.
function healthRoutes({ checkDb, config, externalApi }) {
  const r = express.Router();
  r.get("/health", (req, res) => res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()), traceId: req.traceId }));
  r.get("/ready", wrap(async (req, res) => {
    const checks = {};
    try { await checkDb(); checks.database = "up"; } catch { checks.database = "down"; }
    try { await fsp.mkdir(config.uploadDir, { recursive: true }); await fsp.access(config.uploadDir); checks.storage = "up"; } catch { checks.storage = "down"; }
    const enterpriseApi = (await externalApi.ping()) ? "up" : "down";
    const ready = Object.values(checks).every((v) => v === "up");
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", checks, dependencies: { enterpriseApi }, traceId: req.traceId });
  }));
  return r;
}
module.exports = { healthRoutes };
