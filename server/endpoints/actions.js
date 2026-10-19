const prisma = require("../utils/prisma");
const { Workspace } = require("../models/workspace");
const { userFromSession } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { executeAction } = require("../utils/externalApi");
const { ROLES } = require("../utils/middleware/multiUserProtected");

const REVIEWER_ROLES = [ROLES.manager, ROLES.admin];
const ACTION_PAYLOAD_LIMIT = 64 * 1024;

function authenticatedUser(request, response) {
  return response.locals?.user || userFromSession(request, response);
}

async function requireUser(request, response, next) {
  const user = await authenticatedUser(request, response);
  if (!response.locals?.multiUserMode || !user) {
    response.status(401).json({ error: "Multi-user authentication is required." });
    return;
  }
  if (user.suspended) {
    response.status(401).json({ error: "User is suspended from system." });
    return;
  }
  response.locals.user = user;
  next();
}

function requireReviewer(request, response, next) {
  if (!REVIEWER_ROLES.includes(response.locals.user?.role)) {
    response.status(403).json({ error: "Reviewer or administrator role required." });
    return;
  }
  next();
}

async function actionVisibleToUser(action, user) {
  const workspace = await Workspace.getWithUser(user, { id: action.workspaceId });
  return !!workspace;
}

async function logTransition(
  transaction,
  action,
  actorId,
  traceId,
  event,
  before,
  after
) {
  await transaction.audit_events.create({
    data: {
      entity: "proposed_action",
      entityId: String(action.id),
      actorId,
      action: event,
      before: JSON.stringify(before),
      after: JSON.stringify(after),
      traceId,
    },
  });
}

