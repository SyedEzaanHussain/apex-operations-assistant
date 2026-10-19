import { useState } from "react";
import ErrorNotice from "./ErrorNotice";

export default function AskPanel({ api, onActionProposed }) {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState({ phase: "idle" }); // idle | loading | answer | empty | error

  const submit = async (e) => {
    e?.preventDefault();
    if (state.phase === "loading") return;
    setState({ phase: "loading" });
    try {
      const qa = await api.ask(question);
      setState({ phase: "answer", qa });
      if (qa.proposedAction && onActionProposed) onActionProposed(qa.proposedAction);
    } catch (err) {
      setState(err.code === "NO_READY_DOCUMENTS" ? { phase: "empty", error: err } : { phase: "error", error: err });
    }
  };

  return (
    <section aria-labelledby="ask-h" className="space-y-4">
      <h2 id="ask-h" className="text-lg font-semibold">Ask a question</h2>
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="apex-question" className="block text-sm">Question about your uploaded documents</label>
        <textarea
          id="apex-question" value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} maxLength={2000}
          className="w-full rounded border border-zinc-600 bg-zinc-900 p-2 text-sm"
        />
        <button type="submit" disabled={state.phase === "loading" || question.trim().length < 3} className="rounded bg-blue-700 px-3 py-1.5 text-sm disabled:opacity-50">
          {state.phase === "loading" ? "Asking…" : "Ask"}
        </button>
      </form>

      <div aria-live="polite">
        {state.phase === "loading" ? <p role="status">Searching documents and generating an answer…</p> : null}

        {state.phase === "empty" ? (
          <div className="rounded border border-zinc-600 p-3 text-sm">
            <p className="font-semibold">Nothing to search yet</p>
            <p>Upload a document in the Documents tab and wait until it shows READY, then ask again.</p>
          </div>
        ) : null}

        {state.phase === "error" ? <ErrorNotice error={state.error} onRetry={submit} /> : null}

        {state.phase === "answer" ? <Answer qa={state.qa} /> : null}
      </div>
    </section>
  );
}

function Answer({ qa }) {
  return (
    <article className="space-y-3 rounded border border-zinc-600 p-3" aria-label="Answer">
      {/* Rendered as plain text: model output is never injected as HTML. */}
      <p className="whitespace-pre-wrap text-sm">{qa.answer}</p>
      {qa.grounded ? (
        <div>
          <h3 className="text-sm font-semibold">Sources ({qa.citations.length})</h3>
          <ol className="mt-1 list-decimal space-y-2 pl-5 text-xs">
            {qa.citations.map((c) => (
              <li key={`${c.chunkId ?? "x"}-${c.ordinal}`}>
                <span className="font-medium">{c.filename}</span>
                <blockquote className="mt-0.5 border-l-2 border-zinc-500 pl-2 opacity-80">{c.snippet}</blockquote>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div role="alert" className="rounded border border-yellow-500 bg-yellow-950 p-2 text-sm text-yellow-100">
          <strong>No sources were cited.</strong> Treat this answer as unverified. Actions cannot be proposed from it.
        </div>
      )}
      {qa.proposedAction ? (
        <p className="rounded bg-zinc-800 p-2 text-sm">
          Proposed action <strong>#{qa.proposedAction.id}</strong> ({qa.proposedAction.actionType}) was sent for reviewer approval. Nothing has been executed.
        </p>
      ) : null}
      <p className="text-xs opacity-70">Trace ID: <code>{qa.traceId}</code> · {qa.latencyMs ?? "?"} ms · provider: {qa.provider}</p>
    </article>
  );
}
