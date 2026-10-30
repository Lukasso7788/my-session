// src/components/CreateSessionModal.tsx
// Full file replacement
// ✅ Added session description field + save to sessions.description
// ✅ Removed server region picker entirely (no auto/manual domain in modal)
// ✅ All sessions created with fixed EU domain: jitsi.mysession.club
// ✅ Added host auto-booking after session creation
// ✅ Added Session Studio multi-select + Ctrl/Cmd+C + Ctrl/Cmd+V duplication
// ✅ Added block library
// ✅ NEW: Save current Session Studio script into "My templates"
// ✅ NEW: Load and apply "My templates" inside modal
// ✅ NEW: Load and apply "My previous sessions" inside modal

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
  ArrowLeft,
  ArrowRight,
  Trash2,
  RotateCcw,
  Eraser,
  Link2,
  CalendarDays,
  Bookmark,
  Save,
  History,
  Info,
  ChevronDown,
  Minus,
  Plus,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { assignServerForSession } from "../lib/livekitPlacement";
import { useAuth } from "../context/AuthContext";
import { useLocation, useNavigate } from "react-router-dom";
import { resolveStageVisual } from "./SessionStageBar";
import { withRoomPolicies } from "../lib/roomPolicies";
import { CHECK_IN_BREAK_TITLE, INTENTIONS_COLOR, isCheckInBreakName } from "../lib/checkInBreak";
import { isCurrentUserAdmin } from "../lib/bans";
import {
  DEFAULT_BOOKEND_MINUTES,
  GOALS_PHASE_COLOR,
  GOALS_PHASE_TITLE,
  PROGRESS_PHASE_COLOR,
  PROGRESS_PHASE_TITLE,
  bookendIssueMessage,
  bookendIssues,
  withBookendPhases,
} from "../lib/sessionBookends";
import CreateKindSwitch, { requestInfiniteRoomCreator } from "./CreateKindSwitch";
import UiIcon from "./UiIcon";

interface CreateSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionCreated: () => void;
}

type SessionTemplate = {
  id: string;
  name: string | null;
  total_duration?: number | null;
  blocks?: any;
  schedule?: any;
};

// ✅ Fixed EU domain (no picker in UI)
const FIXED_JITSI_DOMAIN = "jitsi.mysession.club";

function nowLocalForDatetimeInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function getScheduledDatePart(value: string) {
  return String(value || "").slice(0, 10);
}

function getScheduledTimePart(value: string) {
  return String(value || "").slice(11, 16);
}

function combineScheduledDateTime(args: {
  current: string;
  date?: string;
  time?: string;
}) {
  const currentDate = getScheduledDatePart(args.current);
  const currentTime = getScheduledTimePart(args.current);
  const fallback = nowLocalForDatetimeInput();
  const date = String(args.date ?? currentDate ?? "").trim();
  const time = String(args.time ?? currentTime ?? "").trim();

  if (!date && !time) return "";

  return `${date || fallback.slice(0, 10)}T${time || fallback.slice(11, 16)}`;
}

// ===============================
// Form layout.


const SECTION_CARD = "min-w-0";
const PRESET_TILE = "flex h-[52px] min-w-0 items-center gap-2.5 rounded-[12px] border px-2.5 text-left transition ";
const PRESET_TILE_ON = "border-[#2F2F2F] bg-[#2F2F2F] text-white";
const PRESET_TILE_OFF = "border-[#E3E5E8] bg-white text-[#15171A] hover:border-[#2F2F2F]/50";
const PRESET_TILE_ICON = "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]";
const FIELD_LABEL = "block font-inter text-[12.5px] font-semibold text-[#15171A]";
const FIELD_INPUT =
  "h-11 w-full rounded-[12px] border border-[#D8DCE3] bg-white px-3.5 font-inter text-[14px] text-[#344054] outline-none transition focus:border-[#2F2F2F] focus:ring-2 focus:ring-[#2F2F2F]/10";

function SectionHeading({ step, title, id, children }: { step: number; title: string; id?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2F2F2F] font-inter text-[11px] font-semibold text-white">
        {step}
      </span>
      <div className="min-w-0 flex-1">
        <h3 id={id} className="font-inter text-[15.5px] font-bold leading-6 text-[#15171A]">{title}</h3>
        {children ? <div className="font-inter text-[12.5px] leading-5 text-[#667085]">{children}</div> : null}
      </div>
    </div>
  );
}

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
  return 0;
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

