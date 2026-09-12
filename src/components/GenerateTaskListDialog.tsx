import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getUserEntitlement } from "../lib/entitlements";
import { hasUnlimitedAccess } from "../lib/billing";

export function GenerateTaskListDialog({ userId, onClose, onCreated }: {
  userId: string;
  onClose: () => void;
  onCreated: (result: { plan: any; items: any[] }) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const request = useRef({ goal: "", id: crypto.randomUUID() });
  const [goal, setGoal] = useState("");
  const [access, setAccess] = useState<"loading" | "pro" | "free" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    void getUserEntitlement(userId).then((entitlement) => {
      if (alive.current) setAccess(hasUnlimitedAccess(entitlement) ? "pro" : "free");
    }).catch(() => { if (alive.current) setAccess("error"); });
    return () => { alive.current = false; };
  }, [userId]);

  const generate = async () => {
    if (lock.current || access !== "pro" || goal.trim().length < 10) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const text = goal.trim();
    if (request.current.goal !== text) request.current = { goal: text, id: crypto.randomUUID() };
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session?.access_token || data.session.user.id !== userId) {
        throw new Error("Your session expired. Please log in again.");
      }
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ action: "task-list-generate", goal: text, requestId: request.current.id }),
        signal: AbortSignal.timeout(60_000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Could not generate the list. Please retry.");
      if (!result?.plan?.id || !Array.isArray(result.items) || !result.items.length) {
        throw new Error("The list could not be confirmed. Please retry.");
      }
      if (alive.current) onCreated(result);
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : "Something went wrong. Please retry.");
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} aria-labelledby="generate-list-title"
      onCancel={(event) => { event.preventDefault(); if (!lock.current) onClose(); }}
      className="w-[calc(100%_-_2rem)] max-w-lg rounded-2xl border border-[#E4E4E4] bg-white p-6 text-[#2F2F2F] shadow-xl backdrop:bg-black/40">
      <div className="flex items-center justify-between gap-4">
        <h2 id="generate-list-title" className="text-lg font-semibold">Generate a task list <span className="text-xs text-[#717680]">PRO</span></h2>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Close generator" className="rounded p-1 disabled:opacity-40"><X size={20} /></button>
      </div>
      {access === "loading" ? <p role="status" className="mt-4 text-sm">Checking Pro access…</p> : null}
      {access === "error" ? <p role="alert" className="mt-4 text-sm">Could not verify your subscription. Close this window and try again.</p> : null}
      {access === "free" ? <div className="mt-4 text-sm">
        <p>Turn a goal into a ready-to-use task list with MySession Pro.</p>
        <Link to="/pricing" className="mt-4 inline-block rounded-lg bg-[#2F2F2F] px-4 py-2 text-white">Explore Pro</Link>
      </div> : null}
      {access === "pro" ? <form onSubmit={(event) => { event.preventDefault(); void generate(); }}>
        <label htmlFor="task-list-goal" className="mt-5 block text-sm font-medium">What do you want to achieve?</label>
        <p id="task-list-goal-help" className="mt-1 text-xs leading-5 text-[#717680]">Describe your goal, why it matters, and any constraints. We’ll create a title and 3–12 actionable tasks in your language.</p>
        <textarea id="task-list-goal" aria-describedby="task-list-goal-help" autoFocus required minLength={10} maxLength={2000}
          rows={5} value={goal} disabled={busy} onChange={(event) => setGoal(event.target.value)}
          placeholder="I want to prepare for my biology exam in two weeks. I need to review five chapters and practise with past papers."
          className="mt-3 w-full resize-y rounded-lg border border-[#D8D8D8] p-3 text-sm outline-none focus:border-[#5E8ED6] disabled:opacity-60" />
        <p className="mt-1 text-xs text-[#717680]">Your description is sent to OpenAI. Avoid including sensitive information.</p>
        {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
        <button type="submit" disabled={busy || goal.trim().length < 10}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#2F2F2F] px-4 py-2.5 text-sm text-white disabled:opacity-40">
          {busy ? <Loader2 size={16} className="animate-spin" /> : null}
          {busy ? "Generating and saving…" : "Generate task list"}
        </button>
        <p role="status" aria-live="polite" className="mt-2 text-xs text-[#717680]">{busy ? "Please keep this window open while your list is created." : "The new list is saved automatically. You can edit every task afterward."}</p>
      </form> : null}
    </dialog>
  );
}
