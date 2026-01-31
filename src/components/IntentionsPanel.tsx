// src/components/IntentionsPanel.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, MouseEvent as RMouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle,
  Circle,
  Trash2,
  Pencil,
  X,
  Check,
  Pin,
  PinOff,
  Timer,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useParams } from "react-router-dom";

type RoomTheme = "dark" | "light";

interface Intention {
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
}

type IntentionsPanelProps = {
  sessionId?: string; // UUID or slug
  theme?: RoomTheme;

  // Optional: if parent wants to hide panel in-layout
  onClose?: () => void;

  // Optional override: if you want bar to behave as infinite loop (otherwise auto-detect)
  forceLoop?: boolean;
};

// UUID matcher (slug vs uuid)
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---- Document Picture-in-Picture typings (Chromium) ----
type DocPiPWindow = Window & { document: Document; close: () => void };

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (opts?: { width?: number; height?: number }) => Promise<DocPiPWindow>;
    };
  }
}

function IconButton({
  title,
  onClick,
  children,
  className = "",
  theme = "dark",
}: {
  title: string;
  onClick: (e: RMouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
  theme?: RoomTheme;
}) {
  const isLight = theme === "light";
  const base = isLight
    ? "bg-black/5 hover:bg-black/10 text-black/70"
    : "bg-[#111827] hover:bg-[#1f2937] text-white/80";

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

function copyStylesToDocument(from: Document, to: Document) {
  try {
    const nodes = Array.from(
      from.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
        'style, link[rel="stylesheet"]'
      )
    );
    nodes.forEach((n) => {
      const clone = n.cloneNode(true) as any;
      to.head.appendChild(clone);
    });
  } catch {
    // ignore
  }
}

function safeParseSchedule(raw: any) {
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

/**
 * ✅ Parse ISO / unix seconds / unix ms (number-like strings).
 * Returns ms timestamp or null.
 */
function parseTimeMs(input: any): number | null {
  if (input == null) return null;

  if (input instanceof Date) {
    const t = input.getTime();
    return Number.isFinite(t) ? t : null;
  }

  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    const ms = input < 1e12 ? input * 1000 : input;
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof input === "string") {
    const s = input.trim();
    if (!s) return null;

    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) return null;
      const ms = n < 1e12 ? n * 1000 : n;
      return Number.isFinite(ms) ? ms : null;
    }

    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }

  return null;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * ✅ Robust duration resolver (same idea as SessionStageBar):
 * Supports:
 * - stage.durationSeconds / stage.seconds / stage.duration_seconds
 * - stage.duration / stage.minutes as minutes (legacy)
 */
function getStageSeconds(stage: any): number {
  const s =
    Number(stage?.durationSeconds) ||
    Number(stage?.duration_seconds) ||
    Number(stage?.seconds);

  if (Number.isFinite(s) && s > 0) return s;

  const mins = Number(stage?.duration ?? stage?.minutes ?? stage?.duration_minutes);
  if (Number.isFinite(mins) && mins > 0) return mins * 60;

  return 0;
}

type StageKind =
  | "welcome"
  | "intentions"
  | "focus"
  | "break"
  | "checkin"
  | "recap"
  | "celebrate"
  | "custom";

const KIND_META: Record<StageKind, { label: string; color: string }> = {
  welcome: { label: "Welcome", color: "#34D399" },
  intentions: { label: "Intentions", color: "#38BDF8" },
  focus: { label: "Focus", color: "#22C55E" },
  break: { label: "Break", color: "#3B82F6" },
  checkin: { label: "Check-in", color: "#38BDF8" },
  recap: { label: "Recap", color: "#A78BFA" },
  celebrate: { label: "Celebrate", color: "#F472B6" },
  custom: { label: "Custom", color: "#9CA3AF" },
};

