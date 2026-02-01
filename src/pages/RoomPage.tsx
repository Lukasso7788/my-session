// src/pages/RoomPage.tsx
// ROOMPAGE + JITSI ENGINE + VIDEO UI (FIXED)
// ✅ Fix: grid row must be minmax(0,1fr) (grid-rows-1) so right panel content (Chat) can't grow the page -> video tiles won't "fall down"
// ✅ Fix: enforce h-full/min-h-0 chain on BOTH grid items (video + right panel) + overflow-hidden on desktop panel wrapper
// ✅ Fix: propagate theme to html + body AND data-theme + color-scheme so Chat/Intentions can reliably pick it up
// ✅ Fix: kick layout recalculation when right panel toggles (dispatch resize) + ResizeObserver hook for container changes
// ✅ Fix: remove "double header" for chat (keep only close button row; also pass embedded/hideHeader props defensively)

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { IntentionsPanel } from "../components/IntentionsPanel";
import ChatPanel from "../components/ChatPanel";
import { SessionStageBar } from "../components/SessionStageBar";
import { supabase } from "../lib/supabase";
import { UserProfileModal } from "../components/UserProfileModal";
import { JitsiEngine, JitsiParticipant } from "../lib/jitsiEngine";
import { VideoRoom } from "../components/VideoRoom";
import type { ReactionType } from "../components/VideoRoom";
import {
  RoomMediaSettingsModal,
  RoomMediaSettings,
} from "../components/RoomMediaSettingsModal";
import { useAttendancePresence } from "../hooks/useAttendancePresence";

type Stage = {
  name: string;
  duration: number; // minutes (display / legacy)
  color: string;
  type: "intro" | "intentions" | "focus" | "break" | "outro" | string;
  durationSeconds?: number; // preferred when present
};

type RightPanelTab = "participants" | "chat" | "intentions" | null;
type RoomTheme = "dark" | "light";

type HostProfile = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  bio?: string | null;
};

type SessionTemplate = {
  name?: string | null;
  title?: string | null;
  key?: string | null;
  slug?: string | null;
  type?: string | null;
  format?: string | null;
};

type SessionRow = {
  id: string;
  title: string;
  schedule: unknown;
  format?: string | null;
  start_time?: string | null;
  created_at?: string | null;
  jitsi_room_name?: string | null;
  daily_room_url?: string | null;
  host_profile?: HostProfile | null;
  session_templates?: SessionTemplate | SessionTemplate[] | null;
};

type MediaDevicesResult = {
  videoInputs: MediaDeviceInfo[];
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
};

type BackgroundPrefs = {
  mode: "blur" | "image" | "none";
  imageUrl?: string;
};

type InputDevices = {
  videoInputId: string;
  audioInputId: string;
};

/**
 * JitsiEngine in your lib can have extra methods (devices/bg/audio output/reactions).
 * We model them here without using `any`.
 */
type JitsiEngineExt = JitsiEngine & {
  listMediaDevices?: () => Promise<Partial<MediaDevicesResult> | null | undefined>;
  applyInputDevices?: (devices: InputDevices) => Promise<void>;
  setBackgroundPrefs?: (prefs: BackgroundPrefs) => void;
  setBackgroundEffect?: (prefs: BackgroundPrefs) => Promise<void>;
  setAudioOutputDevice?: (id: string) => Promise<void> | void;
  sendReaction?: (type: ReactionType) => void;
  registerVideoElement?: (pid: string, el: HTMLVideoElement, kind: string) => void;
  setVisibleVideoParticipants?: (ids: string[]) => void;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function Icon({
  name,
  theme,
  className = "w-5 h-5",
  alt = "",
}: {
  name:
  | "mic-on"
  | "mic-off"
  | "camera-on"
  | "camera-off"
  | "screen-share"
  | "reaction"
  | "leave"
  | "participants"
  | "chat"
  | "intentions"
  | "settings"
  | "theme-sun"
  | "theme-moon"
  | "timer"
  | "host_session_icon";
  theme: RoomTheme;
  className?: string;
  alt?: string;
}) {
  const themedSrc = `/icons/${name}-${theme}.svg`;
  const fallbackSrc = `/icons/${name}.svg`;

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

const reactionEmoji: Record<ReactionType, string> = {
  fire: "🔥",
  laugh: "😂",
  clap: "👏",
  heart: "❤️",
  thumbsUp: "👍",
  thumbsDown: "👎",
};

// ✅ helpers for infinite schedule parsing
function safeParseJson(raw: unknown): unknown | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s || s === "undefined" || s === "null") return null;
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return null;
    }
  }
  return raw;
}

/** ✅ parse "50/5/5" (or "50-5-5") schedule stored as a string. */
function parse50505(
  raw: unknown
): { focus: number; break: number; intentions: number } | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const m1 = s.match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/);
  const m2 = s.match(/^(\d+)\s*-\s*(\d+)\s*-\s*(\d+)$/);
  const m = m1 || m2;
  if (!m) return null;

  const focus = Number(m[1]);
  const br = Number(m[2]);
  const intentions = Number(m[3]);

  if (!Number.isFinite(focus) || !Number.isFinite(br) || !Number.isFinite(intentions)) return null;
  if (focus <= 0 || br <= 0 || intentions <= 0) return null;

  return { focus, break: br, intentions };
}

function normalizeInfinitePhases(anyPhases: unknown): { name: string; seconds: number }[] {
  if (!anyPhases) return [];

  const toSeconds = (raw: unknown): number => {
    if (isRecord(raw)) {
      const explicitSeconds =
        num(raw.seconds) || num(raw.duration_seconds) || num(raw.durationSeconds);
      if (explicitSeconds > 0) return explicitSeconds;

      const explicitMinutes =
        num(raw.minutes) || num(raw.mins) || num(raw.duration_minutes) || num(raw.durationMinutes);
      if (explicitMinutes > 0) return explicitMinutes * 60;

      const n = num(raw.duration ?? raw.value ?? raw);
      if (!Number.isFinite(n) || n <= 0) return 0;

      if (n <= 180) return n * 60; // assume minutes
      return n; // assume seconds
    }

    const n = num(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n <= 180) return n * 60;
    return n;
  };

  if (Array.isArray(anyPhases)) {
    return anyPhases
      .map((p) => {
        const name = isRecord(p) ? str(p.name || p.key || p.type) : "";
        const seconds = toSeconds(p);
        return { name, seconds };
      })
      .filter((x) => x.seconds > 0);
  }

  if (isRecord(anyPhases)) {
    return Object.entries(anyPhases)
      .map(([k, v]) => {
        const name = String(k || "");
        const seconds =
          typeof v === "number"
            ? v <= 180
              ? Number(v) * 60
              : Number(v)
            : toSeconds(v);
        return { name, seconds };
      })
      .filter((x) => x.seconds > 0);
  }

  return [];
}

