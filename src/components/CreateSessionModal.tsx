// src/components/CreateSessionModal.tsx
// Full file replacement
// ✅ Added session description field + save to sessions.description
// ✅ Removed server region picker entirely (no auto/manual domain in modal)
// ✅ All sessions created with fixed EU domain: jitsi.mysession.club
// ✅ Added host auto-booking after session creation
// ✅ Added Session Studio multi-select + Ctrl/Cmd+C + Ctrl/Cmd+V duplication
// ✅ Added sticky timeline + sticky block library

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
import {
  X,
  Layers,
  ArrowUp,
  ArrowDown,
  Trash2,
  Wand2,
  RotateCcw,
  Eraser,
  Link2,
  Users,
  CalendarDays,
  Repeat,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import type { SessionTemplate } from "../types/session";
import { useAuth } from "../context/AuthContext";

interface CreateSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionCreated: () => void;
}

// ✅ Fixed EU domain (no picker in UI)
// If you later move domain selection to other sources / DB default, you can remove this field from insert.
const FIXED_JITSI_DOMAIN = "jitsi.mysession.club";

function nowLocalForDatetimeInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// ===============================
// Scheduling in advance helpers
// ===============================
type ScheduleMode = "single" | "daily" | "weekly";
const MAX_ADVANCE_DAYS = 14;

