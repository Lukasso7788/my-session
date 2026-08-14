// src/components/TasksPanel.tsx

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { ReactNode, MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  Pencil,
  Trash2,
  X,
  Check,
  ExternalLink,
  ListPlus,
  RefreshCw,
  Search,
  Lock,
  Globe2,
  TimerReset,
  GripVertical,
  Eye,
  EyeOff,
  Sparkles,
  Loader2,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useNavigate, useParams } from "react-router-dom";
import { getUserEntitlement } from "../lib/entitlements";
import { isEntitlementActive, isPaidPlan } from "../lib/billing";

type RoomTheme = "dark" | "light";

type SessionTask = {
  id: string;
  text: string;
  user_id: string;
  session_id: string;
  created_at?: string;
  completed?: boolean;
  profiles?: {
    full_name?: string;
    avatar_url?: string;
  };
};

type PanelTask = {
  id: string;
  user_id: string;
  text: string;
  focus_plan_item_id: string | null;
  completed: boolean;
  created_at: string;
  updated_at: string;
  visibility?: "public" | "private" | string | null;
  sort_order?: number | null;
};

type FocusPlan = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type FocusPlanItem = {
  id: string;
  plan_id: string;
  user_id: string;
  text: string;
  target_date: string | null;
  session_id: string | null;
  created_at: string;
  completed: boolean;
  sort_order: number;
};

type TaskAiSuggestion = {
  summary: string;
  firstAction: string;
  nextSteps: string[];
  likelyObstacle: string;
  focusMinutes: number;
};

type TasksPanelProps = {
  sessionId?: string; // uuid or slug
  oneOnOneMode?: boolean;
  theme?: RoomTheme;
  timerText?: string;
  timerTextClassName?: string;
  pictureInPictureSupported?: boolean;
  pictureInPictureOpen?: boolean;
  onOpenPictureInPicture?: () => void;
  accountabilityWallOpen?: boolean;
  onToggleAccountabilityWall?: () => void;
};

type ProfileMini = {
  id: string;
  full_name?: string;
  avatar_url?: string;
};

type EncouragementUser = ProfileMini & {
  emoji?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DocPiPWindow = Window & { document: Document; close: () => void };

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (opts?: {
        width?: number;
        height?: number;
      }) => Promise<DocPiPWindow>;
    };
  }
}

const OVERLAY_FONT_FAMILY =
  'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';

const PANEL_TASKS_TABLE = "panel_intentions";
const SESSION_TASKS_TABLE = "intentions";
const TASK_ENCOURAGEMENTS_TABLE = "intention_encouragements";
const ENCOURAGEMENT_EMOJI = "🤩";

/**
 * Conservative limits:
 * - enough for normal usage
 * - lighter queries + lighter render
 */
const PANEL_TASKS_FETCH_LIMIT = 120;
const SESSION_TASKS_FETCH_LIMIT = 80;
const TEAM_TASKS_RENDER_LIMIT = 50;
const PLAN_ITEMS_RENDER_LIMIT = 40;
const FOCUS_PLAN_ITEMS_FETCH_LIMIT = 120;
const FOCUS_PLANS_FETCH_LIMIT = 40;

function normalizeTaskVisibility(value: unknown): "public" | "private" {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (v === "private" || v === "self" || v === "hidden") return "private";
  return "public";
}

function isPanelTaskVisibleInRoom(item?: { visibility?: unknown } | null) {
  return normalizeTaskVisibility(item?.visibility) !== "private";
}

function isPanelTaskPublic(item?: { visibility?: unknown } | null) {
  return normalizeTaskVisibility(item?.visibility) === "public";
}

function getNextTaskVisibility(value: unknown): "public" | "private" {
  const current = normalizeTaskVisibility(value);
  return current === "public" ? "private" : "public";
}

function getVisibilityTitle(value: unknown) {
  const v = normalizeTaskVisibility(value);
  if (v === "public")
    return "Public — visible to everyone in the room. Click the lock to make private.";
  return "Private — visible only to you. Click the globe to make public.";
}

