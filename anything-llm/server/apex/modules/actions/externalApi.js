// Client for the (mocked) enterprise system. NEVER throws: it classifies every outcome.
//   OK        -> accepted (possibly an idempotent replay)
//   REJECTED  -> definitively not accepted (4xx other than 408/429)
//   UNCERTAIN -> timeout / network / 5xx / 408 / 429: we cannot know if it was applied
function createExternalApi({ baseUrl, apiKey, timeoutMs, fetchImpl = fetch }) {
  return {
    async submit({ idempotencyKey, actionType, payload, traceId }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${baseUrl}/v1/work-orders`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Idempotency-Key": idempotencyKey,
            "X-Request-Id": traceId || "",
          },
          body: JSON.stringify({ type: actionType, ...payload }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok)
          return { outcome: "OK", externalRef: String(body.id || ""), replay: res.headers.get("idempotent-replay") === "true" };
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)
          return { outcome: "REJECTED", status: res.status, message: String(body.message || `HTTP_${res.status}`).slice(0, 200) };
        return { outcome: "UNCERTAIN", reason: `HTTP_${res.status}` };
      } catch (e) {
        return { outcome: "UNCERTAIN", reason: e.name === "AbortError" ? "EXTERNAL_TIMEOUT" : "EXTERNAL_NETWORK_ERROR" };
      } finally {
        clearTimeout(timer);
      }
    },
    async ping() {
      try {
        const res = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
        return res.ok;
      } catch { return false; }
    },
  };
}
module.exports = { createExternalApi };