function phaseToStageType(phaseNameLower: string): Stage["type"] {
  if (phaseNameLower.includes("focus")) return "focus";
  if (phaseNameLower.includes("checkin") || phaseNameLower.includes("intention")) return "intentions";
  if (phaseNameLower.includes("break") || phaseNameLower.includes("rest")) return "break";
  return "focus";
}

const STAGE_COLORS: Record<string, string> = {
  intro: "#80DF86",
  intentions: "#ADD3FF",
  focus: "#4CA0FF",
  break: "#F9ADA2",
  outro: "#80DF86",
};

const MEDIA_SETTINGS_KEY = "mysession_media_settings_v1";

function loadStoredMediaSettings(): RoomMediaSettings | null {
  try {
    const raw = localStorage.getItem(MEDIA_SETTINGS_KEY);
    if (!raw) return null;

    const objUnknown: unknown = JSON.parse(raw);
    if (!isRecord(objUnknown)) return null;

    const bgModeRaw = str(objUnknown.bgMode).toLowerCase();
    const bgMode: RoomMediaSettings["bgMode"] =
      bgModeRaw === "blur" || bgModeRaw === "image" || bgModeRaw === "none"
        ? (bgModeRaw as RoomMediaSettings["bgMode"])
        : "none";

    return {
      videoInputId: str(objUnknown.videoInputId || ""),
      audioInputId: str(objUnknown.audioInputId || ""),
      audioOutputId: str(objUnknown.audioOutputId || "default") || "default",
      bgMode,
      bgImageUrl: objUnknown.bgImageUrl ? str(objUnknown.bgImageUrl) : undefined,
    };
  } catch {
    return null;
  }
}

function saveStoredMediaSettings(s: RoomMediaSettings) {
  try {
    localStorage.setItem(MEDIA_SETTINGS_KEY, JSON.stringify(s));
  } catch { }
}

function getTemplateFirst(tpl: SessionRow["session_templates"]): SessionTemplate | null {
  if (!tpl) return null;
  return Array.isArray(tpl) ? tpl[0] ?? null : tpl;
}

