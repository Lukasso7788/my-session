import { useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useSpeechDictation } from "../../hooks/useSpeechDictation";
import {
  buildLocalAiPreview,
  requestSessionAiPreview,
  type SessionAiPhase,
  type SessionAiPreview,
} from "./reply";

type PanelTheme = "light" | "dark";

const PHASES: Array<{ id: SessionAiPhase; label: string; placeholder: string }> = [
  { id: "intention", label: "Start", placeholder: "I’m going to work on…" },
  { id: "checkin", label: "Check in", placeholder: "In the last block I…" },
  { id: "next", label: "Next step", placeholder: "I’m stuck on…" },
];

function ReplyPreview({
  preview,
  light,
  pending,
}: {
  preview: SessionAiPreview | null;
  light: boolean;
  pending: boolean;
}) {
  return (
    <section aria-label="AI reply preview" className={`rounded-2xl border px-3 py-3 ${light ? "border-[#D3C8F0] bg-[#F7F3FF]" : "border-white/10 bg-white/[0.05]"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-60">Preview</div>
        <div className="text-[11px] opacity-50">{pending ? "Writing…" : preview ? (preview.source === "openai" ? "AI" : "Draft") : "Nothing yet"}</div>
      </div>
      {preview ? (
        <>
          <p className="mt-2 text-[14px] font-medium leading-6">{preview.publicSpoken}</p>
          <ul className="mt-3 list-disc space-y-1 pl-4 text-[13px] leading-5 opacity-80">
            {preview.privateAdvice.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p className={`mt-3 text-[11px] leading-4 ${light ? "text-black/50" : "text-white/45"}`}>
            This stays in the panel until you add it as a task or post it to chat.
          </p>
        </>
      ) : (
        <p className={`mt-2 text-[13px] leading-5 ${light ? "text-black/45" : "text-white/45"}`}>
          {pending ? "Preparing a reply from what you wrote." : "Your reply preview will appear here before anything is saved or posted."}
        </p>
      )}
    </section>
  );
}

export default function SessionAiPanel({
  theme = "light",
  sessionId,
  currentUserId,
  currentUserName,
  onClose,
}: {
  theme?: PanelTheme;
  sessionId: string;
  currentUserId: string | null;
  currentUserName: string;
  onClose: () => void;
}) {
  const light = theme === "light";
  const [phase, setPhase] = useState<SessionAiPhase>("intention");
  const [text, setText] = useState("");
  const textRef = useRef("");
  textRef.current = text;
  const [preview, setPreview] = useState<SessionAiPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const phaseMeta = PHASES.find((item) => item.id === phase) || PHASES[0];
  const firstName = useMemo(() => {
    const name = String(currentUserName || "").trim();
    if (!name) return "there";
    return name.split(/\s+/)[0] || "there";
  }, [currentUserName]);

  const dictation = useSpeechDictation({
    win: typeof window === "undefined" ? (globalThis as unknown as Window) : window,
    getText: () => textRef.current,
    setText,
  });

  const makePreview = async () => {
    const value = text.trim();
    if (!value || pending) return;
    dictation.stop({ discard: false });
    setPending(true);
    setNotice("");
    const next = await requestSessionAiPreview({ phase, name: firstName, text: value });
    setPreview(next.publicSpoken ? next : buildLocalAiPreview({ phase, name: firstName, text: value }));
    setPending(false);
  };

  const addTask = async () => {
    if (!preview || !currentUserId) {
      setNotice("Sign in to add this as your task.");
      return;
    }
    const taskText = preview.taskText.trim();
    if (!taskText) return;
    const panelInsert = await supabase.from("panel_intentions").insert({
      user_id: currentUserId,
      text: taskText,
      completed: false,
      visibility: "private",
    });
    setNotice(panelInsert.error ? "Could not save the task. The preview is still here." : "Added as a private task.");
  };

  const postPreview = async () => {
    if (!preview || !currentUserId || !sessionId) {
      setNotice("Sign in during a session to post this preview to chat.");
      return;
    }
    const { error } = await supabase.from("session_chat_messages").insert({
      session_id: sessionId,
      user_id: currentUserId,
      body: preview.publicSpoken.slice(0, 1900),
      scope: "general",
    });
    setNotice(error ? "Could not post to chat. The preview is still private." : "Posted the preview to chat.");
  };

  const chipClass = (selected: boolean) =>
    `h-8 rounded-full border px-3 text-[12px] font-medium transition ${selected
      ? light
        ? "border-[#1B1B1B] bg-[#1B1B1B] text-white"
        : "border-[#5286F6] bg-[#5286F6] text-white"
      : light
        ? "border-[#CFCFCF] text-black/70 hover:bg-[#E8E8E8]"
        : "border-[#59616A] text-[#D0D6DD] hover:bg-[#353B42]"
    }`;

  return (
    <div data-side-panel-section="ai" className="flex h-full min-h-0 flex-col">
      <div className={`flex min-h-[44px] items-center justify-between border-b px-3 py-1.5 ${light ? "border-[#D8D0D0] bg-[#F3F1F1]" : "border-[#343434] bg-[#232323]"}`}>
        <div className="flex min-w-0 items-center gap-2">
          <img src={light ? "/icons/ai-host-light.svg" : "/icons/ai-host-dark.svg"} alt="" className="h-4 w-4" />
          <div className={`text-[12px] font-semibold ${light ? "text-black/85" : "text-[#F4F5F6]"}`}>AI</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`flex h-8 w-8 items-center justify-center rounded-[10px] transition ${light ? "bg-[#E6E6E6] text-black/60 hover:bg-[#DCDCDC]" : "bg-[#303030] text-[#D4D9DF] hover:bg-[#3A3A3A]"}`}
          aria-label="Close AI panel"
        >
          ✕
        </button>
      </div>

      <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 ${light ? "text-[#1F1F1F]" : "text-[#F4F5F6]"}`}>
        <div className="flex flex-wrap gap-1.5">
          {PHASES.map((item) => (
            <button key={item.id} type="button" className={chipClass(phase === item.id)} onClick={() => { setPhase(item.id); setPreview(null); }} aria-pressed={phase === item.id}>
              {item.label}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="sr-only">{phaseMeta.placeholder}</span>
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              dictation.manualEdit(event.target.value);
            }}
            placeholder={phaseMeta.placeholder}
            className={`min-h-[96px] w-full resize-y rounded-xl border px-3 py-2 text-[13px] outline-none ${light ? "border-[#CFCFCF] bg-[#E6E6E6] placeholder:text-black/35" : "border-[#484848] bg-[#292929] placeholder:text-white/35"}`}
          />
        </label>

        <div className="flex gap-2">
          {dictation.supported ? (
            <button
              type="button"
              onClick={dictation.toggle}
              className={`h-10 rounded-xl border px-3 text-[12px] font-semibold ${dictation.listening ? "border-[#F65252] text-[#F65252]" : light ? "border-[#CFCFCF]" : "border-[#59616A]"}`}
              aria-pressed={dictation.listening}
            >
              {dictation.listening ? "Stop" : "Dictate"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void makePreview()}
            disabled={pending || !text.trim()}
            className={`h-10 flex-1 rounded-xl text-[13px] font-semibold text-white disabled:opacity-45 ${light ? "bg-[#1B1B1B]" : "bg-[#5286F6]"}`}
          >
            {pending ? "Preparing preview…" : "Preview reply"}
          </button>
        </div>
        {dictation.error ? <div className="text-[12px] text-[#F65252]">{dictation.error}</div> : null}

        <ReplyPreview preview={preview} light={light} pending={pending} />

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void addTask()} disabled={!preview} className={`h-10 rounded-xl border text-[12px] font-semibold disabled:opacity-40 ${light ? "border-[#CFCFCF]" : "border-[#59616A]"}`}>
            Add as my task
          </button>
          <button type="button" onClick={() => void postPreview()} disabled={!preview} className={`h-10 rounded-xl border text-[12px] font-semibold disabled:opacity-40 ${light ? "border-[#CFCFCF]" : "border-[#59616A]"}`}>
            Post preview
          </button>
        </div>
        {notice ? <div className={`rounded-xl px-3 py-2 text-[12px] leading-5 ${light ? "bg-[#EFEFEF]" : "bg-[#292929]"}`}>{notice}</div> : null}
      </div>
    </div>
  );
}
