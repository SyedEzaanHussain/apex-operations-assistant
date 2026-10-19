const http = require("http");

const service = process.env.MOCK_SERVICE;
const port = service === "enterprise" ? 4001 : 4000;
const executedByKey = new Map();

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error("Request body exceeds 1 MB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return sendJson(response, 200, { online: true, service });
  }

  if (
    service === "ai" &&
    request.method === "POST" &&
    request.url === "/v1/chat/completions"
  ) {
    if (process.env.MOCK_AI_MODE === "error") {
      return sendJson(response, 503, { error: "Mock AI failure requested." });
    }
    try {
      await readJson(request);
      const content =
        process.env.MOCK_AI_MODE === "no-sources"
          ? "Mock response without source references."
          : "Mock AI response.";
      return sendJson(response, 200, {
        id: "chatcmpl-assessment-mock",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "assessment-mock",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (
    service === "enterprise" &&
    request.method === "POST" &&
    request.url === "/actions"
  ) {
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || !idempotencyKey) {
      return sendJson(response, 400, { error: "Idempotency-Key is required." });
    }
    if (process.env.MOCK_ENTERPRISE_MODE === "error") {
      return sendJson(response, 503, { error: "Mock enterprise failure requested." });
    }

    try {
      const body = await readJson(request);
      const previous = executedByKey.get(idempotencyKey);
      const result =
        previous ||
        {
          id: `mock-${idempotencyKey}`,
          accepted: true,
          actionId: body.actionId,
        };
      executedByKey.set(idempotencyKey, result);

      const delayMs = Number(process.env.MOCK_ENTERPRISE_DELAY_MS || 0);
      if (Number.isFinite(delayMs) && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return sendJson(response, 200, result);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  return sendJson(response, 404, { error: "Not found." });
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "mock_service_started", service, port }));
});
