const STYLES = {
  READY: "bg-green-900 text-green-100", EXECUTED: "bg-green-900 text-green-100", APPROVED: "bg-blue-900 text-blue-100",
  UPLOADED: "bg-zinc-700 text-zinc-100", PROCESSING: "bg-blue-900 text-blue-100", EXECUTING: "bg-blue-900 text-blue-100",
  PENDING_REVIEW: "bg-yellow-900 text-yellow-100", UNKNOWN: "bg-orange-900 text-orange-100",
  FAILED: "bg-red-900 text-red-100", REJECTED: "bg-red-900 text-red-100",
};
// Status is conveyed by TEXT, never by color alone (accessibility).
export default function StatusBadge({ status }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${STYLES[status] || "bg-zinc-700 text-zinc-100"}`}>
      {String(status).replace("_", " ")}
    </span>
  );
}
