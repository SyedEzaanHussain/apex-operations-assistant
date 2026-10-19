const { AppError, E } = require("../../http/errors");
const { isPrivileged } = require("../../http/auth");
const { GatewayError } = require("./ragGateway");

function createQaService({ repo, documentsRepo, gateway, actionService, audit, config, logger }) {
  return {
    async ask({ user, question, traceId }) {
      const scope = isPrivileged(user) ? {} : { ownerId: user.id };
      const chunks = await documentsRepo.listReadyChunks(scope);
      if (chunks.length === 0)
        throw new AppError(409, "NO_READY_DOCUMENTS", "No processed documents available. Upload a document and wait until it is READY.");

      const qa = await repo.create({ ownerId: user.id, question, traceId });
      await audit.record({ traceId, actor: user, eventType: "QA_ASKED", entityType: "qa_request", entityId: qa.id, toStatus: "PENDING", metadata: { questionLength: question.length } });

      const started = Date.now();
      const controller = new AbortController();
      let timer;
      try {
        const timeout = new Promise((_, rej) => {
          timer = setTimeout(() => { controller.abort(); rej(new GatewayError("RAG_TIMEOUT", "AI service timed out")); }, config.ragTimeoutMs);
        });
        const result = await Promise.race([
          gateway.answer({ question, chunks, traceId, signal: controller.signal, faultInjection: config.faultInjection }),
          timeout,
        ]);
        if (!result || typeof result.answerText !== "string" || !result.answerText.trim())
          throw new GatewayError("RAG_BAD_RESPONSE", "AI service returned an empty answer");

        // Drop citations that don't point at a chunk the caller was allowed to search (anti-hallucinated sources).
        const allowed = new Set(chunks.map((c) => c.id));
        const citations = (Array.isArray(result.citations) ? result.citations : [])
          .filter((c) => c.chunkId == null || allowed.has(c.chunkId))
          .map((c, ordinal) => ({ ...c, ordinal }));
        const grounded = citations.length > 0;

        const done = await repo.complete(qa.id, {
          answerText: result.answerText, grounded, provider: gateway.name,
          latencyMs: Date.now() - started, citations,
        });
        await audit.record({ traceId, actor: user, eventType: "QA_ANSWERED", entityType: "qa_request", entityId: qa.id, fromStatus: "PENDING", toStatus: "ANSWERED", metadata: { grounded, citations: citations.length } });

        let proposedAction = null;
        // Ungrounded answers never produce actions. The AI only *proposes*; humans approve.
        if (grounded && result.suggestedAction) {
          try {
            ({ action: proposedAction } = await actionService.propose({
              user, qaRequest: done, source: "AI", actionType: result.suggestedAction.actionType,
              payload: result.suggestedAction.payload, traceId,
            }));
          } catch (e) {
            logger.warn("suggested_action_rejected", { traceId, qaRequestId: qa.id, reason: e.message });
          }
        }
        return { ...done, proposedAction };
      } catch (err) {
        const code = err instanceof GatewayError ? err.code : "RAG_UNEXPECTED_ERROR";
        if (!(err instanceof GatewayError)) logger.error("qa_unexpected_error", { traceId, message: err.message });
        await repo.fail(qa.id, { errorCode: code, errorMessage: "The AI service could not produce an answer", latencyMs: Date.now() - started });
        await audit.record({ traceId, actor: user, eventType: "QA_FAILED", entityType: "qa_request", entityId: qa.id, fromStatus: "PENDING", toStatus: "FAILED", metadata: { code } });
        const timedOut = code === "RAG_TIMEOUT";
        throw new AppError(timedOut ? 504 : 502, timedOut ? "AI_TIMEOUT" : "AI_UNAVAILABLE",
          timedOut ? "The AI service timed out. Please try again." : "The AI service is unavailable. Please try again.",
          { qaRequestId: qa.id });
      } finally {
        clearTimeout(timer);
      }
    },

    async list(user) {
      return repo.list(isPrivileged(user) ? {} : { ownerId: user.id });
    },

    async get(user, id) {
      const qa = await repo.findById(id);
      if (!qa || !(isPrivileged(user) || qa.ownerId === user.id)) throw E.notFound("Q&A request not found");
      return qa;
    },
  };
}
module.exports = { createQaService };
