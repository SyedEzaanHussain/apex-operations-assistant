// Append-only audit trail. Every state change in documents / Q&A / actions
// records who, what, from->to, and the correlation (trace) id.
function createAuditService({ repo, logger }) {
  return {
    async record({ traceId, actor, eventType, entityType, entityId, fromStatus = null, toStatus = null, metadata = null }) {
      const event = await repo.append({
        traceId,
        actorId: actor ? actor.id : null,
        actorRole: actor ? actor.role : null,
        eventType,
        entityType,
        entityId,
        fromStatus,
        toStatus,
        metadata,
      });
      logger.info("audit_event", { traceId, eventType, entityType, entityId, fromStatus, toStatus, actorId: actor ? actor.id : null });
      return event;
    },
    listFor(entityType, entityId) {
      return repo.listForEntity(entityType, entityId);
    },
  };
}
module.exports = { createAuditService };
