// The AI/RAG boundary. The app depends ONLY on this interface:
//   answer({ question, chunks, traceId, signal, faultInjection })
//     -> { answerText, citations: [{documentId?, chunkId?, filename, snippet, score}], suggestedAction? }
// An adapter may throw GatewayError. It can NEVER execute enterprise actions:
// it can only *suggest* one, which is persisted as PENDING_REVIEW.
class GatewayError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const STOP = new Set("the a an of to in on for and or is are was were be by with at as it this that from how what when who which do does can i we you my our".split(" "));
const tokens = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 2 && !STOP.has(t));

function createMockRag() {
  return {
    name: "mock",
    async answer({ question, chunks, signal, faultInjection }) {
      let q = question;
      let forceNoCitations = false;
      if (faultInjection) {
        if (q.includes("[[AI_ERROR]]")) throw new GatewayError("RAG_UPSTREAM_ERROR", "Mock AI upstream failure");
        if (q.includes("[[AI_TIMEOUT]]"))
          await new Promise((_, rej) => signal && signal.addEventListener("abort", () => rej(new GatewayError("RAG_TIMEOUT", "aborted")), { once: true }));
        if (q.includes("[[NO_CITATIONS]]")) forceNoCitations = true;
        q = q.replace(/\[\[[A-Z_]+\]\]/g, "").trim();
      }
      const qt = new Set(tokens(q));
      const scored = chunks
        .map((c) => {
          const ct = tokens(c.content);
          const hits = ct.filter((t) => qt.has(t)).length;
          return { c, score: qt.size ? hits / Math.sqrt(ct.length + 1) : 0 };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      if (forceNoCitations)
        return { answerText: "The procedure is standard and should be followed as usual. (mock: no sources attached)", citations: [] };
      if (scored.length === 0)
        return { answerText: "I could not find this in the uploaded documents.", citations: [] };

      const citations = scored.map(({ c, score }) => ({
        documentId: c.documentId, chunkId: c.id, filename: c.filename,
        snippet: c.content.slice(0, 240), score: Number(score.toFixed(3)),
      }));
      const lead = scored[0].c.content.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
      const out = { answerText: `Based on the uploaded documents: ${lead}`, citations };
      if (/work order|repair|maintenance|schedule/i.test(q))
        out.suggestedAction = { actionType: "CREATE_WORK_ORDER", payload: { title: `Follow up: ${q.slice(0, 80)}`, description: lead.slice(0, 500), priority: "MEDIUM" } };
      else if (/escalate|incident|safety/i.test(q))
        out.suggestedAction = { actionType: "ESCALATE_INCIDENT", payload: { title: `Escalate: ${q.slice(0, 80)}`, description: lead.slice(0, 500), priority: "HIGH" } };
      return out;
    },
  };
}

// Real RAG through AnythingLLM's developer API (workspace chat in "query" mode).
// NOTE: not exercised by automated tests (needs a configured embedder/LLM + API key).
// NOTE: a workspace is shared, so per-user document isolation is NOT enforced in this mode.
function createAnythingLlmRag({ baseUrl, apiKey, workspaceSlug }) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  return {
    name: "anythingllm",
    async answer({ question, traceId, signal }) {
      let res;
      try {
        res = await fetch(`${baseUrl}/api/v1/workspace/${encodeURIComponent(workspaceSlug)}/chat`, {
          method: "POST", headers, signal,
          body: JSON.stringify({ message: question, mode: "query", sessionId: traceId }),
        });
      } catch (e) {
        throw new GatewayError(e.name === "AbortError" ? "RAG_TIMEOUT" : "RAG_UPSTREAM_ERROR", "AnythingLLM unreachable");
      }
      if (!res.ok) throw new GatewayError("RAG_UPSTREAM_ERROR", `AnythingLLM responded ${res.status}`);
      const body = await res.json();
      if (body.error || body.type === "abort" || typeof body.textResponse !== "string")
        throw new GatewayError("RAG_UPSTREAM_ERROR", "AnythingLLM returned no answer");
      const citations = (body.sources || []).map((s, i) => ({
        documentId: null, chunkId: null,
        filename: String(s.title || `source-${i + 1}`),
        snippet: String(s.chunk || "").slice(0, 240),
        score: typeof s.score === "number" ? s.score : 0,
      }));
      return { answerText: body.textResponse, citations };
    },
  };
}

function createRagGateway(config) {
  return config.ragProvider === "anythingllm" ? createAnythingLlmRag(config.anythingllm) : createMockRag();
}

module.exports = { createRagGateway, createMockRag, createAnythingLlmRag, GatewayError };
