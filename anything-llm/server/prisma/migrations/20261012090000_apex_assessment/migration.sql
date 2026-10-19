-- Apex assessment module: documents, chunks, Q&A, citations, proposed actions, audit.

-- CreateTable
CREATE TABLE "apex_documents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" INTEGER NOT NULL,
    "original_filename" TEXT NOT NULL,
    "stored_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "failure_code" TEXT,
    "failure_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" DATETIME,
    CONSTRAINT "apex_documents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "apex_document_chunks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "document_id" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    CONSTRAINT "apex_document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "apex_documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "apex_qa_requests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "answer_text" TEXT,
    "grounded" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "latency_ms" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "trace_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    CONSTRAINT "apex_qa_requests_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "apex_citations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "qa_request_id" INTEGER NOT NULL,
    "document_id" INTEGER,
    "chunk_id" INTEGER,
    "filename" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "score" REAL NOT NULL DEFAULT 0,
    "ordinal" INTEGER NOT NULL,
    CONSTRAINT "apex_citations_qa_request_id_fkey" FOREIGN KEY ("qa_request_id") REFERENCES "apex_qa_requests" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "apex_citations_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "apex_documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "apex_proposed_actions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "qa_request_id" INTEGER,
    "created_by_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "idempotency_key" TEXT NOT NULL,
    "request_key" TEXT,
    "reviewer_id" INTEGER,
    "review_note" TEXT,
    "reviewed_at" DATETIME,
    "external_ref" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "executed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "apex_proposed_actions_qa_request_id_fkey" FOREIGN KEY ("qa_request_id") REFERENCES "apex_qa_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "apex_proposed_actions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "apex_proposed_actions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "apex_audit_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trace_id" TEXT NOT NULL,
    "actor_id" INTEGER,
    "actor_role" TEXT,
    "event_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "apex_audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "apex_documents_stored_filename_key" ON "apex_documents"("stored_filename");
CREATE INDEX "apex_documents_owner_id_idx" ON "apex_documents"("owner_id");
CREATE INDEX "apex_documents_status_idx" ON "apex_documents"("status");
CREATE UNIQUE INDEX "apex_document_chunks_document_id_ordinal_key" ON "apex_document_chunks"("document_id", "ordinal");
CREATE INDEX "apex_qa_requests_owner_id_idx" ON "apex_qa_requests"("owner_id");
CREATE INDEX "apex_qa_requests_trace_id_idx" ON "apex_qa_requests"("trace_id");
CREATE INDEX "apex_citations_qa_request_id_idx" ON "apex_citations"("qa_request_id");
CREATE UNIQUE INDEX "apex_proposed_actions_idempotency_key_key" ON "apex_proposed_actions"("idempotency_key");
CREATE UNIQUE INDEX "apex_proposed_actions_created_by_id_request_key_key" ON "apex_proposed_actions"("created_by_id", "request_key");
CREATE INDEX "apex_proposed_actions_status_idx" ON "apex_proposed_actions"("status");
CREATE INDEX "apex_audit_events_entity_type_entity_id_idx" ON "apex_audit_events"("entity_type", "entity_id");
CREATE INDEX "apex_audit_events_trace_id_idx" ON "apex_audit_events"("trace_id");

-- Append-only audit trail: block UPDATE/DELETE at the database level.
-- (Prisma ignores triggers, so this is safe alongside `prisma migrate`.)
CREATE TRIGGER "apex_audit_events_no_update" BEFORE UPDATE ON "apex_audit_events"
BEGIN SELECT RAISE(ABORT, 'apex_audit_events is append-only'); END;
CREATE TRIGGER "apex_audit_events_no_delete" BEFORE DELETE ON "apex_audit_events"
BEGIN SELECT RAISE(ABORT, 'apex_audit_events is append-only'); END;
