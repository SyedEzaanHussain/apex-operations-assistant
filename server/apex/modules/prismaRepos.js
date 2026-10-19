// Prisma-backed repositories (the ONLY place that knows about the DB client).
// Services depend on the repo *shape*, so tests swap in an in-memory implementation.
function createPrismaRepos(prisma) {
  const patchData = (patch) => {
    const { incrementAttempts, ...rest } = patch;
    return { ...rest, ...(incrementAttempts ? { attempts: { increment: 1 } } : {}), updatedAt: new Date() };
  };

  // Compare-and-set: succeeds only if the row is still in one of `from` statuses.
  async function cas(model, id, from, patch) {
    const res = await prisma[model].updateMany({ where: { id, status: { in: from } }, data: patchData(patch) });
    return res.count === 0 ? null : prisma[model].findUnique({ where: { id } });
  }

  const parseJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  const actionOut = (r) => (r ? { ...r, payload: parseJson(r.payload) } : r);

  const documents = {
    create: (data) => prisma.apex_documents.create({ data }),
    findById: (id) => prisma.apex_documents.findUnique({ where: { id } }),
    list: (where) => prisma.apex_documents.findMany({ where, orderBy: { id: "desc" }, take: 200 }),
    transition: (id, from, patch) => cas("apex_documents", id, from, patch),
    saveChunks: (documentId, chunks) =>
      prisma.$transaction(async (tx) => {
        await tx.apex_document_chunks.deleteMany({ where: { documentId } });
        for (const c of chunks) await tx.apex_document_chunks.create({ data: { documentId, ordinal: c.ordinal, content: c.content } });
      }),
    async listReadyChunks(scope) {
      const rows = await prisma.apex_document_chunks.findMany({
        where: { document: { status: "READY", ...scope } },
        include: { document: { select: { id: true, originalFilename: true } } },
        take: 5000, // bound memory; production: move retrieval to a vector index
      });
      return rows.map((r) => ({ id: r.id, documentId: r.documentId, ordinal: r.ordinal, content: r.content, filename: r.document.originalFilename }));
    },
  };

  const qa = {
    create: ({ ownerId, question, traceId }) => prisma.apex_qa_requests.create({ data: { ownerId, question, traceId }, include: { citations: true } }),
    findById: (id) => prisma.apex_qa_requests.findUnique({ where: { id }, include: { citations: { orderBy: { ordinal: "asc" } } } }),
    list: (where) => prisma.apex_qa_requests.findMany({ where, orderBy: { id: "desc" }, take: 100, include: { citations: { orderBy: { ordinal: "asc" } } } }),
    complete: (id, { answerText, grounded, provider, latencyMs, citations }) =>
      prisma.$transaction(async (tx) => {
        await tx.apex_qa_requests.update({ where: { id }, data: { status: "ANSWERED", answerText, grounded, provider, latencyMs, completedAt: new Date() } });
        for (const c of citations)
          await tx.apex_citations.create({ data: { qaRequestId: id, documentId: c.documentId ?? null, chunkId: c.chunkId ?? null, filename: c.filename, snippet: c.snippet, score: c.score ?? 0, ordinal: c.ordinal } });
        return tx.apex_qa_requests.findUnique({ where: { id }, include: { citations: { orderBy: { ordinal: "asc" } } } });
      }),
    fail: (id, { errorCode, errorMessage, latencyMs }) =>
      prisma.apex_qa_requests.update({ where: { id }, data: { status: "FAILED", errorCode, errorMessage, latencyMs, completedAt: new Date() } }),
  };

  const actions = {
    async create(data) {
      try {
        return actionOut(await prisma.apex_proposed_actions.create({ data: { ...data, payload: JSON.stringify(data.payload) } }));
      } catch (e) {
        if (e && e.code === "P2002") { const err = new Error("duplicate"); err.code = "DUPLICATE"; throw err; }
        throw e;
      }
    },
    findById: async (id) => actionOut(await prisma.apex_proposed_actions.findUnique({ where: { id } })),
    findByRequestKey: async (createdById, requestKey) => actionOut(await prisma.apex_proposed_actions.findFirst({ where: { createdById, requestKey } })),
    list: async (where) => (await prisma.apex_proposed_actions.findMany({ where, orderBy: { id: "desc" }, take: 200 })).map(actionOut),
    transition: async (id, from, patch) => actionOut(await cas("apex_proposed_actions", id, from, patch)),
  };

  const audit = {
    append: (e) => prisma.apex_audit_events.create({ data: { ...e, metadata: e.metadata ? JSON.stringify(e.metadata) : null } }),
    listForEntity: async (entityType, entityId) =>
      (await prisma.apex_audit_events.findMany({ where: { entityType, entityId }, orderBy: { id: "asc" } }))
        .map((r) => ({ ...r, metadata: parseJson(r.metadata) })),
  };

  return { documents, qa, actions, audit };
}
module.exports = { createPrismaRepos };