function normalizeKind(raw: any): StageKind {
  const k = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  if (k === "check-in" || k === "checkin" || k === "check_in") return "checkin";
  if (k === "intention" || k === "intentions") return "intentions";
  if (k === "welcome") return "welcome";
  if (k === "focus") return "focus";
  if (k === "break") return "break";
  if (k === "recap") return "recap";
  if (k === "celebrate" || k === "celebration") return "celebrate";
  if (k === "custom") return "custom";
  return "custom";
}

function getStageKind(stage: any): StageKind {
  return normalizeKind(
    stage?.kind ??
    stage?.type ??
    stage?.stageKind ??
    stage?.stage_kind ??
    stage?.blockKind
  );
}

function getDisplayName(stage: any, kind: StageKind) {
  const name = String(
    stage?.title ??
    stage?.label ??
    stage?.displayName ??
    stage?.name ??
    ""
  ).trim();

  return name || KIND_META[kind].label;
}

function resolveStageColor(stage: any, kind: StageKind) {
  const raw = stage?.color;
  if (!raw) return KIND_META[kind].color;

  const s = String(raw).trim().toLowerCase();

  if (
    (s === "#4ca0ff" ||
      s === "rgb(76,160,255)" ||
      s === "rgba(76,160,255,1)") &&
    kind !== "focus"
  ) {
    return KIND_META[kind].color;
  }

  return raw;
}

function extractStagesFromSchedule(schedule: any): any[] {
  const sch = safeParseSchedule(schedule);
  if (!sch) return [];

  // 1) old group: array
  if (Array.isArray(sch)) return sch;

  // 2) infinite: { timer: { phases: [] } }
  if (sch?.timer?.phases && Array.isArray(sch.timer.phases)) return sch.timer.phases;

  // 3) other common shapes
  if (sch?.phases && Array.isArray(sch.phases)) return sch.phases;
  if (sch?.stages && Array.isArray(sch.stages)) return sch.stages;
  if (sch?.blocks && Array.isArray(sch.blocks)) return sch.blocks;

  return [];
}

function isInfiniteSchedule(schedule: any) {
  const sch = safeParseSchedule(schedule);
  if (!sch || typeof sch !== "object") return false;
  if ((sch as any)?.kind === "infinite_room") return true;
  if ((sch as any)?.timer?.kind === "infinite_room") return true;
  return false;
}

type SessionMeta = {
  id: string;
  start_time: string | null;
  duration_minutes: number | null;
  schedule: any;
  session_format_type?: string | null;
};

