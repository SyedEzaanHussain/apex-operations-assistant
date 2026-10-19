// Response shaping: internal columns (stored file names, idempotency keys) never leave the server.
const doc = (d) => ({
  id: d.id, ownerId: d.ownerId, filename: d.originalFilename, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
  status: d.status, failureCode: d.failureCode, failureMessage: d.failureMessage, attempts: d.attempts,
  createdAt: d.createdAt, processedAt: d.processedAt,
});
const citation = (c) => ({ documentId: c.documentId, chunkId: c.chunkId, filename: c.filename, snippet: c.snippet, score: c.score, ordinal: c.ordinal });
const qa = (q) => q && ({
  id: q.id, ownerId: q.ownerId, question: q.question, status: q.status, answer: q.answerText, grounded: q.grounded,
  provider: q.provider, latencyMs: q.latencyMs, errorCode: q.errorCode, traceId: q.traceId,
  createdAt: q.createdAt, citations: (q.citations || []).map(citation),
  ...(q.proposedAction !== undefined ? { proposedAction: q.proposedAction ? action(q.proposedAction) : null } : {}),
});
const action = (a) => ({
  id: a.id, qaRequestId: a.qaRequestId, createdById: a.createdById, source: a.source, actionType: a.actionType,
  payload: a.payload, status: a.status, reviewerId: a.reviewerId, reviewNote: a.reviewNote, reviewedAt: a.reviewedAt,
  externalRef: a.externalRef, attempts: a.attempts, lastError: a.lastError, executedAt: a.executedAt, createdAt: a.createdAt,
  ...(a.qaRequest !== undefined ? { qaRequest: qa(a.qaRequest) } : {}),
});
const audit = (e) => ({ id: e.id, traceId: e.traceId, actorId: e.actorId, actorRole: e.actorRole, eventType: e.eventType, fromStatus: e.fromStatus, toStatus: e.toStatus, metadata: e.metadata, createdAt: e.createdAt });
module.exports = { doc, qa, action, audit, citation };
