import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

async function parseResponse(response) {
  const body = await response.json();
  const traceId = response.headers.get("X-Request-Id");
  if (traceId && body && typeof body === "object") body.traceId = traceId;
  if (!response.ok) {
    const error = new Error(
      body.error || body.message || `Request failed with status ${response.status}.`
    );
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

const ProposedAction = {
  list: async function () {
    const response = await fetch(`${API_BASE}/actions`, {
      headers: baseHeaders(),
    });
    return parseResponse(response);
  },

  propose: async function ({ workspaceId, chatId = null, payload, idempotencyKey }) {
    const response = await fetch(`${API_BASE}/actions`, {
      method: "POST",
      headers: {
        ...baseHeaders(),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ workspaceId, chatId, payload }),
    });
    return parseResponse(response);
  },

  approve: async function (id) {
    const response = await fetch(`${API_BASE}/actions/${id}/approve`, {
      method: "POST",
      headers: baseHeaders(),
    });
    return parseResponse(response);
  },

  reject: async function (id, reason = "") {
    const response = await fetch(`${API_BASE}/actions/${id}/reject`, {
      method: "POST",
      headers: { ...baseHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    return parseResponse(response);
  },

  retry: async function (id) {
    const response = await fetch(`${API_BASE}/actions/${id}/retry`, {
      method: "POST",
      headers: baseHeaders(),
    });
    return parseResponse(response);
  },
};

export default ProposedAction;
