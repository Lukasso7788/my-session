import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// Admin panel for the one-time Founding Member thank-you email.
// Preview → test to yourself → send to everyone in small batches. The server
// records every send, so a second run only reaches people who did not get it.

const ADMIN_API = "/api/livekit/admin";

type Counts = {
  foundingMembers: number;
  recipients: number;
  alreadySent: number;
  failed: number;
  inProgress: number;
  notSentYet: number;
  missingEmail: number;
  optedOut: number;
  banned: number;
};

type Preview = {
  subject: string;
  html: string;
  counts: Counts;
  ledgerAvailable: boolean;
  missing: string[];
  confirmPhrase: string;
  batchMax: number;
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
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text };
  }
  if (!res.ok) throw new Error(String(json?.error || json?.message || `Request failed: ${res.status}`));
  return json;
}

export default function FoundingThanksEmailPanel() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "test" | "send">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [phrase, setPhrase] = useState("");
  const [progress, setProgress] = useState<{ sent: number; failed: number; remaining: number } | null>(null);
  const stopRef = useRef(false);

  const loadPreview = async () => {
    setBusy("preview");
    setError("");
    try {
      setPreview((await callAdmin("founding_thanks_preview")) as Preview);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy("");
    }
  };

  const sendTest = async () => {
    setBusy("test");
    setError("");
    setMessage("");
    try {
      const result = await callAdmin("founding_thanks_send_test");
      setMessage(`Test sent to ${result.to}.`);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy("");
    }
  };

  const sendAll = async () => {
    if (!preview) return;
    const confirmed = window.confirm(
      `Send the thank-you email to ${preview.counts.notSentYet} Founding Members? Everyone gets it once; people who already got it are skipped.`,
    );
    if (!confirmed) return;

    stopRef.current = false;
    setBusy("send");
    setError("");
    setMessage("");
    let sent = 0;
    let failed = 0;
    let remaining = preview.counts.notSentYet;
    setProgress({ sent, failed, remaining });
    try {
      while (!stopRef.current) {
        const batch = await callAdmin("founding_thanks_send_batch", {
          confirmPhrase: phrase.trim(),
          limit: preview.batchMax,
        });
        sent += Number(batch.sent || 0);
        failed += Number(batch.failed || 0);
        remaining = Number(batch.remaining || 0);
        setProgress({ sent, failed, remaining });
        if (Array.isArray(batch.errors) && batch.errors.length) setError(`Some sends failed: ${batch.errors[0]}`);
        // Stop when done, or when a batch made no progress (only failing or busy rows left).
        if (remaining <= 0 || Number(batch.sent || 0) === 0) break;
      }
      setMessage(stopRef.current ? "Stopped. Run again to continue where it left off." : "Done.");
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy("");
      void loadPreview();
    }
  };

  const counts = preview?.counts;
  const canSend =
    !!preview &&
    preview.ledgerAvailable &&
    preview.missing.length === 0 &&
    preview.counts.notSentYet > 0 &&
    phrase.trim() === preview.confirmPhrase &&
    !busy;

  return (
    <section id="founding-thanks" className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/50 p-5">
      <h2 className="text-lg font-semibold">Founding Members · one-time thank-you</h2>
      <p className="mt-1 max-w-3xl text-sm text-[#555]">
        Thanks every active Founding Member Pro account for showing up while MySession was rebuilt and invites them back to a
        session. Each person gets it once; people who switched lifecycle email off are left out.
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" disabled={!!busy} onClick={() => void loadPreview()} className="rounded-full border border-[#2F2F2F] bg-white px-5 py-2 text-sm font-semibold disabled:opacity-50">
          {busy === "preview" ? "Loading…" : "Preview email and audience"}
        </button>
        <button type="button" disabled={!!busy || !preview || !!preview.missing.length} onClick={() => void sendTest()} className="rounded-full border border-emerald-600 bg-emerald-50 px-5 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50">
          {busy === "test" ? "Sending test…" : "Send test to me"}
        </button>
      </div>

      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
      {message ? <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p> : null}

      {preview && counts ? (
        <>
          {preview.missing.length ? (
            <p role="alert" className="mt-3 text-sm text-red-700">Missing server configuration: {preview.missing.join(", ")}</p>
          ) : null}
          {!preview.ledgerAvailable ? (
            <p role="alert" className="mt-3 text-sm text-red-700">
              Apply migration 20261015090000_one_time_email_sends.sql first; sending is disabled until the send log exists.
            </p>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ["Founding Members", counts.foundingMembers],
              ["Will receive", counts.recipients],
              ["Already sent", counts.alreadySent],
              ["Not sent yet", counts.notSentYet],
              ["Failed", counts.failed],
              ["Lifecycle email off", counts.optedOut],
              ["No email / blocked", counts.missingEmail + counts.banned],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-black/10 bg-white px-3 py-2">
                <div className="text-[18px] font-bold tabular-nums">{value}</div>
                <div className="text-[11px] text-[#666]">{label}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-black/10 bg-white p-3">
            <label className="block text-sm">
              <span className="font-semibold">Type “{preview.confirmPhrase}” to enable sending</span>
              <input
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                className="mt-2 h-10 w-full max-w-md rounded-xl border border-black/15 px-3 text-sm outline-none focus:ring-2 focus:ring-black/15"
                placeholder={preview.confirmPhrase}
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" disabled={!canSend} onClick={() => void sendAll()} className="rounded-full bg-[#2F2F2F] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {busy === "send" ? "Sending…" : `Send to ${counts.notSentYet} Founding Members`}
              </button>
              {busy === "send" ? (
                <button type="button" onClick={() => { stopRef.current = true; }} className="rounded-full border border-black/15 bg-white px-4 py-2 text-sm font-semibold">
                  Stop after this batch
                </button>
              ) : null}
              {progress ? (
                <span className="text-sm text-[#555]">
                  Sent {progress.sent} · Failed {progress.failed} · Remaining {progress.remaining}
                </span>
              ) : null}
            </div>
          </div>

          <p className="mb-2 mt-4 text-sm font-semibold">{preview.subject}</p>
          <iframe title="Founding Member thank-you email preview" sandbox="" srcDoc={preview.html} className="h-[720px] w-full rounded-xl border bg-white" />
        </>
      ) : null}
    </section>
  );
}
