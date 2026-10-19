// Composition root with NO dependency on the rest of AnythingLLM: everything is injected.
// (index.js does the production wiring; tests inject in-memory fakes.)
const express = require("express");
const { createLogger } = require("./logging/logger");
const { traceId, requestLogger } = require("./http/traceId");
const { errorHandler, E } = require("./http/errors");
const { createAuth } = require("./http/auth");
const { createAuditService } = require("./modules/audit/auditService");
const { createDocumentService } = require("./modules/documentFlow/documentService");
const { createQaService } = require("./modules/qa/qaService");
const { createActionService } = require("./modules/actions/actionService");
const { documentsRoutes } = require("./routes/documents.routes");
const { qaRoutes } = require("./routes/qa.routes");
const { actionsRoutes } = require("./routes/actions.routes");
const { healthRoutes } = require("./routes/health.routes");

function buildApexRouter({ repos, resolveUser, config, gateway, externalApi, checkDb, logger = createLogger(), schedule, newKey }) {
  const audit = createAuditService({ repo: repos.audit, logger });
  const documentService = createDocumentService({ repo: repos.documents, audit, config, logger, schedule });
  const actionService = createActionService({ repo: repos.actions, qaRepo: repos.qa, externalApi, audit, logger, newKey });
  const qaService = createQaService({ repo: repos.qa, documentsRepo: repos.documents, gateway, actionService, audit, config, logger });
  const { authenticate, requireRole } = createAuth(resolveUser);

  const router = express.Router();
  router.use(traceId());
  router.use(healthRoutes({ checkDb, config, externalApi })); // public: no auth
  router.use(authenticate);                                   // everything below requires a valid session
  router.use(requestLogger(logger));
  router.get("/me", (req, res) => res.json({ user: req.user, traceId: req.traceId }));
  router.use(documentsRoutes({ documentService, config }));
  router.use(qaRoutes({ qaService }));
  router.use(actionsRoutes({ actionService, qaService, requireRole }));
  router.use((req, _res, next) => next(E.notFound("Route not found")));
  router.use(errorHandler(logger));
  return { router, services: { documentService, qaService, actionService, audit } };
}
module.exports = { buildApexRouter };
