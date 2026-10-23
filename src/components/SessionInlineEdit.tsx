import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Check, Pencil, X } from "lucide-react";

// In-place editing on a session card for its host: double-click the title or
// the start date/time to change it right there. Enter or clicking away saves,
// Esc cancels. Elements carry data-inline-edit so the card can hold back its
// own single-click action until it knows the click was not a double-click.

type SaveResult = void | Promise<unknown>;

function errorText(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function useFlashError() {
  const [error, setError] = useState("");
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 3500);
    return () => window.clearTimeout(timer);
  }, [error]);
  return [error, setError] as const;
}

function InlineError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <span role="alert" className="ml-2 inline-flex rounded-full bg-red-50 px-2 py-0.5 align-middle text-[11px] font-medium text-red-700">
      {message}
    </span>
  );
}

export function InlineEditableTitle({
  value,
  canEdit,
  onSave,
}: {
  value: string;
  canEdit: boolean;
  onSave: (title: string) => SaveResult;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useFlashError();
  const doneRef = useRef(false);

  // The saved title shows right away and gives way once the card has the new value.
  useEffect(() => setPending(null), [value]);
  const shown = pending ?? value;

  if (!canEdit) return <span className="min-w-0 break-words">{value}</span>;

  const finish = async (save: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setEditing(false);
    const next = draft.trim();
    if (!save || !next || next === value.trim()) return;
    setPending(next);
    try {
      await onSave(next);
    } catch (cause) {
      setPending(null);
      setError(errorText(cause, "Title was not saved"));
    }
  };

  if (editing) {
    return (
      <span data-inline-editing className="min-w-0 flex-1" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          value={draft}
          maxLength={120}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => void finish(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void finish(true);
            if (event.key === "Escape") void finish(false);
          }}
          aria-label="Session title"
          className="w-full min-w-[8ch] rounded-[10px] border border-[#5286F6] bg-white px-2 py-0.5 font-[inherit] text-[inherit] leading-tight text-[#2F2F2F] shadow-[0_0_0_4px_rgba(82,134,246,0.12)] outline-none"
        />
      </span>
    );
  }

  const startEditing = () => {
    window.getSelection()?.removeAllRanges();
    doneRef.current = false;
    setDraft(shown);
    setEditing(true);
  };

  return (
    <span className="min-w-0 break-words">
      <CursorEditHintArea label="Rename session" onActivate={startEditing} className="max-w-full align-bottom">
        <span data-inline-edit onDoubleClick={startEditing} title="Double-click to rename">
          {shown}
        </span>
      </CursorEditHintArea>
      <InlineError message={error} />
    </span>
  );
}

type HintPoint = { x: number; y: number };

/**
 * Wraps an editable value: while the pointer moves over it, a small pencil
 * chip trails the cursor (hosts only render this). The value itself is
 * edited by double-click; a screen-reader/keyboard button starts it too.
 */
export function CursorEditHintArea({
  label,
  onActivate,
  className = "",
  block = false,
  children,
}: {
  label: string;
  onActivate: () => void;
  className?: string;
  /** Use a block wrapper (for full-width things like a timeline bar). */
  block?: boolean;
  children: ReactNode;
}) {
  const [point, setPoint] = useState<HintPoint | null>(null);
  const lastPointRef = useRef<HintPoint>({ x: 0, y: 0 });
  if (point) lastPointRef.current = point;
  const at = point || lastPointRef.current;
  const Wrapper = block ? "div" : "span";

  return (
    <Wrapper
      className={`relative ${block ? "block" : "inline-block"} ${className}`}
      onMouseMove={(event: MouseEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      }}
      onMouseLeave={() => setPoint(null)}
    >
      {children}
      <span
        aria-hidden="true"
        className={[
          "pointer-events-none absolute left-0 top-0 z-[5] flex h-6 w-6 items-center justify-center rounded-full border border-[#E5E5E5] bg-white text-[#2F2F2F] shadow-[0_4px_12px_rgba(0,0,0,0.14)]",
          "transition-[transform,opacity] duration-100 ease-out motion-reduce:transition-none",
          point ? "opacity-100" : "opacity-0",
        ].join(" ")}
        style={{ transform: `translate(${at.x + 14}px, ${at.y - 26}px) scale(${point ? 1 : 0.7})` }}
      >
        <Pencil size={11} strokeWidth={2.25} />
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onActivate();
        }}
        className="sr-only"
      >
        {label}
      </button>
    </Wrapper>
  );
}