function TaskVisibilityIcon({
  visibility,
  size = 14,
}: {
  visibility: unknown;
  size?: number;
}) {
  const normalizedVisibility = normalizeTaskVisibility(visibility);
  const source =
    normalizedVisibility === "public"
      ? "/icons/task-public.svg"
      : "/icons/task-private.svg";
  const [customIconAvailable, setCustomIconAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    const image = new Image();
    image.onload = () => active && setCustomIconAvailable(true);
    image.onerror = () => active && setCustomIconAvailable(false);
    image.src = source;

    return () => {
      active = false;
    };
  }, [source]);

  if (!customIconAvailable) {
    return normalizedVisibility === "public" ? (
      <Globe2 size={size} />
    ) : (
      <Lock size={size} />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="block shrink-0 bg-current"
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url(${source})`,
        maskImage: `url(${source})`,
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}

function orderPanelTasks(tasks: PanelTask[], order: string[]) {
  const indexById = new Map(order.map((id, index) => [id, index]));
  return [...tasks].sort((a, b) => {
    const ai = indexById.has(a.id)
      ? Number(indexById.get(a.id))
      : Number.MAX_SAFE_INTEGER;
    const bi = indexById.has(b.id)
      ? Number(indexById.get(b.id))
      : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
}

function AnimatedTodoCheck({
  completed,
  size = 18,
  className = "",
}: {
  completed: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={[
        "relative inline-flex shrink-0 items-center justify-center leading-none transition-transform duration-200",
        completed ? "scale-105" : "scale-100",
        className,
      ].join(" ")}
      aria-hidden="true"
    >
      <svg className="block" width={size} height={size} viewBox="0 0 24 24" fill="none">
        {completed ? (
          <circle cx="12" cy="12" r="8" stroke="#81DB86" strokeWidth="1.5" opacity="0">
            <animate attributeName="r" values="8;11" dur="0.38s" fill="freeze" />
            <animate attributeName="opacity" values="0.45;0" dur="0.38s" fill="freeze" />
          </circle>
        ) : null}
        <circle
          cx="12"
          cy="12"
          r="9"
          fill={completed ? "#81DB86" : "transparent"}
          stroke={completed ? "#81DB86" : "currentColor"}
          strokeWidth="1.7"
          style={{ transition: "fill 180ms ease, stroke 180ms ease" }}
        />
        {completed ? (
          <path
            d="M7.8 12.2 10.7 15l5.8-6.2"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="20"
            strokeDashoffset="20"
          >
            <animate
              attributeName="stroke-dashoffset"
              from="20"
              to="0"
              dur="0.3s"
              begin="0.05s"
              fill="freeze"
            />
          </path>
        ) : null}
      </svg>
    </span>
  );
}

function PanelSmartIcon({
  name,
  theme,
  className = "w-4 h-4",
  alt,
}: {
  name:
  | "focus-plan"
  | "pip-intentions"
  | "pin"
  | "encouragement"
  | "in-progress"
  | "accountability-wall";
  theme: RoomTheme;
  className?: string;
  alt?: string;
}) {
  const themedSrc = `/icons/${name}-${theme}.svg`;
  const neutralSrc = `/icons/${name}.svg`;
  const [src, setSrc] = useState(themedSrc);

  useEffect(() => {
    setSrc(themedSrc);
  }, [themedSrc]);

  return (
    <img
      src={src}
      onError={() => {
        if (src !== neutralSrc) setSrc(neutralSrc);
      }}
      className={className}
      alt={alt || name}
      draggable={false}
    />
  );
}

function IconButton({
  title,
  onClick,
  children,
  className = "",
  theme = "dark",
}: {
  title: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
  theme?: RoomTheme;
}) {
  const isLight = theme === "light";
  const base = isLight
    ? "bg-[#E6E6E6] hover:bg-[#DCDCDC] text-black/70"
    : "bg-[#1B1B1B] hover:bg-[#242424] text-white/80";

  return (
    <button
      title={title}
      onClick={onClick}
      className={
        "w-9 h-9 rounded-xl flex items-center justify-center transition " +
        base +
        " " +
        className
      }
      type="button"
    >
      {children}
    </button>
  );
}

function TimerSmartIcon({
  theme,
  className = "w-4 h-4",
  alt = "Timer",
}: {
  theme: RoomTheme;
  className?: string;
  alt?: string;
}) {
  const themedSrc = `/icons/timer-${theme}.svg`;
  const fallbackSrc = `/icons/timer.svg`;

  const [src, setSrc] = useState(themedSrc);

  useEffect(() => {
    setSrc(themedSrc);
  }, [themedSrc]);

  return (
    <img
      src={src}
      onError={() => {
        if (src !== fallbackSrc) setSrc(fallbackSrc);
      }}
      className={className}
      alt={alt}
      draggable={false}
    />
  );
}

function copyStylesToDocument(from: Document, to: Document) {
  try {
    const nodes = Array.from(
      from.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
        'style, link[rel="stylesheet"], link[rel="preconnect"], link[rel="preload"]',
      ),
    );

    nodes.forEach((n) => {
      const clone = n.cloneNode(true) as HTMLElement;
      to.head.appendChild(clone);
    });
  } catch { }
}

function applyOverlayBaseStyles(doc: Document, isLight: boolean) {
  try {
    doc.documentElement.style.height = "100%";
    doc.body.style.height = "100%";
    doc.body.style.margin = "0";
    doc.body.style.background = isLight ? "#F3F3F3" : "#1B1B1B";
    doc.body.style.fontFamily = OVERLAY_FONT_FAMILY;
  } catch { }
}

function safeTrim(x: unknown) {
  return String(x || "").trim();
}

function normalizeTextForMatch(x: unknown) {
  return String(x || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}


type TaskTimerState = {
  elapsed_ms: number;
  running_since_ms: number | null;
  updated_at?: string;
};

type TaskTimerMap = Record<string, TaskTimerState>;

const TASK_TIMER_EVENT = "mysession:task-timers-updated";
const TASK_TIMER_VISIBILITY_EVENT = "mysession:task-timer-visibility-changed";
const TASK_ORDER_STORAGE_PREFIX = "mysession_task_order_v1";
const TASK_ORDER_SYNC_EVENT = "mysession:task-order-synced";
const TASK_REORDER_LOG_PREFIX = "[TasksPanel/reorder]";

function logTaskReorder(step: string, detail: Record<string, unknown> = {}) {
  console.info(TASK_REORDER_LOG_PREFIX, step, {
    at: new Date().toISOString(),
    ...detail,
  });
}
const TASK_TIMER_ENABLED_STORAGE_PREFIX = "mysession_task_timer_enabled_v1";
const TASK_TIMER_STORAGE_PREFIX = "mysession_task_timers_v1";
const TASK_TIME_MEASUREMENTS_STORAGE_PREFIX = "mysession_task_time_measurements_v1";
const HIDE_TEAM_TASKS_STORAGE_PREFIX = "mysession_hide_team_tasks_v1";
const TASKS_SYNC_EVENT = "mysession:tasks-synced";

function emitTasksSync(detail: Record<string, unknown> = {}) {
  try {
    const eventDetail = { source: "tasks-panel", ...detail, at: Date.now() };
    window.dispatchEvent(
      new CustomEvent(TASKS_SYNC_EVENT, {
        detail: eventDetail,
      }),
    );
    window.dispatchEvent(
      new CustomEvent("mysession:tasks-updated", {
        detail: eventDetail,
      }),
    );
  } catch { }
}

function makeTaskTimerStorageKey(sessionId: string | null | undefined, userId: string | null | undefined) {
  const sid = String(sessionId || "global").trim() || "global";
  const uid = String(userId || "anon").trim().toLowerCase() || "anon";
  return `${TASK_TIMER_STORAGE_PREFIX}:${sid}:${uid}`;
}

function makeTaskTimerId(ownerUserId: unknown, text: unknown, fallbackId?: unknown) {
  const owner = String(ownerUserId || "")
    .trim()
    .toLowerCase();
  const normalizedText = normalizeTextForMatch(text);
  const textKey = normalizedText ? encodeURIComponent(normalizedText).slice(0, 240) : "";
  const fallback = String(fallbackId || "")
    .trim()
    .toLowerCase();
  return `${owner || "unknown"}:${textKey || `id:${fallback || "unknown"}`}`;
}

function sanitizeTaskTimerState(raw: unknown): TaskTimerState {
  const value = raw && typeof raw === "object" ? (raw as any) : {};
  const elapsed = Math.max(0, Math.round(Number(value.elapsed_ms || 0)));
  const runningSinceRaw = Number(value.running_since_ms || 0);
  const runningSince = Number.isFinite(runningSinceRaw) && runningSinceRaw > 0 ? runningSinceRaw : null;

  return {
    elapsed_ms: elapsed,
    running_since_ms: runningSince,
    updated_at: typeof value.updated_at === "string" ? value.updated_at : undefined,
  };
}

function readTaskTimers(storageKey: string): TaskTimerMap {
  if (!storageKey || typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const out: TaskTimerMap = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
      if (!key) return;
      out[key] = sanitizeTaskTimerState(value);
    });

    return out;
  } catch {
    return {};
  }
}

function writeTaskTimers(storageKey: string, timers: TaskTimerMap) {
  if (!storageKey || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(timers || {}));
  } catch { }
}

function getTaskTimerDisplayMs(timer: TaskTimerState | null | undefined, nowMs: number) {
  if (!timer) return 0;

  const base = Math.max(0, Math.round(Number(timer.elapsed_ms || 0)));
  const runningSince = Number(timer.running_since_ms || 0);

  if (!runningSince || !Number.isFinite(runningSince)) return base;

  return Math.max(0, base + Math.max(0, nowMs - runningSince));
}

function formatTaskTimer(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isTaskTimerRunning(timer: TaskTimerState | null | undefined) {
  return !!timer?.running_since_ms;
}

type TaskTimeMeasurement = {
  id: string;
  user_id: string;
  session_id: string | null;
  session_intention_id: string | null;
  focus_plan_item_id: string | null;
  task_text: string;
  elapsed_ms: number;
  saved_at: string;
};

function makeTaskTimeMeasurementsStorageKey(userId: string | null | undefined) {
  const uid = String(userId || "anon").trim().toLowerCase() || "anon";
  return `${TASK_TIME_MEASUREMENTS_STORAGE_PREFIX}:${uid}`;
}

function readTaskTimeMeasurements(storageKey: string): TaskTimeMeasurement[] {
  if (!storageKey || typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item: any) => ({
        id: String(item?.id || ""),
        user_id: String(item?.user_id || ""),
        session_id: item?.session_id ? String(item.session_id) : null,
        session_intention_id: item?.session_intention_id
          ? String(item.session_intention_id)
          : null,
        focus_plan_item_id: item?.focus_plan_item_id
          ? String(item.focus_plan_item_id)
          : null,
        task_text: String(item?.task_text || "").trim(),
        elapsed_ms: Math.max(0, Math.round(Number(item?.elapsed_ms || 0))),
        saved_at: String(item?.saved_at || ""),
      }))
      .filter((item) => item.id && item.task_text && item.elapsed_ms > 0)
      .slice(0, 500);
  } catch {
    return [];
  }
}

function writeTaskTimeMeasurements(
  storageKey: string,
  measurements: TaskTimeMeasurement[],
) {
  if (!storageKey || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify((measurements || []).slice(0, 500)),
    );
  } catch { }
}

async function fetchProfilesMap(
  userIds: string[],
): Promise<Map<string, ProfileMini>> {
  const ids = [
    ...new Set(
      (userIds || []).map((x) => String(x || "").trim()).filter(Boolean),
    ),
  ];
  const map = new Map<string, ProfileMini>();
  if (!ids.length) return map;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", ids);

    if (error || !Array.isArray(data)) return map;

    for (const row of data) {
      const id = String((row as any)?.id || "").trim();
      if (!id) continue;
      map.set(id, {
        id,
        full_name: (row as any)?.full_name || undefined,
        avatar_url: (row as any)?.avatar_url || undefined,
      });
    }
  } catch { }

  return map;
}

export function TasksPanel({
  sessionId: sessionIdProp,
  oneOnOneMode = false,
  theme = "dark",
  timerText: timerTextProp,
  timerTextClassName,
  pictureInPictureSupported = false,
  pictureInPictureOpen = false,
  onOpenPictureInPicture,
  accountabilityWallOpen = false,
  onToggleAccountabilityWall,
}: TasksPanelProps) {
  const { id: idOrSlugFromUrl } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const rawSessionId = (sessionIdProp || idOrSlugFromUrl || "").trim();

  const panelTheme: RoomTheme = "light";
  const isLight = true;

  const [user, setUser] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [panelTasks, setPanelTasks] = useState<PanelTask[]>([]);
  const [panelLoading, setPanelLoading] = useState(true);

  const [sessionTasks, setSessionTasks] = useState<
    SessionTask[]
  >([]);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [encouragementCounts, setEncouragementCounts] = useState<
    Record<string, number>
  >({});
  const [myEncouragedIds, setMyEncouragedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [encouragementUsersByTask, setEncouragementUsersByTask] =
    useState<Record<string, EncouragementUser[]>>({});
  const [encouragementModalTaskId, setEncouragementModalTaskId] =
    useState<string | null>(null);
  const [deletingPublishedTaskId, setDeletingPublishedTaskId] =
    useState<string | null>(null);
  const [aiSuggestionTask, setAiSuggestionTask] = useState<PanelTask | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<TaskAiSuggestion | null>(null);
  const [aiSuggestionLoading, setAiSuggestionLoading] = useState(false);
  const [aiSuggestionError, setAiSuggestionError] = useState("");
  const [aiPaidAccess, setAiPaidAccess] = useState<boolean | null>(null);
  const [aiPaywallOpen, setAiPaywallOpen] = useState(false);
  const aiSuggestionRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);

  const [newTask, setNewTask] = useState("");
  const [newTaskVisibility, setNewTaskVisibility] = useState<"public" | "private">("public");
  const [newTaskVisibilityMenuOpen, setNewTaskVisibilityMenuOpen] = useState(false);
  const newTaskVisibilityRef = useRef<"public" | "private">("public");
  const voiceTaskLastAppliedRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  useEffect(() => {
    newTaskVisibilityRef.current = newTaskVisibility;
  }, [newTaskVisibility]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");

  const loadSeqRef = useRef(0);
  const panelSeqRef = useRef(0);
  const sessionReloadTimerRef = useRef<number | null>(null);

  const [timerText, setTimerText] = useState<string>("--:--");

  const overlayRef = useRef<{
    win: Window | null;
    container: HTMLElement;
    kind: "pip" | "window";
  } | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [plans, setPlans] = useState<FocusPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [planItems, setPlanItems] = useState<FocusPlanItem[]>([]);
  const [planItemsLoading, setPlanItemsLoading] = useState(false);

  const [planSearch, setPlanSearch] = useState("");
  const [importingItemId, setImportingItemId] = useState<string | null>(null);
  const [lastPlansLoadedAt, setLastPlansLoadedAt] = useState<string>("");
  const [savingPanelTasks, setSavingPanelTasks] = useState(false);
  const [savePanelTasksFeedback, setSavePanelTasksFeedback] = useState("");


  const taskTimerStorageKey = useMemo(
    () => makeTaskTimerStorageKey(sessionId || rawSessionId || "global", user?.id || ""),
    [sessionId, rawSessionId, user?.id],
  );
  const [taskTimers, setTaskTimers] = useState<TaskTimerMap>({});
  const [taskTimerTickMs, setTaskTimerTickMs] = useState(() => Date.now());
  const [savedTimerFeedbackId, setSavedTimerFeedbackId] = useState<string | null>(null);
  const [hideTeamTasks, setHideTeamTasks] = useState(false);

  const taskOrderStorageKey = useMemo(
    () => `${TASK_ORDER_STORAGE_PREFIX}:${String(user?.id || "anonymous")}`,
    [user?.id],
  );
  const taskTimerEnabledStorageKey = useMemo(
    () => `${TASK_TIMER_ENABLED_STORAGE_PREFIX}:${String(user?.id || "anonymous")}`,
    [user?.id],
  );

  const hideTeamTasksStorageKey = useMemo(
    () => `${HIDE_TEAM_TASKS_STORAGE_PREFIX}:${String(user?.id || "anonymous")}`,
    [user?.id],
  );

  const taskTimeMeasurementsStorageKey = useMemo(
    () => makeTaskTimeMeasurementsStorageKey(user?.id || ""),
    [user?.id],
  );

  const [panelTaskOrder, setPanelTaskOrder] = useState<string[]>([]);
  const panelTaskOrderRef = useRef<string[]>([]);
  const reorderVersionRef = useRef(0);
  const reorderInFlightRef = useRef(0);
  const reorderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingPanelReloadRef = useRef(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [taskTimersEnabled, setTaskTimersEnabled] = useState<boolean>(false);

  useEffect(() => {
    setTaskTimers(readTaskTimers(taskTimerStorageKey));
  }, [taskTimerStorageKey]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(taskOrderStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      const next = Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
      panelTaskOrderRef.current = next;
      setPanelTaskOrder(next);
      logTaskReorder("storage_hydrated", {
        storageKey: taskOrderStorageKey,
        order: next,
      });
    } catch {
      panelTaskOrderRef.current = [];
      setPanelTaskOrder([]);
    }
  }, [taskOrderStorageKey]);

  useEffect(() => {
    const applyExternalOrder = (next: string[], source: string) => {
      const normalized = next.map(String).filter(Boolean);
      if (normalized.join("|") === panelTaskOrderRef.current.join("|")) return;
      panelTaskOrderRef.current = normalized;
      setPanelTaskOrder(normalized);
      logTaskReorder("external_order_applied", { source, order: normalized });
    };
    const onOrderSync = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      if (String(detail.userId || "") !== String(user?.id || "")) return;
      if (Array.isArray(detail.order)) applyExternalOrder(detail.order, "same_document");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== taskOrderStorageKey || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue);
        if (Array.isArray(parsed)) applyExternalOrder(parsed, "storage_event");
      } catch { }
    };
    window.addEventListener(TASK_ORDER_SYNC_EVENT, onOrderSync as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(TASK_ORDER_SYNC_EVENT, onOrderSync as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [taskOrderStorageKey, user?.id]);

  useEffect(() => {
    try {
      setTaskTimersEnabled(localStorage.getItem(taskTimerEnabledStorageKey) === "true");
    } catch {
      setTaskTimersEnabled(false);
    }
  }, [taskTimerEnabledStorageKey]);

  useEffect(() => {
    try {
      setHideTeamTasks(localStorage.getItem(hideTeamTasksStorageKey) === "true");
    } catch {
      setHideTeamTasks(false);
    }
  }, [hideTeamTasksStorageKey]);

  useEffect(() => {
    const ids = panelTasks.map((task) => String(task.id || "")).filter(Boolean);
    if (!ids.length) {
      // An empty array while the initial/refetch request is running is not an
      // authoritative empty task set. Clearing here used to erase the locally
      // hydrated order before Supabase returned.
      if (panelLoading) return;
      if (panelTaskOrderRef.current.length) {
        panelTaskOrderRef.current = [];
        setPanelTaskOrder([]);
      }
      return;
    }

    const idSet = new Set(ids);
    setPanelTaskOrder((latestOrder) => {
      const next = [
        ...latestOrder.filter((id) => idSet.has(id)),
        ...ids.filter((id) => !latestOrder.includes(id)),
      ];
      if (next.join("|") === latestOrder.join("|")) return latestOrder;
      panelTaskOrderRef.current = next;
      try {
        localStorage.setItem(taskOrderStorageKey, JSON.stringify(next));
      } catch { }
      logTaskReorder("task_set_reconciled", {
        previousOrder: latestOrder,
        nextOrder: next,
      });
      return next;
    });
  }, [panelLoading, panelTasks, taskOrderStorageKey]);

  useEffect(() => {
    const refresh = () => {
      setTaskTimers(readTaskTimers(taskTimerStorageKey));
    };

    const onTimerEvent = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      if (!detail?.storageKey || detail.storageKey === taskTimerStorageKey) refresh();
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === taskTimerStorageKey) refresh();
    };

    window.addEventListener(TASK_TIMER_EVENT, onTimerEvent as EventListener);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(TASK_TIMER_EVENT, onTimerEvent as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [taskTimerStorageKey]);

  useEffect(() => {
    const id = window.setInterval(() => setTaskTimerTickMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const persistTaskTimers = useCallback(
    (next: TaskTimerMap) => {
      setTaskTimers(next);
      writeTaskTimers(taskTimerStorageKey, next);
      try {
        window.dispatchEvent(
          new CustomEvent(TASK_TIMER_EVENT, {
            detail: { storageKey: taskTimerStorageKey, sessionId, userId: user?.id || "" },
          }),
        );
      } catch { }
    },
    [sessionId, taskTimerStorageKey, user?.id],
  );

  const updateTaskTimer = useCallback(
    (timerId: string, updater: (prev: TaskTimerState | null) => TaskTimerState | null) => {
      if (!timerId) return;

      const prevMap = readTaskTimers(taskTimerStorageKey);
      const nextValue = updater(prevMap[timerId] || null);
      const nextMap = { ...prevMap };

      if (nextValue) nextMap[timerId] = nextValue;
      else delete nextMap[timerId];

      persistTaskTimers(nextMap);
    },
    [persistTaskTimers, taskTimerStorageKey],
  );

  const toggleTaskTimer = useCallback(
    (ownerUserId: unknown, text: unknown, fallbackId?: unknown) => {
      const timerId = makeTaskTimerId(ownerUserId, text, fallbackId);
      const now = Date.now();

      updateTaskTimer(timerId, (prev) => {
        const safePrev = sanitizeTaskTimerState(prev || {});

        if (safePrev.running_since_ms) {
          return {
            elapsed_ms: getTaskTimerDisplayMs(safePrev, now),
            running_since_ms: null,
            updated_at: new Date(now).toISOString(),
          };
        }

        return {
          elapsed_ms: safePrev.elapsed_ms,
          running_since_ms: now,
          updated_at: new Date(now).toISOString(),
        };
      });
    },
    [updateTaskTimer],
  );

  const pauseTaskTimer = useCallback(
    (ownerUserId: unknown, text: unknown, fallbackId?: unknown) => {
      const timerId = makeTaskTimerId(ownerUserId, text, fallbackId);
      const now = Date.now();

      updateTaskTimer(timerId, (prev) => {
        const safePrev = sanitizeTaskTimerState(prev || {});
        if (!safePrev.running_since_ms) return safePrev.elapsed_ms > 0 ? safePrev : null;
        return {
          elapsed_ms: getTaskTimerDisplayMs(safePrev, now),
          running_since_ms: null,
          updated_at: new Date(now).toISOString(),
        };
      });
    },
    [updateTaskTimer],
  );

  const resetTaskTimer = useCallback(
    (ownerUserId: unknown, text: unknown, fallbackId?: unknown) => {
      const timerId = makeTaskTimerId(ownerUserId, text, fallbackId);
      updateTaskTimer(timerId, () => null);
    },
    [updateTaskTimer],
  );


  const saveTaskTimerMeasurement = useCallback(
    async ({
      ownerUserId,
      text,
      fallbackId,
      focusPlanItemId = null,
      sessionTaskId = null,
    }: {
      ownerUserId: unknown;
      text: unknown;
      fallbackId?: unknown;
      focusPlanItemId?: string | null;
      sessionTaskId?: string | null;
    }) => {
      const uid = String(user?.id || "").trim();
      const owner = String(ownerUserId || "").trim();
      const taskText = safeTrim(text);

      if (!uid || !owner || uid !== owner || !taskText) return;

      const timerId = makeTaskTimerId(ownerUserId, text, fallbackId);
      const prevMap = readTaskTimers(taskTimerStorageKey);
      const timer = prevMap[timerId] || null;
      const now = Date.now();
      const elapsedMs = getTaskTimerDisplayMs(timer, now);

      if (elapsedMs <= 0) return;

      const pausedTimer: TaskTimerState = {
        elapsed_ms: elapsedMs,
        running_since_ms: null,
        updated_at: new Date(now).toISOString(),
      };
      const nextTimerMap = { ...prevMap, [timerId]: pausedTimer };
      persistTaskTimers(nextTimerMap);

      const measurement: TaskTimeMeasurement = {
        id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
        user_id: uid,
        session_id: sessionId || null,
        session_intention_id: sessionTaskId || null,
        focus_plan_item_id: focusPlanItemId || null,
        task_text: taskText,
        elapsed_ms: elapsedMs,
        saved_at: new Date(now).toISOString(),
      };

      const prevMeasurements = readTaskTimeMeasurements(taskTimeMeasurementsStorageKey);
      writeTaskTimeMeasurements(taskTimeMeasurementsStorageKey, [
        measurement,
        ...prevMeasurements,
      ]);

      setSavedTimerFeedbackId(timerId);
      window.setTimeout(() => {
        setSavedTimerFeedbackId((current) => (current === timerId ? null : current));
      }, 1400);

      try {
        window.dispatchEvent(
          new CustomEvent("mysession:task-time-measurements-updated", {
            detail: { userId: uid, sessionId, measurement },
          }),
        );
      } catch { }

      try {
        const { data, error } = await supabase
          .from("task_time_measurements")
          .insert({
            user_id: uid,
            session_id: sessionId || null,
            session_intention_id: sessionTaskId || null,
            focus_plan_item_id: focusPlanItemId || null,
            task_text: taskText,
            elapsed_ms: elapsedMs,
            saved_at: measurement.saved_at,
          } as any)
          .select("id")
          .single();

        if (error) throw error;

        if (data?.id) {
          const current = readTaskTimeMeasurements(taskTimeMeasurementsStorageKey);
          const next = current.map((row) =>
            row.id === measurement.id ? { ...row, id: String(data.id) } : row,
          );
          writeTaskTimeMeasurements(taskTimeMeasurementsStorageKey, next);
        }
      } catch (error) {
        console.error("[TasksPanel] failed to save task measurement to Supabase:", error);
      }

      // Save means "commit this interval". Start the next interval from zero,
      // otherwise pressing Save twice would count the same elapsed time twice.
      const afterSaveMap = readTaskTimers(taskTimerStorageKey);
      delete afterSaveMap[timerId];
      persistTaskTimers(afterSaveMap);
    },
    [persistTaskTimers, sessionId, taskTimeMeasurementsStorageKey, taskTimerStorageKey, user?.id],
  );

  const moveTaskTimer = useCallback(
    (ownerUserId: unknown, fromText: unknown, toText: unknown, fallbackId?: unknown) => {
      const fromId = makeTaskTimerId(ownerUserId, fromText, fallbackId);
      const toId = makeTaskTimerId(ownerUserId, toText, fallbackId);
      if (!fromId || !toId || fromId === toId) return;

      const prevMap = readTaskTimers(taskTimerStorageKey);
      const existing = prevMap[fromId];
      if (!existing) return;

      const nextMap = { ...prevMap };
      delete nextMap[fromId];
      nextMap[toId] = existing;
      persistTaskTimers(nextMap);
    },
    [persistTaskTimers, taskTimerStorageKey],
  );

  const titleText = "text-black/95";
  const mutedText = "text-black/55";
  const divider = "bg-[#D8D0D0]";

  const panelBg = "bg-[#F3F1F1] text-black";
  const headerBg = "bg-[#F7F5F5]";
  const headerBorder = "border-[#D8D0D0]";

  const inputCls = `
      h-12 bg-[#F7F5F5] border border-[#CFC6C6] rounded-[18px]
      px-4 text-[14px] text-black/85 placeholder:text-black/35
      outline-none focus:ring-1 focus:ring-[#81DB86] focus:border-[#81DB86]
      font-inter
    `;

  const myCardCls =
    "group relative min-h-11 border-b border-[#D8D0D0]/70 px-1.5 py-2 bg-transparent hover:bg-black/[0.035] transition";

  const teamCardCls =
    "group relative min-h-11 border-b border-[#D8D0D0]/70 px-1.5 py-2 bg-transparent hover:bg-black/[0.035] transition";

  const ghostBtn =
    "border border-[#CFC6C6] bg-transparent hover:bg-[#ECEAEA] text-black/75";

  const primaryBtn = "bg-[#252525] hover:bg-[#303030] text-white font-semibold";

  const stopRoomBubbling = useCallback((e: any) => {
    e?.stopPropagation?.();
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user || null));
  }, []);

  useEffect(() => {
    let active = true;
    const userId = String(user?.id || "").trim();
    if (!userId) {
      setAiPaidAccess(null);
      return () => {
        active = false;
      };
    }

    void getUserEntitlement(userId)
      .then((entitlement) => {
        if (!active) return;
        setAiPaidAccess(
          isPaidPlan(entitlement?.plan) && isEntitlementActive(entitlement),
        );
      })
      .catch((error) => {
        console.error("[TasksPanel] AI entitlement load failed:", error);
        if (active) setAiPaidAccess(null);
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    const t = typeof timerTextProp === "string" ? timerTextProp.trim() : "";
    if (t) setTimerText(t);
  }, [timerTextProp]);

  useEffect(() => {
    const t = typeof timerTextProp === "string" ? timerTextProp.trim() : "";
    if (t) return;

    const onTimer = (e: any) => {
      const v = e?.detail?.text;
      if (typeof v === "string" && v.trim()) setTimerText(v.trim());
    };

    window.addEventListener("mysession:timer", onTimer as any);

    const id = window.setInterval(() => {
      try {
        const v =
          localStorage.getItem("mysession_timer_text") ||
          localStorage.getItem("timer_text") ||
          "";
        const vv = v ? v.trim() : "";
        if (vv) setTimerText((prev) => (prev === vv ? prev : vv));
      } catch { }
    }, 1000);

    return () => {
      window.removeEventListener("mysession:timer", onTimer as any);
      window.clearInterval(id);
    };
  }, [timerTextProp]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const raw = String(rawSessionId || "").trim();
      if (!raw) {
        if (!cancelled) setSessionId(null);
        return;
      }

      if (UUID_RE.test(raw)) {
        if (!cancelled) setSessionId(raw);
        return;
      }

      const slug = raw.toLowerCase();

      try {
        const { data, error } = await supabase
          .from("sessions")
          .select("id")
          .eq("custom_slug", slug)
          .single();

        if (!cancelled) {
          if (!error && data?.id) setSessionId(String(data.id));
          else setSessionId(null);
        }
      } catch {
        if (!cancelled) setSessionId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rawSessionId]);

  const getAvatar = (profile?: any) =>
    profile?.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || "User")}`;

  const loadPanelTasks = useCallback(async () => {
    if (!user?.id) return;

    const seq = ++panelSeqRef.current;
    logTaskReorder("refetch_started", {
      seq,
      reorderInFlight: reorderInFlightRef.current,
    });
    setPanelLoading(true);

    try {
      let { data, error } = await supabase
        .from(PANEL_TASKS_TABLE)
        .select("*")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(PANEL_TASKS_FETCH_LIMIT);

      if (error && /sort_order|column/i.test(String(error.message || ""))) {
        logTaskReorder("database_order_unavailable_fallback", {
          seq,
          error: String(error.message || error),
        });
        const fallback = await supabase
          .from(PANEL_TASKS_TABLE)
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(PANEL_TASKS_FETCH_LIMIT);
        data = fallback.data;
        error = fallback.error;
      }

      if (seq !== panelSeqRef.current) {
        logTaskReorder("refetch_discarded", {
          seq,
          latestSeq: panelSeqRef.current,
        });
        return;
      }

      if (error || !Array.isArray(data)) {
        logTaskReorder("refetch_failed", {
          seq,
          error: String(error?.message || error || "invalid_data"),
        });
        return;
      }

      const databaseOrder = data
        .map((task: any) => String(task.id || ""))
        .filter(Boolean);
      const hasPersistedDatabaseOrder = data.every(
        (task: any) =>
          task.sort_order !== null &&
          task.sort_order !== undefined &&
          task.sort_order !== "" &&
          Number.isFinite(Number(task.sort_order)),
      );

      // Once the position column exists, Supabase is authoritative on loads
      // and refreshes. While a drop is being saved, realtime/refetch is held
      // back so it cannot overwrite the optimistic order.
      if (
        reorderInFlightRef.current === 0 &&
        databaseOrder.length > 0 &&
        (hasPersistedDatabaseOrder || panelTaskOrderRef.current.length === 0)
      ) {
        panelTaskOrderRef.current = databaseOrder;
        setPanelTaskOrder(databaseOrder);
        try {
          localStorage.setItem(taskOrderStorageKey, JSON.stringify(databaseOrder));
        } catch { }
        logTaskReorder("database_order_hydrated", {
          seq,
          hasPersistedDatabaseOrder,
          order: databaseOrder,
        });
      }

      setPanelTasks(data as PanelTask[]);
      logTaskReorder("refetch_applied", {
        seq,
        databaseOrder: data.map((task: any) => ({
          id: String(task.id || ""),
          sortOrder: task.sort_order ?? null,
        })),
      });
    } finally {
      if (seq === panelSeqRef.current) setPanelLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    void loadPanelTasks();
    let realtimeReloadTimer: number | null = null;

    const scheduleRealtimeReload = () => {
      if (realtimeReloadTimer !== null) {
        window.clearTimeout(realtimeReloadTimer);
      }
      realtimeReloadTimer = window.setTimeout(() => {
        realtimeReloadTimer = null;
        logTaskReorder("realtime_refetch_started");
        void loadPanelTasks();
      }, 100);
    };

    const onExternalTasksUpdated = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      if (detail?.source === "tasks-panel") return;
      void loadPanelTasks();
    };

    window.addEventListener(
      "mysession:tasks-updated",
      onExternalTasksUpdated,
    );

    const ch = supabase
      .channel(`panel_intentions_${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: PANEL_TASKS_TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const eventType = String(payload.eventType || "").toUpperCase();
          const nextTask = (payload.new || null) as Partial<PanelTask> | null;
          const previousTask = (payload.old || null) as Partial<PanelTask> | null;
          const taskId = String(nextTask?.id || previousTask?.id || "");

          logTaskReorder("realtime_received", {
            eventType,
            taskId,
            reorderInFlight: reorderInFlightRef.current,
          });

          if (taskId && eventType === "UPDATE" && nextTask) {
            setPanelTasks((current) =>
              current.map((task) =>
                task.id === taskId ? { ...task, ...nextTask } as PanelTask : task,
              ),
            );
            logTaskReorder("realtime_update_applied_locally", { taskId });
            return;
          }

          if (taskId && eventType === "INSERT" && nextTask) {
            setPanelTasks((current) => {
              if (current.some((task) => task.id === taskId)) {
                return current.map((task) =>
                  task.id === taskId ? { ...task, ...nextTask } as PanelTask : task,
                );
              }
              return [nextTask as PanelTask, ...current].slice(0, PANEL_TASKS_FETCH_LIMIT);
            });
            logTaskReorder("realtime_insert_applied_locally", { taskId });
            return;
          }

          if (taskId && eventType === "DELETE") {
            setPanelTasks((current) => current.filter((task) => task.id !== taskId));
            logTaskReorder("realtime_delete_applied_locally", { taskId });
            return;
          }

          if (reorderInFlightRef.current > 0) {
            pendingPanelReloadRef.current = true;
            logTaskReorder("realtime_refetch_deferred");
            return;
          }
          scheduleRealtimeReload();
        },
      )
      .subscribe();

    return () => {
      window.removeEventListener(
        "mysession:tasks-updated",
        onExternalTasksUpdated,
      );
      if (realtimeReloadTimer !== null) {
        window.clearTimeout(realtimeReloadTimer);
      }
      supabase.removeChannel(ch);
    };
  }, [user?.id, loadPanelTasks]);

  const loadSessionTasks = useCallback(
    async (sid?: string | null) => {
      const s = String(sid || sessionId || "");
      if (!s) return;

      const seq = ++loadSeqRef.current;
      setSessionLoading(true);

      try {
        const { data, error } = await supabase
          .from(SESSION_TASKS_TABLE)
          .select("id, text, user_id, session_id, created_at, completed")
          .eq("session_id", s)
          .order("created_at", { ascending: false })
          .limit(SESSION_TASKS_FETCH_LIMIT);

        if (seq !== loadSeqRef.current) return;

        if (error || !Array.isArray(data)) {
          setSessionTasks([]);
          return;
        }

        const rows = data as SessionTask[];
        const profileMap = await fetchProfilesMap(rows.map((r) => r.user_id));

        if (seq !== loadSeqRef.current) return;

        const merged = rows.map((row) => ({
          ...row,
          profiles: profileMap.get(String(row.user_id)) || undefined,
        }));

        setSessionTasks(merged);
      } finally {
        if (seq === loadSeqRef.current) setSessionLoading(false);
      }
    },
    [sessionId],
  );

  const scheduleSessionTasksReload = useCallback(
    (sid?: string | null) => {
      const targetSid = String(sid || sessionId || "");
      if (!targetSid) return;

      if (sessionReloadTimerRef.current) {
        window.clearTimeout(sessionReloadTimerRef.current);
      }

      sessionReloadTimerRef.current = window.setTimeout(() => {
        sessionReloadTimerRef.current = null;
        void loadSessionTasks(targetSid);
      }, 120);
    },
    [sessionId, loadSessionTasks],
  );

  useEffect(() => {
    if (!sessionId) return;

    void loadSessionTasks(sessionId);

    const channel = supabase
      .channel(`intentions_realtime_${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: SESSION_TASKS_TABLE },
        (payload: any) => {
          const payloadSessionId = String(
            payload?.new?.session_id || payload?.old?.session_id || "",
          ).trim();

          if (!payloadSessionId || payloadSessionId === String(sessionId)) {
            scheduleSessionTasksReload(sessionId);
          }
        },
      )
      .subscribe();

    return () => {
      if (sessionReloadTimerRef.current) {
        window.clearTimeout(sessionReloadTimerRef.current);
        sessionReloadTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [sessionId, loadSessionTasks, scheduleSessionTasksReload]);

  useEffect(() => {
    if (!sessionId) return;

    const refreshFromSharedTaskChange = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      const eventSessionId = String(detail?.sessionId || "").trim();

      if (eventSessionId && eventSessionId !== String(sessionId)) return;

      if (detail?.source !== "tasks-panel") void loadPanelTasks();
      scheduleSessionTasksReload(sessionId);
    };

    window.addEventListener(TASKS_SYNC_EVENT, refreshFromSharedTaskChange as EventListener);
    window.addEventListener("mysession:tasks-updated", refreshFromSharedTaskChange as EventListener);

    return () => {
      window.removeEventListener(TASKS_SYNC_EVENT, refreshFromSharedTaskChange as EventListener);
      window.removeEventListener("mysession:tasks-updated", refreshFromSharedTaskChange as EventListener);
    };
  }, [sessionId, loadPanelTasks, scheduleSessionTasksReload]);

  const loadEncouragements = useCallback(async () => {
    const ids = sessionTasks
      .map((x) => String(x.id || ""))
      .filter(Boolean);

    if (!ids.length) {
      setEncouragementCounts({});
      setMyEncouragedIds(new Set());
      setEncouragementUsersByTask({});
      return;
    }

    try {
      const { data, error } = await supabase
        .from(TASK_ENCOURAGEMENTS_TABLE)
        .select("session_intention_id,intention_id,user_id,emoji")
        .in("session_intention_id", ids);

      if (error || !Array.isArray(data)) {
        console.error("loadEncouragements error:", error);
        setEncouragementCounts({});
        setMyEncouragedIds(new Set());
        setEncouragementUsersByTask({});
        return;
      }

      const nextCounts: Record<string, number> = {};
      const nextMine = new Set<string>();
      const userIds: string[] = [];

      data.forEach((row) => {
        const taskId = String(row?.session_intention_id || row?.intention_id || "");
        const rowUserId = String(row?.user_id || "");

        if (!taskId || !ids.includes(taskId)) return;

        nextCounts[taskId] = (nextCounts[taskId] || 0) + 1;

        if (rowUserId) {
          userIds.push(rowUserId);
        }

        if (rowUserId === String(user?.id || "")) {
          nextMine.add(taskId);
        }
      });

      const profileMap = await fetchProfilesMap(userIds);
      const nextUsersByIntention: Record<string, EncouragementUser[]> = {};

      data.forEach((row) => {
        const taskId = String(row?.session_intention_id || row?.intention_id || "");
        const rowUserId = String(row?.user_id || "");

        if (!taskId || !ids.includes(taskId) || !rowUserId) return;

        const profile = profileMap.get(rowUserId);
        const list = nextUsersByIntention[taskId] || [];

        if (!list.some((x) => x.id === rowUserId)) {
          list.push({
            id: rowUserId,
            full_name: profile?.full_name || "Participant",
            avatar_url: profile?.avatar_url,
            emoji: String(row?.emoji || ENCOURAGEMENT_EMOJI),
          });
        }

        nextUsersByIntention[taskId] = list;
      });

      setEncouragementCounts(nextCounts);
      setMyEncouragedIds(nextMine);
      setEncouragementUsersByTask(nextUsersByIntention);
    } catch (e) {
      console.error("loadEncouragements crashed:", e);
    }
  }, [sessionTasks, user?.id]);

  useEffect(() => {
    void loadEncouragements();
  }, [loadEncouragements]);

  useEffect(() => {
    if (!sessionId) return;

    const channel = supabase
      .channel(`intention_encouragements_${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TASK_ENCOURAGEMENTS_TABLE },
        () => void loadEncouragements(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, loadEncouragements]);

  const toggleEncouragement = useCallback(
    async (taskId: string) => {
      const id = String(taskId || "");
      const uid = String(user?.id || "");
      if (!id || !uid) return;

      const had = myEncouragedIds.has(id);

      setMyEncouragedIds((prev) => {
        const next = new Set(prev);
        if (had) next.delete(id);
        else next.add(id);
        return next;
      });

      setEncouragementCounts((prev) => ({
        ...prev,
        [id]: Math.max(0, (prev[id] || 0) + (had ? -1 : 1)),
      }));

      try {
        if (had) {
          const { error } = await supabase
            .from(TASK_ENCOURAGEMENTS_TABLE)
            .delete()
            .eq("intention_id", id)
            .eq("user_id", uid);

          if (error) throw error;
        } else {
          const { error } = await supabase
            .from(TASK_ENCOURAGEMENTS_TABLE)
            .upsert(
              {
                session_id: sessionId,
                intention_id: id,
                session_intention_id: id,
                user_id: uid,
                emoji: ENCOURAGEMENT_EMOJI,
              } as any,
              { onConflict: "intention_id,user_id" },
            );

          if (error) throw error;
        }

        void loadEncouragements();
      } catch (e) {
        console.error("toggleEncouragement error:", e);
        void loadEncouragements();
      }
    },
    [loadEncouragements, myEncouragedIds, sessionId, user?.id],
  );

  const findOwnSessionTaskLocal = useCallback(
    (text: string) => {
      const uid = String(user?.id || "");
      const sid = String(sessionId || "");
      const norm = normalizeTextForMatch(text);
      if (!uid || !sid || !norm) return null;

      return (
        sessionTasks.find(
          (x) =>
            String(x.user_id) === uid &&
            String(x.session_id) === sid &&
            normalizeTextForMatch(x.text) === norm,
        ) || null
      );
    },
    [user?.id, sessionId, sessionTasks],
  );

  const upsertOwnSessionTask = useCallback(
    async ({
      matchText,
      text,
      completed,
    }: {
      matchText?: string;
      text: string;
      completed?: boolean;
    }) => {
      if (!user?.id || !sessionId) return null;

      const nextText = safeTrim(text);
      if (!nextText) return null;

      const existing =
        (matchText ? findOwnSessionTaskLocal(matchText) : null) ||
        findOwnSessionTaskLocal(nextText);

      if (existing) {
        const updates: any = {};

        if (safeTrim(existing.text) !== nextText) updates.text = nextText;
        if (
          typeof completed === "boolean" &&
          Boolean(existing.completed) !== completed
        ) {
          updates.completed = completed;
        }

        if (Object.keys(updates).length === 0) return existing.id;

        try {
          const { error } = await supabase
            .from(SESSION_TASKS_TABLE)
            .update(updates)
            .eq("id", existing.id)
            .eq("user_id", user.id)
            .eq("session_id", sessionId);

          if (error) throw error;
        } catch {
          void loadSessionTasks(sessionId);
          return null;
        }

        emitTasksSync({
          action: "update",
          sessionId,
          userId: user.id,
          taskId: existing.id,
        });
        void loadSessionTasks(sessionId);
        return existing.id;
      }

      try {
        const payload: any = {
          user_id: user.id,
          session_id: sessionId,
          text: nextText,
          completed: typeof completed === "boolean" ? completed : false,
        };

        const { data, error } = await supabase
          .from(SESSION_TASKS_TABLE)
          .insert(payload)
          .select("id, text, user_id, session_id, created_at, completed")
          .single();

        if (error) throw error;

        if (data) {
          setSessionTasks((prev) =>
            [data as SessionTask, ...prev].slice(
              0,
              SESSION_TASKS_FETCH_LIMIT,
            ),
          );
        }

        emitTasksSync({
          action: "insert",
          sessionId,
          userId: user.id,
          taskId: data?.id || null,
        });
        void loadSessionTasks(sessionId);
        return data?.id || null;
      } catch {
        void loadSessionTasks(sessionId);
        return null;
      }
    },
    [user?.id, sessionId, findOwnSessionTaskLocal, loadSessionTasks],
  );

  const deleteOwnSessionTaskByText = useCallback(
    async (text: string) => {
      if (!user?.id || !sessionId) return;

      const existing = findOwnSessionTaskLocal(text);
      if (!existing) return;

      setSessionTasks((prev) => prev.filter((x) => x.id !== existing.id));

      try {
        const { error } = await supabase
          .from(SESSION_TASKS_TABLE)
          .delete()
          .eq("id", existing.id)
          .eq("user_id", user.id)
          .eq("session_id", sessionId);

        if (error) throw error;
      } catch {
        void loadSessionTasks(sessionId);
        return;
      }

      emitTasksSync({
        action: "delete",
        sessionId,
        userId: user.id,
        taskId: existing.id,
      });
      scheduleSessionTasksReload(sessionId);
    },
    [
      user?.id,
      sessionId,
      findOwnSessionTaskLocal,
      loadSessionTasks,
      scheduleSessionTasksReload,
    ],
  );

  const syncFirstPublicTaskForTile = useCallback(
    async (tasks: PanelTask[], order = panelTaskOrderRef.current) => {
      if (!user?.id || !sessionId) return;

      const firstPublicTask = orderPanelTasks(tasks, order).find(
        (task) => isPanelTaskPublic(task) && !Boolean(task.completed),
      );
      if (!firstPublicTask) return;

      const intentionId = await upsertOwnSessionTask({
        text: firstPublicTask.text,
        completed: false,
      });
      if (!intentionId) return;

      // Room participants read the shared intentions table. Promoting the
      // panel's first public task makes that shared selection deterministic
      // without deleting the user's other public tasks or encouragements.
      const { error } = await supabase
        .from(SESSION_TASKS_TABLE)
        .update({ created_at: new Date().toISOString() })
        .eq("id", intentionId)
        .eq("user_id", user.id)
        .eq("session_id", sessionId);

      if (!error) {
        emitTasksSync({
          action: "promote",
          sessionId,
          userId: user.id,
          taskId: intentionId,
        });
      }
    },
    [sessionId, upsertOwnSessionTask, user?.id],
  );

  const loadPlans = useCallback(async () => {
    if (!user?.id) return;

    setPlansLoading(true);
    try {
      const { data, error } = await supabase
        .from("focus_plans")
        .select("id,user_id,title,created_at,updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(FOCUS_PLANS_FETCH_LIMIT);

      if (error || !Array.isArray(data)) {
        setPlans([]);
        setSelectedPlanId("");
        return;
      }

      const list = data as FocusPlan[];
      setPlans(list);

      setSelectedPlanId((prev) => {
        if (list.length === 0) return "";
        if (prev && list.some((p) => p.id === prev)) return prev;
        return list[0].id;
      });

      setLastPlansLoadedAt(new Date().toISOString());
    } catch {
      setPlans([]);
      setSelectedPlanId("");
      setLastPlansLoadedAt(new Date().toISOString());
    } finally {
      setPlansLoading(false);
    }
  }, [user?.id]);

  const loadPlanItems = useCallback(
    async (planId: string) => {
      if (!user?.id) return;
      if (!planId) {
        setPlanItems([]);
        return;
      }

      setPlanItemsLoading(true);
      try {
        const { data, error } = await supabase
          .from("focus_plan_items")
          .select(
            "id,plan_id,user_id,text,target_date,session_id,created_at,completed,sort_order",
          )
          .eq("user_id", user.id)
          .eq("plan_id", planId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false })
          .limit(FOCUS_PLAN_ITEMS_FETCH_LIMIT);

        if (error || !Array.isArray(data)) {
          setPlanItems([]);
          return;
        }

        setPlanItems(data as FocusPlanItem[]);
      } catch {
        setPlanItems([]);
      } finally {
        setPlanItemsLoading(false);
      }
    },
    [user?.id],
  );

  useEffect(() => {
    if (!importModalOpen) return;
    if (!user?.id) return;
    void loadPlans();
  }, [importModalOpen, user?.id, loadPlans]);

  useEffect(() => {
    if (!importModalOpen) return;
    if (!selectedPlanId) {
      setPlanItems([]);
      return;
    }
    void loadPlanItems(selectedPlanId);
  }, [importModalOpen, selectedPlanId, loadPlanItems]);

  const filteredPlanItems = useMemo(() => {
    const q = normalizeTextForMatch(planSearch);
    const base = (planItems || []).filter(
      (it) => safeTrim(it?.text).length > 0,
    );
    if (!q) return base;
    return base.filter((it) => normalizeTextForMatch(it.text).includes(q));
  }, [planItems, planSearch]);

  const renderedPlanItems = useMemo(() => {
    return filteredPlanItems.slice(0, PLAN_ITEMS_RENDER_LIMIT);
  }, [filteredPlanItems]);

  const syncFocusPlanItemCompleted = useCallback(
    async (focusPlanItemId: string, nextCompleted: boolean) => {
      if (!user?.id) return;
      if (!focusPlanItemId) return;

      try {
        await supabase
          .from("focus_plan_items")
          .update({ completed: nextCompleted })
          .eq("id", focusPlanItemId)
          .eq("user_id", user.id);
      } catch { }
    },
    [user?.id],
  );

  const panelTextSet = useMemo(() => {
    const s = new Set<string>();
    for (const it of panelTasks) {
      const t = normalizeTextForMatch(it.text);
      if (t) s.add(t);
    }
    return s;
  }, [panelTasks]);

  const importPlanItemToPanel = useCallback(
    async (item: FocusPlanItem) => {
      if (!user?.id) return;

      const text = safeTrim(item.text);
      if (!text) return;

      const norm = normalizeTextForMatch(text);

      setImportingItemId(item.id);

      try {
        const alreadyById = panelTasks.some(
          (p) => String(p.focus_plan_item_id || "") === String(item.id),
        );
        if (!alreadyById) {
          const existingSameText =
            panelTasks.find(
              (p) => normalizeTextForMatch(p.text) === norm,
            ) || null;

          if (existingSameText) {
            await supabase
              .from(PANEL_TASKS_TABLE)
              .update({ focus_plan_item_id: item.id })
              .eq("id", existingSameText.id)
              .eq("user_id", user.id);
          } else {
            await supabase.from(PANEL_TASKS_TABLE).insert({
              user_id: user.id,
              text,
              focus_plan_item_id: item.id,
              completed: Boolean(item.completed),
              visibility: "public",
            } as any);
          }
        }

        void loadPanelTasks();
        void upsertOwnSessionTask({
          matchText: text,
          text,
          completed: Boolean(item.completed),
        });
      } finally {
        setImportingItemId(null);
      }
    },
    [user?.id, panelTasks, loadPanelTasks, upsertOwnSessionTask],
  );

  const savePanelTasksToTasks = useCallback(async () => {
    if (!user?.id || savingPanelTasks) return;

    const tasks = orderPanelTasks(panelTasks, panelTaskOrder).filter(
      (task) => UUID_RE.test(String(task.id || "")) && safeTrim(task.text).length > 0,
    );
    if (tasks.length === 0) {
      setSavePanelTasksFeedback("Add a task before saving this list.");
      return;
    }

    setSavingPanelTasks(true);
    setSavePanelTasksFeedback("");

    try {
      let planId = selectedPlanId;

      if (!planId) {
        const { data: createdPlan, error: createPlanError } = await supabase
          .from("focus_plans")
          .insert({ user_id: user.id, title: "My tasks" })
          .select("id,user_id,title,created_at,updated_at")
          .single();

        if (createPlanError || !createdPlan) {
          throw createPlanError || new Error("Task list was not created");
        }

        planId = String(createdPlan.id);
        setPlans((current) => [createdPlan as FocusPlan, ...current]);
        setSelectedPlanId(planId);
      }

      const { data: existingRows, error: existingRowsError } = await supabase
        .from("focus_plan_items")
        .select("id,plan_id,user_id,text,target_date,session_id,created_at,completed,sort_order")
        .eq("user_id", user.id)
        .eq("plan_id", planId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });

      if (existingRowsError) throw existingRowsError;

      const existingItems = (Array.isArray(existingRows) ? existingRows : []) as FocusPlanItem[];
      const itemByText = new Map<string, FocusPlanItem>();
      for (const item of existingItems) {
        const normalized = normalizeTextForMatch(item.text);
        if (normalized && !itemByText.has(normalized)) itemByText.set(normalized, item);
      }

      let nextSortOrder = existingItems.reduce(
        (maximum, item) => Math.max(maximum, Number(item.sort_order) || 0),
        -1,
      ) + 1;
      const pendingTexts = new Set<string>();
      const rowsToInsert = tasks.flatMap((task) => {
        const normalized = normalizeTextForMatch(task.text);
        if (!normalized || itemByText.has(normalized) || pendingTexts.has(normalized)) return [];
        pendingTexts.add(normalized);
        return [{
          user_id: user.id,
          plan_id: planId,
          text: safeTrim(task.text),
          target_date: null,
          session_id: null,
          completed: Boolean(task.completed),
          sort_order: nextSortOrder++,
        }];
      });

      if (rowsToInsert.length > 0) {
        const { data: insertedRows, error: insertRowsError } = await supabase
          .from("focus_plan_items")
          .insert(rowsToInsert)
          .select("id,plan_id,user_id,text,target_date,session_id,created_at,completed,sort_order");

        if (insertRowsError) throw insertRowsError;
        for (const item of (Array.isArray(insertedRows) ? insertedRows : []) as FocusPlanItem[]) {
          const normalized = normalizeTextForMatch(item.text);
          if (normalized) itemByText.set(normalized, item);
        }
      }

      const linkedTasks = new Map<string, string>();
      for (const task of tasks) {
        const item = itemByText.get(normalizeTextForMatch(task.text));
        if (!item) continue;
        const { error: linkError } = await supabase
          .from(PANEL_TASKS_TABLE)
          .update({ focus_plan_item_id: item.id })
          .eq("id", task.id)
          .eq("user_id", user.id);
        if (linkError) throw linkError;
        linkedTasks.set(task.id, item.id);
      }

      setPanelTasks((current) =>
        current.map((task) => ({
          ...task,
          focus_plan_item_id: linkedTasks.get(task.id) || task.focus_plan_item_id,
        })),
      );

      await supabase
        .from("focus_plans")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", planId)
        .eq("user_id", user.id);

      await Promise.all([loadPlans(), loadPlanItems(planId), loadPanelTasks()]);
      emitTasksSync({ action: "save-panel-list", userId: user.id, planId });
      setSavePanelTasksFeedback(
        rowsToInsert.length > 0
          ? `Saved ${rowsToInsert.length} new ${rowsToInsert.length === 1 ? "task" : "tasks"}.`
          : "Everything is already saved in Tasks.",
      );
    } catch (error) {
      console.error("[TasksPanel] Failed to save room tasks to Tasks", error);
      setSavePanelTasksFeedback("Could not save tasks. Please try again.");
    } finally {
      setSavingPanelTasks(false);
    }
  }, [
    loadPanelTasks,
    loadPlanItems,
    loadPlans,
    panelTaskOrder,
    panelTasks,
    savingPanelTasks,
    selectedPlanId,
    user?.id,
  ]);

  const handleAddPanelTask = async (
    textOverride?: string,
    visibilityOverride?: "public" | "private",
  ) => {
    if (!user?.id) return;

    const text = safeTrim(textOverride || newTask);
    if (!text) return;
    const visibility = visibilityOverride || newTaskVisibilityRef.current;

    setNewTask("");

    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: PanelTask = {
      id: optimisticId,
      user_id: user.id,
      text,
      focus_plan_item_id: null,
      completed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      visibility,
    };

    setPanelTasks((prev) =>
      [optimistic, ...prev].slice(0, PANEL_TASKS_FETCH_LIMIT),
    );

    try {
      const { data, error } = await supabase
        .from(PANEL_TASKS_TABLE)
        .insert({
          user_id: user.id,
          text,
          completed: false,
          visibility,
        } as any)
        .select("*")
        .single();

      if (error || !data) {
        setPanelTasks((prev) => prev.filter((x) => x.id !== optimisticId));
        return;
      }

      setPanelTasks((prev) =>
        [
          data as PanelTask,
          ...prev.filter((x) => x.id !== optimisticId),
        ].slice(0, PANEL_TASKS_FETCH_LIMIT),
      );

      // A newly added task is always position 1. Persist that position before
      // realtime/refetch can re-apply the database order and move a null
      // sort_order task back to the end of the list.
      const currentIds = panelTasks
        .map((task) => String(task.id || ""))
        .filter((id) => id && id !== optimisticId && id !== String(data.id));
      const persistedIds = panelTaskOrderRef.current.filter((id) =>
        currentIds.includes(id),
      );
      const nextOrder = [
        String(data.id),
        ...persistedIds,
        ...currentIds.filter((id) => !persistedIds.includes(id)),
      ];

      panelTaskOrderRef.current = nextOrder;
      setPanelTaskOrder(nextOrder);
      try {
        localStorage.setItem(taskOrderStorageKey, JSON.stringify(nextOrder));
        window.dispatchEvent(
          new CustomEvent(TASK_ORDER_SYNC_EVENT, {
            detail: { userId: user.id, order: nextOrder, source: "add" },
          }),
        );
      } catch { }

      reorderInFlightRef.current += 1;
      const persistAddedTaskOrder = reorderQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const { error: reorderError } = await supabase.rpc(
            "reorder_panel_intentions",
            { p_task_ids: nextOrder },
          );
          if (reorderError) throw reorderError;
        })
        .catch((reorderError: any) => {
          logTaskReorder("add_order_persist_failed", {
            taskId: String(data.id),
            error: String(reorderError?.message || reorderError || "unknown_error"),
          });
        })
        .finally(() => {
          reorderInFlightRef.current = Math.max(0, reorderInFlightRef.current - 1);
          if (reorderInFlightRef.current === 0 && pendingPanelReloadRef.current) {
            pendingPanelReloadRef.current = false;
            void loadPanelTasks();
          }
        });
      reorderQueueRef.current = persistAddedTaskOrder;

      if (visibility === "public") {
        void syncFirstPublicTaskForTile(
          [data as PanelTask, ...panelTasks.filter((task) => task.id !== optimisticId)],
          nextOrder,
        );
      }
    } catch {
      setPanelTasks((prev) => prev.filter((x) => x.id !== optimisticId));
    }
  };

  useEffect(() => {
    const takePendingText = (incoming?: string) => {
      let pending = "";
      try {
        pending = sessionStorage.getItem("mysession:voice-task-draft") || "";
        sessionStorage.removeItem("mysession:voice-task-draft");
      } catch { }
      const text = String(incoming || pending).trim();
      if (!text) return;
      const previous = voiceTaskLastAppliedRef.current;
      if (previous.text === text && Date.now() - previous.at < 2_000) return;
      voiceTaskLastAppliedRef.current = { text, at: Date.now() };
      setNewTask(text);
      void handleAddPanelTask(text);
    };
    const onVoiceTaskText = (event: Event) => {
      takePendingText((event as CustomEvent<{ text?: string }>).detail?.text);
    };
    takePendingText();
    window.addEventListener("mysession:voice-task-text", onVoiceTaskText);
    return () => window.removeEventListener("mysession:voice-task-text", onVoiceTaskText);
    // The handler intentionally follows the current authenticated panel state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const togglePanelCompleted = async (it: PanelTask) => {
    if (!user?.id) return;
    if (editingId === it.id) return;

    const next = !Boolean(it.completed);

    setPanelTasks((prev) =>
      prev.map((x) => (x.id === it.id ? { ...x, completed: next } : x)),
    );

    try {
      const { error } = await supabase
        .from(PANEL_TASKS_TABLE)
        .update({ completed: next })
        .eq("id", it.id)
        .eq("user_id", user.id);

      if (error) throw error;

      if (it.focus_plan_item_id) {
        void syncFocusPlanItemCompleted(String(it.focus_plan_item_id), next);
      }

      if (next) {
        pauseTaskTimer(user.id, it.text, it.id);
      }

      if (isPanelTaskPublic(it)) {
        void upsertOwnSessionTask({
          matchText: it.text,
          text: it.text,
          completed: next,
        });
        if (next) {
          const nextTasks = panelTasks.map((task) =>
            task.id === it.id ? { ...task, completed: true } : task,
          );
          void syncFirstPublicTaskForTile(nextTasks);
        }
      }
    } catch {
      setPanelTasks((prev) =>
        prev.map((x) => (x.id === it.id ? { ...x, completed: !next } : x)),
      );
    }
  };

  const requestAiTaskSuggestions = useCallback(async (task: PanelTask) => {
    aiSuggestionRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const requestId = (aiSuggestionRequestRef.current?.id || 0) + 1;
    aiSuggestionRequestRef.current = { id: requestId, controller };

    setAiSuggestionTask(task);
    setAiSuggestion(null);
    setAiSuggestionError("");
    setAiSuggestionLoading(true);

    const timeout = window.setTimeout(() => controller.abort(), 30_000);

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token || "";
      if (!accessToken) throw new Error("Please sign in again to use AI suggestions.");

      const response = await fetch("/api/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
        body: JSON.stringify({ action: "task-ai-suggestions", task: task.text }),
      });

      const payload = await response.json().catch(() => null);
      if (response.status === 402 || payload?.error === "payment_required") {
        if (aiSuggestionRequestRef.current?.id === requestId) {
          setAiPaidAccess(false);
          setAiSuggestionTask(null);
          setAiPaywallOpen(true);
        }
        return;
      }
      if (!response.ok || !payload?.suggestion) {
        throw new Error(payload?.message || payload?.error || "AI suggestions are temporarily unavailable.");
      }

      if (aiSuggestionRequestRef.current?.id === requestId) {
        setAiSuggestion(payload.suggestion as TaskAiSuggestion);
      }
    } catch (error: any) {
      if (aiSuggestionRequestRef.current?.id !== requestId) return;
      setAiSuggestionError(
        error?.name === "AbortError"
          ? "AI suggestions took too long. Please try again."
          : error?.message || "AI suggestions are temporarily unavailable.",
      );
    } finally {
      window.clearTimeout(timeout);
      if (aiSuggestionRequestRef.current?.id === requestId) {
        aiSuggestionRequestRef.current = null;
        setAiSuggestionLoading(false);
      }
    }
  }, []);

  const openAiTaskSuggestions = useCallback(
    (task: PanelTask) => {
      if (aiPaidAccess === false) {
        setAiPaywallOpen(true);
        return;
      }
      void requestAiTaskSuggestions(task);
    },
    [aiPaidAccess, requestAiTaskSuggestions],
  );

  const deletePanelTask = async (id: string) => {
    if (!user?.id) return;

    const prev = panelTasks;
    const target = panelTasks.find((x) => x.id === id) || null;

    setPanelTasks((p) => p.filter((x) => x.id !== id));

    try {
      const { error } = await supabase
        .from(PANEL_TASKS_TABLE)
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);

      if (error) throw error;

      if (target?.text && normalizeTaskVisibility(target.visibility) === "public") {
        void deleteOwnSessionTaskByText(target.text);
        void syncFirstPublicTaskForTile(panelTasks.filter((task) => task.id !== id));
      }
    } catch {
      setPanelTasks(prev);
    }
  };

  const deleteOwnPublishedTask = async (item: SessionTask) => {
    const uid = String(user?.id || "").trim();
    const sid = String(sessionId || "").trim();
    const taskId = String(item?.id || "").trim();
    if (
      !uid ||
      !sid ||
      !taskId ||
      String(item?.user_id || "").trim() !== uid ||
      deletingPublishedTaskId
    ) {
      return;
    }

    const matchingPanelTask =
      panelTasks.find(
        (task) =>
          normalizeTextForMatch(task.text) === normalizeTextForMatch(item.text),
      ) || null;

    setDeletingPublishedTaskId(taskId);
    setSessionTasks((prev) => prev.filter((task) => task.id !== taskId));
    setEncouragementModalTaskId((current) =>
      current === taskId ? null : current,
    );

    try {
      // Remove child reactions first for installations without an ON DELETE
      // CASCADE constraint. RLS can reject this best-effort cleanup, while the
      // intention delete itself remains the authoritative operation.
      await supabase
        .from(TASK_ENCOURAGEMENTS_TABLE)
        .delete()
        .or(`session_intention_id.eq.${taskId},intention_id.eq.${taskId}`);

      const { error } = await supabase
        .from(SESSION_TASKS_TABLE)
        .delete()
        .eq("id", taskId)
        .eq("user_id", uid)
        .eq("session_id", sid);

      if (error) throw error;

      setEncouragementCounts((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      setMyEncouragedIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      setEncouragementUsersByTask((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });

      if (matchingPanelTask) {
        await deletePanelTask(matchingPanelTask.id);
      }

      emitTasksSync({
        action: "delete",
        sessionId: sid,
        userId: uid,
        taskId,
      });
      scheduleSessionTasksReload(sid);
    } catch (error) {
      console.error("deleteOwnPublishedTask error:", error);
      void loadSessionTasks(sid);
    } finally {
      setDeletingPublishedTaskId(null);
    }
  };

  const startEdit = (id: string, text: string) => {
    setEditingId(id);
    setEditingText(text || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const saveEdit = async () => {
    if (!user?.id) return;
    if (!editingId) return;

    const text = safeTrim(editingText);
    if (!text) return;

    const targetId = editingId;
    const prev = panelTasks;
    const prevItem = panelTasks.find((x) => x.id === targetId) || null;
    const prevText = prevItem?.text || text;
    const prevCompleted = Boolean(prevItem?.completed);

    setPanelTasks((p) =>
      p.map((x) => (x.id === targetId ? { ...x, text } : x)),
    );

    try {
      const { error } = await supabase
        .from(PANEL_TASKS_TABLE)
        .update({ text })
        .eq("id", targetId)
        .eq("user_id", user.id);

      if (error) throw error;

      setEditingId(null);
      setEditingText("");
      if (prevText !== text) {
        moveTaskTimer(user.id, prevText, text, targetId);
      }

      if (isPanelTaskVisibleInRoom(prevItem)) {
        void upsertOwnSessionTask({
          matchText: prevText,
          text,
          completed: prevCompleted,
        });
      }
    } catch {
      setPanelTasks(prev);
    }
  };

  const togglePanelVisibility = async (it: PanelTask) => {
    if (!user?.id) return;
    if (!it?.id) return;

    const nextVisibility = getNextTaskVisibility(it.visibility);
    const nextVisibleInRoom = nextVisibility !== "private";
    const prev = panelTasks;

    setPanelTasks((items) =>
      items.map((x) =>
        x.id === it.id ? { ...x, visibility: nextVisibility } : x,
      ),
    );

    try {
      const { error } = await supabase
        .from(PANEL_TASKS_TABLE)
        .update({ visibility: nextVisibility })
        .eq("id", it.id)
        .eq("user_id", user.id);

      if (error) throw error;

      if (nextVisibleInRoom) {
        void upsertOwnSessionTask({
          matchText: it.text,
          text: it.text,
          completed: Boolean(it.completed),
        });
        if (!it.completed) {
          const nextTasks = panelTasks.map((task) =>
            task.id === it.id ? { ...task, visibility: nextVisibility } : task,
          );
          void syncFirstPublicTaskForTile(nextTasks);
        }
      } else {
        void deleteOwnSessionTaskByText(it.text);
        const nextTasks = panelTasks.map((task) =>
          task.id === it.id ? { ...task, visibility: nextVisibility } : task,
        );
        void syncFirstPublicTaskForTile(nextTasks);
      }
    } catch {
      setPanelTasks(prev);
    }
  };

  const closeOverlay = useCallback(() => {
    const o = overlayRef.current;
    overlayRef.current = null;
    setOverlayOpen(false);
    try {
      o?.win?.close?.();
    } catch { }
  }, []);

  const openOverlay = useCallback(async () => {
    if (overlayRef.current) return;

    const canPip = !!window.documentPictureInPicture?.requestWindow;

    try {
      if (canPip) {
        const pipWin = await window.documentPictureInPicture!.requestWindow({
          width: 420,
          height: 720,
        });
        pipWin.document.title = "Tasks";
        applyOverlayBaseStyles(pipWin.document, isLight);
        copyStylesToDocument(document, pipWin.document);

        const container = pipWin.document.createElement("div");
        container.style.height = "100vh";
        container.style.width = "100vw";
        container.style.fontFamily = OVERLAY_FONT_FAMILY;
        pipWin.document.body.appendChild(container);

        overlayRef.current = { win: pipWin, container, kind: "pip" };
        setOverlayOpen(true);

        pipWin.addEventListener("pagehide", closeOverlay);
        pipWin.addEventListener("beforeunload", closeOverlay);
        return;
      }

      const w = window.open(
        "",
        "mysession_tasks",
        "popup,width=420,height=720",
      );
      if (!w) return;

      w.document.title = "Tasks";
      applyOverlayBaseStyles(w.document, isLight);
      copyStylesToDocument(document, w.document);

      const container = w.document.createElement("div");
      container.style.height = "100vh";
      container.style.width = "100vw";
      container.style.fontFamily = OVERLAY_FONT_FAMILY;
      w.document.body.appendChild(container);

      overlayRef.current = { win: w, container, kind: "window" };
      setOverlayOpen(true);

      w.addEventListener("beforeunload", closeOverlay);
    } catch { }
  }, [closeOverlay, isLight]);

  useEffect(() => {
    return () => {
      try {
        if (sessionReloadTimerRef.current) {
          window.clearTimeout(sessionReloadTimerRef.current);
          sessionReloadTimerRef.current = null;
        }
        closeOverlay();
      } catch { }
    };
  }, [closeOverlay]);

  useEffect(() => {
    const onOpenPinnedTasks = () => {
      void openOverlay();
    };

    window.addEventListener(
      "mysession:tasks-open-pinned",
      onOpenPinnedTasks,
    );

    return () => {
      window.removeEventListener(
        "mysession:tasks-open-pinned",
        onOpenPinnedTasks,
      );
    };
  }, [openOverlay]);

  const getPortalDocument = useCallback((): Document => {
    const o = overlayRef.current;
    const doc = o?.win?.document;
    return doc || document;
  }, []);

  const openImportModal = useCallback(() => {
    setSavePanelTasksFeedback("");
    setImportModalOpen(true);
  }, []);
  const closeImportModal = useCallback(() => setImportModalOpen(false), []);

  useEffect(() => {
    if (!importModalOpen) return;

    const doc = getPortalDocument();
    const win: any = doc?.defaultView || window;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeImportModal();
      }
    };

    win.addEventListener("keydown", onKeyDown);
    return () => win.removeEventListener("keydown", onKeyDown);
  }, [importModalOpen, closeImportModal, getPortalDocument]);

  const teamTasks = useMemo(() => {
    const uid = String(user?.id || "").trim();
    const base = oneOnOneMode
      ? sessionTasks.filter((task) => String(task.user_id || "") !== uid)
      : hideTeamTasks
        ? sessionTasks.filter((task) => String(task.user_id || "") === uid)
        : sessionTasks;

    return base.slice(0, TEAM_TASKS_RENDER_LIMIT);
  }, [hideTeamTasks, oneOnOneMode, sessionTasks, user?.id]);


  const toggleTaskTimersEnabled = useCallback(() => {
    const next = !taskTimersEnabled;
    setTaskTimersEnabled(next);
    try {
      localStorage.setItem(taskTimerEnabledStorageKey, String(next));
      window.dispatchEvent(
        new CustomEvent(TASK_TIMER_VISIBILITY_EVENT, {
          detail: { enabled: next, userId: user?.id || "" },
        }),
      );
    } catch { }
  }, [taskTimerEnabledStorageKey, taskTimersEnabled, user?.id]);


  const toggleHideTeamTasks = useCallback(() => {
    const next = !hideTeamTasks;
    setHideTeamTasks(next);
    try {
      localStorage.setItem(hideTeamTasksStorageKey, String(next));
    } catch { }
  }, [hideTeamTasks, hideTeamTasksStorageKey]);

  const persistPanelTaskOrder = useCallback(
    (nextOrder: string[], source: string) => {
      panelTaskOrderRef.current = nextOrder;
      setPanelTaskOrder(nextOrder);
      try {
        localStorage.setItem(taskOrderStorageKey, JSON.stringify(nextOrder));
        window.dispatchEvent(
          new CustomEvent(TASK_ORDER_SYNC_EVENT, {
            detail: { userId: user?.id || "", order: nextOrder, source },
          }),
        );
      } catch { }
      logTaskReorder("optimistic_order_applied", { source, order: nextOrder });
    },
    [taskOrderStorageKey, user?.id],
  );

  const reorderPanelTask = useCallback(
    (fromId: string, toId: string) => {
      if (!fromId || !toId || fromId === toId) return;

      const currentIds = panelTasks.map((task) => task.id);
      const latestOrder = panelTaskOrderRef.current;
      const base = [
        ...latestOrder.filter((id) => currentIds.includes(id)),
        ...currentIds.filter((id) => !latestOrder.includes(id)),
      ];

      const fromIndex = base.indexOf(fromId);
      const toIndex = base.indexOf(toId);
      if (fromIndex < 0 || toIndex < 0) {
        logTaskReorder("drop_rejected_missing_task", {
          fromId,
          toId,
          currentOrder: base,
        });
        return;
      }

      const previousOrder = [...base];
      const next = [...base];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      const version = ++reorderVersionRef.current;

      logTaskReorder("drop_computed", {
        version,
        fromId,
        toId,
        previousOrder,
        nextOrder: next,
      });
      persistPanelTaskOrder(next, "drop");
      void syncFirstPublicTaskForTile(panelTasks, next);
      reorderInFlightRef.current += 1;

      const mutation = reorderQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          logTaskReorder("database_mutation_started", {
            version,
            order: next,
          });
          const { error } = await supabase.rpc("reorder_panel_intentions", {
            p_task_ids: next,
          });
          if (error) throw error;
          logTaskReorder("database_mutation_succeeded", {
            version,
            order: next,
          });
        })
        .catch((error: any) => {
          const message = String(error?.message || error || "unknown_error");
          const code = String(error?.code || "");
          const migrationMissing =
            code === "42883" ||
            code === "PGRST202" ||
            /reorder_panel_intentions|function.*does not exist/i.test(message);

          if (migrationMissing) {
            // Keep the established localStorage behavior until the migration
            // is applied; surfacing the precise failure makes rollout obvious.
            logTaskReorder("database_mutation_unavailable_local_fallback", {
              version,
              code,
              error: message,
              order: next,
            });
            return;
          }

          logTaskReorder("database_mutation_failed", {
            version,
            code,
            error: message,
          });
          if (version === reorderVersionRef.current) {
            persistPanelTaskOrder(previousOrder, "database_rollback");
          }
        })
        .finally(() => {
          reorderInFlightRef.current = Math.max(
            0,
            reorderInFlightRef.current - 1,
          );
          logTaskReorder("database_mutation_finished", {
            version,
            remaining: reorderInFlightRef.current,
          });
          if (
            reorderInFlightRef.current === 0 &&
            pendingPanelReloadRef.current
          ) {
            pendingPanelReloadRef.current = false;
            logTaskReorder("deferred_refetch_started", { version });
            void loadPanelTasks();
          }
        });

      reorderQueueRef.current = mutation;
    },
    [loadPanelTasks, panelTasks, persistPanelTaskOrder, syncFirstPublicTaskForTile],
  );

  const orderedPanelTasks = useMemo(() => {
    return orderPanelTasks(panelTasks, panelTaskOrder);
  }, [panelTaskOrder, panelTasks]);

  const renderTaskTimerControls = useCallback(
    ({
      ownerUserId,
      text,
      fallbackId,
      compact = false,
      focusPlanItemId = null,
      sessionTaskId = null,
    }: {
      ownerUserId: unknown;
      text: unknown;
      fallbackId?: unknown;
      compact?: boolean;
      focusPlanItemId?: string | null;
      sessionTaskId?: string | null;
    }) => {
      if (!taskTimersEnabled) return null;

      const timerId = makeTaskTimerId(ownerUserId, text, fallbackId);
      const timer = taskTimers[timerId] || null;
      const elapsedMs = getTaskTimerDisplayMs(timer, taskTimerTickMs);
      const running = isTaskTimerRunning(timer);
      const isMine = String(ownerUserId || "").trim().toLowerCase() === String(user?.id || "").trim().toLowerCase();
      const saved = savedTimerFeedbackId === timerId;

      if (!isMine && elapsedMs <= 0) return null;

      const buttonBase = "h-7 rounded-full border px-2 text-[11px] font-bold transition inline-flex items-center justify-center";
      const shellBase = compact
        ? "mt-2 flex flex-wrap items-center gap-1.5"
        : "mt-2 flex flex-wrap items-center gap-2";

      return (
        <div
          className={shellBase}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <div
            className={[
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-bold tabular-nums",
              running
                ? "border-[#81DB86] bg-[#81DB86]/15 text-[#81DB86]"
                : "border-[#CFC6C6] bg-[#F3F1F1] text-black/60",
            ].join(" ")}
            title="Time spent on this task"
          >
            <TimerReset size={13} />
            <span>{formatTaskTimer(elapsedMs)}</span>
          </div>

          {isMine ? (
            <>
              <button
                type="button"
                onClick={() => toggleTaskTimer(ownerUserId, text, fallbackId)}
                className={[
                  buttonBase,
                  running
                    ? "border-[#F65252]/50 bg-[#F65252]/10 text-[#F65252] hover:bg-[#F65252]/15"
                    : "border-[#81DB86] bg-[#81DB86]/15 text-[#81DB86] hover:bg-[#81DB86]/25",
                ].join(" ")}
                title={running ? "Pause timer" : "Start timer"}
              >
                {running ? "Pause" : "Start"}
              </button>

              {elapsedMs > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    void saveTaskTimerMeasurement({
                      ownerUserId,
                      text,
                      fallbackId,
                      focusPlanItemId,
                      sessionTaskId,
                    })
                  }
                  className={`${buttonBase} ${saved
                    ? "border-[#81DB86] bg-[#81DB86]/15 text-[#81DB86]"
                    : "border-[#5286F6] bg-[#5286F6]/10 text-[#5286F6] hover:bg-[#5286F6]/15"
                    }`}
                  title="Save this time measurement to Tasks"
                >
                  {saved ? "Saved" : "Save"}
                </button>
              ) : null}

              {elapsedMs > 0 ? (
                <button
                  type="button"
                  onClick={() => resetTaskTimer(ownerUserId, text, fallbackId)}
                  className={`${buttonBase} border-[#CFC6C6] bg-[#F7F5F5] text-black/55 hover:bg-[#ECEAEA]`}
                  title="Reset timer"
                >
                  Reset
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      );
    },
    [resetTaskTimer, saveTaskTimerMeasurement, savedTimerFeedbackId, taskTimerTickMs, taskTimers, taskTimersEnabled, toggleTaskTimer, user?.id],
  );

  if (!rawSessionId) {
    return (
      <div
        className={
          "h-full flex items-center justify-center font-inter " + panelBg
        }
      >
        <div className={"text-[12px] italic font-inter " + mutedText}>
          No session id
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div
        className={
          "h-full flex items-center justify-center font-inter " + panelBg
        }
      >
        <div className={"text-[12px] italic font-inter " + mutedText}>
          Resolving session...
        </div>
      </div>
    );
  }

  const timerPillCls = "bg-[#F3F1F1] border border-[#CFC6C6] text-black/80";
  const headerTitle = "text-black/90";
  const timerTextCls =
    `tabular-nums text-[12px] ${timerTextClassName || ""} font-inter font-normal`.trim();

  const ImportModal = importModalOpen
    ? (() => {
      const modalDoc = getPortalDocument();

      const backdropBg = isLight ? "bg-black/40" : "bg-[#E6E6E6]";
      const modalBg = isLight ? "bg-[#F3F3F3]" : "bg-[#1B1B1B]";
      const modalBorder = isLight ? "border-[#CFCFCF]" : "border-[#2B2B2B]";
      const modalTitle = isLight ? "text-black/85" : "text-white/85";
      const modalSub = isLight ? "text-black/50" : "text-white/45";
      const rowBg = isLight
        ? "bg-[#FAFAFA] hover:bg-[#F3F3F3]"
        : "bg-[#242424] hover:bg-[#2B2B2B]";
      const rowBorder = isLight ? "border-[#CFCFCF]" : "border-[#2B2B2B]";

      return createPortal(
        <div
          className={[
            "fixed inset-0 z-[9999] flex items-center justify-center",
            backdropBg,
            "font-inter",
          ].join(" ")}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeImportModal();
          }}
        >
          <div
            className={[
              "w-[min(760px,calc(100vw-24px))] max-h-[min(78vh,780px)] rounded-2xl border shadow-xl overflow-hidden",
              modalBg,
              modalBorder,
            ].join(" ")}
            style={{ fontFamily: OVERLAY_FONT_FAMILY }}
            onMouseDown={stopRoomBubbling}
            onPointerDown={stopRoomBubbling}
            onClick={stopRoomBubbling}
          >
            <div className={["px-4 py-3 border-b", modalBorder].join(" ")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div
                    className={["text-[13px] font-semibold", modalTitle].join(
                      " ",
                    )}
                  >
                    Tasks
                  </div>
                  <div className={["text-[11px] mt-0.5", modalSub].join(" ")}>
                    Save this room todo list to Tasks, or bring saved tasks
                    back into the room.
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    className={
                      "h-9 px-3 rounded-xl text-[12px] font-semibold transition inline-flex items-center gap-2 " +
                      ghostBtn
                    }
                    onClick={() => {
                      const sid = (rawSessionId || sessionId || "").trim();
                      window.open(
                        `/tasks?sessionId=${encodeURIComponent(sid)}`,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                    title="Go to Tasks"
                  >
                    <ExternalLink size={14} />
                    Go to Tasks
                  </button>

                  <button
                    type="button"
                    className={
                      "h-9 px-3 rounded-xl text-[12px] font-semibold transition inline-flex items-center gap-2 " +
                      ghostBtn
                    }
                    onClick={() => loadPlans()}
                    title="Refresh plans"
                  >
                    <RefreshCw size={14} />
                    Refresh
                  </button>

                  <button
                    type="button"
                    className={
                      "w-9 h-9 rounded-xl border transition flex items-center justify-center " +
                      ghostBtn
                    }
                    onClick={closeImportModal}
                    title="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </div>

            <div
              className="p-4 overflow-y-auto custom-scrollbar"
              style={{ maxHeight: "calc(78vh - 56px)" }}
            >
              <div
                className={[
                  "mb-4 rounded-xl px-3 py-3",
                  isLight ? "bg-[#E9E7E7]" : "bg-[#242424]",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className={["text-[13px] font-semibold", modalTitle].join(" ")}>
                      Save current todo list
                    </div>
                    <div className={["mt-0.5 text-[11px]", modalSub].join(" ")}>
                      Every row becomes a separate task. Existing tasks are not duplicated.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={savingPanelTasks || plansLoading || panelTasks.length === 0}
                    onClick={() => void savePanelTasksToTasks()}
                    className={[
                      "h-10 shrink-0 rounded-xl px-3 text-[12px] font-semibold transition inline-flex items-center gap-2",
                      primaryBtn,
                      savingPanelTasks || plansLoading || panelTasks.length === 0
                        ? "cursor-not-allowed opacity-45"
                        : "",
                    ].join(" ")}
                  >
                    {savingPanelTasks ? (
                      <RefreshCw size={15} className="animate-spin" />
                    ) : (
                      <ListPlus size={15} />
                    )}
                    {savingPanelTasks ? "Saving..." : "Save to Tasks"}
                  </button>
                </div>
                {savePanelTasksFeedback ? (
                  <div
                    className={[
                      "mt-2 text-[11px]",
                      savePanelTasksFeedback.startsWith("Could not")
                        ? "text-[#F65252]"
                        : modalSub,
                    ].join(" ")}
                  >
                    {savePanelTasksFeedback}
                  </div>
                ) : null}
              </div>

              <div className={["mb-3 text-[11px] font-semibold uppercase tracking-[0.12em]", modalSub].join(" ")}>
                Add from Tasks
              </div>

              {plansLoading ? (
                <div className={"text-[12px] italic " + mutedText}>
                  Loading plans…
                </div>
              ) : plans.length === 0 ? (
                <div className={"text-[12px] italic " + mutedText}>
                  No plans found. Create one on the Tasks page.
                  {lastPlansLoadedAt
                    ? ` (checked ${new Date(lastPlansLoadedAt).toLocaleTimeString()})`
                    : ""}
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <div className={"text-[11px] font-semibold " + mutedText}>
                      Task list
                    </div>

                    <select
                      value={selectedPlanId}
                      onChange={(e) => setSelectedPlanId(e.target.value)}
                      className={
                        isLight
                          ? "w-full h-11 px-3 rounded-xl border border-[#CFCFCF] bg-[#F3F3F3] text-[13px] font-semibold text-black/85 outline-none focus:ring-1 focus:ring-[#81DB86]"
                          : "w-full h-11 px-3 rounded-xl border border-[#2B2B2B] bg-[#242424] text-[13px] font-semibold text-white/85 outline-none focus:ring-1 focus:ring-[#81DB86]"
                      }
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>

                    <div
                      className={
                        "text-[11px] font-semibold " + mutedText + " mt-2"
                      }
                    >
                      Search
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className={[
                          "h-11 w-11 rounded-xl border flex items-center justify-center",
                          isLight
                            ? "border-[#CFCFCF] bg-[#F3F3F3]"
                            : "border-[#2B2B2B] bg-[#242424]",
                        ].join(" ")}
                      >
                        <Search
                          size={16}
                          className={
                            isLight ? "text-black/40" : "text-white/45"
                          }
                        />
                      </div>

                      <input
                        value={planSearch}
                        onChange={(e) => setPlanSearch(e.target.value)}
                        placeholder="Type to filter tasks..."
                        className={"flex-1 " + inputCls}
                      />
                    </div>
                  </div>

                  <div className={"h-px my-4 " + divider} />

                  {planItemsLoading ? (
                    <div className={"text-[12px] italic " + mutedText}>
                      Loading items…
                    </div>
                  ) : filteredPlanItems.length === 0 ? (
                    <div className={"text-[12px] italic " + mutedText}>
                      No items match your filter.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {renderedPlanItems.map((it) => {
                        const text = safeTrim(it.text);
                        const inPanelById = panelTasks.some(
                          (p) =>
                            String(p.focus_plan_item_id || "") ===
                            String(it.id),
                        );
                        const inPanelByText = panelTextSet.has(
                          normalizeTextForMatch(text),
                        );
                        const already = inPanelById || inPanelByText;

                        return (
                          <div
                            key={it.id}
                            className={[
                              "rounded-xl border px-3 py-2.5 transition",
                              rowBg,
                              rowBorder,
                            ].join(" ")}
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <div
                                  className={[
                                    "text-[13px] break-words leading-5",
                                    it.completed
                                      ? isLight
                                        ? "text-black/45 line-through"
                                        : "text-white/50 line-through"
                                      : isLight
                                        ? "text-black/80"
                                        : "text-white/80",
                                  ].join(" ")}
                                >
                                  {text}
                                </div>

                                <div
                                  className={"mt-1 text-[11px] " + mutedText}
                                >
                                  {already
                                    ? "Already in your panel"
                                    : "Saved task"}
                                  {it.target_date
                                    ? ` · Due: ${it.target_date}`
                                    : ""}
                                </div>
                              </div>

                              {already ? (
                                <div className="shrink-0">
                                  <div
                                    className={[
                                      "h-10 px-3 rounded-xl text-[12px] font-semibold inline-flex items-center gap-2",
                                      isLight
                                        ? "bg-[#E6E6E6] text-black/60 border border-[#CFCFCF]"
                                        : "bg-[#242424] text-white/70 border border-[#2B2B2B]",
                                    ].join(" ")}
                                    title="Already attached to panel"
                                  >
                                    <Check size={16} />
                                    Attached
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => importPlanItemToPanel(it)}
                                  disabled={importingItemId === it.id}
                                  className={[
                                    "shrink-0 h-10 px-3 rounded-xl text-[12px] font-semibold transition inline-flex items-center gap-2",
                                    importingItemId === it.id
                                      ? "opacity-70"
                                      : "opacity-100",
                                    primaryBtn,
                                  ].join(" ")}
                                  title="Attach to panel"
                                >
                                  <ListPlus size={16} />
                                  {importingItemId === it.id
                                    ? "Attaching..."
                                    : "Attach"}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className={"mt-4 text-[11px] " + mutedText}>
                    Tip: Tasks is your reusable list. Room tasks stay compact
                    and each row remains an individual task.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        modalDoc.body,
      );
    })()
    : null;

  const encouragementModalItem = encouragementModalTaskId
    ? teamTasks.find((x) => x.id === encouragementModalTaskId) || null
    : null;

  const EncouragementModal = encouragementModalTaskId
    ? createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/35 font-inter"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setEncouragementModalTaskId(null);
        }}
      >
        <div
          className="w-[min(360px,calc(100vw-24px))] rounded-2xl border border-[#CFC6C6] bg-[#F3F1F1] shadow-xl overflow-hidden"
          onMouseDown={stopRoomBubbling}
          onPointerDown={stopRoomBubbling}
          onClick={stopRoomBubbling}
        >
          <div className="px-4 py-3 border-b border-[#D8D0D0] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-black/90">Encouragements</div>
              <div className="text-[11px] text-black/50 truncate">
                {encouragementModalItem?.text || "Team Task"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEncouragementModalTaskId(null)}
              className="w-8 h-8 rounded-xl border border-[#CFC6C6] bg-[#ECEAEA] hover:bg-[#E3E0E0] flex items-center justify-center"
              title="Close"
            >
              <X size={15} />
            </button>
          </div>

          <div className="p-3 max-h-[360px] overflow-y-auto custom-scrollbar">
            {(encouragementUsersByTask[encouragementModalTaskId] || []).length === 0 ? (
              <div className="text-[12px] italic text-black/55 px-1 py-2">
                No encouragements yet.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {(encouragementUsersByTask[encouragementModalTaskId] || []).map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center gap-3 rounded-xl border border-[#CFC6C6] bg-[#F7F5F5] px-3 py-2"
                  >
                    <img
                      src={getAvatar(u)}
                      className="w-8 h-8 rounded-full object-cover shrink-0"
                      alt=""
                    />
                    <div className="min-w-0 flex-1 text-[13px] font-medium text-black/85 truncate">
                      {u.full_name || "Participant"}
                    </div>
                    <div className="shrink-0 h-8 min-w-8 rounded-full bg-[#E6E6E6] flex items-center justify-center px-2">
                      <PanelSmartIcon
                        name="encouragement"
                        theme={panelTheme}
                        className="w-5 h-5"
                        alt="Encouragement"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>,
      getPortalDocument().body,
    )
    : null;

  const AiPaywallModal = aiPaywallOpen
    ? createPortal(
      <div
        className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/45 px-4 font-inter backdrop-blur-[2px]"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setAiPaywallOpen(false);
        }}
      >
        <div
          className="w-full max-w-[430px] overflow-hidden rounded-[26px] bg-white text-[#2F2F2F] shadow-[0_24px_90px_rgba(0,0,0,0.22)]"
          onMouseDown={stopRoomBubbling}
          onPointerDown={stopRoomBubbling}
          onClick={stopRoomBubbling}
        >
          <div className="px-6 pb-6 pt-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#E9F0FF] text-[#5286F6]">
                <Sparkles size={20} />
              </div>
              <button
                type="button"
                onClick={() => setAiPaywallOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/[0.05] text-black/50 transition hover:bg-black/[0.09] hover:text-black/80"
                title="Close"
                aria-label="Close upgrade message"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 text-[22px] font-bold tracking-[-0.025em]">
              Unlock AI Suggestions
            </div>
            <p className="mt-2 text-[14px] leading-6 text-black/60">
              Turn any task into a clear first action, a practical step-by-step plan, and a focused work block.
            </p>

            <div className="mt-5 rounded-2xl bg-[#F4F3F3] px-4 py-3 text-[12px] leading-5 text-black/60">
              AI Suggestions are currently included with active paid MySession plans.
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setAiPaywallOpen(false)}
                className="flex-1 rounded-2xl bg-black/[0.055] px-4 py-3 text-[13px] font-semibold text-black/65 transition hover:bg-black/[0.09]"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => {
                  setAiPaywallOpen(false);
                  navigate("/pricing");
                }}
                className="flex-1 rounded-2xl bg-[#2F2F2F] px-4 py-3 text-[13px] font-semibold text-white transition hover:bg-[#3A3A3A]"
              >
                View plans
              </button>
            </div>
          </div>
        </div>
      </div>,
      getPortalDocument().body,
    )
    : null;

  const AiSuggestionModal = aiSuggestionTask
    ? createPortal(
      <div
        className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 px-3 font-inter backdrop-blur-[2px]"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setAiSuggestionTask(null);
        }}
      >
        <div
          className="w-[min(430px,calc(100vw-24px))] overflow-hidden rounded-[24px] bg-[#F7F5F5] text-[#2F2F2F] shadow-2xl"
          onMouseDown={stopRoomBubbling}
          onPointerDown={stopRoomBubbling}
          onClick={stopRoomBubbling}
        >
          <div className="flex items-start justify-between gap-4 border-b border-black/10 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[15px] font-bold">
                <Sparkles size={16} className="text-[#5286F6]" />
                AI Suggestions
              </div>
              <div className="mt-1 line-clamp-2 text-[12px] leading-4 text-black/55">
                {aiSuggestionTask.text}
              </div>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-black/[0.05] text-black/55 transition hover:bg-black/[0.09] hover:text-black/80"
              onClick={() => setAiSuggestionTask(null)}
              title="Close"
              aria-label="Close AI suggestions"
            >
              <X size={16} />
            </button>
          </div>

          <div className="max-h-[min(570px,calc(100vh-120px))] overflow-y-auto px-5 py-5 custom-scrollbar">
            {aiSuggestionLoading ? (
              <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
                <Loader2 size={24} className="animate-spin text-[#5286F6]" />
                <div>
                  <div className="text-[14px] font-semibold">Turning this into a clear next move</div>
                  <div className="mt-1 text-[12px] text-black/45">Usually takes a few seconds.</div>
                </div>
              </div>
            ) : aiSuggestionError ? (
              <div className="flex min-h-52 flex-col items-center justify-center text-center">
                <div className="text-[14px] font-semibold">Could not generate suggestions</div>
                <div className="mt-2 max-w-[320px] text-[12px] leading-5 text-black/50">
                  {aiSuggestionError}
                </div>
                <button
                  type="button"
                  onClick={() => void requestAiTaskSuggestions(aiSuggestionTask)}
                  className="mt-4 rounded-xl bg-[#2F2F2F] px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-[#3A3A3A]"
                >
                  Try again
                </button>
              </div>
            ) : aiSuggestion ? (
              <div className="space-y-5">
                <div className="text-[13px] leading-5 text-black/65">{aiSuggestion.summary}</div>

                <div className="rounded-2xl bg-[#E9F0FF] px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#3F6FD4]">Start here</div>
                  <div className="mt-1.5 text-[14px] font-semibold leading-5 text-[#24375F]">
                    {aiSuggestion.firstAction}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-[12px] font-bold">Suggested steps</div>
                    <div className="rounded-full bg-black/[0.055] px-2.5 py-1 text-[10px] font-semibold text-black/55">
                      {aiSuggestion.focusMinutes} min focus block
                    </div>
                  </div>
                  <ol className="space-y-2">
                    {aiSuggestion.nextSteps.map((step, index) => (
                      <li key={`${index}-${step}`} className="flex gap-3 rounded-xl bg-black/[0.035] px-3 py-2.5 text-[12px] leading-5 text-black/70">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2F2F2F] text-[10px] font-bold text-white">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {aiSuggestion.likelyObstacle ? (
                  <div className="rounded-2xl bg-[#EEECEC] px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-black/40">Watch for</div>
                    <div className="mt-1 text-[12px] leading-5 text-black/65">{aiSuggestion.likelyObstacle}</div>
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3 border-t border-black/10 pt-4">
                  <div className="text-[10px] leading-4 text-black/40">Only this task text is sent for this request.</div>
                  <button
                    type="button"
                    onClick={() => void requestAiTaskSuggestions(aiSuggestionTask)}
                    className="shrink-0 rounded-xl bg-black/[0.06] px-3 py-2 text-[11px] font-semibold text-black/65 transition hover:bg-black/[0.1]"
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>,
      getPortalDocument().body,
    )
    : null;

  const PanelUI = (
    <div
      className={"h-full flex flex-col min-h-0 font-inter " + panelBg}
      onPointerDown={stopRoomBubbling}
      onMouseDown={stopRoomBubbling}
      onClick={stopRoomBubbling}
    >
      <div className="px-4 pt-4 pb-2 shrink-0">
        <div
          className={
            "rounded-[22px] border px-4 py-3 " + headerBorder + " " + headerBg
          }
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div
                className={"font-inter font-bold text-[16px] leading-5 " + headerTitle}
              >
                Tasks
              </div>
              <div className={"text-[10px] leading-[12px] font-inter " + titleText}>
                Keep it visible while you work
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 font-inter">
              <div
                className={
                  "inline-flex items-center gap-2 px-3 py-2 rounded-xl " +
                  timerPillCls
                }
                title="Timer"
              >
                <TimerSmartIcon
                  theme={panelTheme}
                  className="w-4 h-4 opacity-80"
                />
                <span
                  className={timerTextCls + " leading-none"}
                  style={{ fontFamily: OVERLAY_FONT_FAMILY }}
                >
                  {timerText || "--:--"}
                </span>
              </div>

              <IconButton
                theme={panelTheme}
                className={
                  "border border-[#5286F6] bg-[#5286F6]/10 text-[#5286F6] hover:bg-[#5286F6]/15"
                }
                title="Sync with Tasks"
                onClick={(e) => {
                  e.preventDefault();
                  openImportModal();
                }}
              >
                <PanelSmartIcon
                  name="focus-plan"
                  theme={panelTheme}
                  className="w-4 h-4"
                  alt="Tasks"
                />
              </IconButton>

              {pictureInPictureSupported && onOpenPictureInPicture ? (
                <IconButton
                  theme={panelTheme}
                  className="border border-[#81DB86] bg-[#81DB86]/10 text-[#81DB86] hover:bg-[#81DB86]/15"
                  title={
                    pictureInPictureOpen
                      ? "Close Picture-in-Picture video"
                      : "Open video Picture-in-Picture"
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenPictureInPicture();
                  }}
                >
                  <PanelSmartIcon
                    name="pip-intentions"
                    theme={panelTheme}
                    className="w-4 h-4"
                    alt="Picture-in-Picture"
                  />
                </IconButton>
              ) : null}

              <IconButton
                theme={panelTheme}
                className={
                  "border border-[#F65252] bg-[#F65252]/10 text-[#F65252] hover:bg-[#F65252]/15"
                }
                title={overlayOpen ? "Unpin" : "Pin (always on top if supported)"}
                onClick={(e) => {
                  e.preventDefault();
                  if (overlayOpen) closeOverlay();
                  else void openOverlay();
                }}
              >
                <PanelSmartIcon
                  name="pin"
                  theme={panelTheme}
                  className="w-4 h-4"
                  alt="Pin"
                />
              </IconButton>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pb-4 pt-5 min-h-0 flex-1 overflow-y-auto custom-scrollbar font-inter">
        <div className="mb-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className={titleText + " font-inter font-bold text-[17px]"}>
                {oneOnOneMode ? "Your Tasks" : "My Tasks"}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-black/40">
                <Sparkles size={10} className="text-[#5286F6]" />
                <span>Click a task for AI advice</span>
                <span className="ml-0.5 rounded-full bg-[#E9F0FF] px-1.5 py-0.5 font-bold text-[#3F6FD4]">PRO</span>
              </div>
            </div>

            {onToggleAccountabilityWall ? (
              <button
                type="button"
                onClick={onToggleAccountabilityWall}
                className={[
                  "h-9 shrink-0 rounded-2xl border px-3 text-[12px] font-bold transition inline-flex items-center gap-2 font-inter",
                  "border-[#CFC6C6] bg-[#F7F5F5] text-black/65 hover:bg-[#ECEAEA]",
                ].join(" ")}
                title={
                  accountabilityWallOpen
                    ? "Back to video grid"
                    : "Switch to Accountability Wall"
                }
              >
                <PanelSmartIcon
                  name={accountabilityWallOpen ? "pip-intentions" : "accountability-wall"}
                  theme={panelTheme}
                  className="w-4 h-4"
                  alt=""
                />
                <span>{accountabilityWallOpen ? "Tasks" : "Wall"}</span>
              </button>
            ) : null}
          </div>

          <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_48px_auto] items-center gap-2 mb-3">
            <div className="relative min-w-0">
              <input
                type="text"
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleAddPanelTask()}
                placeholder="Add a task"
                className={"min-w-0 w-full !pr-12 " + inputCls}
              />

              <div
                className="absolute right-2 top-1/2 z-30 -translate-y-1/2"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setNewTaskVisibilityMenuOpen(false);
                  }
                }}
              >
                <button
                  type="button"
                  onClick={() => setNewTaskVisibilityMenuOpen((open) => !open)}
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-black/50 transition hover:bg-black/[0.06] hover:text-black/75"
                  title={newTaskVisibility === "public" ? "Public task" : "Private task"}
                  aria-label={`Task visibility: ${newTaskVisibility}`}
                  aria-haspopup="menu"
                  aria-expanded={newTaskVisibilityMenuOpen}
                >
                  <TaskVisibilityIcon visibility={newTaskVisibility} size={15} />
                </button>

                {newTaskVisibilityMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+6px)] w-36 overflow-hidden rounded-2xl bg-white p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.06]"
                  >
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={newTaskVisibility === "public"}
                      onClick={() => {
                        setNewTaskVisibility("public");
                        setNewTaskVisibilityMenuOpen(false);
                      }}
                      className={[
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-semibold transition",
                        newTaskVisibility === "public"
                          ? "bg-[#EAF8EC] text-[#2F7F3D]"
                          : "text-black/65 hover:bg-black/[0.04]",
                      ].join(" ")}
                    >
                      <TaskVisibilityIcon visibility="public" size={14} />
                      Public
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={newTaskVisibility === "private"}
                      onClick={() => {
                        setNewTaskVisibility("private");
                        setNewTaskVisibilityMenuOpen(false);
                      }}
                      className={[
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-semibold transition",
                        newTaskVisibility === "private"
                          ? "bg-[#F0F0F0] text-[#2F2F2F]"
                          : "text-black/65 hover:bg-black/[0.04]",
                      ].join(" ")}
                    >
                      <TaskVisibilityIcon visibility="private" size={14} />
                      Private
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={toggleTaskTimersEnabled}
              className={[
                "h-12 w-12 shrink-0 rounded-[18px] border transition inline-flex items-center justify-center",
                taskTimersEnabled
                  ? "border-[#81DB86] bg-[#81DB86]/10 text-[#81DB86] hover:bg-[#81DB86]/15"
                  : "border-[#CFC6C6] bg-[#F7F5F5] text-black/45 hover:bg-[#ECEAEA]",
              ].join(" ")}
              title={taskTimersEnabled ? "Disable Timer" : "Enable Timer"}
              aria-label={taskTimersEnabled ? "Disable Timer" : "Enable Timer"}
              aria-pressed={taskTimersEnabled}
            >
              <TimerReset size={18} />
            </button>

            <button
              onClick={() => void handleAddPanelTask()}
              className={[
                "h-12 shrink-0 px-4 rounded-[18px] font-semibold text-[14px] font-inter transition",
                "bg-[#1F1F1F] hover:bg-[#2A2A2A] text-white",
              ].join(" ")}
              type="button"
              title={`Add ${newTaskVisibility} task`}
            >
              Add
            </button>
          </div>

          {panelLoading ? (
            <div className={"text-[12px] italic font-inter " + mutedText}>
              Loading...
            </div>
          ) : panelTasks.length === 0 ? (
            <div className={"text-[12px] italic font-inter " + mutedText}>
              No panel tasks yet. Add one from Tasks or create it manually.
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {orderedPanelTasks.map((i) => {
                const isEditing = editingId === i.id;
                const isPersistedTask = UUID_RE.test(String(i.id || ""));

                const textDoneCls = "text-black/45 line-through";
                const textActiveCls = "text-black/80";

                const editInputCls = `
                    w-full bg-[#F3F3F3] border border-[#C9C9C9] rounded-xl
                    px-3 py-2 text-[13px] text-black/85
                    outline-none focus:ring-1 focus:ring-[#81DB86] focus:border-[#81DB86]
                    font-inter
                  `;

                return (
                  <div
                    key={i.id}
                    draggable={!isEditing && isPersistedTask}
                    className={[
                      myCardCls,
                      "font-inter",
                      draggedTaskId === i.id ? "opacity-45" : "",
                      dragOverTaskId === i.id && draggedTaskId !== i.id
                        ? "ring-2 ring-[#5286F6]/40"
                        : "",
                    ].join(" ")}
                    onDragStart={(e) => {
                      if (isEditing || !isPersistedTask) {
                        e.preventDefault();
                        logTaskReorder("drag_rejected_unsaved_task", {
                          taskId: i.id,
                        });
                        return;
                      }
                      setDraggedTaskId(i.id);
                      setDragOverTaskId(null);
                      logTaskReorder("drag_started", {
                        taskId: i.id,
                        currentOrder: panelTaskOrderRef.current,
                      });
                      try {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", i.id);
                      } catch { }
                    }}
                    onDragOver={(e) => {
                      if (!isPersistedTask || !draggedTaskId || draggedTaskId === i.id) return;
                      e.preventDefault();
                      setDragOverTaskId(i.id);
                      try {
                        e.dataTransfer.dropEffect = "move";
                      } catch { }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const fromId = draggedTaskId || e.dataTransfer.getData("text/plain");
                      if (!isPersistedTask) {
                        logTaskReorder("drop_rejected_unsaved_task", {
                          fromId,
                          toId: i.id,
                        });
                        return;
                      }
                      logTaskReorder("drop_received", {
                        fromId,
                        toId: i.id,
                      });
                      reorderPanelTask(fromId, i.id);
                      setDraggedTaskId(null);
                      setDragOverTaskId(null);
                    }}
                    onDragEnd={() => {
                      logTaskReorder("drag_ended", {
                        taskId: draggedTaskId,
                        currentOrder: panelTaskOrderRef.current,
                      });
                      setDraggedTaskId(null);
                      setDragOverTaskId(null);
                    }}

                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {!isEditing ? (
                        <div
                          className="shrink-0 cursor-grab active:cursor-grabbing text-black/25 group-hover:text-black/45 transition"
                          title="Drag to reorder"
                          aria-label="Drag to reorder"
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          <GripVertical size={15} />
                        </div>
                      ) : null}

                      <button
                        type="button"
                        className="flex h-[18px] w-[18px] shrink-0 self-center items-center justify-center leading-none"
                        onClick={(event) => {
                          event.stopPropagation();
                          void togglePanelCompleted(i);
                        }}
                        title={i.completed ? "Mark task incomplete" : "Complete task"}
                        aria-label={i.completed ? "Mark task incomplete" : "Complete task"}
                      >
                        <AnimatedTodoCheck
                          completed={Boolean(i.completed)}
                          size={18}
                          className="text-black/40"
                        />
                      </button>

                      <div
                        className={
                          "flex-1 min-w-0 " +
                          (!isEditing
                            ? "transition-[padding-right] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:pr-[72px] group-focus-within:pr-[72px]"
                            : "")
                        }
                      >
                        {!isEditing ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openAiTaskSuggestions(i);
                            }}
                            className={
                              "block w-full max-h-[18px] overflow-hidden whitespace-normal break-words text-left text-[13px] leading-[18px] font-inter transition-[max-height,color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[max-height] group-hover:max-h-[288px] group-focus-within:max-h-[288px] hover:text-[#3F6FD4] " +
                              (i.completed ? textDoneCls : textActiveCls)
                            }
                            title={`Get AI suggestions for: ${i.text}`}
                          >
                            <span>{i.text}</span>
                          </button>
                        ) : (
                          <input
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                            className={editInputCls}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}

                      </div>

                      <div className="relative shrink-0 flex items-center gap-1.5 rounded-full bg-transparent">
                        {!isEditing ? (
                          <>
                            <button
                              type="button"
                              title={getVisibilityTitle(i.visibility)}
                              onClick={(e) => {
                                e.stopPropagation();
                                void togglePanelVisibility(i);
                              }}
                              className={[
                                "relative z-20 h-8 w-8 shrink-0 rounded-lg border text-[13px] font-semibold transition inline-flex items-center justify-center",
                                normalizeTaskVisibility(i.visibility) ===
                                  "public"
                                  ? "border-[#81DB86] bg-[#81DB86]/15 text-[#81DB86] hover:bg-[#81DB86]/25"
                                  : "border-[#CFC6C6] bg-[#F3F1F1] text-black/55 hover:bg-[#ECEAEA]",
                              ].join(" ")}
                            >
                              <TaskVisibilityIcon visibility={i.visibility} size={14} />
                            </button>

                            <div className="absolute right-9 z-10 w-8 translate-x-9 opacity-0 pointer-events-none transition-[opacity,transform] duration-[360ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0 group-hover:opacity-100 group-hover:pointer-events-auto focus-within:translate-x-0 focus-within:opacity-100 focus-within:pointer-events-auto">
                              <IconButton
                                theme={panelTheme}
                                className="!h-8 !w-8 !rounded-lg"
                                title="Edit"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEdit(i.id, i.text);
                                }}
                              >
                                <Pencil size={16} />
                              </IconButton>
                            </div>

                            <div className="absolute right-[70px] z-10 w-8 translate-x-[70px] opacity-0 pointer-events-none transition-[opacity,transform] duration-[440ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0 group-hover:opacity-100 group-hover:pointer-events-auto focus-within:translate-x-0 focus-within:opacity-100 focus-within:pointer-events-auto">
                              <IconButton
                                theme={panelTheme}
                                title="Delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void deletePanelTask(i.id);
                                }}
                                className="!h-8 !w-8 !rounded-lg hover:text-[#F65252]"
                              >
                                <Trash2 size={16} />
                              </IconButton>
                            </div>
                          </>
                        ) : (
                          <>
                            <IconButton
                              theme={panelTheme}
                              title="Save"
                              onClick={(e) => {
                                e.stopPropagation();
                                void saveEdit();
                              }}
                              className="hover:text-emerald-600"
                            >
                              <Check size={18} />
                            </IconButton>

                            <IconButton
                              theme={panelTheme}
                              title="Cancel"
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelEdit();
                              }}
                            >
                              <X size={18} />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </div>

                    {!isEditing ? (
                      <div className="pl-[42px]">
                        {renderTaskTimerControls({
                          ownerUserId: user?.id || i.user_id,
                          text: i.text,
                          fallbackId: i.id,
                          focusPlanItemId: i.focus_plan_item_id || null,
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={"h-px my-5 " + divider} />

        <div className="mb-4 flex items-center justify-between gap-3">
          <div className={titleText + " font-inter font-bold text-[17px]"}>
            {oneOnOneMode ? "Your Partner's Tasks" : "Team Tasks"}
          </div>

          {!oneOnOneMode ? <button
            type="button"
            onClick={toggleHideTeamTasks}
            className={[
              "h-9 shrink-0 rounded-2xl border px-3 text-[12px] font-bold transition inline-flex items-center gap-2 font-inter",
              hideTeamTasks
                ? "border-[#81DB86] bg-[#81DB86]/10 text-[#2F8F3B] hover:bg-[#81DB86]/15"
                : "border-[#CFC6C6] bg-[#F7F5F5] text-black/65 hover:bg-[#ECEAEA]",
            ].join(" ")}
            title={
              hideTeamTasks
                ? "Show other participants' tasks"
                : "Hide other participants' tasks"
            }
            aria-pressed={hideTeamTasks}
          >
            {hideTeamTasks ? <EyeOff size={15} /> : <Eye size={15} />}
            <span>{hideTeamTasks ? "Mine only" : "Hide others"}</span>
          </button> : null}
        </div>

        {sessionLoading ? (
          <div className={"text-[12px] italic font-inter " + mutedText}>
            Loading...
          </div>
        ) : teamTasks.length === 0 ? (
          <div className={"text-[12px] italic font-inter " + mutedText}>
            {oneOnOneMode ? "Your partner's tasks will appear here" : "No Team Tasks"}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {teamTasks.map((item) => {
              const nameCls = "text-black/90";
              const bodyActive = "text-black/85";
              const bodyDone = "text-black/35 line-through";
              const encouragementCount = encouragementCounts[item.id] || 0;
              const encouragedByMe = myEncouragedIds.has(item.id);
              const statusText = item.completed ? "Completed" : "In progress";
              const isOwnPublishedTask =
                String(item.user_id || "").trim() === String(user?.id || "").trim();
              const isDeletingPublishedTask = deletingPublishedTaskId === item.id;

              return (
                <div key={item.id} className={teamCardCls + " font-inter"}>
                  <div className="flex items-stretch gap-2 min-w-0">
                    <div
                      className="flex h-7 max-w-7 shrink-0 self-center items-center overflow-hidden rounded-full bg-transparent transition-[max-width,background-color] duration-300 ease-out group-hover:max-w-[150px] group-hover:bg-black/[0.045] group-focus-within:max-w-[150px] group-focus-within:bg-black/[0.045]"
                      title={item.profiles?.full_name || "Participant"}
                    >
                      <img
                        src={getAvatar(item.profiles)}
                        className="w-7 h-7 rounded-full object-cover shrink-0"
                        alt=""
                      />
                      <span
                        className={
                          "min-w-0 max-w-0 overflow-hidden whitespace-nowrap pl-0 pr-0 text-[12px] font-semibold font-inter opacity-0 transition-[max-width,opacity,padding] duration-300 ease-out group-hover:max-w-[110px] group-hover:pl-2 group-hover:pr-2 group-hover:opacity-100 group-focus-within:max-w-[110px] group-focus-within:pl-2 group-focus-within:pr-2 group-focus-within:opacity-100 " +
                          nameCls
                        }
                      >
                        {item.profiles?.full_name || "Participant"}
                      </span>
                    </div>

                    <div className="flex min-h-8 flex-1 min-w-0 self-stretch flex-col justify-center">
                      <div className="flex min-w-0 items-start">
                        <span
                          className={
                            "min-w-0 flex-1 max-h-[18px] overflow-hidden whitespace-normal break-words text-[13px] leading-[18px] font-inter transition-[max-height] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[max-height] group-hover:max-h-40 group-focus-within:max-h-40 " +
                            (item.completed ? bodyDone : bodyActive)
                          }
                          title={item.text}
                        >
                          {item.text}
                        </span>
                      </div>

                      {renderTaskTimerControls({
                        ownerUserId: item.user_id,
                        text: item.text,
                        fallbackId: item.id,
                        sessionTaskId: item.id,
                        compact: true,
                      })}
                    </div>

                    <div className="shrink-0 self-center flex items-center gap-2">
                      <div
                        className={[
                          "h-8 w-8 rounded-full border text-[12px] font-medium inline-flex items-center justify-center shrink-0",
                          item.completed
                            ? "border-[#81DB86] text-[#81DB86] bg-[#81DB86]/10"
                            : "border-[#5286F6] text-[#5286F6] bg-[#5286F6]/10",
                        ].join(" ")}
                        title={statusText}
                        aria-label={statusText}
                      >
                        {item.completed ? (
                          <AnimatedTodoCheck completed size={17} />
                        ) : (
                          <TimerReset size={15} />
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (encouragementCount > 0 && (e.altKey || e.metaKey || e.ctrlKey)) {
                            setEncouragementModalTaskId(item.id);
                            return;
                          }
                          void toggleEncouragement(item.id);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (encouragementCount > 0) setEncouragementModalTaskId(item.id);
                        }}
                        className={[
                          "relative h-8 min-w-8 rounded-full border px-2 inline-flex items-center justify-center transition",
                          encouragedByMe
                            ? "border-[#CFC6C6] bg-[#E6E6E6]"
                            : "border-[#CFC6C6] bg-[#F3F1F1] hover:bg-[#ECEAEA]",
                        ].join(" ")}
                        title={
                          encouragementCount > 0
                            ? "Send encouragement. Double-click to see who sent it."
                            : "Send encouragement"
                        }
                        aria-label="Send encouragement"
                      >
                        <PanelSmartIcon
                          name="encouragement"
                          theme={panelTheme}
                          className="w-5 h-5"
                          alt="Encouragement"
                        />
                        {encouragementCount > 0 ? (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              setEncouragementModalTaskId(item.id);
                            }}
                            className="absolute -right-1 -bottom-1 min-w-[16px] h-[16px] rounded-full bg-[#252525] px-1 text-[10px] font-bold leading-[16px] text-white shadow-sm"
                            title="See who sent encouragement"
                          >
                            {encouragementCount > 99 ? "99+" : encouragementCount}
                          </span>
                        ) : null}
                      </button>

                      {isOwnPublishedTask ? (
                        <button
                          type="button"
                          disabled={isDeletingPublishedTask}
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteOwnPublishedTask(item);
                          }}
                          className="h-8 w-8 shrink-0 rounded-full bg-[#F3F1F1] text-black/55 transition inline-flex items-center justify-center hover:bg-[#F65252]/10 hover:text-[#F65252] disabled:cursor-wait disabled:opacity-45"
                          title="Delete published task"
                          aria-label="Delete published task"
                        >
                          {isDeletingPublishedTask ? (
                            <RefreshCw size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {ImportModal}
      {EncouragementModal}
      {AiPaywallModal}
      {AiSuggestionModal}
    </div>
  );

  return (
    <>
      {overlayOpen && overlayRef.current?.container
        ? createPortal(PanelUI, overlayRef.current.container)
        : null}

      {!overlayOpen ? (
        PanelUI
      ) : (
        <div
          className={
            "h-full flex items-center justify-center font-inter " + panelBg
          }
          onPointerDown={stopRoomBubbling}
          onMouseDown={stopRoomBubbling}
          onClick={stopRoomBubbling}
        >
          <div className="text-center font-inter">
            <div className={"text-[12px] font-inter " + titleText}>Pinned</div>
            <div className={"text-[12px] italic mt-1 font-inter " + mutedText}>
              Tasks are opened in a floating window.
            </div>
            <button
              type="button"
              onClick={closeOverlay}
              className={`
                mt-4 px-4 py-2 rounded-xl border
                ${"border-black/15 text-black/80 hover:bg-[#E8E8E8]"}
                transition inline-flex items-center gap-2 text-[13px] font-semibold font-inter
              `}
            >
              <PanelSmartIcon
                name="pin"
                theme={panelTheme}
                className="w-4 h-4"
                alt="Pin"
              />
              Unpin
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default TasksPanel;
