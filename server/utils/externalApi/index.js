const prisma = require("../prisma");

const EXECUTION_TIMEOUT_MS = 10_000;

function externalApiUrl() {
  const value = process.env.EXTERNAL_API_URL;
  if (!value) return null;

  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("EXTERNAL_API_URL must use HTTP or HTTPS.");
  }
  return url;
}

async function writeStatus(action, status, actorId, traceId, extra = {}) {
  await prisma.$transaction(async (transaction) => {
    const result = await transaction.proposed_actions.updateMany({
      where: { id: action.id, status: "executing" },
      data: { status, ...extra },
    });
    if (result.count !== 1) return;

    await transaction.audit_events.create({
      data: {
        entity: "proposed_action",
        entityId: String(action.id),
        actorId,
        action: `action_${status}`,
        before: JSON.stringify({ status: "executing" }),
        after: JSON.stringify({ status, ...extra }),
        traceId,
      },
    });
  });

  return prisma.proposed_actions.findUnique({ where: { id: action.id } });
}

async function executeAction(action, actorId, traceId) {
  const claimed = await prisma.$transaction(async (transaction) => {
    const result = await transaction.proposed_actions.updateMany({
      where: {
        id: action.id,
        status: { in: ["approved", "unknown"] },
      },
      data: {
        status: "executing",
        attempts: { increment: 1 },
      },
    });
    if (result.count !== 1) return false;

    await transaction.audit_events.create({
      data: {
        entity: "proposed_action",
        entityId: String(action.id),
        actorId,
        action: "action_executing",
        before: JSON.stringify({ status: action.status }),
        after: JSON.stringify({ status: "executing" }),
        traceId,
      },
    });
    return true;
  });

  if (!claimed) {
    return {
      action: await prisma.proposed_actions.findUnique({
        where: { id: action.id },
      }),
      claimed: false,
    };
  }

  const executingAction = await prisma.proposed_actions.findUnique({
    where: { id: action.id },
  });

  let target;
  try {
    target = externalApiUrl();
  } catch (error) {
    return {
      action: await writeStatus(
        executingAction,
        "failed",
        actorId,
        traceId,
        { failureReason: error.message }
      ),
      claimed: true,
    };
  }

  if (!target) {
    return {
      action: await writeStatus(
        executingAction,
        "failed",
        actorId,
        traceId,
        { failureReason: "EXTERNAL_API_URL is not configured." }
      ),
      claimed: true,
    };
  }
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": String(executingAction.id),
        "X-Request-Id": traceId,
      },
      body: JSON.stringify({
        actionId: executingAction.id,
        workspaceId: executingAction.workspaceId,
        chatId: executingAction.chatId,
        payload: JSON.parse(executingAction.payload),
      }),
      signal: AbortSignal.timeout(EXECUTION_TIMEOUT_MS),
    });

    const responseBody = await response.text();
    if (response.ok) {
      let externalRef = null;
      if (responseBody) {
        try {
          const parsed = JSON.parse(responseBody);
          externalRef =
            typeof parsed?.externalRef === "string"
              ? parsed.externalRef
              : typeof parsed?.id === "string" ||
                  typeof parsed?.id === "number"
                ? String(parsed.id)
                : null;
        } catch {
          externalRef = null;
        }
      }
      return {
        action: await writeStatus(
          executingAction,
          "executed",
          actorId,
          traceId,
          { externalRef }
        ),
        claimed: true,
      };
    }

    const status = response.status >= 500 ? "unknown" : "failed";
    return {
      action: await writeStatus(
        executingAction,
        status,
        actorId,
        traceId,
        {
          failureReason: `External API returned HTTP ${response.status}.`,
        }
      ),
      claimed: true,
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "external_action_execution_uncertain",
        actionId: executingAction.id,
        traceId,
        error: error.message,
      })
    );
    return {
      action: await writeStatus(executingAction, "unknown", actorId, traceId, {
        failureReason: "External API outcome is unknown; retry with the same action ID.",
      }),
      claimed: true,
    };
  }
}

module.exports = { executeAction, externalApiUrl };