function toLocalParts(iso: string | null | undefined) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

export function InlineEditableStart({
  startTime,
  label,
  canEdit,
  onSave,
}: {
  startTime: string | null | undefined;
  label: string;
  canEdit: boolean;
  onSave: (startIso: string) => SaveResult;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => toLocalParts(startTime));
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [error, setError] = useFlashError();
  const doneRef = useRef(false);

  useEffect(() => setPendingLabel(null), [startTime]);

  if (!canEdit) return <span>{label}</span>;

  const finish = async (save: boolean) => {
    if (doneRef.current) return;
    if (!save) {
      doneRef.current = true;
      setEditing(false);
      return;
    }
    if (!draft.date || !draft.time) {
      setError("Pick a date and time");
      return;
    }
    const next = new Date(`${draft.date}T${draft.time}`);
    if (Number.isNaN(next.getTime())) {
      setError("That date does not look right");
      return;
    }
    if (next.getTime() < Date.now() - 60_000) {
      setError("Pick a time in the future");
      return;
    }
    doneRef.current = true;
    setEditing(false);
    const iso = next.toISOString();
    if (startTime && Math.abs(Date.parse(startTime) - next.getTime()) < 60_000) return;
    setPendingLabel(
      next.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    );
    try {
      await onSave(iso);
    } catch (cause) {
      setPendingLabel(null);
      setError(errorText(cause, "Time was not saved"));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") void finish(true);
    if (event.key === "Escape") void finish(false);
  };

  // Clicking outside both fields saves; moving between them does not.
  const onBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    void finish(true);
  };

  if (editing) {
    const fieldCls =
      "h-7 rounded-[8px] border border-[#D3E0FC] bg-white px-1.5 text-[12px] text-[#2F2F2F] outline-none focus:border-[#5286F6] focus:shadow-[0_0_0_3px_rgba(82,134,246,0.12)]";
    return (
      <span
        data-inline-editing
        onClick={(event) => event.stopPropagation()}
        onBlur={onBlur}
        className="inline-flex flex-wrap items-center gap-1.5"
      >
        <input
          autoFocus
          type="date"
          value={draft.date}
          onChange={(event) => setDraft((value) => ({ ...value, date: event.target.value }))}
          onKeyDown={onKeyDown}
          aria-label="Session date"
          className={fieldCls}
        />
        <input
          type="time"
          value={draft.time}
          onChange={(event) => setDraft((value) => ({ ...value, time: event.target.value }))}
          onKeyDown={onKeyDown}
          aria-label="Session start time"
          className={fieldCls}
        />
        <button
          type="button"
          onClick={() => void finish(true)}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5286F6] text-white transition hover:bg-[#4677EC] active:scale-90"
          aria-label="Save date and time"
        >
          <Check size={14} />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void finish(false)}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-[#E5E7EB] bg-white text-[#606060] transition hover:bg-[#F3F4F6] active:scale-90"
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
        <InlineError message={error} />
      </span>
    );
  }

  const startEditing = () => {
    window.getSelection()?.removeAllRanges();
    doneRef.current = false;
    setDraft(toLocalParts(startTime));
    setEditing(true);
  };

  return (
    <span>
      <CursorEditHintArea label="Change date and time" onActivate={startEditing}>
        <span data-inline-edit onDoubleClick={startEditing} title="Double-click to change the date and time">
          {pendingLabel ?? label}
        </span>
      </CursorEditHintArea>
      <InlineError message={error} />
    </span>
  );
}