export function RoomPage() {
  const [theme, setTheme] = useState<RoomTheme>(() => {
    try {
      const v = String(localStorage.getItem("room_theme") || "").toLowerCase();
      return v === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });

  // persist theme
  useEffect(() => {
    try {
      localStorage.setItem("room_theme", theme);
    } catch { }
  }, [theme]);

  // ✅ CRITICAL: propagate theme to html + body (tailwind class-based dark mode)
  // ✅ Also set data-theme + color-scheme (some components read it)
  useEffect(() => {
    try {
      const root = document.documentElement;
      const body = document.body;

      const isDark = theme === "dark";

      root.classList.toggle("dark", isDark);
      body.classList.toggle("dark", isDark);

      root.setAttribute("data-theme", theme);
      body.setAttribute("data-theme", theme);

      // helpful for inputs/scrollbars and some UI libs
      (root.style as unknown as { colorScheme?: string }).colorScheme = theme;
      (body.style as unknown as { colorScheme?: string }).colorScheme = theme;
    } catch { }
  }, [theme]);

  const isLight = theme === "light";

  // theme tokens (RoomPage layout)
  const pageBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
  const topBarBg = isLight
    ? "bg-white/85 border border-black/10"
    : "bg-[#111827]/40 border border-white/5";
  const chipBg = isLight
    ? "bg-black/5 border border-black/10"
    : "bg-[#0B1220]/70 border border-white/5";
  const subtleText = isLight ? "text-black/55" : "text-[#9CA3AF]";
  const strongText = isLight ? "text-black/85" : "text-[#F3F4F6]/90";
  const panelBg = isLight
    ? "bg-white/85 border border-black/10"
    : "bg-[#0B1220]/55 border border-white/5";
  const bottomBarBg = isLight
    ? "bg-white/85 border border-black/10"
    : "bg-[#07101E]/85 border border-white/10";
  const ctlBtnBase = isLight ? "bg-black/5 hover:bg-black/10" : "bg-[#111827] hover:bg-[#1f2937]";

  const [settingsOpen, setSettingsOpen] = useState(false);

  const [devices, setDevices] = useState<MediaDevicesResult>({
    videoInputs: [],
    audioInputs: [],
    audioOutputs: [],
  });

  const [mediaSettings, setMediaSettings] = useState<RoomMediaSettings>(() => {
    const stored = loadStoredMediaSettings();
    return (
      stored || {
        videoInputId: "",
        audioInputId: "",
        audioOutputId: "default",
        bgMode: "none",
        bgImageUrl: undefined,
      }
    );
  });

  // ✅ keep latest settings in ref without triggering Jitsi init effect
  const mediaSettingsRef = useRef<RoomMediaSettings>(mediaSettings);
  useEffect(() => {
    mediaSettingsRef.current = mediaSettings;
  }, [mediaSettings]);

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionRow | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState<string>(() => {
    try {
      return loadStoredMediaSettings()?.audioOutputId || "default";
    } catch {
      return "default";
    }
  });

  const [stages, setStages] = useState<Stage[]>([]);
  const [hoveredStage, setHoveredStage] = useState<Stage | null>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const [remainingTime, setRemainingTime] = useState<string>("");

  // stagebar start + infinite cycle
  const [stagebarStartTime, setStagebarStartTime] = useState<string>("");
  const [stagebarCycleSeconds, setStagebarCycleSeconds] = useState<number | undefined>(undefined);

  const [selectedUser, setSelectedUser] = useState<HostProfile | null>(null);

  const [userName, setUserName] = useState<string>("");
  const [lastErr, setLastErr] = useState<string>("");
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  const engineRef = useRef<JitsiEngine | null>(null);
  const [participants, setParticipants] = useState<JitsiParticipant[]>([]);

  // SOUND WHEN USER JOINS
  const prevCountRef = useRef<number>(0);

  // TRACK SCREEN SHARER
  const [activeScreenSharer, setActiveScreenSharer] = useState<string | null>(null);

  // REACTIONS
  const [incomingReactions, setIncomingReactions] = useState<{ id: number; type: ReactionType }[]>([]);
  const reactionIdRef = useRef<number>(0);

  const [localReactions, setLocalReactions] = useState<{ id: number; type: ReactionType }[]>([]);
  const localReactionIdRef = useRef<number>(0);

  // AUDIO
  const prevStageRef = useRef<number>(-1);
  const firstTickDoneRef = useRef<boolean>(false);
  const welcomeLoopRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef<boolean>(false);

  const STAGE_SOUND_MAP: Record<string, string> = {
    intentions: "/sounds/intentions.mp3",
    focus: "/sounds/focus.mp3",
    break: "/sounds/break_start.mp3",
    outro: "/sounds/outro.mp3",
  };

  const BREAK_END_SOUND = "/sounds/break_end.mp3";
  const WELCOME_LOOP_SOUND = "/sounds/welcome_loop.mp3";

  // RIGHT PANEL
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(false);
  const [rightTab, setRightTab] = useState<RightPanelTab>(null);

  const openRightTab = (tab: RightPanelTab) => {
    if (!tab) {
      setRightPanelOpen(false);
      setRightTab(null);
      return;
    }

    setRightTab((prevTab) => {
      const same = prevTab === tab;
      setRightPanelOpen((prevOpen) => (same ? !prevOpen : true));
      return tab;
    });
  };

  // ✅ Layout recalculation: when panel toggles, some video layouts only recompute on resize
  useEffect(() => {
    const fire = () => {
      try {
        window.dispatchEvent(new Event("resize"));
      } catch { }
    };

    // rAF + a couple delayed kicks for CSS grid settling
    requestAnimationFrame(fire);
    const t1 = window.setTimeout(fire, 60);
    const t2 = window.setTimeout(fire, 220);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [rightPanelOpen, rightTab]);

  // detect infinite room
  const isInfiniteRoom = useMemo(() => {
    const raw = session?.schedule;
    if (parse50505(raw)) return true;

    const parsed = safeParseJson(raw);
    if (!isRecord(parsed)) return false;

    const kind = str(parsed.kind).toLowerCase();
    if (kind === "infinite_room") return true;
    if (kind.includes("infinite")) return true;

    if (isRecord(parsed.timer) && (parsed.timer.phases || parsed.timer.segments)) return true;
    if (parsed.phases || parsed.segments) return true;

    return false;
  }, [session]);

  // SILENT ROOM DETECTION
  const isSilentRoom = useMemo(() => {
    const fmt = str(session?.format).toLowerCase();
    const title = str(session?.title).toLowerCase();

    const tpl0 = getTemplateFirst(session?.session_templates ?? null);
    const tplName = str(tpl0?.name || tpl0?.title).toLowerCase();
    const tplKey = str(tpl0?.key || tpl0?.slug || tpl0?.type).toLowerCase();
    const tplFmt = str(tpl0?.format).toLowerCase();

    const hay = `${fmt} ${title} ${tplName} ${tplKey} ${tplFmt}`.toLowerCase();
    return hay.includes("silent");
  }, [session]);

  // UNLOCK AUDIO
  useEffect(() => {
    const unlock = () => {
      if (audioUnlockedRef.current) return;
      const a = new Audio();
      a.play().catch(() => { });
      audioUnlockedRef.current = true;
      window.removeEventListener("click", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("touchstart", unlock, true);
    };

    window.addEventListener("click", unlock, true);
    window.addEventListener("keydown", unlock, true);
    window.addEventListener("touchstart", unlock, true);

    return () => {
      window.removeEventListener("click", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("touchstart", unlock, true);
    };
  }, []);

  const playOneShot = (url: string, volume = 0.9) => {
    if (!url) return;
    const a = new Audio(url);
    a.volume = volume;
    a.play().catch(() => { });
  };

  const startWelcomeLoop = () => {
    stopWelcomeLoop();
    const a = new Audio(WELCOME_LOOP_SOUND);
    a.loop = true;
    a.volume = 0.6;
    welcomeLoopRef.current = a;
    a.play().catch(() => { });
  };

  const stopWelcomeLoop = () => {
    try {
      if (welcomeLoopRef.current) {
        welcomeLoopRef.current.pause();
        welcomeLoopRef.current.currentTime = 0;
        welcomeLoopRef.current = null;
      }
    } catch { }
  };

  // DEVICES
  const loadDevices = async () => {
    try {
      const engineBase = engineRef.current;
      if (!engineBase) return;

      const engine = engineBase as unknown as JitsiEngineExt;
      const res = await engine.listMediaDevices?.();
      if (!res) return;

      const vIn = res.videoInputs ?? [];
      const aIn = res.audioInputs ?? [];
      const aOut = res.audioOutputs ?? [];

      setDevices({ videoInputs: vIn, audioInputs: aIn, audioOutputs: aOut });

      // only set defaults if empty (don't trigger re-join!)
      setMediaSettings((prev) => ({
        ...prev,
        videoInputId: prev.videoInputId || vIn?.[0]?.deviceId || "",
        audioInputId: prev.audioInputId || aIn?.[0]?.deviceId || "",
        audioOutputId: prev.audioOutputId || "default",
      }));
    } catch (e) {
      console.error("loadDevices error:", e);
    }
  };

  // LOAD SESSION + BUILD STAGES
  useEffect(() => {
    (async () => {
      if (!id) return;

      const { data, error } = await supabase
        .from("sessions")
        .select(
          "*, host_profile:profiles!sessions_host_id_fkey(id, full_name, avatar_url, bio), session_templates(*)"
        )
        .eq("id", id)
        .single();

      if (data && !error) {
        const s = data as unknown as SessionRow;
        setSession(s);

        setStages([]);
        setStagebarCycleSeconds(undefined);
        setStagebarStartTime("");

        const fallbackStart = String(s?.start_time || s?.created_at || new Date().toISOString());

        let parsed: unknown = safeParseJson(s.schedule);

        if (!parsed) {
          const t = parse50505(s.schedule);
          if (t) {
            parsed = {
              kind: "infinite_room",
              timer: { phases: { focus: t.focus, break: t.break, intentions: t.intentions } },
              anchor_ts: s?.start_time || s?.created_at || fallbackStart,
            };
          }
        }

        // unwrap Session Studio / wrapper objects -> blocks array
        if (isRecord(parsed)) {
          const maybeBlocks =
            parsed.blocks ||
            parsed.script ||
            parsed.agenda ||
            parsed.items ||
            parsed.stages;

          if (Array.isArray(maybeBlocks)) parsed = maybeBlocks;
        }

        // legacy array schedule
        if (Array.isArray(parsed)) {
          const formatted: Stage[] = parsed
            .map((b): Stage | null => {
              const blk = isRecord(b) ? b : null;
              if (!blk) return null;

              const rawName =
                str(blk.name) ||
                str(blk.title) ||
                str(blk.label) ||
                str(blk.text) ||
                str(blk.key) ||
                "Stage";

              const lower = rawName.toLowerCase();

              const inferredType: Stage["type"] =
                (str(blk.type) || str(blk.category)) ||
                (lower.includes("welcome") || lower.includes("intro")
                  ? "intro"
                  : lower.includes("intention") || lower.includes("checkin")
                    ? "intentions"
                    : lower.includes("focus")
                      ? "focus"
                      : lower.includes("break") || lower.includes("pause") || lower.includes("rest")
                        ? "break"
                        : lower.includes("farewell") || lower.includes("celebrat")
                          ? "outro"
                          : "focus");

              const minutes =
                num(blk.minutes) ||
                num(blk.mins) ||
                num(blk.duration_minutes) ||
                num(blk.durationMinutes) ||
                num(blk.durationMin) ||
                num(blk.duration) ||
                0;

              const seconds =
                num(blk.seconds) ||
                num(blk.durationSeconds) ||
                num(blk.duration_seconds) ||
                0;

              const durationSeconds = seconds > 0 ? seconds : minutes > 0 ? minutes * 60 : 0;
              const displayMinutes =
                minutes > 0 ? minutes : seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;

              if (durationSeconds <= 0 || displayMinutes <= 0) return null;

              const color = str(blk.color) || STAGE_COLORS[inferredType] || "#F63135";

              return {
                name: rawName,
                duration: displayMinutes,
                color,
                type: inferredType,
                durationSeconds,
              };
            })
            .filter((x): x is Stage => !!x);

          setStages(formatted);
          setStagebarStartTime(String(s.start_time || fallbackStart));
          setStagebarCycleSeconds(undefined);
        }

        // infinite object schedule
        const isInfiniteScheduleObject =
          isRecord(parsed) &&
          (str(parsed.kind).toLowerCase().includes("infinite") ||
            (isRecord(parsed.timer) && (parsed.timer.phases || parsed.timer.segments)) ||
            !!parsed.phases ||
            !!parsed.segments);

        if (isInfiniteScheduleObject && isRecord(parsed)) {
          const timer = isRecord(parsed.timer) ? parsed.timer : null;

          const phasesRaw =
            (timer?.phases ?? timer?.segments ?? parsed.phases ?? parsed.segments) ?? null;

          const phases = normalizeInfinitePhases(phasesRaw);

          const formatted: Stage[] = phases.map((p) => {
            const lower = String(p.name || "").toLowerCase();
            const type = phaseToStageType(lower);

            const displayName =
              type === "focus"
                ? "Focus"
                : type === "intentions"
                  ? "Intentions (spoken)"
                  : type === "break"
                    ? "Break"
                    : String(p.name || "Stage");

            const seconds = Number(p.seconds) || 0;
            const minutes = Math.max(1, Math.round(seconds / 60));

            return {
              name: displayName,
              duration: minutes,
              color: STAGE_COLORS[type] || "#F63135",
              type,
              durationSeconds: seconds,
            };
          });

          setStages(formatted);

          const anchor = String(
            str(parsed.anchor_ts) ||
            str(parsed.anchorTs) ||
            str(s?.start_time) ||
            fallbackStart
          );
          setStagebarStartTime(anchor);

          const sumSeconds = phases.reduce((acc, p) => acc + (Number(p.seconds) || 0), 0);

          const timerCycle =
            timer && isRecord(timer)
              ? num(timer.cycle_seconds) || num(timer.cycleSeconds)
              : 0;

          let cycleSeconds =
            timerCycle ||
            num(parsed.cycle_seconds) ||
            num(parsed.cycleSeconds) ||
            0;

          if (!cycleSeconds || cycleSeconds <= 0) cycleSeconds = sumSeconds;
          if (cycleSeconds < sumSeconds) cycleSeconds = sumSeconds;

          setStagebarCycleSeconds(Math.max(1, cycleSeconds));
        }

        if (!parsed) setStagebarStartTime(fallbackStart);
      }

      setLoading(false);
    })();
  }, [id]);

  // RESOLVE USER NAME
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data.user;
      setAuthUserId(u?.id || null);

      let name =
        str(u?.user_metadata?.full_name) ||
        str(u?.user_metadata?.name) ||
        (u?.email ? u.email.split("@")[0] : "");

      if (!name && u?.id) {
        const { data: p } = await supabase.from("profiles").select("full_name").eq("id", u.id).single();
        name = str((p as unknown as { full_name?: unknown } | null)?.full_name);
      }

      setUserName(name);
    })();
  }, []);

  // PRESENCE (LIVE ATTENDANCE)
  useAttendancePresence(id && authUserId ? id : null, { heartbeatMs: 10_000 });

  // ✅ JITSI INIT + REACTIONS (FIXED deps: NO mediaSettings)
  useEffect(() => {
    if (!session || !userName) return;
    if (engineRef.current) return;

    const engine = new JitsiEngine({
      onParticipantsUpdate: (list) => {
        if (prevCountRef.current < 2 && list.length === 2) {
          playOneShot("/sounds/user_joined.mp3", 0.9);
        }
        prevCountRef.current = list.length;

        const sharer = list.find((p) => p.isScreenSharing);
        setActiveScreenSharer(sharer ? sharer.id : null);

        const updated = list.map((p) => {
          if (!p.isLocal && p.displayName === "Guest") {
            const hp = session.host_profile;
            if (hp?.full_name && hp.id === p.id) {
              return { ...p, displayName: hp.full_name };
            }
          }
          return p;
        });

        setParticipants(updated);
      },

      onConferenceJoin: () => {
        setTimeout(() => loadDevices(), 0);
      },

      onReactionReceived: (_fromId, reaction) => {
        const newId = reactionIdRef.current + 1;
        reactionIdRef.current = newId;

        setIncomingReactions((prev) => [...prev, { id: newId, type: reaction as ReactionType }]);

        setTimeout(() => {
          setIncomingReactions((prev) => prev.filter((r) => r.id !== newId));
        }, 1500);
      },

      onError: (msg) => {
        console.error("Jitsi error:", msg);
        setLastErr(msg);
      },
    });

    // apply persisted settings BEFORE join (devices + bg prefs) — but do NOT re-init on changes
    try {
      const ms = mediaSettingsRef.current;
      engine.mediaSettings.videoInputId = ms.videoInputId || "";
      engine.mediaSettings.audioInputId = ms.audioInputId || "";

      const engineExt = engine as unknown as JitsiEngineExt;
      engineExt.setAudioOutputDevice?.(ms.audioOutputId || "default");
      engineExt.setBackgroundPrefs?.({
        mode: ms.bgMode,
        imageUrl: ms.bgImageUrl,
      });
    } catch { }

    engineRef.current = engine;
    (window as unknown as { engine?: JitsiEngine }).engine = engine;

    const roomNameRaw =
      session.jitsi_room_name ||
      (session.daily_room_url
        ? (() => {
          try {
            const u = new URL(session.daily_room_url);
            const parts = u.pathname.split("/").filter(Boolean);
            return parts[parts.length - 1] || `session-${session.id}`;
          } catch {
            return `session-${session.id}`;
          }
        })()
        : `session-${session.id}`);

    const safeRoomName = roomNameRaw.toLowerCase().replace(/[^a-z0-9-_]/g, "");

    engine
      .initAndJoin(safeRoomName || `session-${session.id}`, userName || "Guest")
      .catch((e: unknown) => {
        console.error("initAndJoin error", e);
        const msg = isRecord(e) ? str(e.message) : "";
        setLastErr(msg || String(e));
      });

    return () => {
      engine
        .dispose()
        .catch(() => { })
        .finally(() => {
          engineRef.current = null;
          try {
            delete (window as unknown as { engine?: JitsiEngine }).engine;
          } catch { }
        });
      stopWelcomeLoop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, userName]);

  // APPLY MEDIA SETTINGS
  const applyMediaSettings = async (next: RoomMediaSettings) => {
    try {
      const base = engineRef.current;
      if (!base) return;
      const engine = base as unknown as JitsiEngineExt;

      await engine.applyInputDevices?.({
        videoInputId: next.videoInputId,
        audioInputId: next.audioInputId,
      });

      try {
        await engine.setBackgroundEffect?.({
          mode: next.bgMode,
          imageUrl: next.bgImageUrl,
        });
      } catch (e) {
        console.warn("setBackgroundEffect warning:", e);
      }

      try {
        await engine.setAudioOutputDevice?.(next.audioOutputId);
      } catch (e) {
        console.warn("setAudioOutputDevice warning:", e);
      }

      setSelectedAudioOutputId(next.audioOutputId || "default");
      setMediaSettings(next);
      saveStoredMediaSettings(next);
    } catch (e) {
      console.error("applyMediaSettings error:", e);
    }
  };

  // BUTTON HANDLERS
  const handleToggleAudio = () => engineRef.current?.toggleAudioMute();
  const handleToggleVideo = () => engineRef.current?.toggleVideoMute();
  const handleToggleScreenShare = () => engineRef.current?.toggleScreenShare();

  const handleLeave = async () => {
    try {
      if (id && authUserId) {
        await supabase.rpc("attendance_leave", { p_session_id: id });
      }
    } catch (e) {
      console.error("attendance_leave (button) exception:", e);
    } finally {
      navigate("/sessions", { replace: true });
    }
  };

  // STAGES TIMER (scheduled OR infinite)
  useEffect(() => {
    if (isSilentRoom) {
      setRemainingTime("");
      setCurrentStage(0);
      firstTickDoneRef.current = false;
      prevStageRef.current = -1;
      stopWelcomeLoop();
      return;
    }

    if (!stagebarStartTime || !stages.length) return;

    const startMs = new Date(stagebarStartTime).getTime();
    if (Number.isNaN(startMs)) return;

    const stageSeconds = stages.map((s) => {
      const sec = Number(s.durationSeconds || 0);
      if (sec > 0) return sec;
      const mins = Number(s.duration || 0);
      return mins > 0 ? mins * 60 : 0;
    });

    const sumStageSeconds = stageSeconds.reduce((acc, v) => acc + v, 0);
    const loopSeconds =
      (Number(stagebarCycleSeconds) || 0) > 0
        ? Number(stagebarCycleSeconds)
        : Math.max(1, sumStageSeconds);

    const timer = window.setInterval(() => {
      const now = Date.now();
      const diffSecRaw = (now - startMs) / 1000;

      const diffSec =
        loopSeconds > 0 && isInfiniteRoom
          ? ((diffSecRaw % loopSeconds) + loopSeconds) % loopSeconds
          : diffSecRaw;

      let total = 0;
      let active = 0;

      let found = false;

      for (let i = 0; i < stages.length; i++) {
        const dur = stageSeconds[i] || 0;
        const next = total + dur;

        if (dur <= 0) continue;

        if (diffSec < next) {
          active = i;
          const rem = next - diffSec;
          setRemainingTime(`${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, "0")}`);
          found = true;
          break;
        }

        total = next;
        active = i;
      }

      if (!found && !isInfiniteRoom) {
        setRemainingTime("0:00");
      }

      setCurrentStage(active);

      if (!isInfiniteRoom) {
        const stage = stages[active];

        if (!firstTickDoneRef.current) {
          if (stage?.type === "intro") startWelcomeLoop();
          else stopWelcomeLoop();

          prevStageRef.current = active;
          firstTickDoneRef.current = true;
          return;
        }

        if (prevStageRef.current !== active) {
          const prev = stages[prevStageRef.current];
          const prevType = prev?.type;
          const newType = stage?.type;

          if (prevType === "break" && newType !== "break") playOneShot(BREAK_END_SOUND);

          if (newType === "intro") {
            startWelcomeLoop();
          } else {
            stopWelcomeLoop();
            if (newType) {
              const sound = STAGE_SOUND_MAP[newType];
              if (sound) playOneShot(sound);
            }
          }

          prevStageRef.current = active;
        }

        if (stage?.type !== "intro" && welcomeLoopRef.current) stopWelcomeLoop();
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [stagebarStartTime, stages, isSilentRoom, isInfiniteRoom, stagebarCycleSeconds]);

  // DERIVED
  const localParticipant = useMemo(
    () => participants.find((p) => p.isLocal) || null,
    [participants]
  );

  const isAudioMuted = !!localParticipant?.audioMuted;
  const isVideoMuted = !!localParticipant?.videoMuted;
  const isScreenSharing = !!localParticipant?.isScreenSharing;

  // REACTIONS MENU
  const [showReactionsMenu, setShowReactionsMenu] = useState(false);
  const reactionsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showReactionsMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!reactionsMenuRef.current || !target) return;
      if (!reactionsMenuRef.current.contains(target)) setShowReactionsMenu(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showReactionsMenu]);

  const handleSendReaction = (type: ReactionType) => {
    const rid = localReactionIdRef.current + 1;
    localReactionIdRef.current = rid;

    setLocalReactions((prev) => [...prev, { id: rid, type }]);

    try {
      const base = engineRef.current;
      if (base) {
        const eng = base as unknown as JitsiEngineExt;
        eng.sendReaction?.(type);
      }
    } catch { }

    setTimeout(() => {
      setLocalReactions((prev) => prev.filter((r) => r.id !== rid));
    }, 1500);
  };

  // MORE MENU (bottom, mobile-only)
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showMoreMenu) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!moreMenuRef.current || !t) return;
      if (!moreMenuRef.current.contains(t)) setShowMoreMenu(false);
    };

    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showMoreMenu]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (mql.matches) setShowMoreMenu(false);
    };
    onChange();
    try {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    } catch {
      // Safari fallback
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
  }, []);

  // RIGHT PANEL CONTENT
  const [participantsSearch, setParticipantsSearch] = useState("");

  const filteredParticipants = useMemo(() => {
    const q = participantsSearch.trim().toLowerCase();
    if (!q) return participants;
    return participants.filter((p) =>
      (p.isLocal ? "you" : p.displayName || "guest").toLowerCase().includes(q)
    );
  }, [participants, participantsSearch]);

  const participantsCount = participants.length;

  // theme switcher
  const switchTrack =
    "w-[84px] h-[32px] rounded-full border relative transition flex items-center px-[3px]";
  const switchTrackCls = isLight
    ? "bg-black/5 border-black/10 hover:bg-black/10"
    : "bg-white/5 border-white/10 hover:bg-white/10";

  const switchThumb =
    "absolute top-[2px] w-[26px] h-[26px] rounded-full shadow-md transition-transform bg-white flex items-center justify-center";

  const thumbTranslate = isLight ? "translateX(0px)" : "translateX(50px)";

  // ✅ video container ref + ResizeObserver to keep layouts stable
  // ✅ MUST be above early returns (loading/session) to keep hooks order stable.
  const videoWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = videoWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    let raf = 0;
    const ro = new ResizeObserver(() => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        try {
          window.dispatchEvent(new Event("resize"));
        } catch { }
      });
    });

    ro.observe(el);

    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  if (loading) {
    return (
      <div className={`flex h-screen justify-center items-center ${pageBg}`}>
        Loading session...
      </div>
    );
  }

  if (!session) {
    return (
      <div className={`flex h-screen justify-center items-center ${pageBg}`}>
        <button onClick={() => navigate("/sessions")}>Back</button>
      </div>
    );
  }

  // Right panel body (re-used for desktop & mobile overlay)
  const RightPanelBody = (
    <div
      className={[
        "rounded-2xl shadow-lg overflow-hidden min-h-0 h-full flex flex-col",
        panelBg,
        // extra safety: local dark context for panels
        theme === "dark" ? "dark" : "",
      ].join(" ")}
      data-theme={theme}
    >
      {/* participants */}
      {rightTab === "participants" && (
        <div className="h-full min-h-0 flex flex-col">
          <div
            className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"
              }`}
          >
            <div className="flex items-center gap-2">
              <span className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>
                Participants
              </span>
              <span className={`${isLight ? "text-black/50" : "text-white/55"} text-sm`}>
                ({participantsCount})
              </span>
            </div>
            <button
              onClick={() => openRightTab(null)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight
                ? "bg-black/5 hover:bg-black/10 text-black/60"
                : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                }`}
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="p-4">
            <div
              className={`rounded-xl px-3 py-2 ${isLight ? "bg-black/5 border border-black/10" : "bg-[#0B1220]/70 border border-white/10"
                }`}
            >
              <input
                value={participantsSearch}
                onChange={(e) => setParticipantsSearch(e.target.value)}
                placeholder="Search participants..."
                className={`w-full bg-transparent outline-none text-[13px] placeholder:opacity-60 ${isLight ? "text-black/80 placeholder:text-black/40" : "text-white/85 placeholder:text-white/35"
                  }`}
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
            <div className="flex flex-col gap-2">
              {filteredParticipants.map((p) => {
                const name = p.isLocal ? "You" : p.displayName || "Guest";
                const initials =
                  name
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((x) => x[0]?.toUpperCase())
                    .join("") || "U";

                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-xl transition ${isLight ? "hover:bg-black/5" : "hover:bg-white/5"
                      }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${isLight ? "bg-blue-500/15 text-blue-700" : "bg-emerald-500/80 text-[#02140B]"
                          }`}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <div className={`text-[13px] font-medium truncate ${isLight ? "text-black/85" : "text-white/90"}`}>
                          {name}
                        </div>
                        <div className={`text-[11px] truncate ${isLight ? "text-black/45" : "text-white/45"}`}>
                          {p.isLocal ? "Team member" : "Participant"}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div
                        className={
                          "w-8 h-8 rounded-lg flex items-center justify-center " +
                          (p.audioMuted
                            ? isLight
                              ? "bg-red-500/10"
                              : "bg-red-500/20"
                            : isLight
                              ? "bg-black/5"
                              : "bg-white/5")
                        }
                        title={p.audioMuted ? "Muted" : "Unmuted"}
                      >
                        <Icon
                          name={p.audioMuted ? "mic-off" : "mic-on"}
                          theme={theme}
                          className={`w-4 h-4 ${p.audioMuted ? "opacity-90" : "opacity-80"}`}
                        />
                      </div>

                      <div
                        className={
                          "w-8 h-8 rounded-lg flex items-center justify-center " +
                          (p.videoMuted
                            ? isLight
                              ? "bg-red-500/10"
                              : "bg-red-500/20"
                            : isLight
                              ? "bg-black/5"
                              : "bg-white/5")
                        }
                        title={p.videoMuted ? "Video off" : "Video on"}
                      >
                        <Icon
                          name={p.videoMuted ? "camera-off" : "camera-on"}
                          theme={theme}
                          className={`w-4 h-4 ${p.videoMuted ? "opacity-90" : "opacity-80"}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={`p-4 border-t ${isLight ? "border-black/10" : "border-white/5"}`}>
            <button
              onClick={() => { }}
              className={`w-full h-12 rounded-xl font-semibold flex items-center justify-center gap-2 ${isLight ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                }`}
            >
              <span className="text-lg">+</span>
              <span>Invite People</span>
            </button>
          </div>
        </div>
      )}

      {/* chat */}
      {rightTab === "chat" && (
        <div className="h-full min-h-0 flex flex-col">
          {/* ✅ remove double header: keep only close control row (no title text) */}
          <div
            className={`px-4 py-3 border-b flex items-center justify-end ${isLight ? "border-black/10" : "border-white/5"
              }`}
          >
            <button
              onClick={() => openRightTab(null)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight
                ? "bg-black/5 hover:bg-black/10 text-black/60"
                : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                }`}
              title="Close"
            >
              ✕
            </button>
          </div>

          {/* ✅ critical: min-h-0 + overflow-hidden so Chat can't stretch the grid row */}
          <div className="flex-1 min-h-0 p-4 overflow-hidden">
            <div
              className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight ? "bg-white/70 border border-black/10" : "bg-[#020617]/40 border border-white/10"
                }`}
            >
              {/* force ChatPanel root to be h-full/min-h-0 */}
              <div className="h-full min-h-0 flex flex-col overflow-hidden [&>*]:h-full [&>*]:min-h-0">
                {session?.id ? (
                  <div data-theme={theme} style={{ colorScheme: theme }} className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}>
                    <ChatPanel
                      sessionId={sessionId}
                      theme={theme}
                      showHeader={false} // если хочешь без сабтайтла
                      title="Chat"
                      onClose={() => setChatOpen(false)}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* intentions */}
      {rightTab === "intentions" && (
        <div className="h-full min-h-0 flex flex-col">
          <div
            className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"
              }`}
          >
            <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>
              Intentions
            </div>
            <button
              onClick={() => openRightTab(null)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight
                ? "bg-black/5 hover:bg-black/10 text-black/60"
                : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                }`}
              title="Close"
            >
              ✕
            </button>
          </div>

          {/* ✅ critical: min-h-0 + overflow-hidden so Intentions doesn't stretch page */}
          <div className="flex-1 min-h-0 overflow-hidden p-4">
            <div
              className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight ? "bg-white/70 border border-black/10" : "bg-[#020617]/40 border border-white/10"
                }`}
            >
              <div className="h-full min-h-0 overflow-y-auto [&>*]:min-h-0">
                <div data-theme={theme} style={{ colorScheme: theme }} className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}>
                  <IntentionsPanel
                    key={`intentions-${session.id}-${theme}`}
                    theme={theme}
                    sessionId={session.id}
                    timerText={remainingTime || "--:--"}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`h-[100dvh] overflow-hidden ${pageBg}`}>
      {/* ✅ full-height column layout */}
      <div className="h-full w-full px-3 sm:px-5 pt-5 pb-[calc(110px+env(safe-area-inset-bottom))] flex flex-col gap-5 min-h-0">
        {/* TOP BAR */}
        <div className={`flex w-full rounded-2xl overflow-hidden ${topBarBg}`}>
          <div className="flex-1 px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className={`font-inter font-semibold text-[18px] truncate ${strongText}`}>
                  {session.title}
                </p>
                <p className={`font-inter text-[13px] ${subtleText}`}>
                  {participantsCount} participants
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!isSilentRoom && stages.length > 0 && !!stagebarStartTime && (
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${chipBg}`}>
                    <Icon name="timer" theme={theme} className="w-4 h-4 opacity-80" alt="Timer" />
                    <span className={`font-inter text-[13px] ${isLight ? "text-black/75" : "text-white/90"}`}>
                      {remainingTime || "--:--"}
                    </span>
                  </div>
                )}

                {/* Theme switcher */}
                <button
                  onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                  className={`${switchTrack} ${switchTrackCls}`}
                  title="Toggle theme"
                  aria-label="Toggle theme"
                >
                  <div className={switchThumb} style={{ transform: thumbTranslate }}>
                    <Icon
                      name={isLight ? "theme-sun" : "theme-moon"}
                      theme={theme}
                      className="w-4 h-4"
                      alt={isLight ? "Light" : "Dark"}
                    />
                  </div>
                </button>

                {/* Host indicator */}
                {session.host_profile && (
                  <button
                    onClick={() => setSelectedUser(session.host_profile || null)}
                    className={`max-[480px]:hidden flex items-center gap-2 px-3 py-1.5 rounded-xl border transition font-inter text-[13px] ${isLight
                      ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/75"
                      : "border-white/10 bg-[#0B1220]/60 hover:bg-[#0B1220]/80 text-[#F3F4F6]/85"
                      }`}
                  >
                    <Icon name="host_session_icon" theme={theme} className="h-5 w-5 opacity-90" alt="" />
                    <span className="flex items-center gap-1 leading-none">
                      <span className={isLight ? "font-normal text-black/55" : "font-normal text-white/70"}>
                        Host:
                      </span>
                      <span className="font-semibold">{session.host_profile.full_name}</span>
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* StageBar */}
            {!isSilentRoom && stages.length > 0 && !!stagebarStartTime && (
              <div className="mt-3 w-full overflow-hidden">
                <div className="w-full overflow-hidden">
                  <SessionStageBar
                    stages={stages}
                    startTime={stagebarStartTime}
                    cycleSeconds={stagebarCycleSeconds}
                    onHoverStage={setHoveredStage}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* MAIN AREA */}
        <div
          className={
            // ✅ IMPORTANT: force the single row to minmax(0,1fr) so content can't expand height
            "relative grid grid-rows-1 gap-5 flex-1 min-h-0 h-full " +
            (rightPanelOpen ? "lg:grid-cols-[minmax(0,1fr),420px]" : "grid-cols-1")
          }
        >
          {/* VIDEO AREA */}
          <div
            ref={videoWrapRef}
            className={`relative rounded-2xl overflow-hidden min-h-0 h-full ${isLight ? "bg-white/70 border border-black/10" : "bg-[#0B1220]/45 border border-white/5"
              }`}
          >
            <div className="w-full h-full min-h-0">
              <VideoRoom
                theme={theme}
                participants={participants}
                onToggleAudio={handleToggleAudio}
                onToggleVideo={handleToggleVideo}
                onToggleScreenShare={handleToggleScreenShare}
                onLeave={handleLeave}
                activeScreenSharer={activeScreenSharer}
                incomingReactions={incomingReactions}
                localReactions={localReactions}
                showControls={false}
                onVisibleVideoIdsChange={(ids: string[]) => {
                  const base = engineRef.current;
                  if (!base) return;
                  const eng = base as unknown as JitsiEngineExt;
                  eng.setVisibleVideoParticipants?.(ids);
                }}
                audioOutputId={selectedAudioOutputId}
                onRegisterVideoElement={(pid: string, el: HTMLVideoElement, kind: string) => {
                  try {
                    const base = engineRef.current;
                    if (!base) return;
                    const eng = base as unknown as JitsiEngineExt;
                    eng.registerVideoElement?.(pid, el, kind);
                  } catch { }
                }}
              />
            </div>

            {lastErr && (
              <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow">
                {lastErr}
              </div>
            )}
          </div>

          {/* DESKTOP RIGHT PANEL */}
          {rightPanelOpen && (
            <div className="hidden lg:block min-h-0 h-full overflow-hidden">
              {RightPanelBody}
            </div>
          )}

          {/* MOBILE OVERLAY RIGHT PANEL */}
          {rightPanelOpen && (
            <div className="lg:hidden absolute inset-0 z-40 min-h-0">
              {/* backdrop */}
              <div
                className="absolute inset-0 bg-black/40"
                onClick={() => openRightTab(null)}
              />
              {/* panel (over video) */}
              <div className="absolute inset-x-0 top-0 bottom-0 p-2 min-h-0">
                {RightPanelBody}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* FIXED BOTTOM CONTROLS */}
      <div className="fixed inset-x-0 bottom-0 z-50">
        <div className="w-full px-3 sm:px-5 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <div className={`h-[64px] sm:h-[74px] rounded-2xl shadow-2xl backdrop-blur grid grid-cols-[auto,1fr,auto] items-center px-2 sm:px-4 ${bottomBarBg}`}>
            {/* LEFT GROUP */}
            <div className="flex items-center gap-2" ref={moreMenuRef}>
              {/* MOBILE (<768): dropdown */}
              <div className="md:hidden relative">
                <button
                  onClick={() => setShowMoreMenu((v) => !v)}
                  className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                  title="Menu"
                >
                  <span className={isLight ? "text-black/70" : "text-white/85"}>⋯</span>
                </button>

                {showMoreMenu && (
                  <div className="absolute bottom-[76px] sm:bottom-[86px] left-0">
                    <div className={`w-[240px] rounded-2xl shadow-2xl overflow-hidden ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"}`}>
                      <button
                        onClick={() => {
                          openRightTab("participants");
                          setShowMoreMenu(false);
                        }}
                        className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"}`}
                      >
                        <Icon name="participants" theme={theme} className="w-4 h-4 opacity-90" />
                        <span>Participants</span>
                      </button>

                      <button
                        onClick={() => {
                          openRightTab("chat");
                          setShowMoreMenu(false);
                        }}
                        className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"}`}
                      >
                        <Icon name="chat" theme={theme} className="w-4 h-4 opacity-90" />
                        <span>Chat</span>
                      </button>

                      <button
                        onClick={() => {
                          openRightTab("intentions");
                          setShowMoreMenu(false);
                        }}
                        className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"}`}
                      >
                        <Icon name="intentions" theme={theme} className="w-4 h-4 opacity-90" />
                        <span>Intentions</span>
                      </button>

                      <div className={isLight ? "h-px bg-black/10" : "h-px bg-white/10"} />

                      <button
                        onClick={() => {
                          setSettingsOpen(true);
                          setTimeout(() => loadDevices(), 0);
                          setShowMoreMenu(false);
                        }}
                        className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"}`}
                      >
                        <Icon name="settings" theme={theme} className="w-4 h-4 opacity-90" />
                        <span>Video settings</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* DESKTOP/TABLET (>=768): direct */}
              <div className="hidden md:flex items-center gap-2">
                <button
                  onClick={() => openRightTab("participants")}
                  className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                  title="Participants"
                >
                  <Icon name="participants" theme={theme} className="w-5 h-5" />
                </button>

                <button
                  onClick={() => openRightTab("chat")}
                  className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                  title="Chat"
                >
                  <Icon name="chat" theme={theme} className="w-5 h-5" />
                </button>

                <button
                  onClick={() => openRightTab("intentions")}
                  className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                  title="Intentions"
                >
                  <Icon name="intentions" theme={theme} className="w-5 h-5" />
                </button>

                <button
                  onClick={() => {
                    setSettingsOpen(true);
                    setTimeout(() => loadDevices(), 0);
                  }}
                  className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                  title="Video settings"
                >
                  <Icon name="settings" theme={theme} className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* CENTER GROUP */}
            <div className="flex items-center justify-center gap-2 sm:gap-3">
              <button
                onClick={() => engineRef.current?.toggleAudioMute()}
                className={
                  "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                  (isAudioMuted ? "bg-red-600 hover:bg-red-700" : ctlBtnBase)
                }
                title="Toggle mic"
              >
                <Icon
                  name={isAudioMuted ? "mic-off" : "mic-on"}
                  theme={isAudioMuted ? "dark" : theme} // mic-off always white
                  className="w-5 h-5"
                />
              </button>

              <button
                onClick={() => engineRef.current?.toggleVideoMute()}
                className={
                  "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                  (isVideoMuted ? "bg-red-600 hover:bg-red-700" : ctlBtnBase)
                }
                title="Toggle camera"
              >
                <Icon name={isVideoMuted ? "camera-off" : "camera-on"} theme={theme} className="w-5 h-5" />
              </button>

              <button
                onClick={() => engineRef.current?.toggleScreenShare()}
                className={
                  "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                  (isScreenSharing ? "bg-blue-600 hover:bg-blue-700" : ctlBtnBase)
                }
                title="Share screen"
              >
                <Icon name="screen-share" theme={theme} className="w-5 h-5" />
              </button>

              {/* reactions */}
              <div className="relative" ref={reactionsMenuRef}>
                <button
                  onClick={() => setShowReactionsMenu((v) => !v)}
                  className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                  title="Reactions"
                >
                  <Icon name="reaction" theme={theme} className="w-5 h-5" />
                </button>

                {showReactionsMenu && (
                  <div
                    className={`absolute bottom-[54px] sm:bottom-[58px] left-1/2 -translate-x-1/2 rounded-2xl px-3 py-2 flex gap-2 text-xl shadow-xl ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"
                      }`}
                  >
                    {(["fire", "laugh", "clap", "heart", "thumbsUp", "thumbsDown"] as ReactionType[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          handleSendReaction(t);
                          setShowReactionsMenu(false);
                        }}
                        className="hover:scale-[1.06] transition"
                        title={t}
                      >
                        {reactionEmoji[t]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT GROUP */}
            <div className="flex items-center justify-end gap-2 sm:gap-3">
              <button
                onClick={handleLeave}
                className={`hidden sm:flex h-11 px-6 rounded-2xl font-semibold items-center justify-center gap-2 ${isLight ? "bg-red-600 hover:bg-red-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"
                  }`}
                title="Leave"
              >
                <Icon name="leave" theme={theme} className="w-5 h-5" />
                <span className="text-[14px]">Leave</span>
              </button>

              <button
                onClick={handleLeave}
                className="sm:hidden w-10 h-10 rounded-2xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center"
                title="Leave"
              >
                <Icon name="leave" theme={theme} className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MEDIA SETTINGS MODAL */}
      <RoomMediaSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        devices={devices}
        value={mediaSettings}
        onRefreshDevices={loadDevices}
        onChange={(next) => {
          setMediaSettings(next);
          setSelectedAudioOutputId(next.audioOutputId || "default");
        }}
        onApply={async (next) => {
          await applyMediaSettings(next);
          setSettingsOpen(false);
        }}
      />

      {selectedUser && <UserProfileModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
    </div>
  );
}

export default RoomPage;