function addDaysLocal(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function advanceLimitDate(now: Date) {
  const d = new Date(now);
  d.setDate(d.getDate() + MAX_ADVANCE_DAYS);
  return d;
}

function stepDaysForMode(mode: ScheduleMode) {
  if (mode === "daily") return 1;
  if (mode === "weekly") return 7;
  return 0; // single
}

function toLocalPreview(d: Date) {
  try {
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return d.toString();
  }
}

// ===============================
// Custom slug helpers
// ===============================
const SLUG_MIN = 3;
const SLUG_MAX = 40;

// allowed: a-z 0-9 - _
function sanitizeSlug(input: string) {
  const raw = String(input || "").trim().toLowerCase();
  const spaced = raw.replace(/\s+/g, "-");
  const clean = spaced.replace(/[^a-z0-9-_]/g, "");
  return clean;
}

function isValidSlug(slug: string) {
  if (!slug) return true; // empty = not used
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return false;
  return /^[a-z0-9][a-z0-9-_]*$/.test(slug);
}

function ymdLocal(d: Date) {
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function makeDatedSlug(baseSlug: string, dateLocal: Date) {
  if (!baseSlug) return "";
  const suffix = ymdLocal(dateLocal); // yyyy-mm-dd
  const extra = 1 + suffix.length; // "-" + suffix
  const maxBase = Math.max(1, SLUG_MAX - extra);
  const trimmedBase =
    baseSlug.length > maxBase ? baseSlug.slice(0, maxBase) : baseSlug;
  const out = `${trimmedBase}-${suffix}`;
  return out.slice(0, SLUG_MAX);
}

// ===============================
// participants limit helpers
// ===============================
const DEFAULT_MAX_PARTICIPANTS = 16;
const MIN_PARTICIPANTS = 3;
const MAX_PARTICIPANTS = 64;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// ===============================
// SESSION STUDIO (builder) types
// ===============================
type StudioBlockKind =
  | "welcome"
  | "intentions"
  | "focus"
  | "break"
  | "checkin"
  | "recap"
  | "celebrate"
  | "custom";

type StudioBlock = {
  id: string;
  kind: StudioBlockKind;
  title: string;
  note?: string;
  minutes: number;
};

function uid() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = (globalThis as any)?.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `b_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function safeJson(raw: any) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function normalizeTemplateBlocks(rawBlocks: any): StudioBlock[] {
  const parsed = safeJson(rawBlocks);
  if (!parsed) return [];

  const arr = Array.isArray(parsed) ? parsed : [];
  return arr.map((b: any) => {
    const title = String(
      b?.title || b?.name || b?.label || b?.kind || b?.type || "Block"
    ).trim();

    const minutesRaw =
      b?.minutes ??
      b?.duration_minutes ??
      b?.duration ??
      b?.len ??
      b?.time ??
      5;

    const minutes = clamp(Number(minutesRaw) || 5, 1, 24 * 60);

    const k = String(b?.kind || b?.type || "").toLowerCase();
    const kind: StudioBlockKind =
      k === "welcome"
        ? "welcome"
        : k === "intentions"
          ? "intentions"
          : k === "focus"
            ? "focus"
            : k === "break"
              ? "break"
              : k === "checkin"
                ? "checkin"
                : k === "recap"
                  ? "recap"
                  : k === "celebrate"
                    ? "celebrate"
                    : "custom";

    return {
      id: uid(),
      kind,
      title,
      note: String(b?.note || b?.description || "").trim() || undefined,
      minutes,
    };
  });
}

function exportStudioToSchedule(blocks: StudioBlock[]) {
  return blocks.map((b, idx) => ({
    kind: b.kind,
    title: b.title,
    minutes: b.minutes,
    note: b.note || null,
    order: idx,
    v: 1,
  }));
}

const STUDIO_LIBRARY: StudioBlock[] = [
  {
    id: "lib_welcome",
    kind: "welcome",
    title: "Welcome",
    note: "Quick intro / rules / vibe",
    minutes: 3,
  },
  {
    id: "lib_intentions",
    kind: "intentions",
    title: "Intentions",
    note: "Say what you’ll finish",
    minutes: 5,
  },
  {
    id: "lib_focus",
    kind: "focus",
    title: "Focus",
    note: "Deep work block",
    minutes: 50,
  },
  {
    id: "lib_break",
    kind: "break",
    title: "Break",
    note: "Recharge / stretch",
    minutes: 10,
  },
  {
    id: "lib_checkin",
    kind: "checkin",
    title: "Check-in",
    note: "Short accountability checkpoint",
    minutes: 3,
  },
  {
    id: "lib_recap",
    kind: "recap",
    title: "Recap",
    note: "What got done / what’s next",
    minutes: 5,
  },
  {
    id: "lib_celebrate",
    kind: "celebrate",
    title: "Celebrate",
    note: "Closure + positive finish",
    minutes: 3,
  },
  {
    id: "lib_custom",
    kind: "custom",
    title: "Custom",
    note: "Any special block",
    minutes: 5,
  },
];

const QUICK_MINUTES = [3, 5, 10, 15, 25, 50];

// ===============================
// SESSION TIMELINE (visual)
// ===============================
function kindBg(kind: StudioBlockKind) {
  switch (kind) {
    case "welcome":
      return "bg-slate-200";
    case "intentions":
      return "bg-indigo-200";
    case "focus":
      return "bg-emerald-200";
    case "break":
      return "bg-amber-200";
    case "checkin":
      return "bg-cyan-200";
    case "recap":
      return "bg-violet-200";
    case "celebrate":
      return "bg-pink-200";
    default:
      return "bg-gray-200";
  }
}

function formatMinutes(min: number) {
  const m = Math.max(0, Math.floor(min || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${mm}m`;
  if (mm === 0) return `${h}h`;
  return `${h}h ${mm}m`;
}

function SessionTimeline({ blocks }: { blocks: StudioBlock[] }) {
  const total = blocks.reduce((s, b) => s + (Number(b.minutes) || 0), 0);

  const rows = useMemo(() => {
    let acc = 0;
    return blocks.map((b) => {
      const start = acc;
      const end = acc + (Number(b.minutes) || 0);
      acc = end;
      return { ...b, start, end };
    });
  }, [blocks]);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <div className="font-inter text-[12px] text-gray-600">
          Session timeline
        </div>
        <div className="font-inter text-[12px] text-gray-600">
          Total:{" "}
          <span className="font-semibold text-brandBlack">
            {formatMinutes(total)}
          </span>
        </div>
      </div>

      <div className="mt-2 border border-gray-200 rounded-[999px] overflow-hidden bg-gray-50">
        <div className="flex h-3">
          {blocks.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center text-[12px] text-gray-500 font-inter">
              Add blocks to build a timeline
            </div>
          ) : (
            blocks.map((b) => {
              const mins = clamp(Number(b.minutes) || 1, 1, 24 * 60);
              const showText = mins >= 10;
              return (
                <div
                  key={b.id}
                  className={`h-full ${kindBg(
                    b.kind
                  )} border-r border-white/70 flex items-center justify-center`}
                  style={{ flexGrow: mins, flexBasis: 0, minWidth: 6 }}
                  title={`${b.title} • ${mins} min`}
                >
                  {showText ? (
                    <span className="px-2 text-[11px] font-inter text-gray-800 truncate">
                      {b.title} · {mins}m
                    </span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {blocks.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-[12px] text-gray-600 font-inter hover:text-gray-800">
            Show breakdown
          </summary>

          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
            {rows.map((r) => (
              <div
                key={r.id}
                className="border border-gray-200 rounded-[14px] px-3 py-2 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${kindBg(r.kind)}`} />
                  <span className="text-[12px] font-inter text-brandBlack truncate">
                    {r.title}
                  </span>
                </div>

                <div className="text-[12px] font-inter text-gray-600 whitespace-nowrap">
                  {r.start}–{r.end}m · {r.minutes}m
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function CreateSessionModal({
  isOpen,
  onClose,
  onSessionCreated,
}: CreateSessionModalProps) {
  const { user, profile, loading } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---------- Scheduling in advance ----------
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("single");
  const [dailyDays, setDailyDays] = useState<number>(7);
  const [weeklyCount, setWeeklyCount] = useState<number>(3);

  // ---------- Custom link slug ----------
  const [customSlugInput, setCustomSlugInput] = useState("");
  const sanitizedSlug = useMemo(
    () => sanitizeSlug(customSlugInput),
    [customSlugInput]
  );
  const slugValid = useMemo(() => isValidSlug(sanitizedSlug), [sanitizedSlug]);
  const [slugStatus, setSlugStatus] = useState<
    "idle" | "invalid" | "checking" | "taken" | "available"
  >("idle");

  // ---------- SESSION STUDIO ----------
  const [studioEnabled, setStudioEnabled] = useState(false);
  const [studioBlocks, setStudioBlocks] = useState<StudioBlock[]>([]);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);

  // DnD state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<"before" | "after">("after");
  const END_DROP_ID = "__end__";

  const [maxParticipants, setMaxParticipants] = useState<number>(
    DEFAULT_MAX_PARTICIPANTS
  );

  // Scroll container ref (modal body)
  const modalScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll while dragging (refs to avoid re-render spam)
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollVelRef = useRef<number>(0);
  const draggingRef = useRef<boolean>(false);

  // FLIP animation bookkeeping (only when we reorder)
  const flipPrevTopsRef = useRef<Record<string, number>>({});
  const flipArmedRef = useRef<boolean>(false);

  // Clipboard for block duplication
  const copiedBlocksRef = useRef<StudioBlock[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setTitle("");
    setDescription("");
    setScheduledAt("");
    setSelectedTemplate("");
    setTemplates([]);
    setIsCreating(false);
    setError(null);

    setMaxParticipants(DEFAULT_MAX_PARTICIPANTS);
    setCustomSlugInput("");
    setSlugStatus("idle");

    setScheduleMode("single");
    setDailyDays(7);
    setWeeklyCount(3);

    setStudioEnabled(false);
    setStudioBlocks([]);
    setSelectedBlockIds([]);
    setActiveBlockId(null);
    setSelectionAnchorId(null);
    setDraggingId(null);
    setDragOverId(null);
    setDropEdge("after");

    copiedBlocksRef.current = [];

    autoScrollVelRef.current = 0;
    draggingRef.current = false;
    if (autoScrollRafRef.current) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!studioEnabled) setMaxParticipants(DEFAULT_MAX_PARTICIPANTS);
  }, [studioEnabled]);

  useEffect(() => {
    if (!isOpen) return;

    if (scheduleMode !== "single") {
      setSlugStatus(sanitizedSlug ? (slugValid ? "idle" : "invalid") : "idle");
      return;
    }

    const s = sanitizedSlug;

    if (!s) {
      setSlugStatus("idle");
      return;
    }

    if (!slugValid) {
      setSlugStatus("invalid");
      return;
    }

    setSlugStatus("checking");
    const t = window.setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from("sessions")
          .select("id")
          .eq("custom_slug", s)
          .limit(1);

        if (error) {
          console.log("[slug] availability check error:", error);
          setSlugStatus("idle");
          return;
        }

        setSlugStatus(data && data.length > 0 ? "taken" : "available");
      } catch (e) {
        console.log("[slug] availability check exception:", e);
        setSlugStatus("idle");
      }
    }, 450);

    return () => window.clearTimeout(t);
  }, [sanitizedSlug, slugValid, isOpen, scheduleMode]);

  const studioTotal = useMemo(
    () => studioBlocks.reduce((sum, b) => sum + (Number(b.minutes) || 0), 0),
    [studioBlocks]
  );

  const selectedTemplateObj = useMemo(
    () => templates.find((t) => t.id === selectedTemplate),
    [templates, selectedTemplate]
  );

  const importFromTemplate = useCallback(() => {
    const tpl = selectedTemplateObj;
    const blocks =
      normalizeTemplateBlocks((tpl as any)?.blocks) ||
      normalizeTemplateBlocks((tpl as any)?.schedule);

    if (blocks.length) {
      setStudioBlocks(blocks);
      const firstId = blocks[0]?.id || null;
      setSelectedBlockIds(firstId ? [firstId] : []);
      setActiveBlockId(firstId);
      setSelectionAnchorId(firstId);
    } else {
      const fallback = [
        {
          id: uid(),
          kind: "welcome" as StudioBlockKind,
          title: "Welcome",
          note: "Quick intro / rules / vibe",
          minutes: 3,
        },
        {
          id: uid(),
          kind: "intentions" as StudioBlockKind,
          title: "Intentions",
          note: "Say what you’ll finish",
          minutes: 5,
        },
        {
          id: uid(),
          kind: "focus" as StudioBlockKind,
          title: "Focus",
          note: "Deep work block",
          minutes: 50,
        },
        {
          id: uid(),
          kind: "recap" as StudioBlockKind,
          title: "Recap",
          note: "What got done / what’s next",
          minutes: 5,
        },
        {
          id: uid(),
          kind: "celebrate" as StudioBlockKind,
          title: "Celebrate",
          note: "Closure + positive finish",
          minutes: 3,
        },
      ];
      setStudioBlocks(fallback);
      setSelectedBlockIds([fallback[0].id]);
      setActiveBlockId(fallback[0].id);
      setSelectionAnchorId(fallback[0].id);
    }
  }, [selectedTemplateObj]);

  const resetDefaultStudio = useCallback(() => {
    const next = [
      {
        id: uid(),
        kind: "welcome" as StudioBlockKind,
        title: "Welcome",
        note: "Quick intro / rules / vibe",
        minutes: 3,
      },
      {
        id: uid(),
        kind: "intentions" as StudioBlockKind,
        title: "Intentions",
        note: "Say what you’ll finish",
        minutes: 5,
      },
      {
        id: uid(),
        kind: "focus" as StudioBlockKind,
        title: "Focus",
        note: "Deep work block",
        minutes: 50,
      },
      {
        id: uid(),
        kind: "break" as StudioBlockKind,
        title: "Break",
        note: "Recharge / stretch",
        minutes: 10,
      },
      {
        id: uid(),
        kind: "focus" as StudioBlockKind,
        title: "Focus",
        note: "Second focus block",
        minutes: 50,
      },
      {
        id: uid(),
        kind: "recap" as StudioBlockKind,
        title: "Recap",
        note: "What got done / what’s next",
        minutes: 5,
      },
      {
        id: uid(),
        kind: "celebrate" as StudioBlockKind,
        title: "Celebrate",
        note: "Closure + positive finish",
        minutes: 3,
      },
    ];
    setStudioBlocks(next);
    setSelectedBlockIds([next[0].id]);
    setActiveBlockId(next[0].id);
    setSelectionAnchorId(next[0].id);
  }, []);

  const clearStudio = useCallback(() => {
    setStudioBlocks([]);
    setSelectedBlockIds([]);
    setActiveBlockId(null);
    setSelectionAnchorId(null);
  }, []);

  const addFromLibrary = useCallback((b: StudioBlock) => {
    const nextBlock = {
      id: uid(),
      kind: b.kind,
      title: b.title,
      note: b.note,
      minutes: b.minutes,
    };
    setStudioBlocks((prev) => [...prev, nextBlock]);
    setSelectedBlockIds([nextBlock.id]);
    setActiveBlockId(nextBlock.id);
    setSelectionAnchorId(nextBlock.id);
  }, []);

  const focusBlock = useCallback((id: string) => {
    if (!id) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(`studio-block-${id}`) as
        | HTMLElement
        | null;
      if (!el) return;
      el.focus();
      try {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch {
        // ignore
      }
    });
  }, []);

  // DnD helpers (avoid dragging from inputs/buttons)
  const isInteractiveEl = (el: EventTarget | null) => {
    const t = el as HTMLElement | null;
    if (!t) return false;
    const tag = (t.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (tag === "button") return true;
    if (t.isContentEditable) return true;
    const closest = t.closest?.(
      "input,textarea,select,button,[contenteditable='true']"
    );
    return !!closest;
  };

  const setTransparentDragImage = (dt: DataTransfer) => {
    try {
      const img = new Image();
      img.src =
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
      dt.setDragImage(img, 0, 0);
    } catch {
      // ignore
    }
  };

  const orderedSelectedIds = useMemo(() => {
    const selectedSet = new Set(selectedBlockIds);
    return studioBlocks
      .map((b) => b.id)
      .filter((id) => selectedSet.has(id));
  }, [studioBlocks, selectedBlockIds]);

  const orderedSelectedBlocks = useMemo(() => {
    const selectedSet = new Set(selectedBlockIds);
    return studioBlocks.filter((b) => selectedSet.has(b.id));
  }, [studioBlocks, selectedBlockIds]);

  const selectSingleBlock = useCallback((id: string) => {
    setSelectedBlockIds([id]);
    setActiveBlockId(id);
    setSelectionAnchorId(id);
  }, []);

  const toggleBlockSelection = useCallback((id: string) => {
    setSelectedBlockIds((prev) => {
      const exists = prev.includes(id);
      if (exists) {
        const next = prev.filter((x) => x !== id);
        return next;
      }
      return [...prev, id];
    });
    setActiveBlockId(id);
    setSelectionAnchorId((prev) => prev || id);
  }, []);

  const selectRangeToBlock = useCallback(
    (id: string) => {
      const anchor = selectionAnchorId || activeBlockId || id;
      const a = studioBlocks.findIndex((b) => b.id === anchor);
      const z = studioBlocks.findIndex((b) => b.id === id);

      if (a < 0 || z < 0) {
        selectSingleBlock(id);
        return;
      }

      const start = Math.min(a, z);
      const end = Math.max(a, z);
      const ids = studioBlocks.slice(start, end + 1).map((b) => b.id);

      setSelectedBlockIds(ids);
      setActiveBlockId(id);
      setSelectionAnchorId(anchor);
    },
    [studioBlocks, selectionAnchorId, activeBlockId, selectSingleBlock]
  );

  const handleBlockSurfaceClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      if (e.shiftKey) {
        selectRangeToBlock(id);
        focusBlock(id);
        return;
      }

      if (e.metaKey || e.ctrlKey) {
        toggleBlockSelection(id);
        focusBlock(id);
        return;
      }

      selectSingleBlock(id);
      focusBlock(id);
    },
    [focusBlock, selectRangeToBlock, selectSingleBlock, toggleBlockSelection]
  );

  const copySelectedBlocks = useCallback(() => {
    if (!orderedSelectedBlocks.length) return;
    copiedBlocksRef.current = orderedSelectedBlocks.map((b) => ({
      ...b,
      id: "copy-placeholder",
    }));
  }, [orderedSelectedBlocks]);

  const pasteCopiedBlocks = useCallback(() => {
    const copied = copiedBlocksRef.current || [];
    if (!copied.length) return;

    const copies = copied.map((b) => ({
      ...b,
      id: uid(),
    }));

    setStudioBlocks((prev) => {
      const currentSelectedSet = new Set(selectedBlockIds);
      const orderedIds = prev
        .map((b) => b.id)
        .filter((id) => currentSelectedSet.has(id));

      const lastSelectedId =
        orderedIds[orderedIds.length - 1] || activeBlockId || null;

      const insertIndex =
        lastSelectedId != null
          ? Math.max(
            0,
            prev.findIndex((b) => b.id === lastSelectedId) + 1
          )
          : prev.length;

      const next = [...prev];
      next.splice(insertIndex, 0, ...copies);
      return next;
    });

    const nextIds = copies.map((b) => b.id);
    setSelectedBlockIds(nextIds);
    setActiveBlockId(nextIds[0] || null);
    setSelectionAnchorId(nextIds[0] || null);

    if (nextIds[0]) focusBlock(nextIds[0]);
  }, [selectedBlockIds, activeBlockId, focusBlock]);

  const deleteSelectedBlocks = useCallback(() => {
    if (!selectedBlockIds.length) return;
    const selectedSet = new Set(selectedBlockIds);
    setStudioBlocks((prev) => prev.filter((b) => !selectedSet.has(b.id)));
    setSelectedBlockIds([]);
    setActiveBlockId(null);
    setSelectionAnchorId(null);
  }, [selectedBlockIds]);

  // ---------- Auto-scroll while dragging ----------
  const startAutoScrollLoop = useCallback(() => {
    if (autoScrollRafRef.current) return;
    draggingRef.current = true;

    const tick = () => {
      if (!draggingRef.current) {
        autoScrollRafRef.current = null;
        return;
      }

      const scroller = modalScrollRef.current;
      const v = autoScrollVelRef.current;

      if (scroller && v !== 0) {
        scroller.scrollTop += v;
      }

      autoScrollRafRef.current = requestAnimationFrame(tick);
    };

    autoScrollRafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopAutoScrollLoop = useCallback(() => {
    draggingRef.current = false;
    autoScrollVelRef.current = 0;
    if (autoScrollRafRef.current) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  }, []);

  const updateAutoScrollFromClientY = useCallback((clientY: number) => {
    const scroller = modalScrollRef.current;
    if (!scroller) {
      autoScrollVelRef.current = 0;
      return;
    }

    const rect = scroller.getBoundingClientRect();
    const threshold = 80;
    const maxSpeed = 18;

    const topZone = rect.top + threshold;
    const bottomZone = rect.bottom - threshold;

    let vel = 0;

    if (clientY < topZone) {
      const t = clamp((topZone - clientY) / threshold, 0, 1);
      vel = -Math.round(maxSpeed * t);
    } else if (clientY > bottomZone) {
      const t = clamp((clientY - bottomZone) / threshold, 0, 1);
      vel = Math.round(maxSpeed * t);
    } else {
      vel = 0;
    }

    autoScrollVelRef.current = vel;
  }, []);

  // ---------- FLIP smooth reorder ----------
  const armFlip = useCallback(() => {
    const tops: Record<string, number> = {};
    for (const b of studioBlocks) {
      const el = document.getElementById(`studio-block-${b.id}`) as
        | HTMLElement
        | null;
      if (!el) continue;
      tops[b.id] = el.getBoundingClientRect().top;
    }
    flipPrevTopsRef.current = tops;
    flipArmedRef.current = true;
  }, [studioBlocks]);

  useLayoutEffect(() => {
    if (!flipArmedRef.current) return;

    const prev = flipPrevTopsRef.current || {};
    flipArmedRef.current = false;

    for (const b of studioBlocks) {
      const el = document.getElementById(`studio-block-${b.id}`) as
        | HTMLElement
        | null;
      if (!el) continue;

      const prevTop = prev[b.id];
      if (typeof prevTop !== "number") continue;

      const nextTop = el.getBoundingClientRect().top;
      const dy = prevTop - nextTop;

      if (Math.abs(dy) < 1) continue;

      try {
        el.animate(
          [
            { transform: `translateY(${dy}px)` },
            { transform: "translateY(0px)" },
          ],
          {
            duration: 180,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
          }
        );
      } catch {
        // ignore
      }
    }
  }, [studioBlocks]);

  const moveBlock = useCallback(
    (id: string, dir: -1 | 1) => {
      armFlip();

      setStudioBlocks((prev) => {
        const idx = prev.findIndex((b) => b.id === id);
        if (idx < 0) return prev;
        const nextIdx = idx + dir;
        if (nextIdx < 0 || nextIdx >= prev.length) return prev;
        const copy = [...prev];
        const [item] = copy.splice(idx, 1);
        copy.splice(nextIdx, 0, item);
        return copy;
      });

      setActiveBlockId(id);
      setSelectionAnchorId(id);
      if (!selectedBlockIds.includes(id)) setSelectedBlockIds([id]);
      focusBlock(id);
    },
    [armFlip, focusBlock, selectedBlockIds]
  );

  const moveBlockTo = useCallback(
    (dragId: string, overId: string, edge: "before" | "after") => {
      if (!dragId || !overId) return;

      armFlip();

      setStudioBlocks((prev) => {
        const from = prev.findIndex((b) => b.id === dragId);
        if (from < 0) return prev;

        if (overId === END_DROP_ID) {
          const copy = [...prev];
          const [item] = copy.splice(from, 1);
          copy.push(item);
          return copy;
        }

        const to = prev.findIndex((b) => b.id === overId);
        if (to < 0) return prev;

        if (dragId === overId) return prev;

        const copy = [...prev];
        const [item] = copy.splice(from, 1);

        const toAfterRemoval = from < to ? to - 1 : to;
        const insertIndex = toAfterRemoval + (edge === "after" ? 1 : 0);

        const finalIndex = clamp(insertIndex, 0, copy.length);
        copy.splice(finalIndex, 0, item);
        return copy;
      });

      setActiveBlockId(dragId);
      setSelectionAnchorId(dragId);
      if (!selectedBlockIds.includes(dragId)) setSelectedBlockIds([dragId]);
      focusBlock(dragId);
    },
    [armFlip, focusBlock, selectedBlockIds]
  );

  const updateBlock = useCallback((id: string, patch: Partial<StudioBlock>) => {
    setStudioBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...patch } : b))
    );
  }, []);

  const removeBlock = useCallback(
    (id: string) => {
      const shouldDeleteSelection =
        selectedBlockIds.length > 1 && selectedBlockIds.includes(id);

      if (shouldDeleteSelection) {
        deleteSelectedBlocks();
        return;
      }

      setStudioBlocks((prev) => prev.filter((b) => b.id !== id));
      setSelectedBlockIds((prev) => prev.filter((x) => x !== id));
      setActiveBlockId((cur) => (cur === id ? null : cur));
      setSelectionAnchorId((cur) => (cur === id ? null : cur));
    },
    [deleteSelectedBlocks, selectedBlockIds]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (!studioEnabled) return;

    if (studioBlocks.length === 0) {
      const hasTplBlocks =
        normalizeTemplateBlocks((selectedTemplateObj as any)?.blocks).length > 0 ||
        normalizeTemplateBlocks((selectedTemplateObj as any)?.schedule).length > 0;
      if (hasTplBlocks) importFromTemplate();
      else resetDefaultStudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioEnabled, isOpen]);

  // ---------- Global shortcuts for Session Studio ----------
  useEffect(() => {
    if (!isOpen || !studioEnabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInteractive = !!target?.closest?.(
        "input,textarea,select,button,[contenteditable='true']"
      );

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();

      if (key === "c") {
        if (isInteractive) return;
        if (!orderedSelectedBlocks.length) return;
        e.preventDefault();
        copySelectedBlocks();
        return;
      }

      if (key === "v") {
        if (isInteractive) return;
        if (!copiedBlocksRef.current.length) return;
        e.preventDefault();
        pasteCopiedBlocks();
        return;
      }

      if (key === "a") {
        if (isInteractive) return;
        if (!studioBlocks.length) return;
        e.preventDefault();
        const allIds = studioBlocks.map((b) => b.id);
        setSelectedBlockIds(allIds);
        setActiveBlockId(allIds[0] || null);
        setSelectionAnchorId(allIds[0] || null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    isOpen,
    studioEnabled,
    studioBlocks,
    orderedSelectedBlocks,
    copySelectedBlocks,
    pasteCopiedBlocks,
  ]);

  // ---------- LOAD TEMPLATES ----------
  useEffect(() => {
    if (!isOpen) return;

    async function loadTemplates() {
      setError(null);

      const { data, error } = await supabase
        .from("session_templates")
        .select("*")
        .order("total_duration", { ascending: true });

      if (error) {
        console.error("❌ Error loading templates:", error);
        setError("Failed to load templates.");
        return;
      }

      setTemplates(data || []);
    }

    loadTemplates();
  }, [isOpen]);

  // ---------- Prevent background scroll when modal open ----------
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  const dynamicMaxOccurrences = useMemo(() => {
    const hardCap =
      scheduleMode === "weekly" ? 3 : scheduleMode === "daily" ? 14 : 1;

    if (scheduleMode === "single") return 1;
    if (!scheduledAt) return hardCap;

    const base = new Date(scheduledAt);
    if (Number.isNaN(base.getTime())) return hardCap;

    const now = new Date();
    const max = advanceLimitDate(now);

    const step = stepDaysForMode(scheduleMode);
    if (step <= 0) return 1;

    const diffMs = max.getTime() - base.getTime();
    if (diffMs < 0) return 1;

    const stepMs = step * 24 * 60 * 60 * 1000;
    const maxOcc = Math.floor(diffMs / stepMs) + 1;

    return clamp(maxOcc, 1, hardCap);
  }, [scheduleMode, scheduledAt]);

  useEffect(() => {
    if (!isOpen) return;
    if (scheduleMode === "daily") {
      setDailyDays((v) => clamp(Number(v) || 1, 1, dynamicMaxOccurrences));
    }
    if (scheduleMode === "weekly") {
      setWeeklyCount((v) => clamp(Number(v) || 1, 1, dynamicMaxOccurrences));
    }
  }, [dynamicMaxOccurrences, scheduleMode, isOpen]);

  const occurrencesCount = useMemo(() => {
    if (scheduleMode === "daily") {
      return clamp(Number(dailyDays) || 1, 1, dynamicMaxOccurrences);
    }
    if (scheduleMode === "weekly") {
      return clamp(Number(weeklyCount) || 1, 1, dynamicMaxOccurrences);
    }
    return 1;
  }, [scheduleMode, dailyDays, weeklyCount, dynamicMaxOccurrences]);

  const scheduleAdvanceError = useMemo(() => {
    if (!scheduledAt) return null;

    const base = new Date(scheduledAt);
    if (Number.isNaN(base.getTime())) return "Invalid start time.";

    const now = new Date();
    const max = advanceLimitDate(now);

    if (base.getTime() < now.getTime() - 60_000) {
      return "Start time must be in the future.";
    }

    const step = stepDaysForMode(scheduleMode);
    const last =
      scheduleMode === "single"
        ? base
        : addDaysLocal(base, step * (occurrencesCount - 1));

    if (last.getTime() > max.getTime()) {
      return `Max scheduling window is ${MAX_ADVANCE_DAYS} days ahead (last occurrence too far).`;
    }

    return null;
  }, [scheduledAt, occurrencesCount, scheduleMode]);

  const occurrencesPreview = useMemo(() => {
    if (!scheduledAt) return [];
    const base = new Date(scheduledAt);
    if (Number.isNaN(base.getTime())) return [];
    const step = stepDaysForMode(scheduleMode);
    const ds = Array.from({ length: occurrencesCount }, (_, i) =>
      scheduleMode === "single" ? base : addDaysLocal(base, step * i)
    );
    return ds.map(toLocalPreview);
  }, [scheduledAt, scheduleMode, occurrencesCount]);

  // ---------- CREATE SESSION(S) ----------
  const handleCreate = async () => {
    if (!title || !scheduledAt) {
      setError("Please fill out session title and start time.");
      return;
    }

    if (!studioEnabled && !selectedTemplate) {
      setError("Please select a session format (template).");
      return;
    }

    if (studioEnabled && studioBlocks.length === 0) {
      setError(
        "Session Studio is enabled, but your script is empty. Add at least one block."
      );
      return;
    }

    if (!user || !profile?.id) {
      setError("You must be logged in to create a session.");
      return;
    }

    if (scheduleAdvanceError) {
      setError(scheduleAdvanceError);
      return;
    }

    const baseSlug = sanitizedSlug;
    if (baseSlug && !isValidSlug(baseSlug)) {
      setError(
        `Custom link is invalid. Use ${SLUG_MIN}-${SLUG_MAX} chars: a-z, 0-9, - or _.`
      );
      return;
    }

    if (scheduleMode === "single") {
      if (baseSlug && slugStatus === "taken") {
        setError("This custom link is already taken. Pick another one.");
        return;
      }
      if (baseSlug && slugStatus === "checking") {
        setError("Checking custom link… please wait 1 second and try again.");
        return;
      }
    }

    const baseTemplateId =
      selectedTemplate || (studioEnabled ? templates[0]?.id ?? "" : "");

    if (studioEnabled && !baseTemplateId) {
      setError(
        "No templates found in database. Create at least one template first."
      );
      return;
    }

    const effectiveMaxParticipants = studioEnabled
      ? clamp(
        Number(maxParticipants) || DEFAULT_MAX_PARTICIPANTS,
        MIN_PARTICIPANTS,
        MAX_PARTICIPANTS
      )
      : DEFAULT_MAX_PARTICIPANTS;

    setIsCreating(true);
    setError(null);

    try {
      const baseDateLocal = new Date(scheduledAt);
      if (Number.isNaN(baseDateLocal.getTime())) {
        setError("Invalid start time.");
        setIsCreating(false);
        return;
      }

      const template = templates.find((t) => t.id === baseTemplateId);

      const durationMinutes = studioEnabled
        ? studioTotal
        : (template as any)?.total_duration ?? 60;

      const schedulePayload = studioEnabled
        ? exportStudioToSchedule(studioBlocks)
        : (template as any)?.blocks || (template as any)?.schedule || [];

      const formatLabel = studioEnabled
        ? template?.name
          ? `${template.name} (Studio)`
          : "Session Studio"
        : template?.name || "Unspecified";

      const normalizedDescription = String(description || "").trim() || null;

      const step = stepDaysForMode(scheduleMode);
      const datesLocal = Array.from({ length: occurrencesCount }, (_, i) =>
        scheduleMode === "single"
          ? baseDateLocal
          : addDaysLocal(baseDateLocal, step * i)
      );

      const isSeries = scheduleMode !== "single";
      const slugsForInsert =
        baseSlug && isSeries
          ? datesLocal.map((d) => makeDatedSlug(baseSlug, d))
          : baseSlug
            ? [baseSlug]
            : [];

      if (isSeries && baseSlug) {
        const checkList = slugsForInsert.filter(Boolean);
        if (checkList.length) {
          const { data: taken, error: takenErr } = await supabase
            .from("sessions")
            .select("custom_slug")
            .in("custom_slug", checkList)
            .limit(checkList.length);

          if (takenErr) {
            console.log("[slug] series collision check error:", takenErr);
          } else if (taken && taken.length > 0) {
            setError(
              "Some custom links for the series are already taken. Try a different base link."
            );
            setIsCreating(false);
            return;
          }
        }
      }

      const dailyUrls: string[] = [];
      for (let i = 0; i < datesLocal.length; i++) {
        const { data: fnData, error: fnError } =
          await supabase.functions.invoke("create-daily-room", { body: {} });

        if (fnError || !fnData?.url) {
          console.error("❌ Daily room creation failed:", fnData, fnError);
          throw new Error("Failed to create Daily room");
        }

        dailyUrls.push(String(fnData.url));
      }

      const rows = datesLocal.map((d, idx) => {
        const scheduledISO = d.toISOString();

        const customSlugForRow =
          baseSlug && isSeries ? slugsForInsert[idx] || null : baseSlug || null;

        return {
          title,
          description: normalizedDescription,
          host_id: profile.id,
          host_name: profile.full_name,

          template_id: baseTemplateId,

          start_time: scheduledISO,
          duration_minutes: durationMinutes,
          format: formatLabel,
          schedule: schedulePayload,
          daily_room_url: dailyUrls[idx],
          status: "planned",
          created_at: new Date().toISOString(),

          // ✅ fixed / no UI selection
          jitsi_domain: FIXED_JITSI_DOMAIN,

          max_participants: effectiveMaxParticipants,
          custom_slug: customSlugForRow,
        };
      });

      const { data: insertedSessions, error: insertError } = await supabase
        .from("sessions")
        .insert(rows)
        .select("id, host_id");

      if (insertError) throw insertError;

      if (!insertedSessions || insertedSessions.length === 0) {
        throw new Error("Sessions were created, but no rows were returned.");
      }

      // ✅ Auto-book host into every newly created session
      const bookingRows = insertedSessions
        .filter((s: any) => s?.id && (s?.host_id || profile.id))
        .map((s: any) => ({
          session_id: s.id,
          user_id: s.host_id || profile.id,
        }));

      if (bookingRows.length > 0) {
        const { error: bookingError } = await supabase
          .from("session_bookings")
          .insert(bookingRows);

        if (bookingError) {
          console.error("❌ Host auto-booking failed:", bookingError);

          // Best-effort rollback so we do not leave broken sessions behind
          try {
            const insertedIds = insertedSessions
              .map((s: any) => s?.id)
              .filter(Boolean);

            if (insertedIds.length > 0) {
              await supabase.from("sessions").delete().in("id", insertedIds);
            }
          } catch (rollbackErr) {
            console.error("❌ Rollback failed after auto-booking error:", rollbackErr);
          }

          throw new Error(
            "Failed to auto-book the host into the created session(s). Creation was rolled back."
          );
        }
      }

      setTitle("");
      setDescription("");
      setScheduledAt("");
      setSelectedTemplate("");
      setStudioEnabled(false);
      setStudioBlocks([]);
      setSelectedBlockIds([]);
      setActiveBlockId(null);
      setSelectionAnchorId(null);
      setMaxParticipants(DEFAULT_MAX_PARTICIPANTS);
      setCustomSlugInput("");
      setSlugStatus("idle");
      setScheduleMode("single");
      setDailyDays(7);
      setWeeklyCount(3);

      onSessionCreated();
      onClose();
    } catch (err: any) {
      console.error("❌ Error creating session(s):", err);

      const msg = String(err?.message || "");
      if (
        msg.toLowerCase().includes("custom_slug") &&
        msg.toLowerCase().includes("duplicate")
      ) {
        setError("This custom link is already taken. Pick another one.");
      } else {
        setError(err.message || "Failed to create session(s)");
      }
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  const hostName = profile?.full_name || user?.email || "Unknown host";
  const minDateTime = nowLocalForDatetimeInput();

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";

  const isSeries = scheduleMode !== "single";

  const linkPreview = sanitizedSlug
    ? isSeries
      ? `${origin}/room/${makeDatedSlug(
        sanitizedSlug,
        new Date(scheduledAt || Date.now())
      )} …`
      : `${origin}/room/${sanitizedSlug}`
    : `${origin}/room/<your-link>`;

  const slugHint = !customSlugInput
    ? "Optional. Your own short link instead of UUID."
    : !slugValid
      ? `Invalid. Use ${SLUG_MIN}-${SLUG_MAX} chars: a-z, 0-9, - or _.`
      : isSeries
        ? "Series mode: date suffix will be added automatically (yyyy-mm-dd)."
        : slugStatus === "checking"
          ? "Checking availability…"
          : slugStatus === "taken"
            ? "Taken. Pick another."
            : slugStatus === "available"
              ? "Available ✓"
              : "";

  const slugHintColor =
    !slugValid || slugStatus === "taken"
      ? "text-red-600"
      : slugStatus === "available"
        ? "text-emerald-600"
        : "text-gray-500";

  const createDisabled =
    !title ||
    !scheduledAt ||
    (!studioEnabled && !selectedTemplate) ||
    (studioEnabled && studioBlocks.length === 0) ||
    (sanitizedSlug ? !slugValid : false) ||
    (scheduleMode === "single" && sanitizedSlug
      ? slugStatus === "taken" || slugStatus === "checking"
      : false) ||
    !!scheduleAdvanceError ||
    isCreating;

  const overlayClass =
    "fixed inset-0 bg-black/50 z-50 p-2 sm:p-3 md:p-4 flex items-center justify-center";

  const panelClass =
    "bg-white w-full h-full rounded-[20px] shadow-2xl flex flex-col overflow-hidden";

  return (
    <div className={overlayClass}>
      <div className={panelClass}>
        {/* HEADER */}
        <div className="px-3 sm:px-6 pt-4 sm:pt-5">
          <div className="flex justify-between items-center">
            <h2 className="text-[20px] font-bold text-brandBlack font-inter">
              Create focus session
            </h2>

            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 transition"
              aria-label="Close"
              type="button"
            >
              <X size={22} />
            </button>
          </div>
        </div>

        {/* BODY (scrolls) */}
        <div
          ref={modalScrollRef}
          className="px-3 sm:px-6 pb-3 sm:pb-4 pt-3 sm:pt-4 flex-1 overflow-y-auto"
        >
          {loading || !user ? (
            <p className="text-sm text-gray-500 font-inter">
              {loading
                ? "Checking your account..."
                : "You must be logged in to create a session."}
            </p>
          ) : (
            <div className="space-y-4 sm:space-y-5">
              {/* Row 1: Title + Start time */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-[14px] font-medium text-brandBlack mb-1 font-inter">
                    Session title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Deep Work Session"
                    className="w-full px-3 py-3 border border-gray-300 rounded-[16px] font-inter"
                  />
                </div>

                <div>
                  <label className="block text-[14px] font-medium text-brandBlack mb-1 font-inter">
                    Start time
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    min={minDateTime}
                    className="w-full px-3 py-3 border border-gray-300 rounded-[16px] font-inter"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-[14px] font-medium text-brandBlack mb-1 font-inter">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional. Describe what this session is about, who it’s for, or what people should expect."
                  rows={4}
                  className="w-full px-3 py-3 border border-gray-300 rounded-[16px] font-inter resize-y"
                />
              </div>

              {/* Row 2: Scheduling + Custom link */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                {/* Scheduling */}
                <div className="border border-gray-200 rounded-[18px] bg-white p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 p-2 rounded-[14px] bg-[#111827] text-white flex items-center justify-center shrink-0">
                      <CalendarDays size={18} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-inter font-semibold text-[14px] text-brandBlack">
                          Scheduling (in advance)
                        </div>
                        <div className="font-inter text-[12px] text-gray-500 whitespace-nowrap">
                          Max: {MAX_ADVANCE_DAYS} days
                        </div>
                      </div>

                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setScheduleMode("single")}
                          className={
                            "px-3 py-2 rounded-full border text-[12px] font-inter transition " +
                            (scheduleMode === "single"
                              ? "border-brandBlack bg-brandBlack text-white"
                              : "border-gray-200 hover:bg-gray-50 text-brandBlack")
                          }
                        >
                          Single
                        </button>

                        <button
                          type="button"
                          onClick={() => setScheduleMode("weekly")}
                          className={
                            "px-3 py-2 rounded-full border text-[12px] font-inter transition inline-flex items-center gap-2 " +
                            (scheduleMode === "weekly"
                              ? "border-brandBlack bg-brandBlack text-white"
                              : "border-gray-200 hover:bg-gray-50 text-brandBlack")
                          }
                        >
                          <Repeat size={14} />
                          Weekly
                        </button>

                        <button
                          type="button"
                          onClick={() => setScheduleMode("daily")}
                          className={
                            "px-3 py-2 rounded-full border text-[12px] font-inter transition inline-flex items-center gap-2 " +
                            (scheduleMode === "daily"
                              ? "border-brandBlack bg-brandBlack text-white"
                              : "border-gray-200 hover:bg-gray-50 text-brandBlack")
                          }
                        >
                          <Repeat size={14} />
                          Daily
                        </button>

                        <div className="w-full sm:w-auto sm:ml-auto font-inter text-[12px] text-gray-500">
                          Creates:{" "}
                          <span className="font-semibold text-brandBlack">
                            {occurrencesCount}
                          </span>
                        </div>
                      </div>

                      {scheduleMode === "weekly" && (
                        <div className="mt-3">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                type="button"
                                onClick={() => setWeeklyCount(2)}
                                className="px-3 py-2 rounded-full border border-gray-200 text-[12px] font-inter hover:bg-gray-50 transition"
                                disabled={dynamicMaxOccurrences < 2}
                              >
                                2 sessions
                              </button>
                              <button
                                type="button"
                                onClick={() => setWeeklyCount(3)}
                                className="px-3 py-2 rounded-full border border-gray-200 text-[12px] font-inter hover:bg-gray-50 transition"
                                disabled={dynamicMaxOccurrences < 3}
                              >
                                3 sessions
                              </button>
                            </div>

                            <div className="font-inter text-[12px] text-gray-600">
                              Sessions:{" "}
                              <span className="font-semibold text-brandBlack">
                                {clamp(
                                  Number(weeklyCount) || 1,
                                  1,
                                  dynamicMaxOccurrences
                                )}
                              </span>
                            </div>
                          </div>

                          <input
                            type="range"
                            min={1}
                            max={dynamicMaxOccurrences}
                            value={clamp(
                              Number(weeklyCount) || 1,
                              1,
                              dynamicMaxOccurrences
                            )}
                            onChange={(e) =>
                              setWeeklyCount(
                                clamp(
                                  Number(e.target.value) || 1,
                                  1,
                                  dynamicMaxOccurrences
                                )
                              )
                            }
                            className="mt-3 w-full"
                          />

                          <div className="mt-2 text-[12px] font-inter text-gray-500">
                            Same weekday and time every week.
                          </div>
                        </div>
                      )}

                      {scheduleMode === "daily" && (
                        <div className="mt-3">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                type="button"
                                onClick={() => setDailyDays(7)}
                                className="px-3 py-2 rounded-full border border-gray-200 text-[12px] font-inter hover:bg-gray-50 transition"
                                disabled={dynamicMaxOccurrences < 7}
                              >
                                7 days
                              </button>
                              <button
                                type="button"
                                onClick={() => setDailyDays(14)}
                                className="px-3 py-2 rounded-full border border-gray-200 text-[12px] font-inter hover:bg-gray-50 transition"
                                disabled={dynamicMaxOccurrences < 14}
                              >
                                14 days
                              </button>
                            </div>

                            <div className="font-inter text-[12px] text-gray-600">
                              Days:{" "}
                              <span className="font-semibold text-brandBlack">
                                {clamp(
                                  Number(dailyDays) || 1,
                                  1,
                                  dynamicMaxOccurrences
                                )}
                              </span>
                            </div>
                          </div>

                          <input
                            type="range"
                            min={1}
                            max={dynamicMaxOccurrences}
                            value={clamp(
                              Number(dailyDays) || 1,
                              1,
                              dynamicMaxOccurrences
                            )}
                            onChange={(e) =>
                              setDailyDays(
                                clamp(
                                  Number(e.target.value) || 1,
                                  1,
                                  dynamicMaxOccurrences
                                )
                              )
                            }
                            className="mt-3 w-full"
                          />

                          <div className="mt-2 text-[12px] font-inter text-gray-500">
                            Same time each day.
                          </div>
                        </div>
                      )}

                      {occurrencesPreview.length > 1 && (
                        <div className="mt-3 border border-gray-200 rounded-[14px] p-3 bg-gray-50">
                          <div className="text-[12px] font-inter text-gray-600">
                            Will create:
                          </div>
                          <div className="mt-1 text-[12px] font-inter text-gray-800 space-y-1">
                            {occurrencesPreview.slice(0, 5).map((p, i) => (
                              <div key={i}>• {p}</div>
                            ))}
                          </div>
                        </div>
                      )}

                      {scheduleAdvanceError && (
                        <div className="mt-2 text-[12px] font-inter text-red-600">
                          {scheduleAdvanceError}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Custom link */}
                <div className="border border-gray-200 rounded-[18px] bg-white p-3 sm:p-4 overflow-hidden">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 p-2 rounded-[14px] bg-[#111827] text-white flex items-center justify-center shrink-0">
                      <Link2 size={18} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="font-inter font-semibold text-[14px] text-brandBlack">
                        Custom session link
                      </div>
                      <div className="font-inter text-[12px] text-gray-500">
                        {slugHint ||
                          "Optional. Your own short link instead of UUID."}
                      </div>

                      <div className="mt-3 min-w-0">
                        <input
                          value={customSlugInput}
                          onChange={(e) => setCustomSlugInput(e.target.value)}
                          placeholder="e.g., yaro-deep-work"
                          className="w-full px-3 py-3 border border-gray-300 rounded-[16px] font-inter"
                        />

                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 min-w-0">
                          <div
                            className={`text-[12px] font-inter ${slugHintColor} min-w-0`}
                          >
                            {customSlugInput
                              ? slugHint
                              : isSeries
                                ? "Optional. In series mode, we auto-add date suffix (yyyy-mm-dd)."
                                : "Allowed: a-z, 0-9, - or _. Lowercase."}
                          </div>

                          <div className="text-[12px] font-inter text-gray-500 min-w-0 truncate">
                            {linkPreview}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 text-[12px] font-inter text-gray-500">
                        Video server:{" "}
                        <span className="font-semibold text-brandBlack">
                          {FIXED_JITSI_DOMAIN}
                        </span>{" "}
                        (fixed)
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Templates */}
              <div>
                <label className="block text-[14px] font-medium text-brandBlack mb-2 font-inter">
                  Session format
                </label>

                <div className="max-h-48 overflow-y-auto pr-2 space-y-3">
                  {templates.length > 0 ? (
                    templates.map((t) => (
                      <label
                        key={t.id}
                        className="flex items-center gap-3 cursor-pointer"
                        onClick={() => {
                          setSelectedTemplate(t.id);
                          if (!title) setTitle(t.name);
                        }}
                      >
                        <input
                          type="radio"
                          name="session-template"
                          value={t.id}
                          checked={selectedTemplate === t.id}
                          onChange={() => { }}
                          className="w-4 h-4 text-brandBlack"
                        />

                        <img
                          src={`/icons/${(t as any).icon || t.name.toLowerCase()}.svg`}
                          className="w-4 h-4"
                          alt=""
                          draggable={false}
                        />

                        <span className="text-[16px] text-brandBlack font-inter">
                          {t.name} ({(t as any).total_duration} min)
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="text-sm text-gray-500 font-inter">
                      Loading templates...
                    </p>
                  )}
                </div>

                {studioEnabled && (
                  <p className="mt-2 text-[12px] text-gray-500 font-inter">
                    Tip: when Session Studio is enabled, selecting a format is
                    optional.
                  </p>
                )}
              </div>

              {/* SESSION STUDIO */}
              <div className="border border-[#DBD8D8] rounded-[18px] bg-white p-3 sm:p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 p-2 rounded-[14px] bg-[#111827] text-white flex items-center justify-center shrink-0">
                      <Layers size={18} />
                    </div>

                    <div className="min-w-0">
                      <div className="font-inter font-semibold text-[14px] text-brandBlack">
                        Session Studio
                      </div>
                      <div className="font-inter text-[12px] text-gray-500">
                        Build a custom session script.
                      </div>
                    </div>
                  </div>

                  {studioEnabled && (
                    <button
                      onClick={() => setStudioEnabled(false)}
                      className="px-4 py-2 rounded-full bg-brandBlack text-white text-[12px] font-inter hover:bg-black transition shrink-0"
                      type="button"
                    >
                      Close
                    </button>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer select-none min-w-0">
                    <input
                      type="checkbox"
                      checked={studioEnabled}
                      onChange={(e) => setStudioEnabled(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-[13px] text-brandBlack font-inter">
                      Use Session Studio for this session
                    </span>
                  </label>

                  <div className="text-[12px] text-gray-600 font-inter whitespace-nowrap">
                    Length: <span className="font-semibold">{studioTotal}</span>{" "}
                    min
                  </div>
                </div>

                <div className="mt-2 text-[12px] text-gray-500 font-inter">
                  Script saved into{" "}
                  <span className="font-medium">sessions.schedule</span>
                </div>

                {/* Participant limit */}
                <div className="mt-4 border border-gray-200 rounded-[16px] p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-[12px] bg-black/5 flex items-center justify-center shrink-0">
                      <Users size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-inter font-semibold text-[13px] text-brandBlack">
                        Participant limit
                      </div>
                      <div className="font-inter text-[12px] text-gray-500">
                        Default for all templates is {DEFAULT_MAX_PARTICIPANTS}.
                        Studio can set {MIN_PARTICIPANTS}–{MAX_PARTICIPANTS}.
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="number"
                      min={MIN_PARTICIPANTS}
                      max={MAX_PARTICIPANTS}
                      value={maxParticipants}
                      disabled={!studioEnabled}
                      onChange={(e) =>
                        setMaxParticipants(
                          clamp(
                            Number(e.target.value) || DEFAULT_MAX_PARTICIPANTS,
                            MIN_PARTICIPANTS,
                            MAX_PARTICIPANTS
                          )
                        )
                      }
                      className={
                        "w-28 px-3 py-2 border rounded-[14px] font-inter text-center " +
                        (studioEnabled
                          ? "border-gray-300"
                          : "border-gray-200 bg-gray-50 text-gray-500")
                      }
                    />
                    <span className="font-inter text-[12px] text-gray-600">
                      people
                    </span>

                    {!studioEnabled && (
                      <span className="ml-auto font-inter text-[12px] text-gray-500">
                        (Locked at {DEFAULT_MAX_PARTICIPANTS} when Studio is off)
                      </span>
                    )}
                  </div>
                </div>

                {studioEnabled && (
                    <div className="sticky top-0 z-20 mt-4 mb-4 -mx-1 px-1 py-3 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 border-b border-gray-100">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="text-[12px] text-gray-600 font-inter">
                        {selectedBlockIds.length > 0 ? (
                          <>
                            Selected:{" "}
                            <span className="font-semibold text-brandBlack">
                              {selectedBlockIds.length}
                            </span>
                            {" · "}Ctrl/Cmd+C to copy, Ctrl/Cmd+V to duplicate
                          </>
                        ) : (
                          <>Timeline stays pinned while you scroll.</>
                        )}
                      </div>
                    </div>
                    <SessionTimeline blocks={studioBlocks} />
                  </div>
                )}

                {studioEnabled && (
                  <div className="mt-3">
                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      <button
                        onClick={importFromTemplate}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-gray-200 text-[12px] font-inter hover:bg-gray-50 transition"
                        title="Import blocks from selected format/template"
                        type="button"
                      >
                        <Wand2 size={14} />
                        Import from format
                      </button>

                      <button
                        onClick={resetDefaultStudio}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-gray-200 text-[12px] font-inter hover:bg-gray-50 transition"
                        title="Reset to default script"
                        type="button"
                      >
                        <RotateCcw size={14} />
                        Reset default
                      </button>

                      <button
                        onClick={clearStudio}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-gray-200 text-[12px] font-inter hover:bg-gray-50 transition"
                        title="Clear script"
                        type="button"
                      >
                        <Eraser size={14} />
                        Clear
                      </button>
                    </div>

                    <div className="mt-2 text-[12px] text-gray-500 font-inter">
                      Tip: Ctrl/Cmd-click for multi-select. Shift-click for range
                      selection. Ctrl/Cmd+C and Ctrl/Cmd+V duplicate selected
                      blocks.
                    </div>

                      <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                      {/* Library */}
                      <div className="lg:sticky lg:top-4 self-start border border-gray-200 rounded-[18px] p-3 sm:p-4 bg-white">
                        <div>
                          <div className="font-inter font-semibold text-[13px] text-brandBlack">
                            Block Library
                          </div>
                          <div className="font-inter text-[12px] text-gray-500">
                            Add blocks to the script (cards, not rows).
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3">
                          {STUDIO_LIBRARY.map((b) => (
                            <button
                              key={b.id}
                              onClick={() => addFromLibrary(b)}
                              className="text-left border border-gray-200 rounded-[14px] p-3 hover:bg-gray-50 transition"
                              type="button"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-inter font-semibold text-[12px] text-brandBlack">
                                  {b.title}
                                </div>
                                <div className="font-inter text-[12px] text-gray-500 whitespace-nowrap">
                                  {b.minutes}m
                                </div>
                              </div>
                              <div className="mt-1 font-inter text-[12px] text-gray-500 leading-snug">
                                {b.note}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Script */}
                      <div
                        className="border border-gray-200 rounded-[18px] p-3 sm:p-4 bg-white"
                        onDragOver={(e) => {
                          if (!draggingId) return;
                          updateAutoScrollFromClientY(e.clientY);
                        }}
                        onDragLeave={() => {
                          if (!draggingId) return;
                          autoScrollVelRef.current = 0;
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-inter font-semibold text-[13px] text-brandBlack">
                              Script
                            </div>
                            <div className="font-inter text-[12px] text-gray-500">
                              Reorder with drag & drop, keyboard ↑/↓, or arrows.
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="font-inter text-[12px] text-gray-500">
                              Total:
                            </div>
                            <div className="font-inter font-semibold text-[12px] text-brandBlack whitespace-nowrap">
                              {studioTotal} min
                            </div>
                          </div>
                        </div>

                        {studioBlocks.length === 0 ? (
                          <div className="mt-4 text-[12px] text-gray-500 font-inter">
                            No blocks yet. Add from the library on the left.
                          </div>
                        ) : (
                          <div className="mt-3 space-y-2 sm:space-y-3">
                            {studioBlocks.map((b, idx) => {
                              const selected = selectedBlockIds.includes(b.id);
                              const isDragging = draggingId === b.id;

                              const isOverSelf =
                                dragOverId === b.id &&
                                draggingId &&
                                draggingId !== b.id;

                              return (
                                <div
                                  key={b.id}
                                  id={`studio-block-${b.id}`}
                                  tabIndex={0}
                                  draggable
                                  onClick={(e) => handleBlockSurfaceClick(e, b.id)}
                                  onFocus={() => {
                                    setActiveBlockId(b.id);
                                    if (!selectedBlockIds.includes(b.id)) {
                                      setSelectedBlockIds([b.id]);
                                      setSelectionAnchorId(b.id);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
                                      if (!isInteractiveEl(e.target)) {
                                        e.preventDefault();
                                        copySelectedBlocks();
                                      }
                                      return;
                                    }

                                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
                                      if (!isInteractiveEl(e.target)) {
                                        e.preventDefault();
                                        pasteCopiedBlocks();
                                      }
                                      return;
                                    }

                                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
                                      if (!isInteractiveEl(e.target)) {
                                        e.preventDefault();
                                        const allIds = studioBlocks.map((x) => x.id);
                                        setSelectedBlockIds(allIds);
                                        setActiveBlockId(allIds[0] || null);
                                        setSelectionAnchorId(allIds[0] || null);
                                      }
                                      return;
                                    }

                                    if (e.key === "ArrowUp") {
                                      e.preventDefault();
                                      moveBlock(b.id, -1);
                                    } else if (e.key === "ArrowDown") {
                                      e.preventDefault();
                                      moveBlock(b.id, 1);
                                    } else if (
                                      e.key === "Delete" ||
                                      e.key === "Backspace"
                                    ) {
                                      if (!isInteractiveEl(e.target)) {
                                        e.preventDefault();
                                        if (selectedBlockIds.length > 1 && selectedBlockIds.includes(b.id)) {
                                          deleteSelectedBlocks();
                                        } else {
                                          removeBlock(b.id);
                                        }
                                      }
                                    }
                                  }}
                                  onDragStart={(e) => {
                                    if (isInteractiveEl(e.target)) {
                                      e.preventDefault();
                                      return;
                                    }

                                    if (!selectedBlockIds.includes(b.id)) {
                                      setSelectedBlockIds([b.id]);
                                      setActiveBlockId(b.id);
                                      setSelectionAnchorId(b.id);
                                    }

                                    setDraggingId(b.id);
                                    setDragOverId(null);
                                    setDropEdge("after");

                                    try {
                                      e.dataTransfer.effectAllowed = "move";
                                      e.dataTransfer.setData(
                                        "text/plain",
                                        b.id
                                      );
                                      setTransparentDragImage(e.dataTransfer);
                                    } catch {
                                      // ignore
                                    }

                                    startAutoScrollLoop();
                                  }}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    if (!draggingId) return;

                                    updateAutoScrollFromClientY(e.clientY);

                                    const rect = (
                                      e.currentTarget as HTMLElement
                                    ).getBoundingClientRect();
                                    const mid = rect.top + rect.height / 2;
                                    const edge: "before" | "after" =
                                      e.clientY < mid ? "before" : "after";

                                    if (dragOverId !== b.id) setDragOverId(b.id);
                                    if (dropEdge !== edge) setDropEdge(edge);
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();

                                    const dragIdFromData = (() => {
                                      try {
                                        return (
                                          e.dataTransfer.getData("text/plain") ||
                                          ""
                                        );
                                      } catch {
                                        return "";
                                      }
                                    })();

                                    const dragId = draggingId || dragIdFromData;
                                    if (dragId)
                                      moveBlockTo(dragId, b.id, dropEdge);

                                    setDraggingId(null);
                                    setDragOverId(null);
                                    setDropEdge("after");

                                    stopAutoScrollLoop();
                                  }}
                                  onDragEnd={() => {
                                    setDraggingId(null);
                                    setDragOverId(null);
                                    setDropEdge("after");
                                    stopAutoScrollLoop();
                                  }}
                                  className={
                                    "relative border rounded-[16px] p-2.5 sm:p-3 outline-none transition " +
                                    "cursor-grab active:cursor-grabbing " +
                                    (selected
                                      ? "border-brandBlack ring-2 ring-black/10 bg-black/[0.03]"
                                      : "border-gray-200") +
                                    (isDragging ? " opacity-60" : "") +
                                    " hover:bg-gray-50"
                                  }
                                  title="Drag to reorder. Click + use ↑/↓ to move."
                                >
                                  {isOverSelf && (
                                    <div
                                      className={
                                        "pointer-events-none absolute left-3 right-3 h-[3px] rounded-full bg-brandBlack/80 " +
                                        (dropEdge === "before"
                                          ? "-top-[6px]"
                                          : "-bottom-[6px]")
                                      }
                                    />
                                  )}

                                  <div className="flex items-center justify-between gap-2">
                                    <span className="px-2 py-1 rounded-full border border-gray-200 text-[10px] sm:text-[11px] font-inter text-gray-600 whitespace-nowrap">
                                      {b.kind}
                                    </span>

                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          moveBlock(b.id, -1);
                                        }}
                                        disabled={idx === 0}
                                        className="w-8 h-8 sm:w-9 sm:h-9 rounded-[12px] border border-gray-200 flex items-center justify-center disabled:opacity-40 hover:bg-gray-50 transition"
                                        type="button"
                                        title="Move up"
                                      >
                                        <ArrowUp size={16} />
                                      </button>

                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          moveBlock(b.id, 1);
                                        }}
                                        disabled={idx === studioBlocks.length - 1}
                                        className="w-8 h-8 sm:w-9 sm:h-9 rounded-[12px] border border-gray-200 flex items-center justify-center disabled:opacity-40 hover:bg-gray-50 transition"
                                        type="button"
                                        title="Move down"
                                      >
                                        <ArrowDown size={16} />
                                      </button>

                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeBlock(b.id);
                                        }}
                                        className="w-8 h-8 sm:w-9 sm:h-9 rounded-[12px] border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition"
                                        type="button"
                                        title="Remove"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="mt-2">
                                    <input
                                      value={b.title}
                                      onChange={(e) =>
                                        updateBlock(b.id, { title: e.target.value })
                                      }
                                      className="w-full px-3 py-2.5 border border-gray-200 rounded-[14px] text-[13px] font-inter"
                                      placeholder="Block title…"
                                      onClick={(e) => e.stopPropagation()}
                                      onFocus={() => {
                                        setActiveBlockId(b.id);
                                        if (!selectedBlockIds.includes(b.id)) {
                                          setSelectedBlockIds([b.id]);
                                          setSelectionAnchorId(b.id);
                                        }
                                      }}
                                    />
                                  </div>

                                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <span className="text-[12px] text-gray-500 font-inter shrink-0">
                                      Minutes
                                    </span>

                                    <div
                                      className="flex items-center gap-1 sm:gap-2 flex-nowrap shrink-0"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        type="button"
                                        onClick={() =>
                                          updateBlock(b.id, {
                                            minutes: clamp(b.minutes - 1, 1, 24 * 60),
                                          })
                                        }
                                        className="w-8 h-8 sm:w-9 sm:h-9 rounded-[12px] border border-gray-200 hover:bg-gray-50 transition"
                                      >
                                        –
                                      </button>

                                      <input
                                        type="number"
                                        value={b.minutes}
                                        onChange={(e) =>
                                          updateBlock(b.id, {
                                            minutes: clamp(
                                              Number(e.target.value) || 1,
                                              1,
                                              24 * 60
                                            ),
                                          })
                                        }
                                        className="w-14 sm:w-16 h-8 sm:h-9 px-2 border border-gray-200 rounded-[12px] text-[13px] font-inter text-center"
                                        onFocus={() => {
                                          setActiveBlockId(b.id);
                                          if (!selectedBlockIds.includes(b.id)) {
                                            setSelectedBlockIds([b.id]);
                                            setSelectionAnchorId(b.id);
                                          }
                                        }}
                                      />

                                      <button
                                        type="button"
                                        onClick={() =>
                                          updateBlock(b.id, {
                                            minutes: clamp(b.minutes + 1, 1, 24 * 60),
                                          })
                                        }
                                        className="w-8 h-8 sm:w-9 sm:h-9 rounded-[12px] border border-gray-200 hover:bg-gray-50 transition"
                                      >
                                        +
                                      </button>

                                      <span className="hidden sm:inline text-[12px] text-gray-500 font-inter whitespace-nowrap">
                                        min
                                      </span>
                                    </div>
                                  </div>

                                  <div
                                    className="mt-2 flex items-center gap-2 flex-wrap"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {QUICK_MINUTES.map((m) => (
                                      <button
                                        key={m}
                                        type="button"
                                        onClick={() => updateBlock(b.id, { minutes: m })}
                                        className="px-2.5 py-1.5 rounded-full border border-gray-200 text-[11px] sm:text-[12px] font-inter hover:bg-gray-50 transition"
                                      >
                                        {m}m
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}

                            {draggingId && (
                              <div
                                className="relative h-10 rounded-[14px] border border-dashed border-gray-200 bg-gray-50/60"
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  updateAutoScrollFromClientY(e.clientY);
                                  if (dragOverId !== END_DROP_ID)
                                    setDragOverId(END_DROP_ID);
                                  if (dropEdge !== "after") setDropEdge("after");
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  const dragIdFromData = (() => {
                                    try {
                                      return (
                                        e.dataTransfer.getData("text/plain") || ""
                                      );
                                    } catch {
                                      return "";
                                    }
                                  })();
                                  const dragId = draggingId || dragIdFromData;
                                  if (dragId) moveBlockTo(dragId, END_DROP_ID, "after");

                                  setDraggingId(null);
                                  setDragOverId(null);
                                  setDropEdge("after");
                                  stopAutoScrollLoop();
                                }}
                              >
                                {dragOverId === END_DROP_ID && (
                                  <div className="pointer-events-none absolute left-3 right-3 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-brandBlack/70" />
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {error && <p className="text-red-600 text-sm font-inter mt-4">{error}</p>}
              </div>
            </div>
          )}
        </div>

        {/* FOOTER */}
        {!loading && user && (
          <div className="px-3 sm:px-6 pb-4 sm:pb-5 pt-3 border-t border-gray-100 bg-white">
            <button
              onClick={handleCreate}
              disabled={createDisabled}
              className="w-full bg-brandBlack text-white py-3 rounded-[42px] font-medium text-[15px] font-inter hover:bg-black disabled:bg-gray-300 transition"
              type="button"
            >
              {isCreating
                ? "Creating..."
                : scheduleMode === "single"
                  ? "Create session"
                  : "Create series"}
            </button>

            <p className="text-xs text-gray-400 mt-3 text-center font-inter">
              Hosted by <span className="font-medium">{hostName}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}