const { randomUUID } = require("crypto");
const { AppError, E } = require("../../http/errors");
const { isPrivileged } = require("../../http/auth");
const { schemas, ACTION_TYPES } = require("../../http/validate");
const { STATUS } = require("./states");

function createActionService({ repo, qaRepo, externalApi, audit, logger, newKey = randomUUID }) {
  const canSee = (user, a) => a && (isPrivileged(user) || a.createdById === user.id);

  async function execute({ id, from, traceId, actor }) {
    // Atomic claim: only ONE caller can move the row into EXECUTING. Everyone else gets the current state
    // back and the external API is NOT called. This is the primary duplicate-execution guard.
    const claimed = await repo.transition(id, from, { status: STATUS.EXECUTING, incrementAttempts: true, lastError: null });
    if (!claimed) return repo.findById(id);
    await audit.record({ traceId, actor, eventType: "ACTION_EXECUTING", entityType: "action", entityId: id, fromStatus: from.join("|"), toStatus: STATUS.EXECUTING, metadata: { attempt: claimed.attempts } });

    // Secondary guard: the SAME idempotency key is sent on every attempt, so the external system de-duplicates.
    const r = await externalApi.submit({ idempotencyKey: claimed.idempotencyKey, actionType: claimed.actionType, payload: claimed.payload, traceId });

    if (r.outcome === "OK") {
      const done = await repo.transition(id, [STATUS.EXECUTING], { status: STATUS.EXECUTED, externalRef: r.externalRef, executedAt: new Date(), lastError: null });
      await audit.record({ traceId, actor, eventType: "ACTION_EXECUTED", entityType: "action", entityId: id, fromStatus: STATUS.EXECUTING, toStatus: STATUS.EXECUTED, metadata: { externalRef: r.externalRef, idempotentReplay: r.replay } });
      return done;
    }
    if (r.outcome === "REJECTED") {
      const failed = await repo.transition(id, [STATUS.EXECUTING], { status: STATUS.FAILED, lastError: `EXTERNAL_REJECTED_${r.status}: ${r.message}` });
      await audit.record({ traceId, actor, eventType: "ACTION_FAILED", entityType: "action", entityId: id, fromStatus: STATUS.EXECUTING, toStatus: STATUS.FAILED, metadata: { status: r.status } });
      return failed;
    }
    const unknown = await repo.transition(id, [STATUS.EXECUTING], { status: STATUS.UNKNOWN, lastError: r.reason });
    logger.warn("action_outcome_uncertain", { traceId, actionId: id, reason: r.reason });
    await audit.record({ traceId, actor, eventType: "ACTION_EXECUTION_UNCERTAIN", entityType: "action", entityId: id, fromStatus: STATUS.EXECUTING, toStatus: STATUS.UNKNOWN, metadata: { reason: r.reason } });
    return unknown;
  }

  return {
    execute,

    /** Returns { action, created }. Idempotent on (user, requestKey). */
    async propose({ user, qaRequest, source, actionType, payload, requestKey = null, traceId }) {
      if (!ACTION_TYPES.includes(actionType)) throw E.badRequest(`Unsupported actionType: ${actionType}`);
      const { value, error } = schemas.actionPayload.validate(payload, { stripUnknown: true });
      if (error) throw E.badRequest("Invalid action payload", error.details.map((d) => d.message));
      if (!qaRequest || qaRequest.status !== "ANSWERED" || !qaRequest.grounded)
        throw new AppError(422, "NOT_GROUNDED", "Actions can only be proposed from answers that cite sources");

      if (requestKey) {
        const existing = await repo.findByRequestKey(user.id, requestKey);
        if (existing) return { action: existing, created: false };
      }
      let action;
      try {
        action = await repo.create({
          qaRequestId: qaRequest.id, createdById: user.id, source, actionType, payload: value,
          idempotencyKey: newKey(), requestKey,
        });
      } catch (e) {
        if (e.code === "DUPLICATE" && requestKey) {
          const existing = await repo.findByRequestKey(user.id, requestKey); // lost a race with a double-submit
          if (existing) return { action: existing, created: false };
        }
        throw e;
      }
      await audit.record({ traceId, actor: user, eventType: "ACTION_PROPOSED", entityType: "action", entityId: action.id, toStatus: STATUS.PENDING_REVIEW, metadata: { source, actionType } });
      return { action, created: true };
    },

    async list(user) {
      return repo.list(isPrivileged(user) ? {} : { createdById: user.id });
    },

    async get(user, id) {
      const a = await repo.findById(id);
      if (!canSee(user, a)) throw E.notFound("Action not found");
      const qa = a.qaRequestId ? await qaRepo.findById(a.qaRequestId) : null;
      return { ...a, qaRequest: qa };
    },

    async history(user, id) {
      await this.get(user, id);
      return audit.listFor("action", id);
    },

    async approve({ user, id, note = "", traceId }) {
      const a = await repo.findById(id);
      if (!a) throw E.notFound("Action not found");
      if (a.createdById === user.id)
        throw new AppError(403, "SELF_APPROVAL_FORBIDDEN", "You cannot approve an action you created");
      if (a.status === STATUS.REJECTED) throw E.conflict("Action was already rejected");
      if (a.status === STATUS.PENDING_REVIEW) {
        const approved = await repo.transition(id, [STATUS.PENDING_REVIEW], { status: STATUS.APPROVED, reviewerId: user.id, reviewNote: note, reviewedAt: new Date() });
        if (approved) {
          await audit.record({ traceId, actor: user, eventType: "ACTION_APPROVED", entityType: "action", entityId: id, fromStatus: STATUS.PENDING_REVIEW, toStatus: STATUS.APPROVED, metadata: { note } });
        } else if ((await repo.findById(id)).status === STATUS.REJECTED) {
          throw E.conflict("Action was already rejected");
        }
      }
      // Safe to call for any state: the CAS claim inside execute() decides whether anything is sent.
      return execute({ id, from: [STATUS.APPROVED], traceId, actor: user });
    },

    async reject({ user, id, note = "", traceId }) {
      const a = await repo.findById(id);
      if (!a) throw E.notFound("Action not found");
      if (a.status === STATUS.REJECTED) return a; // idempotent
      const rejected = await repo.transition(id, [STATUS.PENDING_REVIEW], { status: STATUS.REJECTED, reviewerId: user.id, reviewNote: note, reviewedAt: new Date() });
      if (!rejected) throw E.conflict(`Only PENDING_REVIEW actions can be rejected (current: ${(await repo.findById(id)).status})`);
      await audit.record({ traceId, actor: user, eventType: "ACTION_REJECTED", entityType: "action", entityId: id, fromStatus: STATUS.PENDING_REVIEW, toStatus: STATUS.REJECTED, metadata: { note } });
      return rejected;
    },

    async retry({ user, id, traceId }) {
      const a = await repo.findById(id);
      if (!a) throw E.notFound("Action not found");
      if (a.status === STATUS.EXECUTED || a.status === STATUS.EXECUTING) return a; // idempotent
      if (![STATUS.UNKNOWN, STATUS.FAILED].includes(a.status))
        throw E.conflict(`Only UNKNOWN or FAILED actions can be retried (current: ${a.status})`);
      return execute({ id, from: [STATUS.UNKNOWN, STATUS.FAILED], traceId, actor: user });
    },
  };
}

module.exports = { createActionService };
