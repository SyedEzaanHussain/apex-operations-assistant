// Consistent error presentation: what happened + trace id so support can find it in logs.
export default function ErrorNotice({ error, onRetry }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded border border-red-500 bg-red-950 p-3 text-sm text-red-100">
      <p className="font-semibold">{error.message}</p>
      <p className="mt-1 text-xs opacity-80">
        {error.code}
        {error.traceId ? <> · Trace ID: <code>{error.traceId}</code></> : null}
      </p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-2 rounded bg-red-800 px-2 py-1 text-xs hover:bg-red-700">
          Try again
        </button>
      ) : null}
    </div>
  );
}
