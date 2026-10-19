const express = require("express");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { loadConfig } = require("../config");
const { buildApexRouter } = require("../app");
const { createLogger } = require("../logging/logger");
const { createMockRag } = require("../modules/qa/ragGateway");
const { createExternalApi } = require("../modules/actions/externalApi");
const { createMemoryRepos } = require("./memoryRepos");
const { createServer } = require("../../../apex/mock-services/enterprise-api/server");

const MOCK_KEY = "test-mock-key";
const USERS = {
  user: { id: 1, username: "alice", role: "default" },
  user2: { id: 2, username: "bob", role: "default" },
  reviewer: { id: 3, username: "rita", role: "manager" },
  reviewer2: { id: 4, username: "ravi", role: "manager" },
  admin: { id: 5, username: "root", role: "admin" },
  weird: { id: 6, username: "x", role: "superuser" },
};

async function createTestApp({ envOverrides = {}, checkDb = async () => 1 } = {}) {
  const mock = createServer({ apiKey: MOCK_KEY, admin: true });
  await new Promise((r) => mock.server.listen(0, r));
  const mockPort = mock.server.address().port;
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "apex-up-"));
  const config = loadConfig({
    NODE_ENV: "test", APEX_ENABLE_FAULT_INJECTION: "true", APEX_UPLOAD_DIR: uploadDir,
    APEX_MAX_UPLOAD_BYTES: "4096", APEX_RAG_TIMEOUT_MS: "400",
    APEX_ENTERPRISE_API_URL: `http://127.0.0.1:${mockPort}`, APEX_ENTERPRISE_API_KEY: MOCK_KEY, APEX_ENTERPRISE_TIMEOUT_MS: "300",
    ...envOverrides,
  });
  const lines = [];
  const logger = createLogger({ write: (l) => lines.push(l) });
  const pending = [];
  const repos = createMemoryRepos();
  const { router } = buildApexRouter({
    repos, config, logger, checkDb,
    resolveUser: async (req) => USERS[req.header("x-test-user")] || null,
    gateway: createMockRag(),
    externalApi: createExternalApi(config.enterprise),
    schedule: (fn) => pending.push(fn()),
  });
  const app = express();
  app.use(express.json());
  app.use("/api/apex", router);
  return {
    app, repos, config, logs: lines, mock, mockPort, uploadDir,
    settle: async () => { await Promise.all(pending.splice(0)); },
    async close() { mock.server.closeAllConnections && mock.server.closeAllConnections(); await new Promise((r) => mock.server.close(r)); fs.rmSync(uploadDir, { recursive: true, force: true }); },
  };
}
const SOP = "Pump maintenance procedure. Before any pump repair, isolate power and apply lockout tagout. Schedule maintenance during the weekly window.\n\nSafety incident policy. Any safety incident must be escalated to the site manager within one hour. Record the incident in the register.";
module.exports = { createTestApp, USERS, SOP, MOCK_KEY };
