import { useState } from "react";
import { supabase } from "../lib/supabase";

// Admin: "Come back today" invite. Today's schedule, sent to people who signed
// up or attended a session yesterday (UTC days), with an intro for each.
// Same Plunk delivery, unsubscribe and one-email-per-day ledger as the daily
// schedule email. The morning cron can send it too:
//   GET /api/livekit/admin?cronAction=daily_schedule_send_yesterday  (X-Cron-Secret)

const ADMIN_API = "/api/livekit/admin";

type Recipient = { userId: string; email: string; name: string; timeZone: string | null; introKind: "new" | "returning" | null };
type Preview = {
  scheduleDate: string;
  yesterday: string;
  counts: { registeredYesterday: number; attendedYesterday: number; newcomers: number; returning: number };
  selectedCount: number;
  selected: Recipient[];
  samples?: { kind: "new" | "returning"; subject: string; html: string }[];
};

async function callAdmin(action: string, extra: Record<string, unknown> = {}) {
  const { data } = await supabase.auth.getSession();
  const token = String(data.session?.access_token || "").trim();
  if (!token) throw new Error("Sign in again to continue.");
  const res = await fetch(ADMIN_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...extra }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json?.error || json?.message || `Request failed: ${res.status}`));
  return json;
}

export default function YesterdayInvitePanel() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sample, setSample] = useState<"new" | "returning">("new");
  const [busy, setBusy] = useState<"" | "preview" | "send">("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadPreview = async () => {
    setBusy("preview");
    setError("");
    setMessage("");
    try {
      const result = (await callAdmin("daily_schedule_yesterday_preview")) as Preview;
      setPreview(result);
      setSample(result.samples?.[0]?.kind || "new");
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy("");
    }
  };

  const send = async () => {
    if (!preview) return;
    if (!window.confirm(`Send today's invite to ${preview.selectedCount} people from yesterday?`)) return;
    setBusy("send");
    setError("");
    try {
      const result = await callAdmin("daily_schedule_send_yesterday");
      setMessage(`Sent ${result.sentCount || 0}${result.failedCount ? `, failed ${result.failedCount}` : ""}.`);
      await loadPreview();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy("");
    }
  };

  const shown = preview?.samples?.find((item) => item.kind === sample) || preview?.samples?.[0];

  return (
    <section id="yesterday-invite" className="mt-6 rounded-2xl border border-[#5286F6]/30 bg-[#F4F8FF] p-5">
      <h2 className="text-lg font-semibold">Come back today · yesterday’s people</h2>
      <p className="mt-1 max-w-3xl text-sm text-[#555]">
        Today’s schedule for people who signed up yesterday (“Your first session is one click away”) or came to a session yesterday
        (“Good to see you yesterday”). People who switched daily emails off, or already got today’s schedule, are skipped.
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" disabled={!!busy} onClick={() => void loadPreview()} className="rounded-full border border-[#2F2F2F] bg-white px-5 py-2 text-sm font-semibold disabled:opacity-50">
          {busy === "preview" ? "Loading…" : "Preview audience and email"}
        </button>
        <button
          type="button"
          disabled={!!busy || !preview || preview.selectedCount === 0}
          onClick={() => void send()}
          className="rounded-full bg-[#2F2F2F] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy === "send" ? "Sending…" : preview ? `Send to ${preview.selectedCount} people` : "Send"}
        </button>
      </div>

      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
      {message ? <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p> : null}

      {preview ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Signed up yesterday", preview.counts.registeredYesterday],
              ["Came yesterday", preview.counts.attendedYesterday],
              ["Will receive", preview.selectedCount],
              ["Schedule for", preview.scheduleDate],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-black/10 bg-white px-3 py-2">
                <div className="text-[18px] font-bold tabular-nums">{value}</div>
                <div className="text-[11px] text-[#666]">{label}</div>
              </div>
            ))}
          </div>

          {preview.selected.length ? (
            <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-black/10 bg-white">
              {preview.selected.map((person) => (
                <div key={person.userId} className="flex items-center justify-between gap-3 border-b border-black/5 px-3 py-2 text-sm last:border-0">
                  <span className="min-w-0 truncate">
                    <b>{person.name}</b> <span className="text-[#777]">{person.email}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${person.introKind === "new" ? "bg-[#EDF5FF] text-[#245FBD]" : "bg-[#EAF8ED] text-[#16803B]"}`}>
                    {person.introKind === "new" ? "Signed up" : "Came back"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[#666]">Nobody to invite today.</p>
          )}

          {shown ? (
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {(preview.samples || []).map((item) => (
                  <button
                    key={item.kind}
                    type="button"
                    onClick={() => setSample(item.kind)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${sample === item.kind ? "bg-[#2F2F2F] text-white" : "bg-white text-[#555] border border-black/10"}`}
                  >
                    {item.kind === "new" ? "Signed up yesterday" : "Came yesterday"}
                  </button>
                ))}
                <span className="text-sm font-semibold">{shown.subject}</span>
              </div>
              <iframe title="Come back today email preview" sandbox="" srcDoc={shown.html} className="h-[720px] w-full rounded-xl border bg-white" />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
