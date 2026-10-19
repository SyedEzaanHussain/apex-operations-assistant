import { useCallback, useEffect, useState } from "react";
import StatusBadge from "./StatusBadge";
import ErrorNotice from "./ErrorNotice";

const canReview = (role) => role === "reviewer" || role === "admin";

export default function ApprovalsPanel({ api, role, refreshKey = 0 }) {
  const [actions, setActions] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadList = useCallback(async () => {
    try { setActions(await api.listActions()); } catch (e) { setError(e); setActions((a) => a ?? []); }
  }, [api]);

  const loadDetail = useCallback(async (id) => {
    try {
      const [a, h] = await Promise.all([api.getAction(id), api.actionHistory(id)]);
      setDetail(a); setHistory(h);
    } catch (e) { setError(e); }
  }, [api]);

  useEffect(() => { loadList(); }, [loadList, refreshKey]);
  useEffect(() => { if (selectedId != null) loadDetail(selectedId); }, [selectedId, loadDetail]);

  // One in-flight request at a time: no double submits from the UI (the server is idempotent anyway).
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { setError(null); await fn(); }
    catch (e) { setError(e); } // e.g. 403 FORBIDDEN from the server is shown, never swallowed
    finally { setBusy(false); await loadList(); if (selectedId != null) await loadDetail(selectedId); }
  };

  return (
    <section aria-labelledby="appr-h" className="space-y-4">
      <h2 id="appr-h" className="text-lg font-semibold">Approvals</h2>
      <ErrorNotice error={error} />
      {actions === null ? (
        <p role="status">Loading actions…</p>
      ) : actions.length === 0 ? (
        <p className="text-sm opacity-80">No proposed actions yet. Ask a question that suggests a follow-up (for example, scheduling maintenance).</p>
      ) : (
        <ul className="divide-y divide-zinc-700 rounded border border-zinc-700">
          {actions.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setSelectedId(a.id)} aria-pressed={selectedId === a.id}
                className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-zinc-800">
                <span>
                  <span className="font-medium">#{a.id} {a.payload?.title}</span>
                  <span className="block text-xs opacity-70">{a.actionType} · proposed by {a.source === "AI" ? "AI" : "user"}</span>
                </span>
                <StatusBadge status={a.status} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {detail ? (
        <article className="space-y-3 rounded border border-zinc-600 p-3" aria-label={`Action ${detail.id} details`}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">#{detail.id} {detail.payload?.title}</h3>
            <StatusBadge status={detail.status} />
          </div>
          <p className="text-sm">{detail.payload?.description || "No description"} · Priority {detail.payload?.priority}</p>
          {detail.qaRequest ? (
            <details className="text-sm">
              <summary className="cursor-pointer">Why was this proposed? (question, answer, sources)</summary>
              <p className="mt-1"><strong>Q:</strong> {detail.qaRequest.question}</p>
              <p><strong>A:</strong> {detail.qaRequest.answer}</p>
              <ul className="list-disc pl-5 text-xs">
                {detail.qaRequest.citations.map((c) => <li key={c.ordinal}>{c.filename}</li>)}
              </ul>
            </details>
          ) : null}
          {detail.externalRef ? <p className="text-sm">External reference: <code>{detail.externalRef}</code></p> : null}
          {detail.lastError ? <p className="text-xs text-orange-300">Last error: {detail.lastError}</p> : null}

          {detail.status === "UNKNOWN" ? (
            <p role="status" className="text-sm text-orange-200">
              The external system did not confirm this action. Retrying is safe — the same idempotency key is reused, so it cannot create a duplicate.
            </p>
          ) : null}

          {canReview(role) ? (
            <div className="space-y-2">
              {detail.status === "PENDING_REVIEW" ? (
                <>
                  <label htmlFor="apex-note" className="block text-sm">Review note (optional)</label>
                  <input id="apex-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="w-full rounded border border-zinc-600 bg-zinc-900 p-1.5 text-sm" />
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => run(() => api.approve(detail.id, note))} className="rounded bg-green-700 px-3 py-1.5 text-sm disabled:opacity-50">Approve & submit</button>
                    <button type="button" disabled={busy} onClick={() => run(() => api.reject(detail.id, note))} className="rounded bg-red-700 px-3 py-1.5 text-sm disabled:opacity-50">Reject</button>
                  </div>
                </>
              ) : null}
              {["UNKNOWN", "FAILED"].includes(detail.status) ? (
                <button type="button" disabled={busy} onClick={() => run(() => api.retryAction(detail.id))} className="rounded bg-orange-700 px-3 py-1.5 text-sm disabled:opacity-50">Retry submission</button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm opacity-80">Only reviewers can approve or reject actions.</p>
          )}

          <div>
            <h4 className="text-sm font-semibold">History</h4>
            <ol className="mt-1 space-y-1 text-xs">
              {history.map((h) => (
                <li key={h.id}>{new Date(h.createdAt).toLocaleString()} — {h.eventType.replace("ACTION_", "")}{h.actorRole ? ` by ${h.actorRole}` : ""} <span className="opacity-60">(trace {h.traceId.slice(0, 8)})</span></li>
              ))}
            </ol>
          </div>
        </article>
      ) : null}
    </section>
  );
}
