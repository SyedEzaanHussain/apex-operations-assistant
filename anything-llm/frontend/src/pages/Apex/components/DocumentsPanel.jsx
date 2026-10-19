import { useCallback, useEffect, useRef, useState } from "react";
import StatusBadge from "./StatusBadge";
import ErrorNotice from "./ErrorNotice";

const IN_FLIGHT = ["UPLOADED", "PROCESSING"];

export default function DocumentsPanel({ api, pollMs = 2000 }) {
  const [docs, setDocs] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setDocs(await api.listDocuments()); // background refreshes must not wipe an error the user hasn't seen yet
    } catch (e) {
      setError(e);
      setDocs((d) => d ?? []);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  // Poll only while something is still processing.
  const hasInFlight = (docs || []).some((d) => IN_FLIGHT.includes(d.status));
  useEffect(() => {
    if (!hasInFlight) return undefined;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [hasInFlight, load, pollMs]);

  const onUpload = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setError({ code: "VALIDATION_ERROR", message: "Choose a file first" }); return; }
    setUploading(true);
    setError(null);
    try {
      await api.uploadDocument(file);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
    }
  };

  const onRetry = async (id) => {
    try { setError(null); await api.retryDocument(id); await load(); } catch (err) { setError(err); }
  };

  return (
    <section aria-labelledby="docs-h" className="space-y-4">
      <h2 id="docs-h" className="text-lg font-semibold">Documents</h2>
      <form onSubmit={onUpload} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="apex-file" className="block text-sm">Upload a document (.txt, .md, .csv, .json — max 2 MB)</label>
          <input id="apex-file" ref={fileRef} type="file" accept=".txt,.md,.csv,.json" className="text-sm" />
        </div>
        <button type="submit" disabled={uploading} className="rounded bg-blue-700 px-3 py-1.5 text-sm disabled:opacity-50">
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </form>
      <ErrorNotice error={error} />
      {docs === null ? (
        <p role="status">Loading documents…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm opacity-80">No documents yet. Upload an operational document to start asking questions.</p>
      ) : (
        <ul className="divide-y divide-zinc-700 rounded border border-zinc-700">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <p className="font-medium">{d.filename}</p>
                <p className="text-xs opacity-70">{d.sizeBytes} bytes · uploaded {new Date(d.createdAt).toLocaleString()}</p>
                {d.status === "FAILED" ? (
                  <p role="alert" className="mt-1 text-xs text-red-300">
                    Processing failed: {d.failureMessage} ({d.failureCode}) — attempt {d.attempts}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={d.status} />
                {d.status === "FAILED" ? (
                  <button type="button" onClick={() => onRetry(d.id)} className="rounded bg-zinc-700 px-2 py-1 text-xs">
                    Retry processing
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
