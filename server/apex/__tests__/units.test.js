const { chunkText } = require("../modules/documentFlow/chunker");
const { createLogger, redact } = require("../logging/logger");
const { loadConfig } = require("../config");
const { createExternalApi } = require("../modules/actions/externalApi");
const { createMockRag } = require("../modules/qa/ragGateway");

describe("chunker", () => {
  test("keeps paragraphs together up to the size and numbers chunks", () => {
    const out = chunkText("aaa\n\nbbb\n\nccc", 8);
    expect(out.map((c) => c.ordinal)).toEqual([0, 1]);
    expect(out[0].content).toBe("aaa\n\nbbb");
  });
  test("splits oversize paragraphs", () => {
    expect(chunkText("x".repeat(25), 10)).toHaveLength(3);
  });
  test("empty text -> no chunks", () => expect(chunkText("  \n\n ", 10)).toEqual([]));
});

describe("logger", () => {
  test("redacts secret-looking keys at any depth", () => {
    expect(redact({ a: 1, headers: { Authorization: "Bearer x", ok: "y" }, apiKey: "k" })).toEqual({ a: 1, headers: { Authorization: "[REDACTED]", ok: "y" }, apiKey: "[REDACTED]" });
  });
  test("emits JSON lines with level/event", () => {
    const lines = [];
    createLogger({ write: (l) => lines.push(l) }).info("hello", { traceId: "t" });
    expect(JSON.parse(lines[0])).toMatchObject({ level: "info", event: "hello", traceId: "t", service: "apex" });
  });
});

describe("config", () => {
  test("refuses fault injection in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", APEX_ENABLE_FAULT_INJECTION: "true" })).toThrow(/production/);
  });
  test("demo mode is an explicit second opt-in", () => {
    expect(loadConfig({ NODE_ENV: "production", APEX_ENABLE_FAULT_INJECTION: "true", APEX_DEMO_MODE: "true" }).faultInjection).toBe(true);
  });
  test("rejects unknown RAG provider and bad integers", () => {
    expect(() => loadConfig({ APEX_RAG_PROVIDER: "nope" })).toThrow();
    expect(() => loadConfig({ APEX_MAX_UPLOAD_BYTES: "-5" })).toThrow();
  });
  test("defaults are safe", () => {
    const c = loadConfig({});
    expect(c.faultInjection).toBe(false);
    expect(c.ragProvider).toBe("mock");
  });
});

describe("externalApi outcome classification", () => {
  const mk = (impl) => createExternalApi({ baseUrl: "http://x", apiKey: "k", timeoutMs: 50, fetchImpl: impl });
  const res = (status, body = {}, headers = {}) => ({ ok: status < 300, status, json: async () => body, headers: { get: (h) => headers[h.toLowerCase()] } });
  const call = (api) => api.submit({ idempotencyKey: "k1", actionType: "CREATE_WORK_ORDER", payload: { title: "t" }, traceId: "tr" });
  test("2xx -> OK (+replay flag)", async () => {
    expect(await call(mk(async () => res(201, { id: "WO-1" })))).toMatchObject({ outcome: "OK", externalRef: "WO-1", replay: false });
    expect(await call(mk(async () => res(200, { id: "WO-1" }, { "idempotent-replay": "true" })))).toMatchObject({ replay: true });
  });
  test("4xx -> REJECTED; 5xx/408/429 -> UNCERTAIN", async () => {
    expect((await call(mk(async () => res(422)))).outcome).toBe("REJECTED");
    for (const s of [500, 503, 408, 429]) expect((await call(mk(async () => res(s)))).outcome).toBe("UNCERTAIN");
  });
  test("timeout and network errors -> UNCERTAIN (never throws)", async () => {
    const slow = mk((url, opts) => new Promise((_, rej) => opts.signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" })))));
    expect(await call(slow)).toEqual({ outcome: "UNCERTAIN", reason: "EXTERNAL_TIMEOUT" });
    expect(await call(mk(async () => { throw new Error("ECONNREFUSED"); }))).toEqual({ outcome: "UNCERTAIN", reason: "EXTERNAL_NETWORK_ERROR" });
  });
  test("sends the idempotency key and auth header", async () => {
    let seen;
    await call(mk(async (u, o) => { seen = o.headers; return res(201, { id: "x" }); }));
    expect(seen["Idempotency-Key"]).toBe("k1");
    expect(seen.Authorization).toBe("Bearer k");
  });
});

describe("mock RAG", () => {
  const chunks = [{ id: 1, documentId: 1, filename: "a.txt", content: "Lockout tagout must be applied before pump repair." }, { id: 2, documentId: 1, filename: "a.txt", content: "Cafeteria opens at noon." }];
  test("retrieves the relevant chunk with a citation", async () => {
    const r = await createMockRag().answer({ question: "lockout before pump repair?", chunks });
    expect(r.citations[0]).toMatchObject({ chunkId: 1, filename: "a.txt" });
  });
  test("fault hooks are ignored unless fault injection is enabled", async () => {
    const r = await createMockRag().answer({ question: "lockout pump [[AI_ERROR]]", chunks, faultInjection: false });
    expect(r.citations.length).toBeGreaterThan(0);
  });
});
