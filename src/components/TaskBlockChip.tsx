import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import type { FocusBlock } from "../lib/taskBlocks";

// Small chip under one of my tasks in the room's Tasks panel: which focus
// block it is planned for. Unplanned tasks show nothing (the row keeps its
// height); planning starts from the task's menu, which opens this chip.
export default function TaskBlockChip({
  blocks,
  value,
  currentStageIndex,
  isLight,
  onChange,
  defaultOpen = false,
  onClose,
}: {
  blocks: FocusBlock[];
  value: number | null;
  currentStageIndex: number | null;
  isLight: boolean;
  onChange: (stageIndex: number | null) => void;
  defaultOpen?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const wasOpenRef = useRef(defaultOpen);
  useEffect(() => {
    if (open) wasOpenRef.current = true;
    else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      onClose?.();
    }
  }, [open, onClose]);
  const rootRef = useRef<HTMLSpanElement>(null);
  const block = blocks.find((item) => item.stageIndex === value) || null;
  const isNow = block != null && block.stageIndex === currentStageIndex;
  const isPast = block != null && currentStageIndex != null && block.stageIndex < currentStageIndex;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!blocks.length) return null;

  const chipTone = block
    ? isNow
      ? "border-[#5286F6] bg-[#5286F6]/12 text-[#3F6FD8]"
      : isLight
        ? "border-[#CFC6C6] bg-[#F3F1F1] text-black/60"
        : "border-[#464646] bg-white/[0.06] text-white/70"
    : isLight
      ? "border-dashed border-[#CFC6C6] text-black/45"
      : "border-dashed border-[#5A5A5A] text-white/50";

  return (
    <span
      ref={rootRef}
      className="relative inline-flex"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={block ? "Planned focus block" : "Plan this task for a focus block"}
        className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold transition ${chipTone} ${isPast ? "opacity-60" : ""}`}
      >
        {block ? (
          <>
            <span className={`h-1.5 w-1.5 rounded-full ${isNow ? "bg-[#5286F6]" : "bg-[#3B82F6]/60"}`} aria-hidden="true" />
            {block.label}
            {isNow ? <span className="font-bold">· now</span> : null}
          </>
        ) : (
          <>
            <Plus size={11} aria-hidden="true" />
            Plan for a block
          </>
        )}
        <ChevronDown size={11} className="opacity-60" aria-hidden="true" />
      </button>

      {open ? (
        <span
          role="menu"
          className="absolute left-0 top-[calc(100%+6px)] z-40 w-44 overflow-hidden rounded-2xl bg-white p-1.5 text-[#2F2F2F] shadow-[0_10px_30px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.06]"
        >
          {blocks.map((item) => {
            const past = currentStageIndex != null && item.stageIndex < currentStageIndex;
            const now = item.stageIndex === currentStageIndex;
            return (
              <button
                key={item.stageIndex}
                type="button"
                role="menuitemradio"
                aria-checked={item.stageIndex === value}
                onClick={() => {
                  onChange(item.stageIndex);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-semibold transition hover:bg-black/[0.04] ${past ? "text-black/40" : "text-black/70"}`}
              >
                {item.label}
                {now ? <span className="rounded-full bg-[#5286F6] px-1.5 text-[10px] leading-4 text-white">Now</span> : null}
                {past ? <span className="text-[10px] font-normal">done</span> : null}
                {item.stageIndex === value ? <Check size={13} className="ml-auto text-[#5286F6]" aria-hidden="true" /> : null}
              </button>
            );
          })}
          {value != null ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="mt-1 flex w-full items-center rounded-xl border-t border-black/[0.06] px-3 py-2 text-left text-[12px] text-black/50 hover:bg-black/[0.04]"
            >
              Not planned
            </button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