export function IntentionsPanel({
  sessionId: sessionIdProp,
  theme = "dark",
  onClose,
  forceLoop,
}: IntentionsPanelProps) {
  const { id: idOrSlugFromUrl } = useParams<{ id: string }>();
  const rawSessionId = (sessionIdProp || idOrSlugFromUrl || "").trim();

  const isLight = theme === "light";

  const [user, setUser] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [newIntention, setNewIntention] = useState("");
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");

  // avoid overlapping loads + stale updates
  const loadSeqRef = useRef(0);

  // ✅ session meta for timer
  const [sessionMeta, setSessionMeta] = useState<SessionMeta | null>(null);
  const [sessionMetaLoading, setSessionMetaLoading] = useState(false);

  // ✅ computed timer state (principle from SessionTimer + SessionStageBar)
  const [sessionStarted, setSessionStarted] = useState(false);
  const [timeLeftSec, setTimeLeftSec] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [stageProgress, setStageProgress] = useState(0);
  const [ended, setEnded] = useState(false);

  // ✅ overlay/pin
  const overlayRef = useRef<{ win: any; container: HTMLElement; kind: "pip" | "window" } | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);

  // tokens
  const mutedText = isLight ? "text-black/50" : "text-white/45";
  const divider = isLight ? "bg-black/10" : "bg-white/5";

  const panelBg = isLight ? "bg-white" : "bg-[#060B14]";
  const barBg = isLight ? "bg-white/95" : "bg-[#060B14]/95";
  const barBorder = isLight ? "border-black/10" : "border-white/10";

  const inputCls = isLight
    ? `
      bg-white border border-black/10 rounded-xl
      px-3 py-3 text-[13px] text-black/85 placeholder:text-black/35
      outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
    `
    : `
      bg-[#0B1220]/70 border border-white/10 rounded-xl
      px-3 py-3 text-[13px] text-white/85 placeholder:text-white/35
      outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
    `;

  const myCardCls = isLight
    ? "group rounded-xl border border-black/10 px-3 py-2.5 bg-white/70 hover:bg-white transition cursor-pointer"
    : "group rounded-xl border border-white/5 px-3 py-2.5 bg-[#0B1220]/55 hover:bg-[#0B1220]/75 transition cursor-pointer";

  const teamCardCls = isLight
    ? "rounded-xl border border-black/10 px-3 py-2.5 bg-white/70 hover:bg-white transition"
    : "rounded-xl border border-white/5 px-3 py-2.5 bg-[#0B1220]/55 hover:bg-[#0B1220]/75 transition";

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  // ✅ Resolve session UUID from prop/url (supports slug)
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
    `https://ui-avatars.com/api/?name=${encodeURIComponent(
      profile?.full_name || "User"
    )}`;

  const loadIntentions = useCallback(
    async (sid?: string | null) => {
      const s = String(sid || sessionId || "");
      if (!s) return;

      const seq = ++loadSeqRef.current;
      setLoading(true);

      try {
        const { data, error } = await supabase
          .from("intentions")
          .select(
            `id, text, user_id, session_id, created_at, completed,
             profiles ( full_name, avatar_url )`
          )
          .eq("session_id", s)
          .order("created_at", { ascending: false });

        if (seq !== loadSeqRef.current) return;
        if (!error) setIntentions((data as any) || []);
      } finally {
        if (seq === loadSeqRef.current) setLoading(false);
      }
    },
    [sessionId]
  );

  // ✅ Load session meta for timer (start_time, duration_minutes, schedule)
  const loadSessionMeta = useCallback(async (sid: string) => {
    setSessionMetaLoading(true);
    try {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, start_time, duration_minutes, schedule, session_format_type")
        .eq("id", sid)
        .maybeSingle();

      if (!error && data?.id) {
        setSessionMeta({
          id: String(data.id),
          start_time: (data as any)?.start_time ?? null,
          duration_minutes: (data as any)?.duration_minutes ?? null,
          schedule: (data as any)?.schedule ?? null,
          session_format_type: (data as any)?.session_format_type ?? null,
        });
      } else {
        setSessionMeta(null);
      }
    } finally {
      setSessionMetaLoading(false);
    }
  }, []);

  // ✅ Initial load + realtime intentions
  useEffect(() => {
    if (!sessionId) return;

    loadIntentions(sessionId);
    loadSessionMeta(sessionId);

    const channel = supabase
      .channel(`intentions_realtime_${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "intentions",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload: any) => {
          if (payload?.eventType === "DELETE") {
            const deletedId = payload?.old?.id;
            if (deletedId) {
              setIntentions((prev) => prev.filter((i) => i.id !== deletedId));
            } else {
              loadIntentions(sessionId);
            }
            return;
          }
          loadIntentions(sessionId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, loadIntentions, loadSessionMeta]);

  // ✅ Poll session meta (cheap) so timer stays correct even if start_time updated
  useEffect(() => {
    if (!sessionId) return;
    const t = window.setInterval(() => loadSessionMeta(sessionId), 15_000);
    return () => window.clearInterval(t);
  }, [sessionId, loadSessionMeta]);

  // ===== stages derived from schedule =====
  const stages = useMemo(() => {
    const schStages = extractStagesFromSchedule(sessionMeta?.schedule);
    if (!schStages?.length) return [];

    return schStages.map((s: any) => {
      const kind = getStageKind(s);
      const name = getDisplayName(s, kind);
      const color = resolveStageColor(s, kind);
      const seconds = Math.max(0, getStageSeconds(s));
      return { raw: s, kind, name, color, seconds };
    });
  }, [sessionMeta?.schedule]);

  const stageSecondsList = useMemo(() => stages.map((s) => s.seconds), [stages]);

  const totalStagesSeconds = useMemo(() => {
    const sum = stageSecondsList.reduce((acc, v) => acc + v, 0);
    return Math.max(1, sum);
  }, [stageSecondsList]);

  const inferredLoop = useMemo(() => {
    const metaLoop =
      String(sessionMeta?.session_format_type || "").toLowerCase() === "infinite" ||
      isInfiniteSchedule(sessionMeta?.schedule);

    if (typeof forceLoop === "boolean") return forceLoop;
    return metaLoop;
  }, [sessionMeta?.session_format_type, sessionMeta?.schedule, forceLoop]);

  const totalSessionSeconds = useMemo(() => {
    const dmin = Number(sessionMeta?.duration_minutes);
    const fromDuration = Number.isFinite(dmin) && dmin > 0 ? Math.round(dmin * 60) : 0;

    // If duration missing, fallback to stages sum
    return fromDuration > 0 ? fromDuration : totalStagesSeconds;
  }, [sessionMeta?.duration_minutes, totalStagesSeconds]);

  // ✅ Timer tick (principle from SessionTimer + StageBar)
  useEffect(() => {
    const startMs = parseTimeMs(sessionMeta?.start_time);
    const hasStart = !!startMs;

    const tick = () => {
      const now = Date.now();

      // If no start_time: treat as started (use elapsed=0)
      const diff = hasStart ? Math.floor((now - (startMs as number)) / 1000) : 0;
      const elapsed = Number.isFinite(diff) ? diff : 0;

      setElapsedSec(elapsed);

      if (hasStart && elapsed < 0) {
        // starts in
        setSessionStarted(false);
        setEnded(false);
        setTimeLeftSec(-elapsed);
        setCurrentStageIndex(0);
        setStageProgress(0);
        return;
      }

      // started
      setSessionStarted(true);

      // session end only for non-loop sessions
      const endedNow = !inferredLoop && elapsed >= totalSessionSeconds;
      setEnded(endedNow);

      if (inferredLoop) {
        // cycle countdown
        const loopSec = totalStagesSeconds > 0 ? totalStagesSeconds : 1;
        const norm = ((elapsed % loopSec) + loopSec) % loopSec;
        const left = Math.max(0, loopSec - norm);
        setTimeLeftSec(left);
      } else {
        const left = Math.max(0, totalSessionSeconds - Math.max(0, elapsed));
        setTimeLeftSec(left);
      }

      // compute current stage index + progress
      if (!stages.length) {
        setCurrentStageIndex(0);
        setStageProgress(0);
        return;
      }

      const loopSec = totalStagesSeconds > 0 ? totalStagesSeconds : 1;
      const raw = Math.max(0, elapsed);

      const normalized = inferredLoop
        ? ((raw % loopSec) + loopSec) % loopSec
        : clamp(raw, 0, Math.max(0, totalSessionSeconds));

      // walk cumulative
      let total = 0;
      let idx = 0;
      let prog = 0;

      const firstNonZero = stageSecondsList.findIndex((x) => x > 0);
      if (firstNonZero >= 0) idx = firstNonZero;

      for (let i = 0; i < stages.length; i++) {
        const dur = stageSecondsList[i] || 0;
        if (dur <= 0) continue;

        const nextTotal = total + dur;

        if (normalized < nextTotal) {
          idx = i;
          const stageElapsed = normalized - total;
          prog = clamp(stageElapsed / dur, 0, 1);
          break;
        }

        total = nextTotal;
        idx = i;
      }

      setCurrentStageIndex(idx);
      setStageProgress(Number.isFinite(prog) ? prog : 0);
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [
    sessionMeta?.start_time,
    inferredLoop,
    totalSessionSeconds,
    totalStagesSeconds,
    stages.length,
    stageSecondsList,
  ]);

  const currentStage = useMemo(() => {
    if (!stages.length) return null;
    const s = stages[currentStageIndex];
    return s || null;
  }, [stages, currentStageIndex]);

  const overallProgressPct = useMemo(() => {
    if (inferredLoop) {
      // show progress inside cycle
      const loopSec = totalStagesSeconds > 0 ? totalStagesSeconds : 1;
      const norm = ((Math.max(0, elapsedSec) % loopSec) + loopSec) % loopSec;
      return clamp((norm / loopSec) * 100, 0, 100);
    }
    const denom = Math.max(1, totalSessionSeconds);
    return clamp(((denom - timeLeftSec) / denom) * 100, 0, 100);
  }, [inferredLoop, totalStagesSeconds, elapsedSec, totalSessionSeconds, timeLeftSec]);

  // ===== intentions UI memo =====
  const myIntentions = useMemo(
    () => intentions.filter((i) => i.user_id === user?.id),
    [intentions, user?.id]
  );

  const teamIntentions = useMemo(() => intentions, [intentions]);

  const handleAddIntention = async () => {
    if (!newIntention.trim() || !user || !sessionId) return;

    const text = newIntention.trim();
    setNewIntention("");

    const optimisticId = `optimistic-${Date.now()}`;
    setIntentions((prev) => [
      {
        id: optimisticId,
        text,
        user_id: user.id,
        session_id: sessionId,
        completed: false,
        created_at: new Date().toISOString(),
        profiles: { full_name: "You", avatar_url: undefined },
      },
      ...prev,
    ]);

    const { error } = await supabase.from("intentions").insert([
      { user_id: user.id, session_id: sessionId, text, completed: false },
    ]);

    if (error) {
      setIntentions((prev) => prev.filter((i) => i.id !== optimisticId));
      return;
    }

    loadIntentions(sessionId);
  };

  const toggleCompleted = async (intention: Intention) => {
    if (editingId === intention.id) return;
    if (!sessionId) return;

    const next = !Boolean(intention.completed);

    setIntentions((prev) =>
      prev.map((i) => (i.id === intention.id ? { ...i, completed: next } : i))
    );

    const { error } = await supabase
      .from("intentions")
      .update({ completed: next })
      .eq("id", intention.id);

    if (error) {
      setIntentions((prev) =>
        prev.map((i) =>
          i.id === intention.id ? { ...i, completed: !next } : i
        )
      );
    }
  };

  const handleDelete = async (id: string) => {
    if (!sessionId) return;

    const prev = intentions;
    setIntentions((curr) => curr.filter((i) => i.id !== id));

    const { error } = await supabase.from("intentions").delete().eq("id", id);
    if (error) setIntentions(prev);
  };

  const startEdit = (i: Intention) => {
    setEditingId(i.id);
    setEditingText(i.text || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (!sessionId) return;

    const text = editingText.trim();
    if (!text) return;

    const old = intentions.find((i) => i.id === editingId)?.text || "";
    setIntentions((prev) =>
      prev.map((i) => (i.id === editingId ? { ...i, text } : i))
    );

    const { error } = await supabase
      .from("intentions")
      .update({ text })
      .eq("id", editingId);

    if (error) {
      setIntentions((prev) =>
        prev.map((i) => (i.id === editingId ? { ...i, text: old } : i))
      );
      return;
    }

    setEditingId(null);
    setEditingText("");
  };

  // =========================
  // ✅ Pin / Overlay functions
  // =========================
  const closeOverlay = useCallback(() => {
    const o = overlayRef.current;
    overlayRef.current = null;
    setOverlayOpen(false);

    try {
      o?.win?.close?.();
    } catch {
      // ignore
    }
  }, []);

  const openOverlay = useCallback(async () => {
    if (overlayRef.current) return;

    const canPip = !!window.documentPictureInPicture?.requestWindow;

    try {
      if (canPip) {
        const pipWin = await window.documentPictureInPicture!.requestWindow({
          width: 420,
          height: 740,
        });

        pipWin.document.title = "Intentions";
        pipWin.document.body.style.margin = "0";
        pipWin.document.body.style.background = isLight ? "#ffffff" : "#060B14";

        copyStylesToDocument(document, pipWin.document);

        const container = pipWin.document.createElement("div");
        container.style.height = "100vh";
        container.style.width = "100vw";
        pipWin.document.body.appendChild(container);

        overlayRef.current = { win: pipWin, container, kind: "pip" };
        setOverlayOpen(true);

        pipWin.addEventListener("pagehide", closeOverlay);
        pipWin.addEventListener("beforeunload", closeOverlay);
        return;
      }

      const w = window.open(
        "",
        "mysession_intentions",
        "popup,width=420,height=740"
      );

      if (!w) return;

      w.document.title = "Intentions";
      w.document.body.style.margin = "0";
      w.document.body.style.background = isLight ? "#ffffff" : "#060B14";

      copyStylesToDocument(document, w.document);

      const container = w.document.createElement("div");
      container.style.height = "100vh";
      container.style.width = "100vw";
      w.document.body.appendChild(container);

      overlayRef.current = { win: w, container, kind: "window" };
      setOverlayOpen(true);

      w.addEventListener("beforeunload", closeOverlay);
    } catch {
      // ignore
    }
  }, [closeOverlay, isLight]);

  useEffect(() => {
    return () => {
      try {
        closeOverlay();
      } catch {
        // ignore
      }
    };
  }, [closeOverlay]);

  // ✅ Close button handler (single row with Pin + Close)
  const handleCloseClick = useCallback(() => {
    if (overlayOpen) {
      closeOverlay();
      return;
    }
    onClose?.();
  }, [overlayOpen, closeOverlay, onClose]);

  // =========================
  // Session not resolved yet
  // =========================
  if (!rawSessionId) {
    return (
      <div className={"h-full flex items-center justify-center " + panelBg}>
        <div className={"text-[12px] italic " + mutedText}>No session id</div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className={"h-full flex items-center justify-center " + panelBg}>
        <div className={"text-[12px] italic " + mutedText}>
          Resolving session...
        </div>
      </div>
    );
  }

  // =========================
  // Top bar (ONE header only)
  // =========================
  const label = useMemo(() => {
    if (ended) return "Session ended";
    if (!sessionStarted) return "Session starts in";
    if (inferredLoop) return "Cycle ends in";
    return "Time remaining";
  }, [ended, sessionStarted, inferredLoop]);

  const stagePillCls = isLight
    ? "bg-black/5 border border-black/10 text-black/80"
    : "bg-white/5 border border-white/10 text-white/80";

  // =========================
  // Stage chips row (like SessionTimer)
  // =========================
  const chips = useMemo(() => {
    if (!stages.length) return [];
    return stages.map((s, idx) => {
      const isActive = idx === currentStageIndex;
      const isPast = idx < currentStageIndex;

      // small color logic (active uses stage color, past gray)
      const bg = isActive
        ? (typeof s.color === "string" ? s.color : KIND_META[s.kind].color)
        : isPast
          ? (isLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.18)")
          : (isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)");

      const fg = isActive ? "#fff" : isLight ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.65)";

      const mins = s.seconds ? Math.max(1, Math.round(s.seconds / 60)) : 0;

      return {
        idx,
        title: `${s.name}${mins ? ` • ${mins}m` : ""}`,
        bg,
        fg,
        isActive,
      };
    });
  }, [stages, currentStageIndex, isLight]);

  // =========================
  // Panel UI (inline + portal)
  // =========================
  const PanelUI = (
    <div className={"h-full flex flex-col min-h-0 " + panelBg}>
      {/* ONE bar: timer + stage + buttons row */}
      <div className={"shrink-0 px-4 pt-4 pb-3 border-b " + barBorder + " " + barBg}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <div className="min-w-0">
              <div className={"text-[12px] " + mutedText}>{label}</div>
              <div className={"flex items-center gap-2 mt-1"}>
                <Timer size={18} className={isLight ? "text-black/70" : "text-white/70"} />
                <div
                  className={
                    "text-[18px] font-semibold tabular-nums " +
                    (isLight ? "text-black/85" : "text-white/85")
                  }
                >
                  {formatTime(timeLeftSec)}
                </div>
              </div>
            </div>

            {currentStage && stages.length > 0 && (
              <div className={"ml-1 inline-flex items-center gap-2 px-3 py-2 rounded-xl border " + stagePillCls}>
                <span className="text-[12px] font-semibold">
                  {currentStage.name}
                </span>
                <span className={mutedText + " text-[12px]"}>
                  {Math.max(1, Math.round((currentStage.seconds || 0) / 60))}m
                </span>
              </div>
            )}
          </div>

          {/* ✅ All buttons in ONE row (Pin + Close) */}
          <div className="flex items-center gap-2 shrink-0">
            {!overlayOpen ? (
              <IconButton
                theme={theme}
                title="Pin (always-on-top if supported)"
                onClick={(e) => {
                  e.preventDefault();
                  openOverlay();
                }}
              >
                <Pin size={16} />
              </IconButton>
            ) : (
              <IconButton
                theme={theme}
                title="Unpin"
                onClick={(e) => {
                  e.preventDefault();
                  closeOverlay();
                }}
              >
                <PinOff size={16} />
              </IconButton>
            )}

            <IconButton
              theme={theme}
              title={overlayOpen ? "Close window" : "Close"}
              onClick={(e) => {
                e.preventDefault();
                handleCloseClick();
              }}
              className={isLight ? "hover:text-black" : "hover:text-white"}
            >
              <X size={18} />
            </IconButton>
          </div>
        </div>

        {/* Stage chips row */}
        {stages.length > 0 && (
          <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
            {chips.map((c) => (
              <div
                key={c.idx}
                className="px-3 py-2 rounded-lg text-[11px] font-semibold flex-shrink-0"
                style={{ background: c.bg, color: c.fg }}
                title={c.title}
              >
                {c.title}
              </div>
            ))}
          </div>
        )}

        {/* Progress bar */}
        <div className={isLight ? "mt-3 w-full bg-black/10 rounded-full h-2" : "mt-3 w-full bg-white/10 rounded-full h-2"}>
          <div
            className="h-2 rounded-full transition-all duration-1000"
            style={{
              width: `${overallProgressPct}%`,
              background: isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.65)",
            }}
          />
        </div>

        {(sessionMetaLoading || !sessionMeta) && (
          <div className={"text-[11px] mt-2 " + mutedText}>
            {sessionMetaLoading ? "Loading session timer..." : "Timer data unavailable"}
          </div>
        )}
      </div>

      {/* content */}
      <div className="p-4 min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        {/* My intentions */}
        <div className="mb-5">
          <div
            className={
              (isLight ? "text-black/85" : "text-white/85") +
              " font-inter font-semibold text-[13px] mb-3"
            }
          >
            My intentions
          </div>

          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={newIntention}
              onChange={(e) => setNewIntention(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddIntention()}
              placeholder="Add an intention..."
              className={"flex-1 " + inputCls}
            />

            <button
              onClick={handleAddIntention}
              className="
                h-11 px-4 rounded-xl
                bg-emerald-500 hover:bg-emerald-600
                text-[#02140B] font-semibold text-[13px]
              "
              type="button"
              title="Add"
            >
              Add
            </button>
          </div>

          {loading ? (
            <div className={"text-[12px] italic " + mutedText}>Loading...</div>
          ) : myIntentions.length === 0 ? (
            <div className={"text-[12px] italic " + mutedText}>
              No intentions yet
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {myIntentions.map((i) => {
                const isEditing = editingId === i.id;

                const circleCls = isLight ? "text-black/40" : "text-white/45";
                const textDoneCls = isLight
                  ? "text-black/45 line-through"
                  : "text-white/50 line-through";
                const textActiveCls = isLight
                  ? "text-black/80"
                  : "text-white/80";

                const editInputCls = isLight
                  ? `
                    w-full bg-white border border-black/10 rounded-xl
                    px-3 py-2 text-[13px] text-black/85
                    outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
                  `
                  : `
                    w-full bg-[#0B1220]/80 border border-white/10 rounded-xl
                    px-3 py-2 text-[13px] text-white/85
                    outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
                  `;

                return (
                  <div
                    key={i.id}
                    onClick={() => toggleCompleted(i)}
                    className={myCardCls}
                  >
                    <div className="flex items-center gap-2">
                      <div className="shrink-0">
                        {i.completed ? (
                          <CheckCircle size={18} className="text-emerald-500" />
                        ) : (
                          <Circle size={18} className={circleCls} />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {!isEditing ? (
                          <div
                            className={
                              "text-[13px] break-words leading-5 " +
                              (i.completed ? textDoneCls : textActiveCls)
                            }
                          >
                            {i.text}
                          </div>
                        ) : (
                          <input
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                            className={editInputCls}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {!isEditing ? (
                          <>
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <IconButton
                                theme={theme}
                                title="Edit"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEdit(i);
                                }}
                              >
                                <Pencil size={16} />
                              </IconButton>
                            </div>

                            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <IconButton
                                theme={theme}
                                title="Delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(i.id);
                                }}
                                className="hover:text-red-500"
                              >
                                <Trash2 size={16} />
                              </IconButton>
                            </div>
                          </>
                        ) : (
                          <>
                            <IconButton
                              theme={theme}
                              title="Save"
                              onClick={(e) => {
                                e.stopPropagation();
                                saveEdit();
                              }}
                              className="hover:text-emerald-600"
                            >
                              <Check size={18} />
                            </IconButton>

                            <IconButton
                              theme={theme}
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
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={"h-px my-5 " + divider} />

        {/* Team intentions */}
        <div
          className={
            (isLight ? "text-black/85" : "text-white/85") +
            " font-inter font-semibold text-[13px] mb-3"
          }
        >
          Team intentions
        </div>

        {loading ? (
          <div className={"text-[12px] italic " + mutedText}>Loading...</div>
        ) : teamIntentions.length === 0 ? (
          <div className={"text-[12px] italic " + mutedText}>
            No team intentions
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {teamIntentions.map((item) => {
              const isMine = item.user_id === user?.id;
              const nameCls = isLight ? "text-black/85" : "text-white/85";
              const bodyActive = isLight ? "text-black/75" : "text-white/75";
              const bodyDone = isLight
                ? "text-black/45 line-through"
                : "text-white/50 line-through";
              const circleCls = isLight ? "text-black/30" : "text-white/30";

              return (
                <div key={item.id} className={teamCardCls}>
                  <div className="flex items-center gap-3">
                    <img
                      src={getAvatar(item.profiles)}
                      className="w-9 h-9 rounded-full object-cover"
                      alt=""
                    />

                    <div className="flex-1 min-w-0">
                      <div
                        className={"text-[13px] font-medium truncate " + nameCls}
                      >
                        {isMine
                          ? "You"
                          : item.profiles?.full_name || "Participant"}
                      </div>

                      <div
                        className={
                          "text-[13px] break-words leading-5 " +
                          (item.completed ? bodyDone : bodyActive)
                        }
                      >
                        {item.text}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {item.completed ? (
                        <CheckCircle size={16} className="text-emerald-500" />
                      ) : (
                        <Circle size={16} className={circleCls} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // If pinned: render portal into PiP/popout; inline shows a small “pinned” bar is NOT needed -> we just render nothing extra.
  return (
    <>
      {overlayOpen && overlayRef.current?.container
        ? createPortal(PanelUI, overlayRef.current.container)
        : null}

      {!overlayOpen ? PanelUI : null}
    </>
  );
}

export default IntentionsPanel;
