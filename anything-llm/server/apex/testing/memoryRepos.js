// In-memory repositories with the SAME contract as prismaRepos.js, including atomic
// compare-and-set transitions (synchronous check+write, so concurrent callers race fairly).
function createMemoryRepos() {
  let seq = { doc: 0, chunk: 0, qa: 0, cit: 0, act: 0, aud: 0 };
  const T = { docs: [], chunks: [], qas: [], cits: [], acts: [], auds: [] };
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x), (k, v) => (/At$/.test(k) && typeof v === "string" ? new Date(v) : v)) : x);
  const apply = (row, patch) => {
    const { incrementAttempts, ...rest } = patch;
    Object.assign(row, rest, { updatedAt: new Date() });
    if (incrementAttempts) row.attempts += 1;
  };
  const cas = (table, id, from, patch) => {
    const row = table.find((r) => r.id === id);
    if (!row || !from.includes(row.status)) return null;
    apply(row, patch);
    return clone(row);
  };
  const match = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);

  const documents = {
    async create(d) { const row = { id: ++seq.doc, status: "UPLOADED", failureCode: null, failureMessage: null, attempts: 0, createdAt: new Date(), processedAt: null, ...d }; T.docs.push(row); return clone(row); },
    async findById(id) { return clone(T.docs.find((d) => d.id === id) || null); },
    async list(where) { return T.docs.filter((d) => match(d, where)).sort((a, b) => b.id - a.id).map(clone); },
    async transition(id, from, patch) { return cas(T.docs, id, from, patch); },
    async saveChunks(documentId, chunks) {
      T.chunks = T.chunks.filter((c) => c.documentId !== documentId);
      for (const c of chunks) T.chunks.push({ id: ++seq.chunk, documentId, ordinal: c.ordinal, content: c.content });
    },
    async listReadyChunks(scope) {
      const ok = new Map(T.docs.filter((d) => d.status === "READY" && match(d, scope)).map((d) => [d.id, d]));
      return T.chunks.filter((c) => ok.has(c.documentId)).map((c) => ({ ...c, filename: ok.get(c.documentId).originalFilename }));
    },
    _raw: T,
  };
  const withCits = (q) => q && { ...clone(q), citations: T.cits.filter((c) => c.qaRequestId === q.id).sort((a, b) => a.ordinal - b.ordinal).map(clone) };
  const qa = {
    async create({ ownerId, question, traceId }) { const row = { id: ++seq.qa, ownerId, question, traceId, status: "PENDING", answerText: null, grounded: false, provider: null, latencyMs: null, errorCode: null, errorMessage: null, createdAt: new Date(), completedAt: null }; T.qas.push(row); return withCits(row); },
    async findById(id) { return withCits(T.qas.find((q) => q.id === id) || null); },
    async list(where) { return T.qas.filter((q) => match(q, where)).sort((a, b) => b.id - a.id).map(withCits); },
    async complete(id, { answerText, grounded, provider, latencyMs, citations }) {
      const row = T.qas.find((q) => q.id === id);
      Object.assign(row, { status: "ANSWERED", answerText, grounded, provider, latencyMs, completedAt: new Date() });
      for (const c of citations) T.cits.push({ id: ++seq.cit, qaRequestId: id, documentId: c.documentId ?? null, chunkId: c.chunkId ?? null, filename: c.filename, snippet: c.snippet, score: c.score ?? 0, ordinal: c.ordinal });
      return withCits(row);
    },
    async fail(id, { errorCode, errorMessage, latencyMs }) { const row = T.qas.find((q) => q.id === id); Object.assign(row, { status: "FAILED", errorCode, errorMessage, latencyMs, completedAt: new Date() }); return withCits(row); },
    _raw: T,
  };
  const actions = {
    async create(d) {
      if (d.requestKey && T.acts.some((a) => a.createdById === d.createdById && a.requestKey === d.requestKey)) { const e = new Error("dup"); e.code = "DUPLICATE"; throw e; }
      if (T.acts.some((a) => a.idempotencyKey === d.idempotencyKey)) { const e = new Error("dup"); e.code = "DUPLICATE"; throw e; }
      const row = { id: ++seq.act, status: "PENDING_REVIEW", reviewerId: null, reviewNote: null, reviewedAt: null, externalRef: null, attempts: 0, lastError: null, executedAt: null, createdAt: new Date(), ...d };
      T.acts.push(row); return clone(row);
    },
    async findById(id) { return clone(T.acts.find((a) => a.id === id) || null); },
    async findByRequestKey(createdById, requestKey) { return clone(T.acts.find((a) => a.createdById === createdById && a.requestKey === requestKey) || null); },
    async list(where) { return T.acts.filter((a) => match(a, where)).sort((a, b) => b.id - a.id).map(clone); },
    async transition(id, from, patch) { return cas(T.acts, id, from, patch); },
    _raw: T,
  };
  const audit = {
    async append(e) { const row = { id: ++seq.aud, createdAt: new Date(), ...clone(e) }; T.auds.push(row); return clone(row); },
    async listForEntity(entityType, entityId) { return T.auds.filter((a) => a.entityType === entityType && a.entityId === entityId).map(clone); },
    _raw: T,
  };
  return { documents, qa, actions, audit };
}
module.exports = { createMemoryRepos };
