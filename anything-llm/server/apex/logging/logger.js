// Minimal structured (JSON-lines) logger with secret redaction.
// Never pass raw request bodies, document text or questions here: log sizes/ids only.
const REDACT = /authorization|token|password|secret|api[-_]?key|cookie/i;

function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value))
    out[k] = REDACT.test(k) ? "[REDACTED]" : redact(v, depth + 1);
  return out;
}

function createLogger({ write = (line) => process.stdout.write(line + "\n"), base = {} } = {}) {
  const emit = (level, event, fields = {}) =>
    write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        service: "apex",
        event,
        ...base,
        ...redact(fields),
      })
    );
  return {
    info: (e, f) => emit("info", e, f),
    warn: (e, f) => emit("warn", e, f),
    error: (e, f) => emit("error", e, f),
    child: (extra) => createLogger({ write, base: { ...base, ...extra } }),
  };
}

module.exports = { createLogger, redact };
