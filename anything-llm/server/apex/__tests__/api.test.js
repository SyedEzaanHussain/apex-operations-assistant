const request = require("supertest");
const { createTestApp, SOP } = require("../testing/testApp");

let t;
beforeEach(async () => { t = await createTestApp(); });
afterEach(async () => { await t.close(); });

const as = (who) => (req) => req.set("x-test-user", who);
const api = (method, url, who) => { const r = request(t.app)[method](`/api/apex${url}`); return who ? r.set("x-test-user", who) : r; };

async function uploadDoc(who, text = SOP, name = "sop.txt") {
  const res = await api("post", "/documents", who).attach("file", Buffer.from(text), name);
  await t.settle();
  return res;
}
// user uploads SOP, asks a question that yields an AI-proposed action
async function proposedAction(who = "user", question = "When should we schedule maintenance for the pump repair?") {
  await uploadDoc(who);
  const res = await api("post", "/qa/ask", who).send({ question });
  expect(res.status).toBe(200);
  expect(res.body.qa.proposedAction).toBeTruthy();
  return res.body.qa.proposedAction;
}

describe("authentication & authorization (server-side)", () => {
  test("no session -> 401 with the standard error shape and a trace id", async () => {
    const res = await api("get", "/documents");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(res.body.error.traceId).toBe(res.headers["x-request-id"]);
  });
  test("unknown role fails closed (403)", async () => {
    const res = await api("get", "/documents", "weird");
    expect(res.status).toBe(403);
  });
  test("a normal user calling approve directly is blocked and NOTHING is executed", async () => {
    const action = await proposedAction("user");
    const res = await api("post", `/actions/${action.id}/approve`, "user").send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect((await t.repos.actions.findById(action.id)).status).toBe("PENDING_REVIEW");
    expect(t.mock.stats.received).toBe(0);
  });
  test("a normal user cannot reject or retry either", async () => {
    const action = await proposedAction("user");
    expect((await api("post", `/actions/${action.id}/reject`, "user").send({})).status).toBe(403);
    expect((await api("post", `/actions/${action.id}/retry`, "user").send({})).status).toBe(403);
  });
  test("users cannot read each other's documents/actions (404, not 403); reviewers can", async () => {
    const up = await uploadDoc("user");
    const id = up.body.document.id;
    expect((await api("get", `/documents/${id}`, "user2")).status).toBe(404);
    expect((await api("get", "/documents", "user2")).body.documents).toHaveLength(0);
    expect((await api("get", `/documents/${id}`, "reviewer")).status).toBe(200);
    const action = await proposedAction("user");
    expect((await api("get", `/actions/${action.id}`, "user2")).status).toBe(404);
    expect((await api("get", `/actions/${action.id}/history`, "user2")).status).toBe(404);
  });
  test("retrieval is scoped: another user's documents are never searched or cited", async () => {
    await uploadDoc("user");
    const res = await api("post", "/qa/ask", "user2").send({ question: "pump maintenance lockout" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NO_READY_DOCUMENTS");
  });
});

describe("document workflow", () => {
  test("valid upload -> 202, persisted metadata, async processing reaches READY", async () => {
    const res = await api("post", "/documents", "user").attach("file", Buffer.from(SOP), "sop.txt");
    expect(res.status).toBe(202);
    expect(res.body.document).toMatchObject({ filename: "sop.txt", status: "UPLOADED", sizeBytes: SOP.length });
    expect(res.body.document.storedFilename).toBeUndefined(); // internal field not exposed
    await t.settle();
    const doc = await api("get", `/documents/${res.body.document.id}`, "user");
    expect(doc.body.document.status).toBe("READY");
  });
  test.each([
    ["disallowed extension", Buffer.from("x"), "evil.exe", 415, "UNSUPPORTED_MEDIA_TYPE"],
    ["empty file", Buffer.alloc(0), "empty.txt", 400, "VALIDATION_ERROR"],
    ["oversized file", Buffer.alloc(5000, "a"), "big.txt", 413, "PAYLOAD_TOO_LARGE"],
  ])("rejects %s", async (_n, buf, name, status, code) => {
    const res = await api("post", "/documents", "user").attach("file", buf, name);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
  });
  test("missing file -> 400", async () => {
    const res = await api("post", "/documents", "user").send({});
    expect(res.status).toBe(400);
  });
  test("failed-processing states are persisted with a reason, and retry re-runs processing", async () => {
    const bin = await uploadDoc("user", "abc\u0000def", "bin.txt");
    expect((await api("get", `/documents/${bin.body.document.id}`, "user")).body.document).toMatchObject({ status: "FAILED", failureCode: "BINARY_CONTENT", attempts: 1 });
    const ws = await uploadDoc("user", "   \n  ", "blank.txt");
    expect((await api("get", `/documents/${ws.body.document.id}`, "user")).body.document.failureCode).toBe("EMPTY_CONTENT");
    const bad = await api("post", "/documents", "user").attach("file", Buffer.from([0xff, 0xfe, 0xfd, 0x80]), "bad.txt");
    await t.settle();
    expect((await api("get", `/documents/${bad.body.document.id}`, "user")).body.document.failureCode).toBe("UNREADABLE_TEXT");
    const retry = await api("post", `/documents/${bin.body.document.id}/retry`, "user");
    expect(retry.status).toBe(202);
    expect(retry.body.document).toMatchObject({ status: "FAILED", attempts: 2 }); // still bad content -> fails again, honestly
  });
  test("retrying a document that is not FAILED is a 409", async () => {
    const ok = await uploadDoc("user");
    const res = await api("post", `/documents/${ok.body.document.id}/retry`, "user");
    expect(res.status).toBe(409);
  });
  test("hostile filenames never touch the filesystem path", async () => {
    const res = await uploadDoc("user", SOP, "../../etc/passwd.txt");
    expect(res.body.document.filename).not.toMatch(/[\\/]/);
    const fs = require("fs");
    const files = fs.readdirSync(t.uploadDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f-]{36}\.txt$/);
  });
});

describe("AI question-and-answer workflow", () => {
  test("empty state: no processed documents -> 409 NO_READY_DOCUMENTS", async () => {
    const res = await api("post", "/qa/ask", "user").send({ question: "anything at all" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NO_READY_DOCUMENTS");
  });
  test("grounded answer has citations, a trace id (body == header) and is persisted", async () => {
    await uploadDoc("user");
    const res = await api("post", "/qa/ask", "user").send({ question: "What must be done before a pump repair?" });
    expect(res.status).toBe(200);
    expect(res.body.qa.grounded).toBe(true);
    expect(res.body.qa.citations.length).toBeGreaterThan(0);
    expect(res.body.qa.citations[0]).toMatchObject({ filename: "sop.txt" });
    expect(res.body.qa.traceId).toBe(res.headers["x-request-id"]);
    expect(res.body.traceId).toBe(res.headers["x-request-id"]);
    const again = await api("get", `/qa/${res.body.qa.id}`, "user");
    expect(again.body.qa.answer).toBe(res.body.qa.answer);
  });
  test("an inbound well-formed X-Request-Id is honoured; a malformed one is replaced", async () => {
    const ok = await api("get", "/health").set("x-request-id", "client-trace-12345");
    expect(ok.headers["x-request-id"]).toBe("client-trace-12345");
    const bad = await api("get", "/health").set("x-request-id", "has spaces and ;;; symbols");
    expect(bad.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/); // replaced by a freshly minted UUID
  });
  test("validation: too-short question -> 400 with field details", async () => {
    const res = await api("post", "/qa/ask", "user").send({ question: "hi" });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("question");
  });
  test("AI upstream error -> 502 AI_UNAVAILABLE with trace id; failure persisted + audited", async () => {
    await uploadDoc("user");
    const res = await api("post", "/qa/ask", "user").send({ question: "pump maintenance [[AI_ERROR]]" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(res.body.error.traceId).toBe(res.headers["x-request-id"]);
    const qa = await t.repos.qa.findById(res.body.error.details.qaRequestId);
    expect(qa.status).toBe("FAILED");
    expect(t.repos.audit._raw.auds.some((a) => a.eventType === "QA_FAILED")).toBe(true);
  });
  test("AI timeout -> 504 AI_TIMEOUT", async () => {
    await uploadDoc("user");
    const res = await api("post", "/qa/ask", "user").send({ question: "pump maintenance [[AI_TIMEOUT]]" });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe("AI_TIMEOUT");
  });
  test("answer WITHOUT citations: returned as ungrounded, no action proposed, actions blocked server-side", async () => {
    await uploadDoc("user");
    const res = await api("post", "/qa/ask", "user").send({ question: "schedule maintenance for the pump repair [[NO_CITATIONS]]" });
    expect(res.status).toBe(200);
    expect(res.body.qa).toMatchObject({ grounded: false, citations: [], proposedAction: null });
    const create = await api("post", "/actions", "user").send({
      qaRequestId: res.body.qa.id, actionType: "CREATE_WORK_ORDER", payload: { title: "Fix pump" },
    });
    expect(create.status).toBe(422);
    expect(create.body.error.code).toBe("NOT_GROUNDED");
  });
  test("question with no match in the documents -> honest 'not found', ungrounded", async () => {
    await uploadDoc("user");
    const res = await api("post", "/qa/ask", "user").send({ question: "zebra quantum submarine" });
    expect(res.body.qa).toMatchObject({ grounded: false, citations: [] });
  });
});

describe("approval workflow", () => {
  test("AI only PROPOSES: the action is PENDING_REVIEW and nothing was sent to the enterprise API", async () => {
    const a = await proposedAction("user");
    expect(a).toMatchObject({ status: "PENDING_REVIEW", source: "AI", actionType: "CREATE_WORK_ORDER" });
    expect(t.mock.stats.received).toBe(0);
  });
  test("reviewer approves -> EXECUTED once; full audit history with trace ids", async () => {
    const a = await proposedAction("user");
    const res = await api("post", `/actions/${a.id}/approve`, "reviewer").send({ note: "ok" });
    expect(res.status).toBe(200);
    expect(res.body.action).toMatchObject({ status: "EXECUTED", reviewerId: 3 });
    expect(res.body.action.externalRef).toMatch(/^WO-/);
    expect(t.mock.stats).toMatchObject({ received: 1, created: 1 });
    const hist = await api("get", `/actions/${a.id}/history`, "user");
    expect(hist.body.history.map((h) => h.eventType)).toEqual(["ACTION_PROPOSED", "ACTION_APPROVED", "ACTION_EXECUTING", "ACTION_EXECUTED"]);
    expect(hist.body.history[1].traceId).toBe(res.headers["x-request-id"]);
  });
  test("approving the same action again never executes it again", async () => {
    const a = await proposedAction("user");
    await api("post", `/actions/${a.id}/approve`, "reviewer").send({});
    const second = await api("post", `/actions/${a.id}/approve`, "reviewer").send({});
    const third = await api("post", `/actions/${a.id}/approve`, "reviewer2").send({});
    expect([second.status, third.status]).toEqual([200, 200]);
    expect(second.body.action.status).toBe("EXECUTED");
    expect(t.mock.stats).toMatchObject({ received: 1, created: 1 });
  });
  test("CONCURRENT approvals (double-click / two reviewers) -> exactly one external execution", async () => {
    const a = await proposedAction("user");
    const results = await Promise.all(
      ["reviewer", "reviewer", "reviewer2", "reviewer2", "admin"].map((who) => api("post", `/actions/${a.id}/approve`, who).send({}))
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(t.mock.stats).toMatchObject({ received: 1, created: 1 });
    expect((await t.repos.actions.findById(a.id)).attempts).toBe(1);
  });
  test("separation of duties: you cannot approve your own action", async () => {
    const a = await proposedAction("reviewer");
    const res = await api("post", `/actions/${a.id}/approve`, "reviewer").send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SELF_APPROVAL_FORBIDDEN");
    expect((await api("post", `/actions/${a.id}/approve`, "reviewer2").send({})).body.action.status).toBe("EXECUTED");
  });
  test("reject -> REJECTED, later approve is a 409 and nothing executes", async () => {
    const a = await proposedAction("user");
    const rej = await api("post", `/actions/${a.id}/reject`, "reviewer").send({ note: "not needed" });
    expect(rej.body.action).toMatchObject({ status: "REJECTED", reviewNote: "not needed" });
    expect((await api("post", `/actions/${a.id}/approve`, "reviewer2").send({})).status).toBe(409);
    expect(t.mock.stats.received).toBe(0);
  });
  test("enterprise API ACCEPTS then times out -> UNKNOWN; retry reuses the idempotency key -> still ONE work order", async () => {
    const a = await proposedAction("user");
    await request(`http://127.0.0.1:${t.mockPort}`).post("/__admin/behavior").send({ mode: "timeout-after-accept", count: 1, delayMs: 1200 });
    const first = await api("post", `/actions/${a.id}/approve`, "reviewer").send({});
    expect(first.body.action).toMatchObject({ status: "UNKNOWN", lastError: "EXTERNAL_TIMEOUT" });
    expect(t.mock.stats.created).toBe(1); // it WAS created remotely
    const retry = await api("post", `/actions/${a.id}/retry`, "reviewer").send({});
    expect(retry.body.action.status).toBe("EXECUTED");
    expect(t.mock.stats).toMatchObject({ created: 1, replays: 1 });
    expect(t.mock.store.size).toBe(1);
    const hist = (await api("get", `/actions/${a.id}/history`, "reviewer")).body.history.map((h) => h.eventType);
    expect(hist).toContain("ACTION_EXECUTION_UNCERTAIN");
  });
  test("enterprise 503 (not accepted) -> UNKNOWN, retry succeeds, one work order", async () => {
    const a = await proposedAction("user");
    await request(`http://127.0.0.1:${t.mockPort}`).post("/__admin/behavior").send({ mode: "fail-503", count: 1 });
    expect((await api("post", `/actions/${a.id}/approve`, "reviewer").send({})).body.action.status).toBe("UNKNOWN");
    expect((await api("post", `/actions/${a.id}/retry`, "reviewer").send({})).body.action.status).toBe("EXECUTED");
    expect(t.mock.stats.created).toBe(1);
  });
  test("enterprise 422 -> FAILED (definitive), reviewer can retry", async () => {
    const a = await proposedAction("user");
    await request(`http://127.0.0.1:${t.mockPort}`).post("/__admin/behavior").send({ mode: "reject-422", count: 1 });
    const res = await api("post", `/actions/${a.id}/approve`, "reviewer").send({});
    expect(res.body.action.status).toBe("FAILED");
    expect(res.body.action.lastError).toMatch(/EXTERNAL_REJECTED_422/);
    expect((await api("post", `/actions/${a.id}/retry`, "reviewer").send({})).body.action.status).toBe("EXECUTED");
  });
  test("retrying an already EXECUTED action is a no-op", async () => {
    const a = await proposedAction("user");
    await api("post", `/actions/${a.id}/approve`, "reviewer").send({});
    const res = await api("post", `/actions/${a.id}/retry`, "reviewer").send({});
    expect(res.body.action.status).toBe("EXECUTED");
    expect(t.mock.stats.received).toBe(1);
  });
  test("creating an action twice with the same Idempotency-Key yields ONE action", async () => {
    await uploadDoc("user");
    const qa = (await api("post", "/qa/ask", "user").send({ question: "pump lockout tagout isolate power" })).body.qa;
    const body = { qaRequestId: qa.id, actionType: "ESCALATE_INCIDENT", payload: { title: "Escalate pump issue", priority: "HIGH" } };
    const one = await api("post", "/actions", "user").set("Idempotency-Key", "key-abcdef123").send(body);
    const two = await api("post", "/actions", "user").set("Idempotency-Key", "key-abcdef123").send(body);
    expect([one.status, two.status]).toEqual([201, 200]);
    expect(two.body.replayed).toBe(true);
    expect(two.body.action.id).toBe(one.body.action.id);
    expect(t.repos.actions._raw.acts).toHaveLength(1);
  });
  test("action validation: bad payload and malformed Idempotency-Key -> 400", async () => {
    await uploadDoc("user");
    const qa = (await api("post", "/qa/ask", "user").send({ question: "pump lockout tagout" })).body.qa;
    const bad = await api("post", "/actions", "user").send({ qaRequestId: qa.id, actionType: "CREATE_WORK_ORDER", payload: { title: "x" } });
    expect(bad.status).toBe(400);
    const badKey = await api("post", "/actions", "user").set("Idempotency-Key", "no spaces!").send({ qaRequestId: qa.id, actionType: "CREATE_WORK_ORDER", payload: { title: "Valid title" } });
    expect(badKey.status).toBe(400);
    const unknownType = await api("post", "/actions", "user").send({ qaRequestId: qa.id, actionType: "DELETE_EVERYTHING", payload: { title: "Valid title" } });
    expect(unknownType.status).toBe(400);
  });
  test("a user cannot create an action from someone else's Q&A (404)", async () => {
    await uploadDoc("user");
    const qa = (await api("post", "/qa/ask", "user").send({ question: "pump lockout tagout" })).body.qa;
    const res = await api("post", "/actions", "user2").send({ qaRequestId: qa.id, actionType: "CREATE_WORK_ORDER", payload: { title: "Valid title" } });
    expect(res.status).toBe(404);
  });
});

describe("audit trail integrity", () => {
  test("document + Q&A events are audited with actor and trace id", async () => {
    await uploadDoc("user");
    await api("post", "/qa/ask", "user").send({ question: "pump lockout tagout" });
    const types = t.repos.audit._raw.auds.map((a) => a.eventType);
    expect(types).toEqual(expect.arrayContaining(["DOCUMENT_UPLOADED", "DOCUMENT_READY", "QA_ASKED", "QA_ANSWERED"]));
    expect(t.repos.audit._raw.auds.every((a) => a.traceId)).toBe(true);
  });
});

describe("operational basics", () => {
  test("/health is public; /ready reports checks", async () => {
    expect((await api("get", "/health")).status).toBe(200);
    const ready = await api("get", "/ready");
    expect(ready.status).toBe(200);
    expect(ready.body.checks).toEqual({ database: "up", storage: "up" });
    expect(ready.body.dependencies.enterpriseApi).toBe("up");
  });
  test("/ready returns 503 when the database is down", async () => {
    await t.close();
    t = await createTestApp({ checkDb: async () => { throw new Error("db down"); } });
    const res = await api("get", "/ready");
    expect(res.status).toBe(503);
    expect(res.body.checks.database).toBe("down");
  });
  test("unknown routes use the standard 404 shape; unexpected errors never leak internals", async () => {
    const res = await api("get", "/nope", "user");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
  test("logs never contain secrets, tokens, or user question/document text", async () => {
    const secretQuestion = "CONFIDENTIAL-SENTINEL pump lockout tagout";
    await uploadDoc("user", SOP.replace("Pump", "DOCTEXT-SENTINEL Pump"));
    await api("post", "/qa/ask", "user").set("Authorization", "Bearer super-secret-token").send({ question: secretQuestion });
    const a = await proposedAction("reviewer");
    await api("post", `/actions/${a.id}/approve`, "reviewer2").send({});
    const all = t.logs.join("\n");
    expect(all).not.toContain("CONFIDENTIAL-SENTINEL");
    expect(all).not.toContain("DOCTEXT-SENTINEL");
    expect(all).not.toContain("super-secret-token");
    expect(all).not.toContain("test-mock-key");
    t.logs.forEach((l) => expect(() => JSON.parse(l)).not.toThrow()); // every line is valid JSON
  });
});
