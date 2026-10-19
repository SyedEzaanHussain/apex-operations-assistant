// Central, validated configuration. Reads env once; never logs secret values.
const path = require("path");

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`[apex] ${name} must be a positive integer`);
  return n;
}

function loadConfig(env = process.env) {
  const prev = process.env;
  process.env = env;
  try {
    const nodeEnv = env.NODE_ENV || "development";
    const faultInjection = env.APEX_ENABLE_FAULT_INJECTION === "true";
    // The Docker image runs with NODE_ENV=production, so a deliberate second flag is required
    // to enable the demo fault hooks there. Never set APEX_DEMO_MODE on a real deployment.
    if (faultInjection && nodeEnv === "production" && env.APEX_DEMO_MODE !== "true")
      throw new Error(
        "[apex] APEX_ENABLE_FAULT_INJECTION must not be enabled in production (set APEX_DEMO_MODE=true only for demos)"
      );

    const ragProvider = env.APEX_RAG_PROVIDER || "mock";
    if (!["mock", "anythingllm"].includes(ragProvider))
      throw new Error("[apex] APEX_RAG_PROVIDER must be mock|anythingllm");

    return Object.freeze({
      nodeEnv,
      faultInjection,
      ragProvider,
      uploadDir:
        env.APEX_UPLOAD_DIR ||
        path.resolve(env.STORAGE_DIR || path.resolve(__dirname, "../storage"), "apex-uploads"),
      maxUploadBytes: int("APEX_MAX_UPLOAD_BYTES", 2 * 1024 * 1024),
      allowedExtensions: ["txt", "md", "csv", "json"],
      chunkSize: int("APEX_CHUNK_SIZE", 600),
      ragTimeoutMs: int("APEX_RAG_TIMEOUT_MS", 15000),
      enterprise: Object.freeze({
        baseUrl: env.APEX_ENTERPRISE_API_URL || "http://localhost:4010",
        apiKey: env.APEX_ENTERPRISE_API_KEY || "",
        timeoutMs: int("APEX_ENTERPRISE_TIMEOUT_MS", 3000),
      }),
      anythingllm: Object.freeze({
        baseUrl: env.APEX_ANYTHINGLLM_URL || "http://localhost:3001",
        apiKey: env.APEX_ANYTHINGLLM_API_KEY || "",
        workspaceSlug: env.APEX_ANYTHINGLLM_WORKSPACE || "apex",
      }),
    });
  } finally {
    process.env = prev;
  }
}

module.exports = { loadConfig };