function isWeekdayLocal(d: Date) {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

function moveToNextWeekdayLocal(base: Date) {
  const d = new Date(base);
  while (!isWeekdayLocal(d)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function buildScheduledDates(args: {
  base: Date;
  mode: ScheduleMode;
  count: number;
  maxDate: Date;
  weekdaysOnly?: boolean;
}) {
  const { base, mode, count, maxDate, weekdaysOnly = false } = args;

  if (!Number.isFinite(base.getTime()) || !Number.isFinite(maxDate.getTime())) {
    return [];
  }

  if (count <= 0) return [];

  if (mode === "single") {
    return base.getTime() <= maxDate.getTime() ? [new Date(base)] : [];
  }

  if (mode === "weekly") {
    const out: Date[] = [];
    for (let i = 0; i < count; i++) {
      const d = addDaysLocal(base, i * 7);
      if (d.getTime() > maxDate.getTime()) break;
      out.push(d);
    }
    return out;
  }

  const out: Date[] = [];
  let cursor = new Date(base);

  if (weekdaysOnly) {
    cursor = moveToNextWeekdayLocal(cursor);
  }

  while (out.length < count && cursor.getTime() <= maxDate.getTime()) {
    if (!weekdaysOnly || isWeekdayLocal(cursor)) {
      out.push(new Date(cursor));
    }
    cursor = addDaysLocal(cursor, 1);
  }

  return out;
}

function countAvailableOccurrences(args: {
  base: Date;
  mode: ScheduleMode;
  maxDate: Date;
  weekdaysOnly?: boolean;
  hardCap: number;
}) {
  const dates = buildScheduledDates({
    base: args.base,
    mode: args.mode,
    count: args.hardCap,
    maxDate: args.maxDate,
    weekdaysOnly: args.weekdaysOnly,
  });

  return dates.length;
}

// ===============================
// Custom slug helpers
// ===============================
const SLUG_MIN = 3;
const SLUG_MAX = 40;

function sanitizeSlug(input: string) {
  const raw = String(input || "")
    .trim()
    .toLowerCase();
  const spaced = raw.replace(/\s+/g, "-");
  const clean = spaced.replace(/[^a-z0-9-_]/g, "");
  return clean;
}

function isValidSlug(slug: string) {
  if (!slug) return true;
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
  const suffix = ymdLocal(dateLocal);
  const extra = 1 + suffix.length;
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

type PresetKey = "15-3" | "25-5" | "50-10";
type AccessMode = "public" | "private";

const CREATE_SESSION_ACCENT = "#2F2F2F";

const SESSION_PRESETS: Array<{
  key: PresetKey;
  label: string;
  focus: string;
  breakLabel: string;
  focusMinutes: number;
  breakMinutes: number;
  icon: "zap" | "tomato" | "target";
}> = [
    {
      key: "15-3",
      label: "15 / 3",
      focus: "15m focus",
      breakLabel: "3m break",
      focusMinutes: 15,
      breakMinutes: 3,
      icon: "zap",
    },
    {
      key: "25-5",
      label: "25 / 5",
      focus: "25m focus",
      breakLabel: "5m break",
      focusMinutes: 25,
      breakMinutes: 5,
      icon: "tomato",
    },
    {
      key: "50-10",
      label: "50 / 10",
      focus: "50m focus",
      breakLabel: "10m break",
      focusMinutes: 50,
      breakMinutes: 10,
      icon: "target",
    },
  ];

function templateMatchesPreset(
  template: SessionTemplate,
  preset: (typeof SESSION_PRESETS)[number],
) {
  const name = String(template?.name || "").toLowerCase();
  const compactName = name.replace(/\s+/g, "");

  if (
    compactName.includes(`${preset.focusMinutes}/${preset.breakMinutes}`) ||
    compactName.includes(`${preset.focusMinutes}-${preset.breakMinutes}`)
  ) {
    return true;
  }

  const blocks = normalizeTemplateBlocks(
    (template as any)?.blocks || (template as any)?.schedule,
  );

  const firstFocus = blocks.find((block) => block.kind === "focus");
  const firstBreak = blocks.find((block) => block.kind === "break");

  return (
    Number(firstFocus?.minutes) === preset.focusMinutes &&
    Number(firstBreak?.minutes) === preset.breakMinutes
  );
}

function buildPresetCycleBlocks(
  preset: (typeof SESSION_PRESETS)[number],
  cycles: number,
): StudioBlock[] {
  const safeCycles = clamp(Math.round(Number(cycles) || 1), 1, 12);
  const blocks: StudioBlock[] = [
    {
      id: `preset-${preset.key}-goals`,
      kind: "intentions",
      title: GOALS_PHASE_TITLE,
      note: "Everyone says what they'll work on",
      minutes: DEFAULT_BOOKEND_MINUTES,
      color: GOALS_PHASE_COLOR,
    },
  ];

  for (let index = 0; index < safeCycles; index += 1) {
    blocks.push({
      id: `preset-${preset.key}-focus-${index + 1}`,
      kind: "focus",
      title: `Focus ${index + 1}`,
      note: `${preset.focusMinutes}-minute focus block`,
      minutes: preset.focusMinutes,
      color: getDefaultBlockColor("focus"),
    });

    // The last focus block flows straight into sharing progress.
    if (index === safeCycles - 1) break;

    blocks.push({
      id: `preset-${preset.key}-break-${index + 1}`,
      kind: "break",
      title: CHECK_IN_BREAK_TITLE,
      note: `${preset.breakMinutes}-minute quick check-in and break`,
      minutes: preset.breakMinutes,
      color: INTENTIONS_COLOR,
    });
  }

  blocks.push({
    id: `preset-${preset.key}-progress`,
    kind: "recap",
    title: PROGRESS_PHASE_TITLE,
    note: "Everyone shares what they got done",
    minutes: DEFAULT_BOOKEND_MINUTES,
    color: PROGRESS_PHASE_COLOR,
  });

  return blocks;
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
  color?: string;
};

type UserSessionTemplateRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  base_template_id: string | null;
  source_session_id: string | null;
  blocks: any;
  default_title: string | null;
  default_description: string | null;
  default_max_participants: number | null;
  created_at: string;
  updated_at: string;
};

type PreviousSessionRow = {
  id: string;
  title: string;
  description: string | null;
  template_id: string | null;
  format: string | null;
  schedule: any;
  duration_minutes: number | null;
  max_participants: number | null;
  created_at: string | null;
  start_time: string | null;
};

type PublicSlugRow = {
  slug: string;
  owner_type: string | null;
  owner_id: string | null;
  host_user_id?: string | null;
  updated_at?: string | null;
};

type ExistingHostedSessionRow = {
  id: string;
  title?: string | null;
  start_time?: string | null;
  duration_minutes?: number | null;
  status?: string | null;
  session_format_type?: string | null;
};

type SessionTimeRange = {
  start: Date;
  end: Date;
  label: string;
};

function rangesOverlap(a: SessionTimeRange, b: SessionTimeRange) {
  // Touching boundaries are allowed: 10:00-11:00 and 11:00-12:00.
  return a.start.getTime() < b.end.getTime() &&
    a.end.getTime() > b.start.getTime();
}

function formatOverlapTime(date: Date) {
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

function inferStudioBlockKind(raw: any): StudioBlockKind {
  const candidates = [
    raw?.kind,
    raw?.type,
    raw?.stage_type,
    raw?.block_type,
    raw?.title,
    raw?.name,
    raw?.label,
  ]
    .map((v) =>
      String(v || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);

  const joined = candidates.join(" | ");

  if (
    joined.includes("welcome") ||
    joined.includes("intro") ||
    joined.includes("opening")
  ) {
    return "welcome";
  }

  if (
    joined.includes("intentions") ||
    joined.includes("intention") ||
    joined.includes("plan")
  ) {
    return "intentions";
  }

  if (
    joined.includes("focus") ||
    joined.includes("deep work") ||
    joined.includes("work block") ||
    joined.includes("pomodoro")
  ) {
    return "focus";
  }

  if (joined.includes("break") || joined.includes("rest")) {
    return "break";
  }

  if (
    joined.includes("check-in") ||
    joined.includes("checkin") ||
    joined.includes("checkpoint")
  ) {
    return "checkin";
  }

  if (
    joined.includes("recap") ||
    joined.includes("reflection") ||
    joined.includes("review") ||
    joined.includes("wrap up") ||
    joined.includes("wrap-up")
  ) {
    return "recap";
  }

  if (
    joined.includes("celebrate") ||
    joined.includes("closing") ||
    joined.includes("closure")
  ) {
    return "celebrate";
  }

  return "custom";
}

function normalizeTemplateBlocks(rawBlocks: any): StudioBlock[] {
  const parsed = safeJson(rawBlocks);
  if (!parsed) return [];

  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.blocks)
      ? parsed.blocks
      : Array.isArray(parsed?.schedule)
        ? parsed.schedule
        : Array.isArray(parsed?.stages)
          ? parsed.stages
          : Array.isArray(parsed?.items)
            ? parsed.items
            : [];

  return arr.map((b: any) => {
    const title = String(
      b?.title ||
      b?.name ||
      b?.label ||
      b?.stage_name ||
      b?.kind ||
      b?.type ||
      "Block",
    ).trim();

    const minutesRaw =
      b?.minutes ??
      b?.duration_minutes ??
      b?.duration ??
      b?.len ??
      b?.time ??
      b?.length ??
      5;

    const minutes = clamp(Number(minutesRaw) || 5, 1, 24 * 60);

    const kind = inferStudioBlockKind(b);

    // Templates saved "Break & check-in" in the break color; it is now
    // "Check-in & break" in the Intentions color.
    if (isCheckInBreakName(title)) {
      return {
        id: uid(),
        kind,
        title: CHECK_IN_BREAK_TITLE,
        note: String(b?.note || b?.description || b?.details || "").trim() || undefined,
        minutes,
        color: INTENTIONS_COLOR,
      };
    }

    const rawColor = String(
      b?.color || b?.colour || b?.bgColor || b?.backgroundColor || "",
    ).trim();

    return {
      id: uid(),
      kind,
      title,
      note:
        String(b?.note || b?.description || b?.details || "").trim() ||
        undefined,
      minutes,
      color: isValidHexColor(rawColor) ? rawColor : getDefaultBlockColor(kind),
    };
  });
}

function exportStudioToSchedule(blocks: StudioBlock[]) {
  return blocks.map((b, idx) => ({
    kind: b.kind,
    type: b.kind,
    title: b.title,
    name: b.title,
    minutes: b.minutes,
    note: b.note || null,
    color: getBlockColor(b),
    order: idx,
    v: 1,
  }));
}

const DEFAULT_CUSTOM_BLOCK_COLOR = "#F63135";

const QUICK_MINUTES = [3, 5, 10, 15, 25, 50];
const TIMELINE_MIN_SEGMENT_WIDTH = 6;
const TIMELINE_RESIZE_PX_PER_MINUTE = 4;

const BLOCK_COLOR_PRESETS = [
  "#F63135", // red
  "#4CA0FF", // blue
  "#80DF86", // green
  "#F9ADA2", // coral
  "#ADD3FF", // light blue
  "#A78BFA", // violet
  "#FBBF24", // amber
  "#22C55E", // emerald
  "#111827", // dark
];

function defaultStudioTitle(kind: StudioBlockKind) {
  switch (kind) {
    case "welcome":
      return "Welcome";
    case "intentions":
      return "Intentions";
    case "focus":
      return "Focus";
    case "break":
      return "Break";
    case "checkin":
      return "Check-in";
    case "recap":
      return "Recap";
    case "celebrate":
      return "Celebrate";
    case "custom":
    default:
      return "Custom";
  }
}

const STUDIO_KIND_OPTIONS: { value: StudioBlockKind; label: string }[] = [
  { value: "welcome", label: "Welcome" },
  { value: "intentions", label: "Intentions" },
  { value: "focus", label: "Focus" },
  { value: "break", label: "Break" },
  { value: "checkin", label: "Check-in" },
  { value: "recap", label: "Recap" },
  { value: "celebrate", label: "Celebrate" },
  { value: "custom", label: "Custom" },
];

const STUDIO_LIBRARY: StudioBlock[] = [
  { id: "lib_goals", kind: "intentions", title: GOALS_PHASE_TITLE, note: "Everyone says what they'll work on", minutes: DEFAULT_BOOKEND_MINUTES, color: GOALS_PHASE_COLOR },
  { id: "lib_focus", kind: "focus", title: "Focus", note: "Deep work block", minutes: 50 },
  { id: "lib_break", kind: "break", title: "Break", note: "Recharge / stretch", minutes: 10 },
  { id: "lib_checkin", kind: "checkin", title: "Check-in", note: "Short accountability checkpoint", minutes: 3 },
  { id: "lib_progress", kind: "recap", title: PROGRESS_PHASE_TITLE, note: "Everyone shares what they got done", minutes: DEFAULT_BOOKEND_MINUTES, color: PROGRESS_PHASE_COLOR },
  { id: "lib_welcome", kind: "welcome", title: "Welcome", note: "Quick intro / rules / vibe", minutes: 3 },
  { id: "lib_celebrate", kind: "celebrate", title: "Celebrate", note: "Closure + positive finish", minutes: 3 },
  { id: "lib_custom", kind: "custom", title: "Custom", note: "Any special block", minutes: 5, color: DEFAULT_CUSTOM_BLOCK_COLOR },
];

function formatMinutes(min: number) {
  const m = Math.max(0, Math.floor(min || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${mm}m`;
  if (mm === 0) return `${h}h`;
  return `${h}h ${mm}m`;
}

const STUDIO_INPUT =
  "rounded-[12px] border border-[#D8DCE3] bg-white px-3 font-inter text-[13px] text-[#15171A] outline-none focus:border-[#2F2F2F]";
const STUDIO_ICON_BUTTON =
  "flex h-8 w-8 items-center justify-center rounded-[10px] border border-[#D8DCE3] bg-white text-[#344054] hover:bg-[#F7F7F7]";
const STUDIO_TEXT_BUTTON =
  "h-8 rounded-[10px] border border-[#D8DCE3] bg-white px-2.5 font-inter text-[12px] font-semibold text-[#344054] hover:bg-[#F7F7F7]";

// The session flow editor: one segment per block with its name written in,
// sized by minutes. Click to select, drag or use the arrows to reorder, pull
// the right edge to resize.
function SessionTimeline({
  blocks,
  onChange,
  selectedBlockId,
  setSelectedBlockId,
}: {
  blocks: StudioBlock[];
  onChange: (blocks: StudioBlock[]) => void;
  selectedBlockId: string | null;
  setSelectedBlockId: (id: string | null) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  const total = blocks.reduce((s, b) => s + (Number(b.minutes) || 0), 0);

  const selectedBlock = useMemo(
    () => blocks.find((b) => b.id === selectedBlockId) || null,
    [blocks, selectedBlockId],
  );
  const selectedIndex = selectedBlock ? blocks.indexOf(selectedBlock) : -1;

  const rows = useMemo(() => {
    let acc = 0;
    return blocks.map((b) => {
      const start = acc;
      const end = acc + (Number(b.minutes) || 0);
      acc = end;
      return { ...b, start, end };
    });
  }, [blocks]);

  const move = useCallback(
    (fromId: string, toId: string) => {
      const from = blocks.findIndex((b) => b.id === fromId);
      const to = blocks.findIndex((b) => b.id === toId);
      if (from < 0 || to < 0 || from === to) return;

      const copy = [...blocks];
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      onChange(copy);
      setSelectedBlockId(item.id);
    },
    [blocks, onChange, setSelectedBlockId],
  );

  const moveByDelta = useCallback(
    (id: string, delta: -1 | 1) => {
      const from = blocks.findIndex((b) => b.id === id);
      if (from < 0) return;
      const to = from + delta;
      if (to < 0 || to >= blocks.length) return;

      const copy = [...blocks];
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      onChange(copy);
      setSelectedBlockId(item.id);
    },
    [blocks, onChange, setSelectedBlockId],
  );

  const update = useCallback(
    (id: string, patch: Partial<StudioBlock>) => {
      onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    },
    [blocks, onChange],
  );

  const remove = useCallback(
    (id: string) => {
      const idx = blocks.findIndex((b) => b.id === id);
      if (idx < 0) return;

      const copy = blocks.filter((b) => b.id !== id);
      onChange(copy);

      const next = copy[idx] || copy[idx - 1] || null;
      setSelectedBlockId(next ? next.id : null);
    },
    [blocks, onChange, setSelectedBlockId],
  );

  const duplicate = useCallback(
    (id: string) => {
      const idx = blocks.findIndex((b) => b.id === id);
      if (idx < 0) return;

      const clone: StudioBlock = { ...blocks[idx], id: uid() };
      const copy = [...blocks];
      copy.splice(idx + 1, 0, clone);
      onChange(copy);
      setSelectedBlockId(clone.id);
    },
    [blocks, onChange, setSelectedBlockId],
  );

  const insertAfter = useCallback(
    (id: string) => {
      const idx = blocks.findIndex((b) => b.id === id);
      if (idx < 0) return;

      const nextBlock: StudioBlock = {
        id: uid(),
        kind: "focus",
        title: "New block",
        note: "",
        minutes: 25,
        color: getDefaultBlockColor("focus"),
      };

      const copy = [...blocks];
      copy.splice(idx + 1, 0, nextBlock);
      onChange(copy);
      setSelectedBlockId(nextBlock.id);
    },
    [blocks, onChange, setSelectedBlockId],
  );

  return (
    <div className="mt-3 font-inter">
      <div className="flex items-center justify-between text-[12px] text-[#667085]">
        <span>Session timeline</span>
        <span>
          Total: <span className="font-semibold text-[#15171A]">{formatMinutes(total)}</span>
        </span>
      </div>

      <div className="mt-2 flex h-9 w-full overflow-hidden rounded-[10px] bg-[#E9EAEC]">
        {blocks.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center text-[12px] text-[#667085]">
            Add blocks to build a timeline
          </div>
        ) : (
          blocks.map((b) => {
            const mins = clamp(Number(b.minutes) || 1, 1, 24 * 60);
            const share = total > 0 ? mins / total : 0;
            const showText = share >= 0.1;
            const showMinutes = share >= 0.3;
            const isSelected = selectedBlockId === b.id;
            const visual = resolveStageVisual(b);

            return (
              <button
                key={b.id}
                type="button"
                draggable
                onDragStart={() => {
                  setDragId(b.id);
                  setSelectedBlockId(b.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== b.id) move(dragId, b.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== b.id) move(dragId, b.id);
                  setDragId(null);
                }}
                onDragEnd={() => setDragId(null)}
                onClick={() => setSelectedBlockId(b.id)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    moveByDelta(b.id, -1);
                  } else if (e.key === "ArrowRight") {
                    e.preventDefault();
                    moveByDelta(b.id, 1);
                  } else if (e.key === "Delete" || e.key === "Backspace") {
                    e.preventDefault();
                    remove(b.id);
                  }
                }}
                className="relative flex h-full min-w-0 items-center justify-center border-r border-white/70 outline-none last:border-r-0"
                style={{
                  flexGrow: mins,
                  flexBasis: 0,
                  minWidth: TIMELINE_MIN_SEGMENT_WIDTH,
                  backgroundColor: visual.color,
                  boxShadow: isSelected ? "inset 0 0 0 2px rgba(17,24,39,0.6)" : "none",
                }}
                title={`${b.title} · ${mins} min`}
              >
                {showText ? (
                  <span className="truncate px-1.5 font-inter text-[11px] font-medium text-[#15171A]">
                    {b.title}{showMinutes ? ` · ${mins}m` : ""}
                  </span>
                ) : null}

                <span
                  className="absolute bottom-0 right-0 top-0 w-[6px] cursor-ew-resize hover:bg-black/15"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const startX = e.clientX;
                    const startMinutes = mins;

                    const onMove = (ev: MouseEvent) => {
                      const deltaPx = ev.clientX - startX;
                      const next = clamp(
                        Math.round(startMinutes + deltaPx / TIMELINE_RESIZE_PX_PER_MINUTE),
                        1,
                        24 * 60,
                      );
                      update(b.id, { minutes: next });
                    };

                    const onUp = () => {
                      window.removeEventListener("mousemove", onMove);
                      window.removeEventListener("mouseup", onUp);
                    };

                    window.addEventListener("mousemove", onMove);
                    window.addEventListener("mouseup", onUp);
                  }}
                />
              </button>
            );
          })
        )}
      </div>

      {selectedBlock && (
        <div className="mt-3 rounded-[14px] border border-[#E6E8EC] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-[#15171A]">Edit selected block</div>
              <div className="mt-0.5 text-[11px] leading-4 text-[#667085]">
                Drag or use the arrows to reorder. Pull the right edge to resize.
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => moveByDelta(selectedBlock.id, -1)}
                disabled={selectedIndex <= 0}
                className={STUDIO_ICON_BUTTON + " disabled:opacity-40"}
                title="Move left"
                aria-label="Move left"
              >
                <ArrowLeft size={15} />
              </button>
              <button
                type="button"
                onClick={() => moveByDelta(selectedBlock.id, 1)}
                disabled={selectedIndex >= blocks.length - 1}
                className={STUDIO_ICON_BUTTON + " disabled:opacity-40"}
                title="Move right"
                aria-label="Move right"
              >
                <ArrowRight size={15} />
              </button>
              <button type="button" onClick={() => duplicate(selectedBlock.id)} className={STUDIO_TEXT_BUTTON}>
                Duplicate
              </button>
              <button type="button" onClick={() => insertAfter(selectedBlock.id)} className={STUDIO_TEXT_BUTTON}>
                Add after
              </button>
              <button
                type="button"
                onClick={() => remove(selectedBlock.id)}
                className={STUDIO_ICON_BUTTON + " text-red-500 hover:bg-red-50"}
                title="Delete"
                aria-label="Delete block"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <select
              value={selectedBlock.kind}
              onChange={(e) => {
                const nextKind = e.target.value as StudioBlockKind;
                update(selectedBlock.id, {
                  kind: nextKind,
                  title: String(selectedBlock.title || "").trim() || defaultStudioTitle(nextKind),
                  color: getDefaultBlockColor(nextKind),
                });
              }}
              aria-label="Block type"
              className={STUDIO_INPUT + " h-9 w-full min-w-0"}
            >
              {STUDIO_KIND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  update(selectedBlock.id, {
                    minutes: clamp((Number(selectedBlock.minutes) || 1) - 1, 1, 24 * 60),
                  })
                }
                className={STUDIO_ICON_BUTTON + " h-9 w-9"}
                aria-label="Shorten"
              >
                <Minus size={14} />
              </button>
              <input
                type="number"
                min={1}
                max={24 * 60}
                value={selectedBlock.minutes}
                onChange={(e) =>
                  update(selectedBlock.id, {
                    minutes: clamp(Number(e.target.value) || 1, 1, 24 * 60),
                  })
                }
                aria-label="Minutes"
                className={STUDIO_INPUT + " h-9 w-14 px-1 text-center tabular-nums"}
              />
              <button
                type="button"
                onClick={() =>
                  update(selectedBlock.id, {
                    minutes: clamp((Number(selectedBlock.minutes) || 1) + 1, 1, 24 * 60),
                  })
                }
                className={STUDIO_ICON_BUTTON + " h-9 w-9"}
                aria-label="Lengthen"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          <input
            value={selectedBlock.title}
            onChange={(e) => update(selectedBlock.id, { title: e.target.value })}
            className={STUDIO_INPUT + " mt-2 h-9 w-full"}
            placeholder="Block title…"
            aria-label="Block title"
          />

          <textarea
            value={selectedBlock.note || ""}
            onChange={(e) => update(selectedBlock.id, { note: e.target.value })}
            className={STUDIO_INPUT + " mt-2 w-full py-2"}
            placeholder="Block note…"
            aria-label="Block note"
            rows={2}
          />

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {QUICK_MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => update(selectedBlock.id, { minutes: m })}
                className={
                  "rounded-full border px-2.5 py-1 font-inter text-[11px] " +
                  (Number(selectedBlock.minutes) === m
                    ? "border-[#2F2F2F] bg-[#2F2F2F] text-white"
                    : "border-[#D8DCE3] bg-white text-[#344054] hover:bg-[#F7F7F7]")
                }
              >
                {m}m
              </button>
            ))}
          </div>

          {selectedBlock.kind === "custom" && (
            <div className="mt-3 rounded-[12px] bg-[#F7F7F8] px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-[12px] font-semibold text-[#15171A]">Block color</div>
                <input
                  type="color"
                  value={getBlockColor(selectedBlock)}
                  onChange={(e) => update(selectedBlock.id, { color: e.target.value })}
                  className="h-8 w-11 cursor-pointer rounded-lg border border-[#D8DCE3] bg-white p-1"
                  title="Custom block color"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {BLOCK_COLOR_PRESETS.map((color) => {
                  const selected = getBlockColor(selectedBlock).toLowerCase() === color.toLowerCase();
                  return (
                    <button
                      key={`${selectedBlock.id}-${color}`}
                      type="button"
                      onClick={() => update(selectedBlock.id, { color })}
                      className={
                        "h-6 w-6 rounded-full border transition " +
                        (selected ? "border-[#2F2F2F] ring-2 ring-[#2F2F2F]/20" : "border-[#D8DCE3] hover:scale-105")
                      }
                      style={{ backgroundColor: color }}
                      title={color}
                      aria-label={`Set block color ${color}`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {blocks.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-[12px] text-[#667085] hover:text-[#15171A]">
            Show breakdown
          </summary>

          <div className="mt-2 space-y-1.5">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedBlockId(r.id)}
                className={
                  "flex w-full items-center justify-between gap-3 rounded-[12px] border px-3 py-2 text-left " +
                  (selectedBlockId === r.id ? "border-[#2F2F2F] bg-[#F7F7F8]" : "border-[#E6E8EC] bg-white")
                }
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: resolveStageVisual(r).color }} />
                  <span className="truncate text-[12px] text-[#15171A]">{r.title}</span>
                </span>
                <span className="whitespace-nowrap text-[12px] tabular-nums text-[#667085]">
                  {r.start}–{r.end}m · {r.minutes}m
                </span>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function isValidHexColor(v: unknown) {
  return /^#[0-9a-f]{6}$/i.test(String(v || "").trim());
}

function getDefaultBlockColor(kind: StudioBlockKind) {
  switch (kind) {
    case "welcome":
      return "#80DF86";
    case "intentions":
      return "#ADD3FF";
    case "focus":
      return "#4CA0FF";
    case "break":
      return "#F9ADA2";
    case "checkin":
      return "#ADD3FF";
    case "recap":
      return "#A78BFA";
    case "celebrate":
      return "#F472B6";
    case "custom":
    default:
      return DEFAULT_CUSTOM_BLOCK_COLOR;
  }
}

function getBlockColor(block: Pick<StudioBlock, "kind" | "color"> & { title?: string }) {
  if (isCheckInBreakName(block.title)) return INTENTIONS_COLOR;
  const raw = String(block.color || "").trim();
  return isValidHexColor(raw) ? raw : getDefaultBlockColor(block.kind);
}

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

function formatShortDate(raw?: string | null) {
  if (!raw) return "";
  try {
    return new Date(raw).toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(raw);
  }
}

export function CreateSessionModal({
  isOpen,
  onClose,
  onSessionCreated,
}: CreateSessionModalProps) {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Admins can switch to creating a 24/7 (Infinite) room. Server-checked via
  // is_app_admin(); the database still decides what may be created.
  const [isAppAdmin, setIsAppAdmin] = useState(false);
  useEffect(() => {
    if (!isOpen || !user?.id) return;
    let cancelled = false;
    void isCurrentUserAdmin().then((ok) => {
      if (!cancelled) setIsAppAdmin(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, user?.id]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingUserTemplate, setIsSavingUserTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedPresetKey, setSelectedPresetKey] = useState<PresetKey | null>(null);
  const [presetCycles, setPresetCycles] = useState<number>(3);
  const [accessMode, setAccessMode] = useState<AccessMode>("public");
  const [cameraRequired, setCameraRequired] = useState(false);
  const [screenShareRequired, setScreenShareRequired] = useState(false);
  const [cameraOrScreenShareRequired, setCameraOrScreenShareRequired] = useState(false);
  const [publicChatDisabled, setPublicChatDisabled] = useState(false);

  // ---------- Scheduling in advance ----------
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("single");
  const [dailyDays, setDailyDays] = useState<number>(7);
  const [weeklyCount, setWeeklyCount] = useState<number>(3);
  const [dailyWeekdaysOnly, setDailyWeekdaysOnly] = useState<boolean>(false);

  // ---------- Custom link slug ----------
  const [customSlugInput, setCustomSlugInput] = useState("");
  const sanitizedSlug = useMemo(
    () => sanitizeSlug(customSlugInput),
    [customSlugInput],
  );
  const slugValid = useMemo(() => isValidSlug(sanitizedSlug), [sanitizedSlug]);
  const [slugStatus, setSlugStatus] = useState<
    "idle" | "invalid" | "checking" | "taken" | "available" | "owned"
  >("idle");
  const [ownedPublicSlugs, setOwnedPublicSlugs] = useState<PublicSlugRow[]>([]);

  // ---------- SESSION STUDIO ----------
  const [studioEnabled, setStudioEnabled] = useState(false);
  const [flowEditing, setFlowEditing] = useState(false);
  const [studioBlocks, setStudioBlocks] = useState<StudioBlock[]>([]);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(
    null,
  );

  // ---------- My templates / previous sessions ----------
  const [userTemplates, setUserTemplates] = useState<UserSessionTemplateRow[]>(
    [],
  );
  const [previousSessions, setPreviousSessions] = useState<
    PreviousSessionRow[]
  >([]);
  const [selectedUserTemplateId, setSelectedUserTemplateId] =
    useState<string>("");
  const [selectedPreviousSessionId, setSelectedPreviousSessionId] =
    useState<string>("");
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [saveTemplateDescription, setSaveTemplateDescription] = useState("");

  // DnD state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<"before" | "after">("after");
  const END_DROP_ID = "__end__";

  const [maxParticipants, setMaxParticipants] = useState<number>(
    DEFAULT_MAX_PARTICIPANTS,
  );

  // Scroll container ref (modal body)
  const modalScrollRef = useRef<HTMLDivElement | null>(null);
  const basicSectionRef = useRef<HTMLElement | null>(null);
  const scheduleSectionRef = useRef<HTMLElement | null>(null);
  const structureSectionRef = useRef<HTMLElement | null>(null);
  const guestsSectionRef = useRef<HTMLElement | null>(null);

  // Auto-scroll while dragging
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollVelRef = useRef<number>(0);
  const draggingRef = useRef<boolean>(false);

  // FLIP animation bookkeeping
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
    setUserTemplates([]);
    setPreviousSessions([]);
    setOwnedPublicSlugs([]);
    setSelectedUserTemplateId("");
    setSelectedPreviousSessionId("");
    setSaveTemplateName("");
    setSaveTemplateDescription("");
    setIsCreating(false);
    setIsSavingUserTemplate(false);
    setError(null);
    setNotice(null);
    setFlowEditing(false);
    setSelectedPresetKey(null);
    setPresetCycles(3);
    setAccessMode("public");
    setCameraRequired(false);
    setScreenShareRequired(false);
    setCameraOrScreenShareRequired(false);
    setPublicChatDisabled(false);

    setMaxParticipants(DEFAULT_MAX_PARTICIPANTS);
    setCustomSlugInput("");
    setSlugStatus("idle");

    setScheduleMode("single");
    setDailyDays(7);
    setWeeklyCount(3);
    setDailyWeekdaysOnly(false);

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
    if (!studioEnabled) return;
    if (!saveTemplateName.trim() && title.trim()) {
      setSaveTemplateName(title.trim());
    }
  }, [studioEnabled, title, saveTemplateName]);

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
          .from("public_url_slugs")
          .select("slug, owner_type, owner_id, host_user_id")
          .eq("slug", s)
          .limit(1);

        if (error) {
          console.log("[slug] availability check error:", error);
          setSlugStatus("idle");
          return;
        }

        const existing = data?.[0] as PublicSlugRow | undefined;

        if (!existing) {
          setSlugStatus("available");
          return;
        }

        if (existing.host_user_id && profile?.id) {
          setSlugStatus(existing.host_user_id === profile.id ? "owned" : "taken");
          return;
        }

        // Reusable-link compatibility:
        // Old rows can have host_user_id = NULL. For these rows the only thing we
        // need during creation is to move public_url_slugs.owner_id to the new
        // session id. Do NOT block the modal as "taken" just because host_user_id
        // is missing. The final create step will update owner_id and also backfill
        // host_user_id to the current host.
        if (existing.owner_type === "session" && existing.owner_id && profile?.id) {
          try {
            const { data: sessionOwner } = await supabase
              .from("sessions")
              .select("id, host_id")
              .eq("id", existing.owner_id)
              .maybeSingle();

            if (sessionOwner?.host_id && sessionOwner.host_id !== profile.id) {
              setSlugStatus("taken");
              return;
            }
          } catch {
            // If RLS prevents reading the old session, still allow the create flow.
            // The update below is the source of truth.
          }

          setSlugStatus("owned");
          return;
        }

        setSlugStatus("taken");
      } catch (e) {
        console.log("[slug] availability check exception:", e);
        setSlugStatus("idle");
      }
    }, 450);

    return () => window.clearTimeout(t);
  }, [sanitizedSlug, slugValid, isOpen, scheduleMode, profile?.id]);

  const studioTotal = useMemo(
    () => studioBlocks.reduce((sum, b) => sum + (Number(b.minutes) || 0), 0),
    [studioBlocks],
  );

  const selectedTemplateObj = useMemo(
    () => templates.find((t) => t.id === selectedTemplate),
    [templates, selectedTemplate],
  );

  const templateNameById = useMemo(() => {
    const map = new Map<string, string>();
    templates.forEach((t) => {
      if (t?.id) map.set(String(t.id), String((t as any).name || "Template"));
    });
    return map;
  }, [templates]);

  const applyStudioBlocks = useCallback((blocks: StudioBlock[]) => {
    setStudioEnabled(true);
    setStudioBlocks(blocks);
    const firstId = blocks[0]?.id || null;
    setSelectedBlockIds(firstId ? [firstId] : []);
    setActiveBlockId(firstId);
    setSelectionAnchorId(firstId);
  }, []);

  const importFromTemplate = useCallback(() => {
    const tpl = selectedTemplateObj;

    const fromBlocks = normalizeTemplateBlocks((tpl as any)?.blocks);
    const fromSchedule = normalizeTemplateBlocks((tpl as any)?.schedule);
    const blocks = fromBlocks.length ? fromBlocks : fromSchedule;

    if (blocks.length) {
      applyStudioBlocks(blocks);
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
      applyStudioBlocks(fallback);
    }
  }, [applyStudioBlocks, selectedTemplateObj]);

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
    applyStudioBlocks(next);
  }, [applyStudioBlocks]);

  const clearStudio = useCallback(() => {
    setStudioBlocks([]);
    setSelectedBlockIds([]);
    setActiveBlockId(null);
    setSelectionAnchorId(null);
  }, []);

  const selectStudioBlock = useCallback((id: string | null) => {
    setActiveBlockId(id);
    setSelectedBlockIds(id ? [id] : []);
    setSelectionAnchorId(id);
  }, []);

  const addFromLibrary = useCallback((b: StudioBlock) => {
    const nextBlock = {
      id: uid(),
      kind: b.kind,
      title: b.title,
      note: b.note,
      minutes: b.minutes,
      color: getBlockColor(b),
    };
    setStudioBlocks((prev) => [...prev, nextBlock]);
    selectStudioBlock(nextBlock.id);
  }, [selectStudioBlock]);

  const focusBlock = useCallback((id: string) => {
    if (!id) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(
        `studio-block-${id}`,
      ) as HTMLElement | null;
      if (!el) return;
      el.focus();
      try {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch {
        // ignore
      }
    });
  }, []);

  const loadModalData = useCallback(async () => {
    if (!isOpen) return;

    setError(null);

    try {
      const globalTemplatesPromise = supabase
        .from("session_templates")
        .select("*")
        .order("total_duration", { ascending: true });

      const userTemplatesPromise = profile?.id
        ? supabase
          .from("user_session_templates")
          .select("*")
          .eq("user_id", profile.id)
          .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [], error: null } as any);

      const previousSessionsPromise = profile?.id
        ? supabase
          .from("sessions")
          .select(
            "id,title,description,template_id,format,schedule,duration_minutes,max_participants,created_at,start_time",
          )
          .eq("host_id", profile.id)
          .order("created_at", { ascending: false })
          .limit(24)
        : Promise.resolve({ data: [], error: null } as any);

      const ownedSlugsPromise = profile?.id
        ? supabase
          .from("public_url_slugs")
          .select("slug, owner_type, owner_id, host_user_id, updated_at")
          .eq("owner_type", "session")
          .eq("host_user_id", profile.id)
          .order("updated_at", { ascending: false })
          .limit(10)
        : Promise.resolve({ data: [], error: null } as any);

      // Fallback source of truth for reusable links:
      // older public_url_slugs rows may not have host_user_id populated yet,
      // but sessions.custom_slug still tells us which public link belongs to this host.
      const ownedSessionSlugsPromise = profile?.id
        ? supabase
          .from("sessions")
          .select("id, custom_slug, created_at")
          .eq("host_id", profile.id)
          .not("custom_slug", "is", null)
          .order("created_at", { ascending: false })
          .limit(10)
        : Promise.resolve({ data: [], error: null } as any);

      const [
        globalTemplatesRes,
        userTemplatesRes,
        previousSessionsRes,
        ownedSlugsRes,
        ownedSessionSlugsRes,
      ] = await Promise.all([
        globalTemplatesPromise,
        userTemplatesPromise,
        previousSessionsPromise,
        ownedSlugsPromise,
        ownedSessionSlugsPromise,
      ]);

      if (globalTemplatesRes.error) {
        console.error("❌ Error loading templates:", globalTemplatesRes.error);
        setError("Failed to load templates.");
      } else {
        setTemplates(globalTemplatesRes.data || []);
      }

      if (userTemplatesRes?.error) {
        console.error(
          "❌ Error loading user templates:",
          userTemplatesRes.error,
        );
      } else {
        setUserTemplates(
          (userTemplatesRes?.data || []) as UserSessionTemplateRow[],
        );
      }

      if (previousSessionsRes?.error) {
        console.error(
          "❌ Error loading previous sessions:",
          previousSessionsRes.error,
        );
      } else {
        setPreviousSessions(
          (previousSessionsRes?.data || []) as PreviousSessionRow[],
        );
      }

      if (ownedSlugsRes?.error) {
        console.error(
          "❌ Error loading reusable public links:",
          ownedSlugsRes.error,
        );
      }

      if (ownedSessionSlugsRes?.error) {
        console.error(
          "❌ Error loading session custom links:",
          ownedSessionSlugsRes.error,
        );
      }

      const fromRegistry = ((ownedSlugsRes?.data || []) as PublicSlugRow[])
        .filter((r) => String(r?.slug || "").trim());

      const fromSessions = ((ownedSessionSlugsRes?.data || []) as any[])
        .map((r) => ({
          slug: String(r?.custom_slug || "").trim(),
          owner_type: "session",
          owner_id: String(r?.id || "").trim() || null,
          host_user_id: profile?.id || null,
          updated_at: String(r?.created_at || "").trim() || null,
        }))
        .filter((r) => r.slug);

      const seenSlugs = new Set<string>();
      const mergedOwnedSlugs: PublicSlugRow[] = [];

      for (const row of [...fromRegistry, ...fromSessions]) {
        const slug = String(row?.slug || "").trim();
        if (!slug || seenSlugs.has(slug)) continue;
        seenSlugs.add(slug);
        mergedOwnedSlugs.push(row);
      }

      setOwnedPublicSlugs(mergedOwnedSlugs.slice(0, 1));
    } catch (e) {
      console.error("❌ Error loading modal data:", e);
      setError("Failed to load session data.");
    }
  }, [isOpen, profile?.id]);

  const applyUserTemplate = useCallback(
    (tpl: UserSessionTemplateRow) => {
      const blocks = normalizeTemplateBlocks(tpl.blocks);

      setSelectedUserTemplateId(tpl.id);
      setSelectedPreviousSessionId("");

      setTitle(String(tpl.default_title || tpl.name || "").trim());
      setDescription(String(tpl.default_description || "").trim());
      setSaveTemplateName(String(tpl.name || "").trim());
      setSaveTemplateDescription(String(tpl.description || "").trim());

      const nextBaseTemplateId =
        String(tpl.base_template_id || "").trim() ||
        String(templates[0]?.id || "").trim();

      setSelectedTemplate(nextBaseTemplateId);

      const nextMax = clamp(
        Number(tpl.default_max_participants) || DEFAULT_MAX_PARTICIPANTS,
        MIN_PARTICIPANTS,
        MAX_PARTICIPANTS,
      );
      setMaxParticipants(nextMax);

      setCustomSlugInput("");
      setSlugStatus("idle");

      if (blocks.length) {
        applyStudioBlocks(blocks);
      } else {
        setStudioEnabled(false);
        clearStudio();
      }

      setNotice(`Loaded template: ${tpl.name}`);
      window.setTimeout(() => setNotice(null), 1600);
    },
    [applyStudioBlocks, clearStudio, templates],
  );

  const applyPreviousSession = useCallback(
    (row: PreviousSessionRow) => {
      const blocks = normalizeTemplateBlocks(row.schedule);

      setSelectedPreviousSessionId(row.id);
      setSelectedUserTemplateId("");

      setTitle(String(row.title || "").trim());
      setDescription(String(row.description || "").trim());

      const nextBaseTemplateId =
        String(row.template_id || "").trim() ||
        String(templates[0]?.id || "").trim();

      setSelectedTemplate(nextBaseTemplateId);

      const nextMax = clamp(
        Number(row.max_participants) || DEFAULT_MAX_PARTICIPANTS,
        MIN_PARTICIPANTS,
        MAX_PARTICIPANTS,
      );
      setMaxParticipants(nextMax);

      setSaveTemplateName(String(row.title || "").trim());
      setSaveTemplateDescription("");

      setCustomSlugInput("");
      setSlugStatus("idle");

      if (blocks.length) {
        applyStudioBlocks(blocks);
      } else if (nextBaseTemplateId) {
        setStudioEnabled(false);
        clearStudio();
      }

      setNotice("Loaded previous session");
      window.setTimeout(() => setNotice(null), 1600);
    },
    [applyStudioBlocks, clearStudio, templates],
  );

  const handleSaveCurrentAsUserTemplate = useCallback(async () => {
    if (!user || !profile?.id) {
      setError("You must be logged in to save your template.");
      return;
    }

    if (!studioEnabled || studioBlocks.length === 0) {
      setError("Turn on Session Studio and add at least one block first.");
      return;
    }

    const templateName = String(saveTemplateName || title || "").trim();
    if (!templateName) {
      setError("Give your template a name first.");
      return;
    }

    setError(null);
    setNotice(null);
    setIsSavingUserTemplate(true);

    try {
      const payload = {
        user_id: profile.id,
        name: templateName,
        description: String(saveTemplateDescription || "").trim() || null,
        base_template_id: String(selectedTemplate || "").trim() || null,
        source_session_id: null,
        blocks: exportStudioToSchedule(studioBlocks),
        default_title: String(title || "").trim() || null,
        default_description: String(description || "").trim() || null,
        default_max_participants: clamp(
          Number(maxParticipants) || DEFAULT_MAX_PARTICIPANTS,
          MIN_PARTICIPANTS,
          MAX_PARTICIPANTS,
        ),
      };

      const { data, error } = await supabase
        .from("user_session_templates")
        .insert(payload)
        .select("*")
        .single();

      if (error) throw error;

      const nextRow = data as UserSessionTemplateRow;
      setUserTemplates((prev) => [nextRow, ...prev]);
      setSelectedUserTemplateId(nextRow.id);
      setNotice("Saved to My templates ✅");
      window.setTimeout(() => setNotice(null), 1800);
    } catch (err: any) {
      console.error("❌ Error saving user template:", err);
      setError(err?.message || "Failed to save your template.");
    } finally {
      setIsSavingUserTemplate(false);
    }
  }, [
    user,
    profile?.id,
    studioEnabled,
    studioBlocks,
    saveTemplateName,
    title,
    saveTemplateDescription,
    selectedTemplate,
    description,
    maxParticipants,
  ]);

  // DnD helpers
  const isInteractiveEl = (el: EventTarget | null) => {
    const t = el as HTMLElement | null;
    if (!t) return false;
    const tag = (t.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (tag === "button") return true;
    if (t.isContentEditable) return true;
    const closest = t.closest?.(
      "input,textarea,select,button,[contenteditable='true']",
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
    return studioBlocks.map((b) => b.id).filter((id) => selectedSet.has(id));
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
    [studioBlocks, selectionAnchorId, activeBlockId, selectSingleBlock],
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
    [focusBlock, selectRangeToBlock, selectSingleBlock, toggleBlockSelection],
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
          ? Math.max(0, prev.findIndex((b) => b.id === lastSelectedId) + 1)
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
      const el = document.getElementById(
        `studio-block-${b.id}`,
      ) as HTMLElement | null;
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
      const el = document.getElementById(
        `studio-block-${b.id}`,
      ) as HTMLElement | null;
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
          },
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
    [armFlip, focusBlock, selectedBlockIds],
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
    [armFlip, focusBlock, selectedBlockIds],
  );

  const updateBlock = useCallback((id: string, patch: Partial<StudioBlock>) => {
    setStudioBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...patch } : b)),
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
    [deleteSelectedBlocks, selectedBlockIds],
  );

  useEffect(() => {
    if (!isOpen) return;
    void loadModalData();
  }, [isOpen, loadModalData]);

  useEffect(() => {
    if (!isOpen) return;
    if (!studioEnabled) return;

    if (studioBlocks.length === 0) {
      const hasTplBlocks =
        normalizeTemplateBlocks((selectedTemplateObj as any)?.blocks).length >
        0 ||
        normalizeTemplateBlocks((selectedTemplateObj as any)?.schedule).length >
        0;
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
        "input,textarea,select,button,[contenteditable='true']",
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

    if (base.getTime() > max.getTime()) return 1;

    const available = countAvailableOccurrences({
      base,
      mode: scheduleMode,
      maxDate: max,
      weekdaysOnly: scheduleMode === "daily" ? dailyWeekdaysOnly : false,
      hardCap,
    });

    return clamp(available || 1, 1, hardCap);
  }, [scheduleMode, scheduledAt, dailyWeekdaysOnly]);

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

    const dates = buildScheduledDates({
      base,
      mode: scheduleMode,
      count: occurrencesCount,
      maxDate: max,
      weekdaysOnly: scheduleMode === "daily" ? dailyWeekdaysOnly : false,
    });

    if (dates.length !== occurrencesCount) {
      return `Max scheduling window is ${MAX_ADVANCE_DAYS} days ahead (not enough valid occurrences fit in range).`;
    }

    return null;
  }, [scheduledAt, occurrencesCount, scheduleMode, dailyWeekdaysOnly]);

  const occurrencesPreview = useMemo(() => {
    if (!scheduledAt) return [];

    const base = new Date(scheduledAt);
    if (Number.isNaN(base.getTime())) return [];

    const now = new Date();
    const max = advanceLimitDate(now);

    const ds = buildScheduledDates({
      base,
      mode: scheduleMode,
      count: occurrencesCount,
      maxDate: max,
      weekdaysOnly: scheduleMode === "daily" ? dailyWeekdaysOnly : false,
    });

    return ds.map(toLocalPreview);
  }, [scheduledAt, scheduleMode, occurrencesCount, dailyWeekdaysOnly]);

  // ---------- CREATE SESSION(S) ----------
  const handleCreate = async () => {
    if (!title || !scheduledAt) {
      setError("Please fill out session title and start time.");
      return;
    }

    if (!studioEnabled && !selectedTemplate && !selectedPresetKey) {
      setError("Please select a session format (template).");
      return;
    }

    if (studioEnabled && studioBlocks.length === 0) {
      setError(
        "Session Studio is enabled, but your script is empty. Add at least one block.",
      );
      return;
    }

    if (!user || !profile?.id) {
      setError("You must be logged in to create a session.");
      return;
    }

    if (bookendMessage) {
      setError(bookendMessage);
      return;
    }

    if (scheduleAdvanceError) {
      setError(scheduleAdvanceError);
      return;
    }

    const baseSlug = sanitizedSlug;
    if (baseSlug && !isValidSlug(baseSlug)) {
      setError(
        `Custom link is invalid. Use ${SLUG_MIN}-${SLUG_MAX} chars: a-z, 0-9, - or _.`,
      );
      return;
    }

    if (scheduleMode === "single") {
      if (baseSlug && slugStatus === "taken") {
        setError(
          "This custom link is already taken by another host. Pick another one.",
        );
        return;
      }
      if (baseSlug && slugStatus === "checking") {
        setError("Checking custom link… please wait 1 second and try again.");
        return;
      }
    }

    const baseTemplateId =
      selectedTemplate || ((studioEnabled || selectedPresetKey) ? (templates[0]?.id ?? "") : "");

    if (studioEnabled && !baseTemplateId) {
      setError(
        "No templates found in database. Create at least one template first.",
      );
      return;
    }

    const effectiveMaxParticipants = clamp(
      Number(maxParticipants) || DEFAULT_MAX_PARTICIPANTS,
      MIN_PARTICIPANTS,
      MAX_PARTICIPANTS,
    );

    setIsCreating(true);
    setError(null);
    setNotice(null);

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
        : generatedPresetBlocks.length
          ? generatedPresetBlocks.reduce(
            (sum, block) => sum + (Number(block.minutes) || 0),
            0,
          )
          : ((template as any)?.total_duration ?? 60);

      const baseSchedulePayload = studioEnabled
        ? exportStudioToSchedule(studioBlocks)
        : generatedPresetBlocks.length
          ? exportStudioToSchedule(generatedPresetBlocks)
          : (template as any)?.blocks || (template as any)?.schedule || [];
      const schedulePayload = withRoomPolicies(baseSchedulePayload, {
        cameraRequired,
        screenShareRequired,
        cameraOrScreenShareRequired,
        publicChatDisabled,
      });

      const formatLabel = studioEnabled
        ? template?.name
          ? `${template.name} (Studio)`
          : "Session Studio"
        : selectedPreset?.label || template?.name || "Unspecified";

      const normalizedDescription = String(description || "").trim() || null;

      const maxAdvanceDate = advanceLimitDate(new Date());
      const datesLocal = buildScheduledDates({
        base: baseDateLocal,
        mode: scheduleMode,
        count: occurrencesCount,
        maxDate: maxAdvanceDate,
        weekdaysOnly: scheduleMode === "daily" ? dailyWeekdaysOnly : false,
      });

      if (datesLocal.length !== occurrencesCount) {
        throw new Error(
          `Unable to create ${occurrencesCount} occurrence(s) inside the ${MAX_ADVANCE_DAYS}-day scheduling window.`,
        );
      }

      /**
       * Prevent the host from creating overlapping scheduled sessions.
       *
       * We validate both:
       * 1. new occurrences against one another; and
       * 2. every new occurrence against the host's existing scheduled sessions.
       *
       * Even a one-minute overlap is rejected. Back-to-back sessions are valid.
       */
      const normalizedDurationMinutes = Math.max(
        1,
        Math.round(Number(durationMinutes) || 1),
      );

      const newRanges: SessionTimeRange[] = datesLocal.map((date, index) => {
        const start = new Date(date);
        const end = new Date(
          start.getTime() + normalizedDurationMinutes * 60 * 1000,
        );

        return {
          start,
          end,
          label:
            datesLocal.length > 1
              ? `Occurrence ${index + 1}`
              : title.trim() || "New session",
        };
      });

      for (let leftIndex = 0; leftIndex < newRanges.length; leftIndex += 1) {
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < newRanges.length;
          rightIndex += 1
        ) {
          const left = newRanges[leftIndex];
          const right = newRanges[rightIndex];

          if (rangesOverlap(left, right)) {
            throw new Error(
              `${left.label} overlaps ${right.label}. Reduce the duration or choose a different recurrence schedule.`,
            );
          }
        }
      }

      const earliestStartMs = Math.min(
        ...newRanges.map((range) => range.start.getTime()),
      );
      const latestEndMs = Math.max(
        ...newRanges.map((range) => range.end.getTime()),
      );

      // Session Studio allows blocks up to 24 hours. A two-day look-back safely
      // catches an older long session that extends into the new time range.
      const existingSearchStart = new Date(
        earliestStartMs - 2 * 24 * 60 * 60 * 1000,
      );
      const existingSearchEnd = new Date(latestEndMs);

      const { data: existingHostedSessions, error: existingHostedSessionsError } =
        await supabase
          .from("sessions")
          .select(
            "id, title, start_time, duration_minutes, status, session_format_type",
          )
          .eq("host_id", profile.id)
          .gte("start_time", existingSearchStart.toISOString())
          .lt("start_time", existingSearchEnd.toISOString())
          .order("start_time", { ascending: true })
          .limit(500);

      if (existingHostedSessionsError) {
        throw new Error(
          `Could not verify session availability: ${existingHostedSessionsError.message}`,
        );
      }

      const existingRanges: SessionTimeRange[] = (
        (existingHostedSessions || []) as ExistingHostedSessionRow[]
      )
        .filter((row) => {
          const status = String(row.status || "").trim().toLowerCase();
          const sessionType = String(row.session_format_type || "")
            .trim()
            .toLowerCase();

          if (status === "cancelled" || status === "canceled") return false;
          // Always-open rooms do not reserve one scheduled host time slot.
          if (sessionType === "infinite") return false;
          return !!row.start_time;
        })
        .map((row) => {
          const start = new Date(String(row.start_time));
          const duration = Math.max(
            1,
            Math.round(Number(row.duration_minutes) || 1),
          );
          const end = new Date(start.getTime() + duration * 60 * 1000);

          return {
            start,
            end,
            label: String(row.title || "Existing session"),
          };
        })
        .filter(
          (range) =>
            Number.isFinite(range.start.getTime()) &&
            Number.isFinite(range.end.getTime()),
        );

      for (const nextRange of newRanges) {
        const conflict = existingRanges.find((existingRange) =>
          rangesOverlap(nextRange, existingRange),
        );

        if (conflict) {
          throw new Error(
            `This session overlaps "${conflict.label}" (${formatOverlapTime(
              conflict.start,
            )}–${conflict.end.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}). Choose a start time after the existing session ends.`,
          );
        }
      }

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
            .from("public_url_slugs")
            .select("slug")
            .in("slug", checkList)
            .limit(checkList.length);

          if (takenErr) {
            console.log("[slug] series collision check error:", takenErr);
          } else if (taken && taken.length > 0) {
            setError(
              "Some custom links for the series are already taken. Try a different base link.",
            );
            setIsCreating(false);
            return;
          }
        }
      }

      if (!isSeries && baseSlug) {
        const { data: existingSlugRows, error: existingSlugError } =
          await supabase
            .from("public_url_slugs")
            .select("slug, owner_type, owner_id, host_user_id")
            .eq("slug", baseSlug)
            .limit(1);

        if (existingSlugError) {
          console.log("[slug] ownership check error:", existingSlugError);
        }

        const existingSlug = existingSlugRows?.[0] as PublicSlugRow | undefined;
        if (existingSlug) {
          let belongsToCurrentHost = false;

          if (existingSlug.host_user_id) {
            belongsToCurrentHost = existingSlug.host_user_id === profile.id;
          } else if (existingSlug.owner_type === "session" && existingSlug.owner_id) {
            // Important: legacy reusable rows can have host_user_id = NULL.
            // If the old owner session is readable and belongs to another host, block it.
            // Otherwise allow the reusable flow and move owner_id to the new session below.
            const { data: sessionOwner, error: sessionOwnerError } = await supabase
              .from("sessions")
              .select("id, host_id")
              .eq("id", existingSlug.owner_id)
              .maybeSingle();

            if (sessionOwnerError) {
              console.log("[slug] old owner session lookup skipped:", sessionOwnerError);
              belongsToCurrentHost = true;
            } else if (!sessionOwner?.host_id) {
              belongsToCurrentHost = true;
            } else {
              belongsToCurrentHost = sessionOwner.host_id === profile.id;
            }
          }

          if (!belongsToCurrentHost) {
            setError(
              "This custom link is already taken by another host. Pick another one.",
            );
            setIsCreating(false);
            return;
          }
        }

        // One reusable public link per host: detach it from old sessions first,
        // then attach the same slug to the newly created session below.
        const { error: clearOldSessionSlugError } = await supabase
          .from("sessions")
          .update({ custom_slug: null })
          .eq("host_id", profile.id)
          .not("custom_slug", "is", null);

        if (clearOldSessionSlugError) {
          console.log(
            "[slug] old session slug cleanup error:",
            clearOldSessionSlugError,
          );
        }

        const { error: clearOldPublicSlugError } = await supabase
          .from("public_url_slugs")
          .delete()
          .eq("owner_type", "session")
          .eq("host_user_id", profile.id)
          .neq("slug", baseSlug);

        if (clearOldPublicSlugError) {
          console.log(
            "[slug] old public slug cleanup error:",
            clearOldPublicSlugError,
          );
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

      const placement = await assignServerForSession({
        sessionFormatType: "group",
        maxParticipants: effectiveMaxParticipants,
      });

      console.log("[livekit placement] assigned", {
        title,
        serverCode: placement.server.code,
        serverId: placement.server.id,
        placementWeight: placement.placementWeight,
        score: placement.score,
      });

      const rows = datesLocal.map((d, idx) => {
        const scheduledISO = d.toISOString();

        const row: Record<string, unknown> = {
          title,
          description: normalizedDescription,
          host_id: profile.id,
          host_name: profile.full_name,

          template_id: baseTemplateId,

          start_time: scheduledISO,
          duration_minutes: durationMinutes,
          format: formatLabel,
          schedule: schedulePayload,
          camera_required: cameraRequired,
          screen_share_required: screenShareRequired,
          public_chat_disabled: publicChatDisabled,
          daily_room_url: dailyUrls[idx],
          status: "planned",
          created_at: new Date().toISOString(),

          jitsi_domain: FIXED_JITSI_DOMAIN,

          max_participants: effectiveMaxParticipants,
          is_private: accessMode === "private",
          assigned_server_id: placement.server.id,
          placement_weight: placement.placementWeight,
          assigned_at: new Date().toISOString(),
        };

        // IMPORTANT:
        // For a single reusable public link, we intentionally DO NOT send custom_slug
        // to the sessions insert at all. Sending custom_slug, even in legacy flows,
        // can hit the DB trigger/unique check: Public URL slug "<slug>" is already taken.
        //
        // The reusable link lives in public_url_slugs. After the session is created,
        // we only re-point public_url_slugs.owner_id to the newly created session id.
        //
        // Series links are dated and unique, so they can still be stored on sessions.
        if (baseSlug && isSeries) {
          row.custom_slug = slugsForInsert[idx] || null;
        }

        return row;
      });

      let insertedSessions: any[] | null = null;
      let insertError: any = null;

      const insertResult = await supabase
        .from("sessions")
        .insert(rows)
        .select("id, host_id, custom_slug");

      insertedSessions = (insertResult.data as any[]) || null;
      insertError = insertResult.error;

      // Safety retry for the exact legacy failure:
      // if the DB still complains that the reusable slug is taken, retry once with
      // custom_slug forcibly removed from every row. This keeps creation unblocked
      // and lets public_url_slugs become the only reusable-link source of truth.
      if (insertError && baseSlug && !isSeries) {
        const msg = String(insertError?.message || "");
        const looksLikeReusableSlugCollision =
          msg.includes("Public URL slug") && msg.includes("already taken");

        if (looksLikeReusableSlugCollision) {
          console.warn(
            "[slug] sessions insert hit reusable slug collision; retrying without sessions.custom_slug",
            insertError,
          );

          const rowsWithoutSessionSlug = rows.map((row) => {
            const copy = { ...row };
            delete (copy as any).custom_slug;
            return copy;
          });

          const retryResult = await supabase
            .from("sessions")
            .insert(rowsWithoutSessionSlug)
            .select("id, host_id, custom_slug");

          insertedSessions = (retryResult.data as any[]) || null;
          insertError = retryResult.error;
        }
      }

      if (insertError) throw insertError;

      if (!insertedSessions || insertedSessions.length === 0) {
        throw new Error("Sessions were created, but no rows were returned.");
      }

      // ✅ CRITICAL: host auto-booking must happen BEFORE public slug registry work.
      // Public slug registry can hit RLS/unique-index edge cases, but it must never block
      // the host from being booked into a successfully created session.
      const bookingRows = insertedSessions
        .filter((s: any) => s?.id && (s?.host_id || profile.id))
        .map((s: any) => ({
          session_id: s.id,
          user_id: s.host_id || profile.id,
          booking_role: "host",
        }));

      if (bookingRows.length > 0) {
        let { error: bookingError } = await supabase
          .from("session_bookings")
          .upsert(bookingRows, { onConflict: "session_id,user_id" });

        const bookingRoleColumnUnavailable =
          bookingError &&
          (
            bookingError.code === "PGRST204" ||
            /booking_role.*(?:column|schema cache)|(?:column|schema cache).*booking_role/i.test(
              bookingError.message || ""
            )
          );

        if (bookingRoleColumnUnavailable) {
          const legacyBookingRows = bookingRows.map(
            ({ booking_role: _bookingRole, ...row }) => row,
          );
          const legacyResult = await supabase
            .from("session_bookings")
            .upsert(legacyBookingRows, { onConflict: "session_id,user_id" });

          bookingError = legacyResult.error;
        }

        if (bookingError) {
          console.error("❌ Host auto-booking failed:", bookingError);

          try {
            const insertedIds = insertedSessions
              .map((s: any) => s?.id)
              .filter(Boolean);

            if (insertedIds.length > 0) {
              await supabase.from("sessions").delete().in("id", insertedIds);
            }
          } catch (rollbackErr) {
            console.error(
              "❌ Rollback failed after auto-booking error:",
              rollbackErr,
            );
          }

          throw new Error(
            "Failed to auto-book the host into the created session(s). Creation was rolled back.",
          );
        }
      }

      if (baseSlug && !isSeries) {
        const targetSessionId = String(insertedSessions[0]?.id || "").trim();
        const reusableSlug = String(baseSlug || "").trim();

        if (!targetSessionId || !reusableSlug) {
          throw new Error("Missing reusable slug target session.");
        }

        const { data: updatedSlugRows, error: rpcSlugError } = await supabase.rpc(
          "reuse_session_public_slug",
          {
            p_slug: reusableSlug,
            p_session_id: targetSessionId,
          },
        );

        if (rpcSlugError) {
          // The session already exists at this point. A secondary public-link
          // registry failure must not leave the modal open and invite a second
          // click that creates a duplicate session.
          console.error("❌ Reusable public slug RPC failed:", rpcSlugError);
        } else if (!updatedSlugRows || updatedSlugRows.length === 0) {
          console.error(
            "❌ Reusable public link owner_id update returned no rows.",
          );
        } else {
          setOwnedPublicSlugs(updatedSlugRows as PublicSlugRow[]);
        }
      }

      if (baseSlug && isSeries) {
        const publicSlugRows = insertedSessions
          .filter((s: any) => String(s?.custom_slug || "").trim())
          .map((s: any) => ({
            slug: String(s.custom_slug).trim(),
            owner_type: "session",
            owner_id: s.id,
            host_user_id: profile.id,
            updated_at: new Date().toISOString(),
          }));

        if (publicSlugRows.length > 0) {
          const { error: publicSlugError } = await supabase
            .from("public_url_slugs")
            .upsert(publicSlugRows, { onConflict: "slug" });

          if (publicSlugError) {
            // Sessions are already created. Do not keep the modal open after a
            // non-critical registry failure, otherwise the host can click
            // Create again and accidentally duplicate the whole series.
            console.error(
              "❌ Series public slug registry failed:",
              publicSlugError,
            );
          } else {
            setOwnedPublicSlugs(publicSlugRows.slice(0, 1));
          }
        }
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = String(sessionData?.session?.access_token || "").trim();

        if (token) {
          await Promise.allSettled(
            insertedSessions
              .map((s: any) => String(s?.id || "").trim())
              .filter(Boolean)
              .map((sessionId: string) =>
                fetch("/api/push/send-host-session", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ sessionId }),
                }),
              ),
          );
        }
      } catch (pushErr) {
        console.warn("⚠️ Host session push notification failed:", pushErr);
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
      setDailyWeekdaysOnly(false);
      setSelectedUserTemplateId("");
      setSelectedPreviousSessionId("");
      setSaveTemplateName("");
      setSaveTemplateDescription("");
      setNotice(null);

      /**
       * Close first and treat the parent refresh as best-effort.
       *
       * Previously, if onSessionCreated() rejected/threw after the database
       * insert had already succeeded, execution never reached onClose(). The
       * visible modal then encouraged the host to click Create again.
       */
      try {
        onClose();
      } catch (closeError) {
        console.error("❌ Failed to close Create Session modal:", closeError);
      }

      try {
        await Promise.resolve(onSessionCreated());
      } catch (refreshError) {
        console.error(
          "⚠️ Session was created, but the sessions list refresh callback failed:",
          refreshError,
        );
      }

      // Keep the user on the canonical sessions listing after successful creation.
      try {
        navigate("/sessions", { replace: true });
      } catch {
        if (typeof window !== "undefined") {
          window.location.assign("/sessions");
        }
      }
    } catch (err: any) {
      console.error("❌ Error creating session(s):", err);

      const msg = String(err?.message || "");
      if (
        (msg.toLowerCase().includes("custom_slug") ||
          msg.toLowerCase().includes("public_url_slugs") ||
          msg.toLowerCase().includes("public_url_slugs_pkey")) &&
        (msg.toLowerCase().includes("duplicate") ||
          msg.toLowerCase().includes("already exists") ||
          msg.toLowerCase().includes("conflict"))
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
  const minScheduleDate = minDateTime.slice(0, 10);
  const scheduledDatePart = getScheduledDatePart(scheduledAt);
  const scheduledTimePart = getScheduledTimePart(scheduledAt);

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";

  const isSeries = scheduleMode !== "single";

  const linkPreview = sanitizedSlug
    ? isSeries
      ? `${origin}/${makeDatedSlug(
        sanitizedSlug,
        new Date(scheduledAt || Date.now()),
      )} …`
      : `${origin}/${sanitizedSlug}`
    : `${origin}/<your-link>`;

  const ownedSlugValues = ownedPublicSlugs
    .map((r) => String(r.slug || "").trim())
    .filter(Boolean);

  const ownedSlugSelectValue = sanitizedSlug
    ? ownedSlugValues.includes(sanitizedSlug)
      ? sanitizedSlug
      : "__custom__"
    : "";

  const slugHint = !customSlugInput
    ? ownedSlugValues.length > 0
      ? "Optional. Reuse your existing public link or type a new one. You can keep one active public link at a time."
      : "Optional. Your reusable public link: mysession.club/your-link."
    : !slugValid
      ? `Invalid. Use ${SLUG_MIN}-${SLUG_MAX} chars: a-z, 0-9, - or _.`
      : isSeries
        ? "Series mode: date suffix will be added automatically (yyyy-mm-dd)."
        : slugStatus === "checking"
          ? "Checking availability…"
          : slugStatus === "taken"
            ? "Taken by another host. Pick another."
            : slugStatus === "owned"
              ? "This is your reusable link. It will move to this new session ✓"
              : slugStatus === "available"
                ? "Available ✓"
                : "";

  const slugHintColor =
    !slugValid || slugStatus === "taken"
      ? "text-red-600"
      : slugStatus === "available" || slugStatus === "owned"
        ? "text-[#2F2F2F]"
        : "text-gray-500";

  const selectedTemplateBlocks = (() => {
    if (!selectedTemplateObj) return [];
    const fromBlocks = normalizeTemplateBlocks((selectedTemplateObj as any)?.blocks);
    if (fromBlocks.length) return fromBlocks;
    return normalizeTemplateBlocks((selectedTemplateObj as any)?.schedule);
  })();

  const sessionFlowPreview = studioEnabled ? studioBlocks : selectedTemplateBlocks;

  // The flow is edited in place, on the Session Flow timeline: editing turns
  // the current preset (or template) into a custom flow the host can change.
  const openSessionStudio = () => {
    if (!studioEnabled) {
      applyStudioBlocks(
        previewBlocks.map((block) => ({ ...block, id: uid() })) as StudioBlock[],
      );
    }
    setSelectedPresetKey(null);
    setFlowEditing(true);
  };

  const overlapError =
    error && /overlap/i.test(error) ? error : null;

  const overlayClass =
    "fixed inset-0 bg-black/50 z-50 p-2 sm:p-3 md:p-4 flex items-center justify-center";

  const panelClass =
    "bg-white w-full max-w-[1320px] h-[min(94vh,980px)] rounded-[24px] shadow-2xl flex flex-col overflow-hidden";

  const presetMeta = SESSION_PRESETS;

  const presetTemplateMap = Object.fromEntries(
    SESSION_PRESETS.map((preset) => [
      preset.key,
      templates.find((template) => templateMatchesPreset(template, preset)) || null,
    ]),
  ) as Record<PresetKey, SessionTemplate | null>;

  const selectedPreset = selectedPresetKey
    ? SESSION_PRESETS.find((preset) => preset.key === selectedPresetKey) || null
    : null;

  const generatedPresetBlocks = selectedPreset
    ? buildPresetCycleBlocks(selectedPreset, presetCycles)
    : [];

  const previewBlocks = studioEnabled
    ? studioBlocks
    : generatedPresetBlocks.length
      ? generatedPresetBlocks
      : sessionFlowPreview.length
        ? sessionFlowPreview
        : [
          { id: "preview-welcome", kind: "welcome" as StudioBlockKind, title: "Welcome & Check-in", minutes: 5 },
          { id: "preview-intentions", kind: "intentions" as StudioBlockKind, title: "Intentions", minutes: 5 },
          { id: "preview-focus-1", kind: "focus" as StudioBlockKind, title: "Focus 1", minutes: 25 },
          { id: "preview-break-1", kind: "break" as StudioBlockKind, title: "Break", minutes: 5 },
          { id: "preview-focus-2", kind: "focus" as StudioBlockKind, title: "Focus 2", minutes: 25 },
          { id: "preview-break-2", kind: "break" as StudioBlockKind, title: "Break", minutes: 5 },
          { id: "preview-focus-3", kind: "focus" as StudioBlockKind, title: "Focus 3", minutes: 25 },
          { id: "preview-recap", kind: "recap" as StudioBlockKind, title: "Wrap-up & Recap", minutes: 5 },
        ];

  const previewFocusMinutes = previewBlocks
    .filter((block) => block.kind === "focus")
    .reduce((sum, block) => sum + (Number(block.minutes) || 0), 0);
  const previewBreakMinutes = previewBlocks
    .filter((block) => block.kind === "break")
    .reduce((sum, block) => sum + (Number(block.minutes) || 0), 0);
  const previewTotalMinutes = previewBlocks.reduce(
    (sum, block) => sum + (Number(block.minutes) || 0),
    0,
  );

  // Timeline legend: one entry per kind of stage ("Focus 1/2/3" -> "Focus"), in order.
  const previewFlowLegend: { name: string; color: string; minutes: number }[] = [];
  for (const block of previewBlocks) {
    const visual = resolveStageVisual(block);
    const name = String(visual.name || block.title || "").replace(/\s+\d+$/, "");
    const existing = previewFlowLegend.find((item) => item.name === name);
    if (existing) existing.minutes += Number(block.minutes) || 0;
    else previewFlowLegend.push({ name, color: visual.color, minutes: Number(block.minutes) || 0 });
  }

  // The blocks the session will actually be created with.
  const flowBlocks: StudioBlock[] = studioEnabled
    ? studioBlocks
    : generatedPresetBlocks.length
      ? generatedPresetBlocks
      : selectedTemplateBlocks;
  const hasFlow = studioEnabled || !!selectedPresetKey || !!selectedTemplate;
  const bookendMessage = hasFlow ? bookendIssueMessage(bookendIssues(flowBlocks)) : null;

  const addBookendPhases = () => {
    applyStudioBlocks(
      withBookendPhases(
        flowBlocks.map((block) => ({ ...block, id: uid() })),
        uid,
      ),
    );
    setSelectedPresetKey(null);
  };

  const createDisabled =
    !title ||
    !scheduledAt ||
    (!studioEnabled && !selectedTemplate && !selectedPresetKey) ||
    (studioEnabled && studioBlocks.length === 0) ||
    !!bookendMessage ||
    (sanitizedSlug ? !slugValid : false) ||
    (scheduleMode === "single" && sanitizedSlug
      ? slugStatus === "taken" || slugStatus === "checking"
      : false) ||
    !!scheduleAdvanceError ||
    isCreating;

  const previewDate = scheduledAt ? new Date(scheduledAt) : null;
  const previewDateLabel =
    previewDate && !Number.isNaN(previewDate.getTime())
      ? previewDate.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
      : "Choose date";
  const previewTimeLabel =
    previewDate && !Number.isNaN(previewDate.getTime())
      ? previewDate.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
      : "Choose time";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827]/80 p-3 sm:p-5">
      {overlapError && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="overlap-warning-title"
            className="w-full max-w-[460px] rounded-[22px] border border-[#E5E7EB] bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="overlap-warning-title" className="font-inter text-[18px] font-semibold text-[#2F2F2F]">
                  Session time overlaps
                </h3>
                <p className="mt-2 font-inter text-[13px] leading-5 text-[#667085]">{overlapError}</p>
              </div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#E5E7EB] text-[#667085] hover:bg-[#F7F7F7]"
                aria-label="Close overlap warning"
              >
                <X size={17} />
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setError(null)}
                className="rounded-[14px] bg-[#2F2F2F] px-5 py-2.5 font-inter text-[13px] font-semibold text-white hover:bg-[#1F1F1F]"
              >
                Change time
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex h-[min(96vh,1080px)] w-full max-w-[1280px] flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_30px_90px_rgba(0,0,0,0.35)]">
        {/* Header */}
        <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-[#E6E8EC] px-6 sm:px-8">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#2F2F2F] text-white">
              <UiIcon name="calendar-plus-filled" size={20} />
            </div>
            <div>
              <h2 className="font-inter text-[20px] font-bold leading-tight tracking-[-0.4px] text-[#15171A]">Create session</h2>
              <p className="font-inter text-[13px] text-[#667085]">Set up your focus session in a few steps</p>
            </div>
          </div>
          {isAppAdmin ? (
            <CreateKindSwitch
              value="group"
              className="ml-auto mr-4 hidden sm:inline-flex"
              onChange={() => {
                onClose();
                requestInfiniteRoomCreator(navigate, location.pathname);
              }}
            />
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#344054] hover:bg-[#F4F4F5]"
            aria-label="Close"
          >
            <X size={22} strokeWidth={1.8} />
          </button>
        </div>

        {loading || !user ? (
          <div className="flex flex-1 items-center justify-center p-8 font-inter text-sm text-[#667085]">
            {loading ? "Checking your account..." : "You must be logged in to create a session."}
          </div>
        ) : (
          <div ref={modalScrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid min-h-full grid-cols-1 lg:grid-cols-[minmax(0,1.82fr)_minmax(360px,1fr)]">
              {/* Left column */}
              <div className="border-b border-[#E6E8EC] px-6 pb-6 pt-5 sm:px-8 lg:border-b-0 lg:border-r">
                {notice && (
                  <div className="mb-4 rounded-[12px] border border-[#2F2F2F]/20 bg-[#2F2F2F]/[0.05] px-4 py-3 font-inter text-[13px] text-[#2F2F2F]">
                    {notice}
                  </div>
                )}

                {/* Details and date side by side; structure and guests below. */}
                <div className="grid grid-cols-1 gap-x-7 gap-y-5 lg:grid-cols-2">
                {/* 1. Session details */}
                <section ref={basicSectionRef} className={SECTION_CARD}>
                  <SectionHeading step={1} title="Session details" />

                  <label htmlFor="create-session-title" className={`mt-3 ${FIELD_LABEL}`}>
                    Title <span className="text-[#E5484D]">*</span>
                  </label>
                  <input
                    id="create-session-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Deep Work Session"
                    className={`mt-1.5 ${FIELD_INPUT} text-[#15171A]`}
                  />

                  <label htmlFor="create-session-description" className={`mt-3 ${FIELD_LABEL}`}>Description (optional)</label>
                  <div className="relative mt-1.5">
                    <textarea
                      id="create-session-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value.slice(0, 300))}
                      placeholder="What will you focus on together?"
                      rows={2}
                      className="min-h-[76px] w-full resize-none rounded-[12px] border border-[#D8DCE3] bg-white px-3.5 py-2.5 pr-16 font-inter text-[14px] text-[#15171A] outline-none transition focus:border-[#2F2F2F] focus:ring-2 focus:ring-[#2F2F2F]/10"
                    />
                    <span className="absolute bottom-2.5 right-3.5 font-inter text-[11px] text-[#98A2B3]">{description.length}/300</span>
                  </div>

                  {/* Custom public link, always visible. */}
                  <label htmlFor="create-session-slug" className={`mt-3 ${FIELD_LABEL}`}>Custom link (optional)</label>
                  <div className="mt-1.5 flex gap-2">
                    {ownedSlugValues.length > 0 && (
                      <select
                        value={ownedSlugSelectValue}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCustomSlugInput(value === "__custom__" ? "" : value);
                        }}
                        aria-label="Your links"
                        className="h-11 w-[132px] shrink-0 rounded-[12px] border border-[#D8DCE3] bg-white px-2.5 font-inter text-[13px] text-[#344054] outline-none focus:border-[#2F2F2F]"
                      >
                        <option value="">No link</option>
                        {ownedSlugValues.map((slug) => <option key={slug} value={slug}>{slug}</option>)}
                        <option value="__custom__">New link…</option>
                      </select>
                    )}
                    <div className="flex h-11 min-w-0 flex-1 items-center rounded-[12px] border border-[#D8DCE3] bg-white pl-3.5 transition focus-within:border-[#2F2F2F] focus-within:ring-2 focus-within:ring-[#2F2F2F]/10">
                      <span className="shrink-0 font-inter text-[13px] text-[#98A2B3]">mysession.club/</span>
                      <input
                        id="create-session-slug"
                        type="text"
                        value={customSlugInput}
                        onChange={(e) => setCustomSlugInput(e.target.value)}
                        placeholder="your-link"
                        className="h-full min-w-0 flex-1 bg-transparent pr-3 font-inter text-[14px] text-[#15171A] outline-none"
                      />
                    </div>
                  </div>
                  {customSlugInput ? (
                    <p className={"mt-1.5 truncate font-inter text-[11px] " + slugHintColor} title={linkPreview}>{slugHint}</p>
                  ) : null}
                </section>


                {/* 2. Date & scheduling */}
                <section
                  ref={scheduleSectionRef}
                  className={SECTION_CARD}
                  aria-labelledby="create-session-schedule-heading"
                >
                  <SectionHeading step={2} title="Date & scheduling" id="create-session-schedule-heading" />

                  {/* Date and start time (any minute), then repeat. */}
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="create-session-date" className={FIELD_LABEL}>
                        Date <span className="text-[#E5484D]">*</span>
                      </label>
                      <input
                        id="create-session-date"
                        type="date"
                        value={scheduledDatePart}
                        min={minScheduleDate}
                        onChange={(event) =>
                          setScheduledAt(
                            combineScheduledDateTime({
                              current: scheduledAt,
                              date: event.target.value,
                            }),
                          )
                        }
                        className={`mt-1.5 ${FIELD_INPUT}`}
                      />
                    </div>

                    <div>
                      <label htmlFor="create-session-time" className={FIELD_LABEL}>
                        Start time <span className="text-[#E5484D]">*</span>
                      </label>
                      <input
                        id="create-session-time"
                        type="time"
                        step={60}
                        value={scheduledTimePart}
                        onChange={(event) =>
                          setScheduledAt(
                            combineScheduledDateTime({
                              current: scheduledAt,
                              time: event.target.value,
                            }),
                          )
                        }
                        className={`mt-1.5 ${FIELD_INPUT}`}
                      />
                    </div>

                    <fieldset className="col-span-2">
                      <legend className={FIELD_LABEL}>Repeat</legend>
                      <div className="mt-1.5 grid h-11 grid-cols-3 gap-1 rounded-[12px] bg-[#F2F2F3] p-1">
                        {([
                          ["single", "Once", "Create it once"],
                          ["daily", "Daily", "Schedule daily sessions in advance"],
                          ["weekly", "Weekly", "Schedule weekly sessions in advance"],
                        ] as Array<[ScheduleMode, string, string]>).map(([mode, label, helper]) => {
                          const selected = scheduleMode === mode;
                          return (
                            <button
                              key={mode}
                              type="button"
                              title={helper}
                              onClick={() => setScheduleMode(mode)}
                              className={[
                                "rounded-[9px] px-3.5 font-inter text-[13px] font-semibold transition",
                                selected
                                  ? "bg-[#2F2F2F] text-white shadow-sm"
                                  : "text-[#667085] hover:text-[#2F2F2F]",
                              ].join(" ")}
                              aria-pressed={selected}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  </div>

                  {scheduleMode !== "single" && (
                    <div className="mt-4 grid grid-cols-1 gap-4 rounded-[16px] border border-[#E3E5E8] bg-white p-4 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="create-session-occurrences"
                          className="block font-inter text-[12px] font-semibold text-[#344054]"
                        >
                          Number of sessions
                        </label>
                        <div className="relative mt-2">
                          <select
                            id="create-session-occurrences"
                            value={occurrencesCount}
                            onChange={(event) => {
                              const count = clamp(
                                Number(event.target.value) || 1,
                                1,
                                dynamicMaxOccurrences,
                              );
                              if (scheduleMode === "daily") setDailyDays(count);
                              if (scheduleMode === "weekly") setWeeklyCount(count);
                            }}
                            className="h-11 w-full appearance-none rounded-[12px] border border-[#D8DCE3] bg-white px-3 pr-10 font-inter text-[13px] text-[#344054] outline-none focus:border-[#2F2F2F]"
                          >
                            {Array.from(
                              { length: dynamicMaxOccurrences },
                              (_, index) => index + 1,
                            ).map((count) => (
                              <option key={count} value={count}>
                                {count} {count === 1 ? "session" : "sessions"}
                              </option>
                            ))}
                          </select>
                          <ChevronDown
                            size={15}
                            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#667085]"
                          />
                        </div>
                      </div>

                      {scheduleMode === "daily" ? (
                        <label className="flex min-h-11 items-center gap-3 self-end rounded-[12px] border border-[#D8DCE3] bg-[#FAFAFA] px-3 font-inter text-[12px] text-[#344054]">
                          <input
                            type="checkbox"
                            checked={dailyWeekdaysOnly}
                            onChange={(event) =>
                              setDailyWeekdaysOnly(event.target.checked)
                            }
                            className="h-4 w-4 accent-[#2F2F2F]"
                          />
                          Weekdays only
                        </label>
                      ) : (
                        <div className="self-end rounded-[12px] border border-[#E3E5E8] bg-[#FAFAFA] px-3 py-2.5 font-inter text-[11px] leading-4 text-[#667085]">
                          Repeats every 7 days from the selected date.
                        </div>
                      )}
                    </div>
                  )}

                  {scheduleAdvanceError ? (
                    <div
                      role="alert"
                      className="mt-4 rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 font-inter text-[12px] leading-5 text-red-700"
                    >
                      {scheduleAdvanceError}
                    </div>
                  ) : null}

                  {occurrencesPreview.length > 0 ? (
                    <div className="mt-4 rounded-[16px] border border-[#E3E5E8] bg-white p-4">
                      <div className="font-inter text-[12px] font-semibold text-[#344054]">
                        {scheduleMode === "single" ? "Session time" : "Session dates"}
                      </div>
                      <div className="mt-2 grid gap-1.5 font-inter text-[11px] text-[#667085] sm:grid-cols-2">
                        {occurrencesPreview.map((item) => (
                          <div key={item} className="rounded-[14px] bg-[#F7F7F8] px-3 py-2">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
                </div>

                {/* 3. Choose a structure */}
                <section ref={structureSectionRef} className={`mt-5 border-t border-[#F0F0F1] pt-5 ${SECTION_CARD}`}>
                  <SectionHeading step={3} title="Choose a structure">
                    <span className="inline-flex items-center gap-2">
                      <span>Pick a proven flow, then click the timeline on the right to change it.</span>
                      <span className="group relative inline-flex">
                        <Info size={16} className="cursor-help" />
                        <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-[260px] -translate-x-1/2 rounded-[14px] bg-[#2F2F2F] px-3 py-2 text-center text-[11px] leading-4 text-white shadow-xl group-hover:block">
                          Session Studio lets you create a custom structure with your own focus blocks, breaks, check-ins, intentions, and recap stages.
                        </span>
                      </span>
                    </span>
                  </SectionHeading>

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {presetMeta.map((preset) => {
                      const template = presetTemplateMap[preset.key];
                      const isSelected =
                        selectedPresetKey === preset.key &&
                        !studioEnabled;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setSelectedTemplate(template?.id || templates[0]?.id || "");
                            setSelectedPresetKey(preset.key);
                            setStudioEnabled(false);
                            setFlowEditing(false);
                          }}
                          className={PRESET_TILE + (isSelected ? PRESET_TILE_ON : PRESET_TILE_OFF)}
                          aria-pressed={isSelected}
                        >
                          <span className={PRESET_TILE_ICON + (isSelected ? " bg-white/15 text-white" : " bg-[#F2F2F3] text-[#2F2F2F]")}>
                            {preset.icon === "zap" ? (
                              <UiIcon name="bolt" size={17} />
                            ) : preset.icon === "target" ? (
                              <UiIcon name="bullseye" size={17} />
                            ) : (
                              <span className="text-[17px] leading-none" aria-hidden="true">🍅</span>
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block font-inter text-[14px] font-bold leading-5">{preset.label}</span>
                            <span className={"block truncate font-inter text-[11.5px] leading-4 " + (isSelected ? "text-white/70" : "text-[#667085]")}>
                              {preset.focus.replace(" focus", "")} · {preset.breakLabel.replace(" break", "")}
                            </span>
                          </span>
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={openSessionStudio}
                      className={PRESET_TILE + (studioEnabled ? PRESET_TILE_ON : PRESET_TILE_OFF)}
                      aria-pressed={studioEnabled}
                    >
                      <span className={PRESET_TILE_ICON + (studioEnabled ? " bg-white/15 text-white" : " bg-[#F2F2F3] text-[#2F2F2F]")}>
                        <UiIcon name="layers" size={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-inter text-[14px] font-bold leading-5">Custom</span>
                        <span className={"block truncate font-inter text-[11.5px] leading-4 " + (studioEnabled ? "text-white/70" : "text-[#667085]")}>Session Studio</span>
                      </span>
                    </button>
                  </div>

                  {selectedPreset && !studioEnabled && (
                    <div className="mt-3 flex flex-col gap-3 rounded-[12px] bg-[#F7F7F7] px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-inter text-[13px] font-semibold text-[#15171A]">
                          Number of cycles
                        </div>
                        <div className="mt-1 font-inter text-[12px] text-[#667085]">
                          Each cycle adds {selectedPreset.focusMinutes} minutes of focus and a {selectedPreset.breakMinutes}-minute check-in &amp; break. Opens with sharing goals, ends with sharing progress.
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPresetCycles((value) => clamp(value - 1, 1, 12))}
                          disabled={presetCycles <= 1}
                          className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-[#D5D5D5] bg-white text-[#2F2F2F] disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Decrease cycles"
                        >
                          <Minus size={16} />
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={12}
                          value={presetCycles}
                          onChange={(event) =>
                            setPresetCycles(clamp(Number(event.target.value) || 1, 1, 12))
                          }
                          className="h-10 w-16 rounded-[12px] border border-[#D5D5D5] bg-white px-2 text-center font-inter text-[14px] font-semibold text-[#15171A] outline-none focus:border-[#2F2F2F] focus:ring-2 focus:ring-[#2F2F2F]/10"
                          aria-label="Number of cycles"
                        />
                        <button
                          type="button"
                          onClick={() => setPresetCycles((value) => clamp(value + 1, 1, 12))}
                          disabled={presetCycles >= 12}
                          className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-[#D5D5D5] bg-white text-[#2F2F2F] disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Increase cycles"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={openSessionStudio}
                    className="mt-2.5 inline-flex items-center gap-2 font-inter text-[12.5px] text-[#667085] transition hover:text-[#2F2F2F]"
                  >
                    <UiIcon name="sparkles" size={14} className="text-[#2F2F2F]" />
                    <span>Add check-ins, intentions and more: <span className="font-semibold underline">edit the session flow</span>.</span>
                  </button>
                </section>

                {/* 4. Guests & capacity */}
                <section ref={guestsSectionRef} className={`mt-5 border-t border-[#F0F0F1] pt-5 ${SECTION_CARD}`}>
                  <SectionHeading step={4} title="Guests & capacity" />
                  {/* Capacity, access and room rules on one row; rules are icon toggles. */}
                  <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3">
                    <div className="w-[132px]">
                      <label htmlFor="create-session-capacity" className={FIELD_LABEL}>Max participants</label>
                      <div className="relative mt-1.5">
                        <UiIcon name="users" size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#98A2B3]" />
                        <input
                          id="create-session-capacity"
                          type="number"
                          min={MIN_PARTICIPANTS}
                          max={MAX_PARTICIPANTS}
                          step={1}
                          value={maxParticipants}
                          onChange={(event) =>
                            setMaxParticipants(
                              clamp(
                                Number(event.target.value) || MIN_PARTICIPANTS,
                                MIN_PARTICIPANTS,
                                MAX_PARTICIPANTS,
                              ),
                            )
                          }
                          onBlur={() =>
                            setMaxParticipants((value) =>
                              clamp(
                                Number(value) || DEFAULT_MAX_PARTICIPANTS,
                                MIN_PARTICIPANTS,
                                MAX_PARTICIPANTS,
                              ),
                            )
                          }
                          className={`${FIELD_INPUT} pl-10`}
                          aria-label="Maximum participants"
                          title={`Any number from ${MIN_PARTICIPANTS} to ${MAX_PARTICIPANTS}`}
                        />
                      </div>
                    </div>

                    <fieldset>
                      <legend className={FIELD_LABEL}>Who can join</legend>
                      <div className="mt-1.5 flex h-11 gap-1 rounded-[12px] bg-[#F2F2F3] p-1">
                        {([
                          ["public", "Public", "earth-americas", "Visible on the sessions page and joinable through its link."],
                          ["private", "Private", "lock", "Hidden from the public sessions list. Share the direct link to invite someone."],
                        ] as const).map(([mode, label, icon, helper]) => {
                          const selected = accessMode === mode;
                          return (
                            <button
                              key={mode}
                              type="button"
                              title={helper}
                              onClick={() => setAccessMode(mode as AccessMode)}
                              className={[
                                "inline-flex items-center gap-1.5 rounded-[9px] px-3 font-inter text-[13px] font-semibold transition",
                                selected ? "bg-[#2F2F2F] text-white shadow-sm" : "text-[#667085] hover:text-[#2F2F2F]",
                              ].join(" ")}
                              aria-pressed={selected}
                            >
                              <UiIcon name={icon} size={14} />
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>

                    <fieldset>
                      <legend className={FIELD_LABEL}>Room rules</legend>
                      <div className="mt-1.5 flex h-11 gap-1.5">
                        {([
                          {
                            key: "camera",
                            on: cameraRequired,
                            label: "Cameras required",
                            helper: "Two reminders, then disconnect if the camera stays off.",
                            icons: ["webcam"],
                            toggle: () => { setCameraRequired((v) => !v); setCameraOrScreenShareRequired(false); },
                          },
                          {
                            key: "screen",
                            on: screenShareRequired,
                            label: "Screen share required",
                            helper: "Two reminders, then disconnect if screen sharing stays off.",
                            icons: ["screencast"],
                            toggle: () => { setScreenShareRequired((v) => !v); setCameraOrScreenShareRequired(false); },
                          },
                          {
                            key: "either",
                            on: cameraOrScreenShareRequired,
                            label: "Camera or screen share required",
                            helper: "Either one is enough. Two reminders, then disconnect only if both stay off.",
                            icons: ["webcam", "screencast"],
                            toggle: () => { setCameraOrScreenShareRequired((v) => !v); setCameraRequired(false); setScreenShareRequired(false); },
                          },
                          {
                            key: "chat",
                            on: publicChatDisabled,
                            label: "Public chat off",
                            helper: "Participants can only send private messages to the host.",
                            icons: ["comment-slash"],
                            toggle: () => setPublicChatDisabled((v) => !v),
                          },
                        ] as const).map((rule) => (
                          <button
                            key={rule.key}
                            type="button"
                            onClick={rule.toggle}
                            title={`${rule.label}. ${rule.helper}`}
                            aria-label={rule.label}
                            aria-pressed={rule.on}
                            className={[
                              "inline-flex min-w-11 items-center justify-center gap-1 rounded-[12px] border px-2.5 transition",
                              rule.on
                                ? "border-[#2F2F2F] bg-[#2F2F2F] text-white"
                                : "border-[#D8DCE3] bg-white text-[#667085] hover:border-[#2F2F2F]/50 hover:text-[#2F2F2F]",
                            ].join(" ")}
                          >
                            {rule.icons.map((icon, i) => (
                              <span key={icon} className="inline-flex items-center gap-1">
                                {i > 0 ? <span className="font-inter text-[10px] font-semibold opacity-70">or</span> : null}
                                <UiIcon name={icon} size={17} />
                              </span>
                            ))}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  </div>

                  <p className="mt-2.5 font-inter text-[12px] leading-5 text-[#667085]">
                    {accessMode === "private"
                      ? "Private: hidden from the sessions list, join by direct link."
                      : "Public: listed on the sessions page."}
                    {" "}
                    {[
                      cameraRequired && "Cameras required.",
                      screenShareRequired && "Screen share required.",
                      cameraOrScreenShareRequired && "Camera or screen share required.",
                      publicChatDisabled && "Public chat off.",
                    ].filter(Boolean).join(" ") || "No room rules. Hover an icon to see what it does."}
                  </p>
                </section>

                {/* Start from one of your templates or a previous session. */}
                {(userTemplates.length > 0 || previousSessions.length > 0) && (
                <details className="mt-5 rounded-[12px] bg-[#F7F7F8]">
                  <summary className="cursor-pointer list-none px-4 py-2.5 font-inter text-[13px] font-semibold text-[#344054] marker:hidden">
                    <span className="flex items-center justify-between gap-3">
                      Start from a template or a past session
                      <ChevronDown size={16} className="text-[#667085]" />
                    </span>
                  </summary>
                  <div className="space-y-5 border-t border-[#E3E5E8] p-4">

                    {(userTemplates.length > 0 || previousSessions.length > 0) && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {userTemplates.length > 0 && (
                          <label className="font-inter text-[12px] font-semibold text-[#344054]">
                            My templates
                            <select
                              value={selectedUserTemplateId}
                              onChange={(e) => {
                                const row = userTemplates.find((item) => item.id === e.target.value);
                                if (row) applyUserTemplate(row);
                              }}
                              className="mt-2 h-11 w-full rounded-[12px] border border-[#D8DCE3] bg-white px-3 font-inter text-[13px]"
                            >
                              <option value="">Choose template</option>
                              {userTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                          </label>
                        )}
                        {previousSessions.length > 0 && (
                          <label className="font-inter text-[12px] font-semibold text-[#344054]">
                            Previous sessions
                            <select
                              value={selectedPreviousSessionId}
                              onChange={(e) => {
                                const row = previousSessions.find((item) => item.id === e.target.value);
                                if (row) applyPreviousSession(row);
                              }}
                              className="mt-2 h-11 w-full rounded-[12px] border border-[#D8DCE3] bg-white px-3 font-inter text-[13px]"
                            >
                              <option value="">Choose session</option>
                              {previousSessions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                            </select>
                          </label>
                        )}
                      </div>
                    )}

                  </div>
                </details>
                )}


                {error && !overlapError && <p className="mt-4 font-inter text-[13px] text-red-600">{error}</p>}
              </div>

              {/* Right column */}
              <aside className="bg-[#FAFAFB] px-6 py-5 sm:px-7">
                {/* Stays in view while the form on the left scrolls. */}
                <div className="lg:sticky lg:top-6">
                <h3 className="font-inter text-[15.5px] font-bold text-[#15171A]">Session preview</h3>

                <div className="mt-3 rounded-[14px] border border-[#E6E8EC] bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 font-inter text-[14px] font-medium text-[#344054]">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2F2F2F] text-white"><UiIcon name="users-filled" size={18} /></span>
                      Group session
                    </div>
                    <span className="rounded-full bg-[#2F2F2F]/[0.10] px-2.5 py-1 font-inter text-[11px] font-semibold text-[#2F2F2F]">Structured</span>
                  </div>
                  <div className="mt-3.5 space-y-2.5 font-inter text-[13px] text-[#344054]">
                    <div className="flex items-center gap-3"><UiIcon name="calendar" size={16} className="text-[#98A2B3]" /><span>{previewDateLabel} · {previewTimeLabel}</span></div>
                    <div className="flex items-center gap-3"><UiIcon name="arrows-repeat" size={16} className="text-[#98A2B3]" /><span>{studioEnabled
                      ? "Custom structure"
                      : selectedPreset
                        ? `Based on ${selectedPreset.label} · ${presetCycles} ${presetCycles === 1 ? "cycle" : "cycles"}`
                        : "Based on selected structure"}</span></div>
                    <div className="flex items-center gap-3"><UiIcon name="users" size={16} className="text-[#98A2B3]" /><span>Up to {maxParticipants} participants</span></div>
                    <div className="flex items-center gap-3">
                      <UiIcon name={accessMode === "private" ? "lock" : "earth-americas"} size={16} className="text-[#98A2B3]" />
                      <span>{accessMode === "private" ? "Private · direct link only" : "Public session"}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h4 className="font-inter text-[15px] font-bold text-[#15171A]">Session Flow</h4>
                    <span className="group relative inline-flex text-[#667085]">
                      <Info size={16} />
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-[230px] -translate-x-1/2 rounded-[12px] bg-[#2F2F2F] px-3 py-2 text-center font-inter text-[11px] leading-4 text-white group-hover:block">Click the timeline to change stages, durations, colors and order right here.</span>
                    </span>
                  </div>
                  {!flowEditing ? (
                    <button type="button" onClick={openSessionStudio} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#D8DCE3] bg-white px-3 font-inter text-[12px] font-semibold text-[#344054] hover:border-[#2F2F2F]">
                      <UiIcon name="pencil" size={13} /> Edit
                    </button>
                  ) : null}
                </div>

                {flowEditing ? (
                  <div className="mt-3 rounded-[14px] border border-[#E6E8EC] bg-white p-3.5 font-inter">
                    {/* Add blocks from the library; they land at the end of the timeline. */}
                    <div className="flex flex-wrap gap-1.5">
                      {STUDIO_LIBRARY.map((block) => (
                        <button
                          key={block.id}
                          type="button"
                          onClick={() => addFromLibrary(block)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#D8DCE3] bg-white px-2.5 py-1 text-[11px] text-[#344054] hover:border-[#2F2F2F]"
                        >
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getBlockColor(block) }} />
                          {block.title}
                        </button>
                      ))}
                    </div>

                    <SessionTimeline
                      blocks={studioBlocks}
                      onChange={setStudioBlocks}
                      selectedBlockId={activeBlockId}
                      setSelectedBlockId={selectStudioBlock}
                    />

                    <div className="mt-3 flex min-w-0 items-center gap-1.5">
                      <input
                        value={saveTemplateName}
                        onChange={(e) => setSaveTemplateName(e.target.value)}
                        placeholder="Save as template…"
                        aria-label="Template name"
                        className="h-8 min-w-0 flex-1 rounded-full border border-[#E5E5E5] bg-white px-3 text-[12px] outline-none focus:border-[#2F2F2F]"
                      />
                      {saveTemplateName.trim() ? (
                        <button
                          type="button"
                          onClick={handleSaveCurrentAsUserTemplate}
                          disabled={isSavingUserTemplate}
                          className="h-8 shrink-0 rounded-full border border-[#E5E5E5] px-3 text-[12px] font-semibold text-[#344054] hover:bg-[#F3F4F6] disabled:opacity-50"
                        >
                          {isSavingUserTemplate ? "Saving…" : "Save"}
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3 text-[12px] text-[#667085]">
                        <button type="button" onClick={resetDefaultStudio} className="hover:text-[#15171A]">Reset</button>
                        <button type="button" onClick={clearStudio} className="hover:text-[#15171A]">Clear</button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFlowEditing(false)}
                        className="h-8 rounded-full bg-[#2F2F2F] px-4 text-[12px] font-semibold text-white hover:bg-[#1F1F1F]"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                ) : (
                <button
                  type="button"
                  onClick={openSessionStudio}
                  title="Click to edit the flow"
                  className="group/flow mt-3 block w-full rounded-[14px] border border-[#E6E8EC] bg-white p-3.5 text-left transition hover:border-[#2F2F2F]/40 hover:shadow-[0_4px_14px_rgba(0,0,0,0.06)]"
                >
                  {/* Same look as SessionStageBar: one continuous track, rounded only at its ends. */}
                  <div className="flex h-[10px] overflow-hidden rounded-full bg-[#E9EAEC]">
                    {previewBlocks.map((block, index) => {
                      const visual = resolveStageVisual(block);
                      const minutes = Number(block.minutes) || 0;
                      if (minutes <= 0 || previewTotalMinutes <= 0) return null;
                      return (
                        <span
                          key={`${block.id}-${index}`}
                          className="h-full"
                          style={{ width: `${(minutes / previewTotalMinutes) * 100}%`, backgroundColor: visual.color }}
                          title={`${visual.name || block.title} · ${block.minutes} min`}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-1.5 flex justify-between font-inter text-[11px] tabular-nums text-[#98A2B3]">
                    <span>0 min</span>
                    <span>{previewTotalMinutes} min</span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5 font-inter text-[12px] text-[#344054]">
                    {previewFlowLegend.map((item) => (
                      <span key={item.name} className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                        {item.name}
                        <span className="text-[#98A2B3]">{item.minutes}m</span>
                      </span>
                    ))}
                  </div>
                </button>
                )}

                {bookendMessage ? (
                  <div role="alert" className="mt-2.5 flex items-start gap-2.5 rounded-[12px] bg-[#FEF3F2] px-3 py-2.5 font-inter text-[12px] leading-[17px] text-[#B42318]">
                    <UiIcon name="info" size={15} className="mt-px shrink-0" />
                    <span className="min-w-0 flex-1">{bookendMessage}</span>
                    <button
                      type="button"
                      onClick={addBookendPhases}
                      className="shrink-0 rounded-full bg-[#B42318] px-2.5 py-1 font-semibold text-white hover:bg-[#912018]"
                    >
                      Add
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 font-inter text-[11.5px] leading-4 text-[#667085]">
                    Required: sharing goals at the start and sharing progress at the end, 2+ min each.
                  </p>
                )}

                <div className="my-4 h-px bg-[#E6E8EC]" />

                <h4 className="font-inter text-[14px] font-bold text-[#15171A]">Quick summary</h4>
                <div className="mt-2.5 rounded-[14px] border border-[#E6E8EC] bg-white p-3.5">
                  <div className="space-y-2 font-inter text-[12px] text-[#667085]">
                    <div className="flex justify-between gap-4"><span>Focus time</span><strong className="font-medium text-[#344054]">{previewFocusMinutes} min</strong></div>
                    <div className="flex justify-between gap-4"><span>Break time</span><strong className="font-medium text-[#344054]">{previewBreakMinutes} min</strong></div>
                    <div className="flex justify-between gap-4"><span>Total time (per session)</span><strong className="font-medium text-[#344054]">{previewTotalMinutes} min</strong></div>
                    <div className="flex justify-between gap-4"><span>Max participants</span><strong className="font-medium text-[#344054]">{maxParticipants} people</strong></div>
                  </div>
                </div>
                </div>
              </aside>
            </div>
          </div>
        )}

        {/* Footer */}
        {!loading && user && (
          <div className="flex h-[72px] shrink-0 items-center justify-between gap-4 border-t border-[#E6E8EC] bg-white px-6 sm:px-8">
            <button type="button" onClick={onClose} className="h-11 rounded-full border border-[#D8DCE3] bg-white px-5 font-inter text-[13px] font-semibold text-[#344054] hover:bg-[#F7F7F7]">Cancel</button>
            <div className="ml-auto hidden min-w-0 truncate font-inter text-[13px] text-[#667085] md:block">
              {previewDateLabel} · {previewTimeLabel} · <span className="font-semibold text-[#344054]">{previewTotalMinutes} min</span>
            </div>
            <button
              type="button"
              onClick={handleCreate}
              disabled={createDisabled}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-[#2F2F2F] px-6 font-inter text-[13px] font-semibold text-white hover:bg-[#1F1F1F] disabled:cursor-not-allowed disabled:bg-[#2F2F2F]/25"
            >
              <CalendarDays size={16} />
              {isCreating ? "Creating..." : scheduleMode === "single" ? "Schedule it" : "Schedule series"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
