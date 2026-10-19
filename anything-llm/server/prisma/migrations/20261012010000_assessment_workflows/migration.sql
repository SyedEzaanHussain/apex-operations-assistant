-- Additive assessment workflow fields. Existing indexed documents remain ready.
ALTER TABLE "workspace_documents" ADD COLUMN "processingStatus" TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE "workspace_documents" ADD COLUMN "failureReason" TEXT;

CREATE TABLE "proposed_actions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workspaceId" INTEGER NOT NULL,
    "chatId" INTEGER,
    "createdBy" INTEGER NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "idempotencyKey" TEXT NOT NULL,
    "failureReason" TEXT,
    "reviewedBy" INTEGER,
    "reviewedAt" DATETIME,
    "externalRef" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL,
    CONSTRAINT "proposed_actions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "proposed_actions_idempotencyKey_key" ON "proposed_actions"("idempotencyKey");
CREATE INDEX "proposed_actions_workspaceId_status_idx" ON "proposed_actions"("workspaceId", "status");
CREATE INDEX "proposed_actions_createdBy_idx" ON "proposed_actions"("createdBy");

CREATE TABLE "audit_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" INTEGER,
    "action" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "traceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "audit_events_entity_entityId_idx" ON "audit_events"("entity", "entityId");
CREATE INDEX "audit_events_traceId_idx" ON "audit_events"("traceId");
