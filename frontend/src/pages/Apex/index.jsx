import { useEffect, useMemo, useState } from "react";
import Apex from "@/models/apex";
import DocumentsPanel from "./components/DocumentsPanel";
import AskPanel from "./components/AskPanel";
import ApprovalsPanel from "./components/ApprovalsPanel";
import ErrorNotice from "./components/ErrorNotice";

const TABS = [["documents", "Documents"], ["ask", "Ask"], ["approvals", "Approvals"]];

// Role comes from the SERVER (/apex/me). Hiding buttons here is UX only: the API enforces authorization.
export default function ApexPage() {
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("documents");
  const [refreshKey, setRefreshKey] = useState(0);
  const api = useMemo(() => Apex, []);

  useEffect(() => { api.me().then(setMe).catch(setError); }, [api]);

  if (error) return <main className="p-6 text-white"><ErrorNotice error={error} /></main>;
  if (!me) return <main className="p-6 text-white"><p role="status">Loading…</p></main>;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6 text-white">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Apex Operations Assistant</h1>
        <p className="text-sm">Signed in as <strong>{me.username}</strong> ({me.role})</p>
      </header>
      <div role="tablist" aria-label="Sections" className="flex gap-2 border-b border-zinc-700">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} type="button"
            onClick={() => setTab(id)} className={`px-3 py-2 text-sm ${tab === id ? "border-b-2 border-blue-500 font-semibold" : "opacity-70"}`}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "documents" ? <DocumentsPanel api={api} /> : null}
        {tab === "ask" ? <AskPanel api={api} onActionProposed={() => setRefreshKey((k) => k + 1)} /> : null}
        {tab === "approvals" ? <ApprovalsPanel api={api} role={me.role} refreshKey={refreshKey} /> : null}
      </div>
    </main>
  );
}
