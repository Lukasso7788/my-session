import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

type EventRow = { id: string; event_type: string; status: string; attempts: number; next_attempt_at: string; last_error: string | null; created_at: string; sent_at: string | null };

export default function SenderEmailAdminPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const call = useCallback(async (id?: string) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) return navigate("/login?next=/admin/sender-email");
    const response = await fetch("/api/livekit/admin", {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: id ? "sender_outbox_retry" : "sender_outbox_list",
        ...(id ? { senderEventId: id } : {}),
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load Sender events.");
    setRows(payload.events || []);
  }, [navigate]);

  useEffect(() => { void call().catch((e) => setError(e.message)).finally(() => setLoading(false)); }, [call]);

  return <main className="min-h-screen bg-[#F7F8FA] px-5 py-10 text-[#2F2F2F]"><div className="mx-auto max-w-7xl">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-[0.16em] text-[#4AAE55]">MySession Admin</div><h1 className="mt-2 text-3xl font-bold">Sender lifecycle email</h1><p className="mt-2 text-sm text-black/55">Outbox diagnostics without displaying recipient emails or event payloads.</p></div><div className="flex gap-2"><Link to="/admin" className="rounded-full border border-black/15 px-4 py-2 text-sm">Admin</Link><button onClick={() => void call()} className="rounded-full bg-[#2F2F2F] px-4 py-2 text-sm text-white">Refresh</button></div></div>
    {error ? <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
    <div className="mt-7 overflow-x-auto rounded-2xl border border-black/10 bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-black/[0.03] text-xs uppercase tracking-wide text-black/50"><tr><th className="p-4">Event</th><th className="p-4">Status</th><th className="p-4">Attempts</th><th className="p-4">Created</th><th className="p-4">Last error</th><th className="p-4"></th></tr></thead><tbody>{loading ? <tr><td className="p-5" colSpan={6}>Loading…</td></tr> : rows.map((row) => <tr key={row.id} className="border-t border-black/5"><td className="p-4 font-medium">{row.event_type}</td><td className="p-4"><span className="rounded-full bg-black/[0.05] px-2 py-1 text-xs">{row.status}</span></td><td className="p-4">{row.attempts}</td><td className="p-4 text-xs text-black/55">{new Date(row.created_at).toLocaleString()}</td><td className="max-w-sm truncate p-4 text-xs text-red-700" title={row.last_error || ""}>{row.last_error || "—"}</td><td className="p-4">{["failed","dead"].includes(row.status) ? <button onClick={() => void call(row.id)} className="rounded-full border border-black/15 px-3 py-1.5 text-xs">Retry</button> : null}</td></tr>)}</tbody></table></div>
  </div></main>;
}
