// Mock enterprise system (zero dependencies). Behaves like a real API that supports idempotency keys.
//   POST /v1/work-orders   (Bearer MOCK_API_KEY + Idempotency-Key required)
//   GET  /v1/work-orders   list what was ACTUALLY created (to prove exactly-once)
//   GET  /health
// Fault injection (only if MOCK_ENABLE_ADMIN=true):
//   POST /__admin/behavior {"mode":"timeout-after-accept"|"fail-503"|"reject-422"|"normal","count":1,"delayMs":10000}
//   GET  /__admin/stats    POST /__admin/reset
const http = require("http");
const crypto = require("crypto");

function createServer({ apiKey = process.env.MOCK_API_KEY, admin = process.env.MOCK_ENABLE_ADMIN === "true" } = {}) {
  const store = new Map(); // idempotencyKey -> { id, bodyHash, response }
  const stats = { received: 0, created: 0, replays: 0 };
  let behavior = { mode: "normal", remaining: 0, delayMs: 10000 };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const readJson = (req) => new Promise((resolve) => {
    let d = ""; req.on("data", (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve(null); } });
  });
  const takeBehavior = () => {
    if (behavior.mode === "normal" || behavior.remaining <= 0) return "normal";
    behavior.remaining -= 1;
    return behavior.mode;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { status: "ok" });

    if (url.pathname.startsWith("/__admin/")) {
      if (!admin) return send(res, 404, { message: "not found" });
      if (url.pathname === "/__admin/behavior" && req.method === "POST") {
        const b = await readJson(req);
        behavior = { mode: b.mode || "normal", remaining: Number(b.count ?? 1), delayMs: Number(b.delayMs ?? 10000) };
        return send(res, 200, { behavior });
      }
      if (url.pathname === "/__admin/stats") return send(res, 200, { ...stats, stored: store.size });
      if (url.pathname === "/__admin/reset" && req.method === "POST") {
        store.clear(); stats.received = stats.created = stats.replays = 0; behavior = { mode: "normal", remaining: 0, delayMs: 10000 };
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { message: "not found" });
    }

    if (url.pathname === "/v1/work-orders" && req.method === "GET") {
      if (req.headers.authorization !== `Bearer ${apiKey}`) return send(res, 401, { message: "unauthorized" });
      return send(res, 200, { items: [...store.values()].map((v) => v.response) });
    }

    if (url.pathname === "/v1/work-orders" && req.method === "POST") {
      if (!apiKey || req.headers.authorization !== `Bearer ${apiKey}`) return send(res, 401, { message: "unauthorized" });
      const key = req.headers["idempotency-key"];
      if (!key) return send(res, 400, { message: "Idempotency-Key header is required" });
      const body = await readJson(req);
      if (!body || !body.title) return send(res, 422, { message: "title is required" });
      stats.received += 1;

      const mode = takeBehavior();
      if (mode === "fail-503") return send(res, 503, { message: "temporarily unavailable" }); // NOT accepted
      if (mode === "reject-422") return send(res, 422, { message: "rejected by business rules" });

      const bodyHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
      const existing = store.get(key);
      let response; let replay = false;
      if (existing) {
        if (existing.bodyHash !== bodyHash) return send(res, 409, { message: "Idempotency-Key reused with a different payload" });
        response = existing.response; replay = true; stats.replays += 1;
      } else {
        response = { id: `WO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, ...body, createdAt: new Date().toISOString() };
        store.set(key, { id: response.id, bodyHash, response });
        stats.created += 1;
      }
      const headers = replay ? { "Idempotent-Replay": "true" } : {};
      if (mode === "timeout-after-accept") { // accepted + persisted, but the response is delayed past the client's timeout
        return setTimeout(() => { try { send(res, 201, response, headers); } catch {} }, behavior.delayMs);
      }
      return send(res, replay ? 200 : 201, response, headers);
    }
    return send(res, 404, { message: "not found" });
  });
  return { server, stats, store };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4010);
  if (!process.env.MOCK_API_KEY) { console.error("MOCK_API_KEY is required"); process.exit(1); }
  createServer().server.listen(port, () => console.log(JSON.stringify({ service: "enterprise-mock", event: "listening", port })));
}
module.exports = { createServer };
