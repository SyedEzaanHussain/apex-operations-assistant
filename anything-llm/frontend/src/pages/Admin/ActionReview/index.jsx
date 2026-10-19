import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise, Check, X } from "@phosphor-icons/react";
import ProposedAction from "@/models/proposedAction";
import System from "@/models/system";
import showToast from "@/utils/toast";

const STATUS_STYLES = {
  proposed: "text-amber-300",
  approved: "text-sky-300",
  rejected: "text-red-400",
  executing: "text-sky-300",
  executed: "text-green-400",
  failed: "text-red-400",
  unknown: "text-amber-300",
};

export default function ActionReview() {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [traceId, setTraceId] = useState(null);
  const [multiUserMode, setMultiUserMode] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { actions: results, traceId: requestId } =
        await ProposedAction.list();
      setActions(results);
      setTraceId(requestId || null);
    } catch (error) {
      showToast(`Unable to load action review queue: ${error.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    System.keys()
      .then(({ MultiUserMode }) => {
        if (!active) return;
        setMultiUserMode(MultiUserMode);
        if (MultiUserMode) refresh();
        else setLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        setLoading(false);
        showToast(`Unable to check action review availability: ${error.message}`, "error");
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  const transition = async (action, operation) => {
    setBusyId(action.id);
    try {
      const result = await ProposedAction[operation](action.id);
      setTraceId(result.traceId || null);
      showToast(
        result.message ||
          (operation === "approve"
            ? `Action ${action.id} approved.`
            : operation === "reject"
              ? `Action ${action.id} rejected.`
              : `Action ${action.id} retry started.`),
        "success"
      );
      await refresh();
    } catch (error) {
      const actionState = error.body?.action;
      setTraceId(error.body?.traceId || null);
      await refresh();
      if (actionState?.status === "unknown") {
        showToast(
          error.body.message ||
            "The external result is unknown. Retry with the same action ID.",
          "warning"
        );
      } else {
        showToast(
          error.body?.action?.failureReason || error.message,
          "error"
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="w-full h-full p-6 overflow-y-auto">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-theme-text-primary">
            Action review
          </h1>
          <p className="text-sm text-theme-text-secondary mt-1">
            Review proposed actions before they reach the configured external system.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-theme-settings-input-bg text-theme-text-primary disabled:opacity-50"
        >
          <ArrowClockwise className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {traceId && (
        <p className="text-xs text-theme-text-secondary mb-4">
          Last request ID: <code>{traceId}</code>
        </p>
      )}

      {multiUserMode === false ? (
        <p className="text-theme-text-secondary">
          Action review is available only when multi-user mode is enabled.
        </p>
      ) : loading && actions.length === 0 ? (
        <p className="text-theme-text-secondary">Loading actions...</p>
      ) : actions.length === 0 ? (
        <p className="text-theme-text-secondary">No proposed actions found.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {actions.map((action) => {
            let payload = action.payload;
            try {
              payload = JSON.stringify(JSON.parse(action.payload), null, 2);
            } catch {
              payload = action.payload;
            }
            const busy = busyId === action.id;
            return (
              <article
                key={action.id}
                className="rounded-xl border border-theme-modal-border bg-theme-settings-input-bg p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <h2 className="font-semibold text-theme-text-primary">
                      Action #{action.id}
                    </h2>
                    <span
                      className={`text-sm capitalize ${STATUS_STYLES[action.status] || "text-theme-text-secondary"}`}
                    >
                      {action.status}
                    </span>
                    <span className="text-xs text-theme-text-secondary">
                      Workspace {action.workspaceId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {action.status === "proposed" && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() => transition(action, "approve")}
                          className="flex items-center gap-1 rounded-lg bg-green-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                        >
                          <Check size={16} />
                          Approve
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => transition(action, "reject")}
                          className="flex items-center gap-1 rounded-lg bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                        >
                          <X size={16} />
                          Reject
                        </button>
                      </>
                    )}
                    {["unknown", "approved"].includes(action.status) && (
                      <button
                        disabled={busy}
                        onClick={() => transition(action, "retry")}
                        className="flex items-center gap-1 rounded-lg bg-sky-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                      >
                        <ArrowClockwise size={16} />
                        Retry
                      </button>
                    )}
                  </div>
                </div>
                <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-black/20 p-3 text-xs text-theme-text-primary whitespace-pre-wrap">
                  {payload}
                </pre>
                {action.failureReason && (
                  <p className="mt-2 text-sm text-red-400">
                    {action.failureReason}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