function actionsEndpoints(app) {
  if (!app) return;

  app.post(
    "/actions",
    [validatedRequest, requireUser],
    async (request, response) => {
      const user = response.locals.user;
      const { workspaceId, chatId = null, payload } = request.body || {};
      const idempotencyKey = request.header("Idempotency-Key");
      const parsedWorkspaceId = Number(workspaceId);
      let serializedPayload;

      try {
        if (!Number.isSafeInteger(parsedWorkspaceId) || parsedWorkspaceId < 1) {
          return response.status(400).json({ error: "A valid workspaceId is required." });
        }
        if (
          chatId !== null &&
          (!Number.isSafeInteger(Number(chatId)) || Number(chatId) < 1)
        ) {
          return response.status(400).json({ error: "chatId must be a positive integer." });
        }
        if (
          typeof idempotencyKey !== "string" ||
          idempotencyKey.length < 1 ||
          idempotencyKey.length > 200
        ) {
          return response.status(400).json({
            error: "A 1-200 character Idempotency-Key header is required.",
          });
        }
        if (
          !payload ||
          typeof payload !== "object" ||
          Array.isArray(payload)
        ) {
          return response.status(400).json({ error: "payload must be a JSON object." });
        }

        serializedPayload = JSON.stringify(payload);
        if (Buffer.byteLength(serializedPayload, "utf8") > ACTION_PAYLOAD_LIMIT) {
          return response.status(413).json({ error: "payload exceeds 64 KB." });
        }

        const workspace = await Workspace.getWithUser(user, {
          id: parsedWorkspaceId,
        });
        if (!workspace) {
          return response.status(404).json({ error: "Workspace does not exist." });
        }
        if (chatId !== null) {
          const chat = await prisma.workspace_chats.findFirst({
            where: {
              id: Number(chatId),
              workspaceId: parsedWorkspaceId,
              user_id: user.id,
            },
            select: { id: true },
          });
          if (!chat) {
            return response.status(404).json({ error: "Chat does not exist." });
          }
        }

        const existing = await prisma.proposed_actions.findUnique({
          where: { idempotencyKey },
        });
        if (existing) {
          if (
            existing.createdBy === user.id &&
            existing.workspaceId === parsedWorkspaceId &&
            existing.payload === serializedPayload
          ) {
            return response.status(200).json({ action: existing });
          }
          return response.status(409).json({
            error: "Idempotency-Key has already been used.",
          });
        }

        const action = await prisma.$transaction(async (transaction) => {
          const created = await transaction.proposed_actions.create({
            data: {
              workspaceId: parsedWorkspaceId,
              chatId: chatId === null ? null : Number(chatId),
              createdBy: user.id,
              payload: serializedPayload,
              idempotencyKey,
            },
          });
          await logTransition(
            transaction,
            created,
            user.id,
            request.traceId,
            "action_proposed",
            null,
            { status: "proposed" }
          );
          return created;
        });
        return response.status(201).json({ action });
      } catch (error) {
        if (error.code === "P2002") {
          const existing = await prisma.proposed_actions.findUnique({
            where: { idempotencyKey },
          });
          if (
            existing &&
            existing.createdBy === user.id &&
            existing.workspaceId === parsedWorkspaceId &&
            existing.payload === serializedPayload
          ) {
            return response.status(200).json({ action: existing });
          }
          return response.status(409).json({
            error: "Idempotency-Key has already been used.",
          });
        }
        console.error(
          JSON.stringify({
            level: "error",
            event: "action_proposal_failed",
            traceId: request.traceId,
            error: error.message,
          })
        );
        return response.status(500).json({ error: "Failed to create proposed action." });
      }
    }
  );

  app.get(
    "/actions",
    [validatedRequest, requireUser],
    async (request, response) => {
      try {
        const user = response.locals.user;
        const where = REVIEWER_ROLES.includes(user.role)
          ? {}
          : {
              createdBy: user.id,
              workspace: {
                workspace_users: { some: { user_id: user.id } },
              },
            };
        const actions = await prisma.proposed_actions.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 100,
        });
        return response.status(200).json({ actions });
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "action_list_failed",
            traceId: request.traceId,
            error: error.message,
          })
        );
        return response.status(500).json({ error: "Failed to load actions." });
      }
    }
  );

  app.get(
    "/actions/:id",
    [validatedRequest, requireUser],
    async (request, response) => {
      const actionId = Number(request.params.id);
      if (!Number.isSafeInteger(actionId) || actionId < 1) {
        return response.status(400).json({ error: "Invalid action ID." });
      }
      const action = await prisma.proposed_actions.findUnique({
        where: { id: actionId },
      });
      if (!action || !(await actionVisibleToUser(action, response.locals.user))) {
        return response.status(404).json({ error: "Action does not exist." });
      }
      if (
        action.createdBy !== response.locals.user.id &&
        !REVIEWER_ROLES.includes(response.locals.user.role)
      ) {
        return response.status(403).json({ error: "Action access denied." });
      }
      const audit = await prisma.audit_events.findMany({
        where: { entity: "proposed_action", entityId: String(action.id) },
        orderBy: { createdAt: "asc" },
      });
      return response.status(200).json({ action, audit });
    }
  );

  app.post(
    "/actions/:id/approve",
    [validatedRequest, requireUser, requireReviewer],
    async (request, response) => {
      try {
        const actionId = Number(request.params.id);
        if (!Number.isSafeInteger(actionId) || actionId < 1) {
          return response.status(400).json({ error: "Invalid action ID." });
        }
        const user = response.locals.user;
        const action = await prisma.proposed_actions.findUnique({
          where: { id: actionId },
        });
        if (!action || !(await actionVisibleToUser(action, user))) {
          return response.status(404).json({ error: "Action does not exist." });
        }
        if (action.createdBy === user.id) {
          return response.status(403).json({ error: "Users cannot approve their own actions." });
        }

        const approved = await prisma.$transaction(async (transaction) => {
          const result = await transaction.proposed_actions.updateMany({
            where: { id: actionId, status: "proposed" },
            data: {
              status: "approved",
              reviewedBy: user.id,
              reviewedAt: new Date(),
            },
          });
          if (result.count !== 1) return false;
          await logTransition(
            transaction,
            action,
            user.id,
            request.traceId,
            "action_approved",
            { status: "proposed" },
            { status: "approved" }
          );
          return true;
        });
        if (!approved) {
          return response.status(409).json({
            error: "Only proposed actions can be approved.",
          });
        }

        const result = await executeAction(
          { ...action, status: "approved" },
          user.id,
          request.traceId
        );
        return response.status(result.action?.status === "executed" ? 200 : 502).json({
          action: result.action,
          message:
            result.action?.status === "unknown"
              ? "External API outcome is unknown. Retry this action using the same action ID."
              : undefined,
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "action_approval_failed",
            traceId: request.traceId,
            error: error.message,
          })
        );
        return response.status(500).json({ error: "Failed to approve action." });
      }
    }
  );

  app.post(
    "/actions/:id/reject",
    [validatedRequest, requireUser, requireReviewer],
    async (request, response) => {
      try {
        const actionId = Number(request.params.id);
        const reason = request.body?.reason;
        if (!Number.isSafeInteger(actionId) || actionId < 1) {
          return response.status(400).json({ error: "Invalid action ID." });
        }
        if (reason !== undefined && (typeof reason !== "string" || reason.length > 1000)) {
          return response.status(400).json({ error: "reason must be a string up to 1000 characters." });
        }
        const user = response.locals.user;
        const action = await prisma.proposed_actions.findUnique({
          where: { id: actionId },
        });
        if (!action || !(await actionVisibleToUser(action, user))) {
          return response.status(404).json({ error: "Action does not exist." });
        }
        if (action.createdBy === user.id) {
          return response.status(403).json({ error: "Users cannot reject their own actions." });
        }

        const rejected = await prisma.$transaction(async (transaction) => {
          const result = await transaction.proposed_actions.updateMany({
            where: { id: actionId, status: "proposed" },
            data: {
              status: "rejected",
              reviewedBy: user.id,
              reviewedAt: new Date(),
            },
          });
          if (result.count !== 1) return false;
          await logTransition(
            transaction,
            action,
            user.id,
            request.traceId,
            "action_rejected",
            { status: "proposed" },
            { status: "rejected", reason: reason || null }
          );
          return true;
        });
        if (!rejected) {
          return response.status(409).json({
            error: "Only proposed actions can be rejected.",
          });
        }
        const rejectedAction = await prisma.proposed_actions.findUnique({
          where: { id: actionId },
        });
        return response.status(200).json({ action: rejectedAction });
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "action_rejection_failed",
            traceId: request.traceId,
            error: error.message,
          })
        );
        return response.status(500).json({ error: "Failed to reject action." });
      }
    }
  );

  app.post(
    "/actions/:id/retry",
    [validatedRequest, requireUser, requireReviewer],
    async (request, response) => {
      try {
        const actionId = Number(request.params.id);
        if (!Number.isSafeInteger(actionId) || actionId < 1) {
          return response.status(400).json({ error: "Invalid action ID." });
        }
        const user = response.locals.user;
        const action = await prisma.proposed_actions.findUnique({
          where: { id: actionId },
        });
        if (!action || !(await actionVisibleToUser(action, user))) {
          return response.status(404).json({ error: "Action does not exist." });
        }
        if (action.status !== "unknown" && action.status !== "approved") {
          return response.status(409).json({
            error: "Only approved or unknown actions can be retried.",
          });
        }
        const result = await executeAction(action, user.id, request.traceId);
        if (!result.claimed) {
          return response.status(409).json({
            action: result.action,
            error: "Action is already being processed or is no longer retryable.",
          });
        }
        return response.status(result.action?.status === "executed" ? 200 : 502).json({
          action: result.action,
          message:
            result.action?.status === "unknown"
              ? "External API outcome is unknown. Retry this action using the same action ID."
              : undefined,
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "action_retry_failed",
            traceId: request.traceId,
            error: error.message,
          })
        );
        return response.status(500).json({ error: "Failed to retry action." });
      }
    }
  );
}

module.exports = { actionsEndpoints };
