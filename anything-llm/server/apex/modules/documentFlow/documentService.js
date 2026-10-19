const path = require("path");
const fsp = require("fs/promises");
const crypto = require("crypto");
const { E } = require("../../http/errors");
const { isPrivileged } = require("../../http/auth");
const { chunkText } = require("./chunker");

class ProcessingError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Display-only name: never used to build a filesystem path.
const safeDisplayName = (n) =>
  path.basename(String(n || "file")).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").slice(0, 120) || "file";

function createDocumentService({ repo, audit, config, logger, schedule = setImmediate }) {
  const visibleTo = (user, doc) => doc && (isPrivileged(user) || doc.ownerId === user.id);

  async function process(id, traceId) {
    const claimed = await repo.transition(id, ["UPLOADED", "FAILED"], {
      status: "PROCESSING", failureCode: null, failureMessage: null, incrementAttempts: true,
    });
    if (!claimed) return null; // already processing/ready: safe no-op
    await audit.record({ traceId, eventType: "DOCUMENT_PROCESSING", entityType: "document", entityId: id, fromStatus: "UPLOADED", toStatus: "PROCESSING" });
    try {
      const buf = await fsp.readFile(path.join(config.uploadDir, claimed.storedFilename));
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
      catch { throw new ProcessingError("UNREADABLE_TEXT", "File is not valid UTF-8 text"); }
      if (text.includes("\u0000")) throw new ProcessingError("BINARY_CONTENT", "File contains binary data");
      if (!text.trim()) throw new ProcessingError("EMPTY_CONTENT", "File has no readable text");
      if (config.faultInjection && text.includes("[[FAIL_PROCESSING]]"))
        throw new ProcessingError("FAULT_INJECTED", "Simulated processing failure");
      await repo.saveChunks(id, chunkText(text, config.chunkSize));
      const ready = await repo.transition(id, ["PROCESSING"], { status: "READY", processedAt: new Date() });
      await audit.record({ traceId, eventType: "DOCUMENT_READY", entityType: "document", entityId: id, fromStatus: "PROCESSING", toStatus: "READY" });
      return ready;
    } catch (err) {
      const code = err instanceof ProcessingError ? err.code : "PROCESSING_ERROR";
      const message = err instanceof ProcessingError ? err.message : "Unexpected processing error";
      if (!(err instanceof ProcessingError)) logger.error("document_processing_error", { traceId, documentId: id, message: err.message });
      const failed = await repo.transition(id, ["PROCESSING"], { status: "FAILED", failureCode: code, failureMessage: message });
      await audit.record({ traceId, eventType: "DOCUMENT_FAILED", entityType: "document", entityId: id, fromStatus: "PROCESSING", toStatus: "FAILED", metadata: { code } });
      return failed;
    }
  }

  return {
    process,

    async upload({ user, file, traceId }) {
      if (!file) throw E.badRequest("A file is required (multipart field 'file')");
      const ext = path.extname(file.originalname || "").slice(1).toLowerCase();
      if (!config.allowedExtensions.includes(ext))
        throw E.unsupported(`Allowed file types: ${config.allowedExtensions.join(", ")}`);
      if (!file.buffer || file.buffer.length === 0) throw E.badRequest("File is empty");
      if (file.buffer.length > config.maxUploadBytes)
        throw E.tooLarge(`File exceeds ${config.maxUploadBytes} bytes`);

      const storedFilename = `${crypto.randomUUID()}.${ext}`; // server-generated; user input never touches the path
      await fsp.mkdir(config.uploadDir, { recursive: true, mode: 0o700 });
      await fsp.writeFile(path.join(config.uploadDir, storedFilename), file.buffer, { mode: 0o600 });

      const doc = await repo.create({
        ownerId: user.id,
        originalFilename: safeDisplayName(file.originalname),
        storedFilename,
        mimeType: String(file.mimetype || "application/octet-stream").slice(0, 100),
        sizeBytes: file.buffer.length,
        sha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
      });
      await audit.record({ traceId, actor: user, eventType: "DOCUMENT_UPLOADED", entityType: "document", entityId: doc.id, toStatus: "UPLOADED", metadata: { sizeBytes: doc.sizeBytes } });
      // In-process async. Production: replace with a durable queue + worker (see docs).
      schedule(() => process(doc.id, traceId).catch((e) => logger.error("process_crash", { traceId, documentId: doc.id, message: e.message })));
      return doc;
    },

    async list(user) {
      return repo.list(isPrivileged(user) ? {} : { ownerId: user.id });
    },

    async get(user, id) {
      const doc = await repo.findById(id);
      if (!visibleTo(user, doc)) throw E.notFound("Document not found"); // 404, not 403: don't leak existence
      return doc;
    },

    async retry({ user, id, traceId }) {
      const doc = await this.get(user, id);
      if (doc.status !== "FAILED") throw E.conflict(`Only FAILED documents can be retried (current: ${doc.status})`);
      await audit.record({ traceId, actor: user, eventType: "DOCUMENT_RETRY_REQUESTED", entityType: "document", entityId: id });
      return process(id, traceId);
    },
  };
}

module.exports = { createDocumentService, ProcessingError, safeDisplayName };
