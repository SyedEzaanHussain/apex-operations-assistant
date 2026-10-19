import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

// Thin client for the Apex API. Every failure becomes an ApexError carrying the
// server's error code and trace id, so the UI can show a useful, supportable message.
export class ApexError extends Error {
  constructor({ status, code, message, traceId }) {
    super(message);
    this.status = status;
    this.code = code;
    this.traceId = traceId;
  }
}

async function request(path, { method = "GET", body, headers = {}, formData } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/apex${path}`, {
      method,
      headers: {
        ...baseHeaders(),
        ...(formData ? {} : body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: formData ? formData : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApexError({ status: 0, code: "NETWORK_ERROR", message: "Cannot reach the server. Check your connection and try again." });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.error || {};
    throw new ApexError({
      status: res.status,
      code: e.code || "UNKNOWN_ERROR",
      message: e.message || "Something went wrong",
      traceId: e.traceId || res.headers.get("x-request-id") || undefined,
    });
  }
  return json;
}

const Apex = {
  me: async () => (await request("/me")).user,
  listDocuments: async () => (await request("/documents")).documents,
  uploadDocument: async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return (await request("/documents", { method: "POST", formData })).document;
  },
  retryDocument: async (id) => (await request(`/documents/${id}/retry`, { method: "POST" })).document,
  ask: async (question) => (await request("/qa/ask", { method: "POST", body: { question } })).qa,
  listActions: async () => (await request("/actions")).actions,
  getAction: async (id) => (await request(`/actions/${id}`)).action,
  actionHistory: async (id) => (await request(`/actions/${id}/history`)).history,
  approve: async (id, note = "") => (await request(`/actions/${id}/approve`, { method: "POST", body: { note } })).action,
  reject: async (id, note = "") => (await request(`/actions/${id}/reject`, { method: "POST", body: { note } })).action,
  retryAction: async (id) => (await request(`/actions/${id}/retry`, { method: "POST" })).action,
};

export default Apex;
