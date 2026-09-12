import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getUserEntitlement } from "../lib/entitlements";
import { hasUnlimitedAccess } from "../lib/billing";

type Draft = { title: string; tasks: string[] };
function validDraft(value: any): value is Draft {
  return typeof value?.title === "string" && !!value.title.trim() && value.title.length <= 120 &&
    Array.isArray(value.tasks) && value.tasks.length >= 1 && value.tasks.length <= 30 &&
    value.tasks.every((task: unknown) => typeof task === "string" && !!task.trim() && task.length <= 300);
}

export function GenerateTaskListDialog({ userId, onClose, onCreated }: {
  userId: string;
  onClose: () => void;
  onCreated: (result: { plan: any; items: any[] }) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const approval = useRef<{ id: string; draft: Draft } | null>(null);
  const [goal, setGoal] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [adjustment, setAdjustment] = useState("");
  const [access, setAccess] = useState<"loading" | "pro" | "free" | "error">("loading");
  const [busy, setBusy] = useState<"generate" | "approve" | null>(null);
  const [approvalPending, setApprovalPending] = useState(false);
  const [error, setError] = useState("");
  const editDisabled = !!busy || approvalPending;

  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    void getUserEntitlement(userId).then((entitlement) => {
      if (alive.current) setAccess(hasUnlimitedAccess(entitlement) ? "pro" : "free");
    }).catch(() => { if (alive.current) setAccess("error"); });
    return () => { alive.current = false; };
  }, [userId]);

  const run = async (mode: "generate" | "approve") => {
    if (lock.current || access !== "pro") return;
    if (mode === "generate" && (approval.current || goal.trim().length < 10 || (draft && !validDraft(draft)))) return;
    if (mode === "approve" && !validDraft(draft)) return;
    lock.current = true;
    setBusy(mode);
    setError("");
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session?.access_token || data.session.user.id !== userId) {
        throw new Error("Your session expired. Please log in again.");
      }
      // Freeze the exact approved version until its save is confirmed, including retries.
      if (mode === "approve" && !approval.current && draft) {
        approval.current = { id: crypto.randomUUID(), draft: { title: draft.title.trim(), tasks: draft.tasks.map((task) => task.trim()) } };
        setApprovalPending(true);
      }
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify(mode === "approve"
          ? { action: "task-list-approve", requestId: approval.current!.id, draft: approval.current!.draft }
          : { action: "task-list-generate", goal: goal.trim(), ...(draft ? {
              draft, adjustment: adjustment.trim() || "Create an alternative version for the current goal, preserving my manual edits where appropriate.",
            } : {}) }),
        signal: AbortSignal.timeout(60_000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        // These failures happen before any write. Other failures can be ambiguous.
        if (mode === "approve" && [400, 401, 403].includes(response.status)) {
          approval.current = null;
          if (alive.current) setApprovalPending(false);
        }
        throw new Error(result?.error || "The request failed. Please retry.");
      }
      if (mode === "approve") {
        if (!result?.plan?.id || !Array.isArray(result.items) || !result.items.length) {
          throw new Error("The save could not be confirmed. Retry Approve to recover this list.");
        }
        if (alive.current) onCreated(result);
      } else {
        if (!validDraft(result?.draft)) throw new Error("AI returned an incomplete draft. Please retry.");
        if (alive.current) {
          setDraft(result.draft);
          setAdjustment("");
        }
      }
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : "Something went wrong. Please retry.");
    } finally {
      lock.current = false;
      if (alive.current) setBusy(null);
    }
  };

  return (
    <dialog ref={dialog} aria-labelledby="generate-list-title"
      onCancel={(event) => { event.preventDefault(); if (!lock.current) onClose(); }}
      className="max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-[#E4E4E4] bg-white p-6 text-[#2F2F2F] shadow-xl backdrop:bg-black/40">
      <div className="flex items-center justify-between gap-4">
        <h2 id="generate-list-title" className="text-lg font-semibold">{draft ? "Review your plan" : "Generate a task list"} <span className="text-xs text-[#717680]">PRO</span></h2>
        <button type="button" disabled={!!busy} onClick={onClose} aria-label="Close generator" className="rounded p-1 disabled:opacity-40"><X size={20} /></button>
      </div>
      {access === "loading" ? <p role="status" className="mt-4 text-sm">Checking Pro access…</p> : null}
      {access === "error" ? <p role="alert" className="mt-4 text-sm">Could not verify your subscription. Close this window and try again.</p> : null}
      {access === "free" ? <div className="mt-4 text-sm">
        <p>Turn a goal into a ready-to-use task list with MySession Pro.</p>
        <Link to="/pricing" className="mt-4 inline-block rounded-lg bg-[#2F2F2F] px-4 py-2 text-white">Explore Pro</Link>
      </div> : null}
      {access === "pro" ? <div>
        <label htmlFor="task-list-goal" className="mt-5 block text-sm font-medium">What do you want to achieve?</label>
        <p id="task-list-goal-help" className="mt-1 text-xs leading-5 text-[#717680]">Describe your goal, purpose and constraints. You can refine this goal at any time before approval.</p>
        <textarea id="task-list-goal" aria-describedby="task-list-goal-help" maxLength={2000}
          rows={3} value={goal} disabled={editDisabled} onChange={(event) => setGoal(event.target.value)}
          placeholder="I want to prepare for my biology exam in two weeks. I need to review five chapters and practise with past papers."
          className="mt-3 w-full resize-y rounded-lg border border-[#D8D8D8] p-3 text-sm focus:border-[#5E8ED6] disabled:opacity-60" />
        <p className="mt-1 text-xs text-[#717680]">Your goal, draft and adjustment instructions are sent to OpenAI when generating. Avoid sensitive information.</p>
        {draft ? <section aria-label="Editable plan preview" className="mt-5 border-t border-[#E4E4E4] pt-4">
          <p className="mb-3 text-sm text-[#717680]">Not saved yet. Edit the title and tasks below, or ask AI to revise them.</p>
          <label htmlFor="draft-plan-title" className="text-sm font-medium">Plan title</label>
          <input id="draft-plan-title" value={draft.title} maxLength={120} disabled={editDisabled}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            className="mt-1 w-full rounded-lg border border-[#D8D8D8] p-2 text-sm" />
          <ol className="mt-3 space-y-2">
            {draft.tasks.map((task, index) => <li key={index} className="flex items-start gap-2">
              <label htmlFor={`draft-task-${index}`} className="pt-2 text-sm text-[#717680]">{index + 1}.</label>
              <textarea id={`draft-task-${index}`} aria-label={`Task ${index + 1}`} rows={2} maxLength={300} value={task} disabled={editDisabled}
                onChange={(event) => setDraft({ ...draft, tasks: draft.tasks.map((entry, i) => i === index ? event.target.value : entry) })}
                className="min-w-0 flex-1 resize-y rounded-lg border border-[#D8D8D8] p-2 text-sm" />
              <button type="button" disabled={editDisabled || draft.tasks.length === 1}
                onClick={() => setDraft({ ...draft, tasks: draft.tasks.filter((_, i) => i !== index) })}
                aria-label={`Remove task ${index + 1}`} className="rounded p-2 disabled:opacity-30"><Trash2 size={16} /></button>
            </li>)}
          </ol>
          <button type="button" disabled={editDisabled || draft.tasks.length >= 30}
            onClick={() => setDraft({ ...draft, tasks: [...draft.tasks, ""] })}
            className="mt-3 inline-flex items-center gap-1 text-sm disabled:opacity-40"><Plus size={16} /> Add task</button>
          <label htmlFor="plan-adjustment" className="mt-5 block text-sm font-medium">What should change?</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {["Make it more detailed", "Break it into more smaller steps", "Rethink the whole plan"].map((hint) =>
              <button key={hint} type="button" disabled={editDisabled} onClick={() => setAdjustment((current) => (current ? `${current}\n${hint}.` : `${hint}.`).slice(0, 2000))}
                className="rounded-full border border-[#D8D8D8] px-2 py-1 text-xs disabled:opacity-40">{hint}</button>)}
          </div>
          <textarea id="plan-adjustment" rows={3} maxLength={2000} value={adjustment} disabled={editDisabled}
            onChange={(event) => setAdjustment(event.target.value)} placeholder="Keep tasks 1–2, split task 3 into smaller steps, and add practice questions."
            className="mt-2 w-full resize-y rounded-lg border border-[#D8D8D8] p-3 text-sm" />
          <p className="text-xs text-[#717680]">Use Regenerate to apply goal changes and instructions. Approve saves only the title and tasks shown above.</p>
          {!validDraft(draft) ? <p role="status" className="mt-2 text-xs text-red-700">Enter a title and text for every task, or remove empty tasks.</p> : null}
        </section> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
        {approvalPending && !busy ? <p role="status" className="mt-3 text-sm">Your save is not confirmed. Retry Approve before editing or closing to avoid losing track of the saved list.</p> : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={() => void run("generate")} disabled={editDisabled || goal.trim().length < 10 || (!!draft && !validDraft(draft))}
            className="inline-flex items-center gap-2 rounded-lg border border-[#D8D8D8] px-4 py-2.5 text-sm disabled:opacity-40">
            {busy === "generate" ? <Loader2 size={16} className="animate-spin" /> : null}
            {busy === "generate" ? "Generating draft…" : draft ? "Regenerate" : "Generate preview"}
          </button>
          {draft ? <button type="button" onClick={() => void run("approve")} disabled={!!busy || !validDraft(draft)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2F2F2F] px-4 py-2.5 text-sm text-white disabled:opacity-40">
            {busy === "approve" ? <Loader2 size={16} className="animate-spin" /> : null}
            {busy === "approve" ? "Saving…" : approvalPending ? "Retry Approve" : "Approve & add list"}
          </button> : null}
        </div>
        <p role="status" aria-live="polite" className="mt-2 text-xs text-[#717680]">{busy ? "Please keep this window open." : "Nothing is added to Tasks until you approve. Closing an unapproved draft discards it."}</p>
      </div> : null}
    </dialog>
  );
}
