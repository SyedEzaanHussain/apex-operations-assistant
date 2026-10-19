// Production wiring: plugs the Apex module into AnythingLLM's existing Express app.
// This is the ONLY file that touches upstream internals (Prisma client, JWT/session, User model).
const { loadConfig } = require("./config");
const { createLogger } = require("./logging/logger");
const { buildApexRouter } = require("./app");
const { createPrismaRepos } = require("./modules/prismaRepos");
const { createRagGateway } = require("./modules/qa/ragGateway");
const { createExternalApi } = require("./modules/actions/externalApi");
const { E } = require("./http/errors");

function apexEndpoints(apiRouter) {
  const prisma = require("../utils/prisma");
  const { SystemSettings } = require("../models/systemSettings");
  const { User } = require("../models/user");
  const { decodeJWT } = require("../utils/http");

  const config = loadConfig();
  const logger = createLogger();
  if (!config.enterprise.apiKey) logger.warn("config_missing", { variable: "APEX_ENTERPRISE_API_KEY" });

  // Same JWT session as the rest of AnythingLLM, but FAIL CLOSED and with Apex's error format.
  // Single-user mode has no per-user identity, so Apex refuses to run in it.
  const resolveUser = async (req) => {
    if (!(await SystemSettings.isMultiUserMode()))
      throw E.unavailable("Apex requires AnythingLLM multi-user mode to be enabled", "MULTI_USER_MODE_REQUIRED");
    const auth = req.header("Authorization");
    const token = auth ? auth.split(" ")[1] : null;
    if (!token) return null;
    const valid = decodeJWT(token);
    if (!valid || !valid.id) return null;
    const user = await User.get({ id: valid.id });
    if (!user || user.suspended) return null;
    return user;
  };

  const { router } = buildApexRouter({
    repos: createPrismaRepos(prisma),
    resolveUser,
    config,
    logger,
    gateway: createRagGateway(config),
    externalApi: createExternalApi(config.enterprise),
    checkDb: () => prisma.$queryRaw`SELECT 1`,
  });
  apiRouter.use("/apex", router);
  logger.info("apex_mounted", { ragProvider: config.ragProvider, faultInjection: config.faultInjection });
}

module.exports = { apexEndpoints };
