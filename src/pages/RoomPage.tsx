// src/pages/RoomPage.tsx
// ROOMPAGE + JITSI ENGINE + VIDEO UI (UPDATED WITH REACTIONS)

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { ChatPanel } from "../components/ChatPanel";
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

// ✅ NEW: presence hook
import { useAttendancePresence } from "../hooks/useAttendancePresence";

type Stage = {
  name: string;
  duration: number; // minutes (for display / legacy)
  color: string;
  type: "intro" | "intentions" | "focus" | "break" | "outro" | string;
};

type RightPanelTab = "participants" | "chat" | "intentions" | null;

function ParticipantsIcon({ active }: { active?: boolean }) {
  return (
    <div
      className={
        "w-11 h-11 rounded-xl flex items-center justify-center transition " +
        (active ? "bg-emerald-500/90" : "bg-[#111827] hover:bg-[#1f2937]")
      }
      title="Participants"
    >
      <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
        <path
          d="M16 11c1.66 0 3-1.57 3-3.5S17.66 4 16 4s-3 1.57-3 3.5S14.34 11 16 11z"
          fill="currentColor"
          opacity="0.9"
        />
        <path
          d="M8 11c1.66 0 3-1.57 3-3.5S9.66 4 8 4 5 5.57 5 7.5 6.34 11 8 11z"
          fill="currentColor"
        />
        <path
          d="M8 13c-2.67 0-8 1.34-8 4v2h12v-2c0-2.66-5.33-4-4-4z"
          fill="currentColor"
        />
        <path
          d="M16 13c-.33 0-.71.02-1.11.06C16.92 14.1 19 15.55 19 17v2h5v-2c0-2.66-5.33-4-8-4z"
          fill="currentColor"
          opacity="0.9"
        />
      </svg>
    </div>
  );
}

function ChatIcon({ active }: { active?: boolean }) {
  return (
    <div
      className={
        "w-11 h-11 rounded-xl flex items-center justify-center transition " +
        (active ? "bg-emerald-500/90" : "bg-[#111827] hover:bg-[#1f2937]")
      }
      title="Chat"
    >
      <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
        <path
          d="M20 2H4C2.9 2 2 2.9 2 4v13c0 1.1.9 2 2 2h3v3c0 .55.45 1 1 1 .2 0 .4-.06.58-.19L14 19h6c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"
          fill="currentColor"
        />
      </svg>
    </div>
  );
}

function IntentionsIcon({ active }: { active?: boolean }) {
  return (
    <div
      className={
        "w-11 h-11 rounded-xl flex items-center justify-center transition " +
        (active ? "bg-emerald-500/90" : "bg-[#111827] hover:bg-[#1f2937]")
      }
      title="Intentions"
    >
      <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
        <path
          d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 2a8 8 0 1 1-8 8 8 8 0 0 1 8-8z"
          fill="currentColor"
          opacity="0.9"
        />
        <path
          d="M12 6.5a5.5 5.5 0 1 0 5.5 5.5A5.51 5.51 0 0 0 12 6.5zm0 2a3.5 3.5 0 1 1-3.5 3.5A3.5 3.5 0 0 1 12 8.5z"
          fill="currentColor"
          opacity="0.9"
        />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      </svg>
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <path
        d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"
        fill="currentColor"
      />
      <path
        d="M6 11a1 1 0 0 0-2 0 8 8 0 0 0 7 7.93V21H9a1 1 0 0 0 0 2h6a1 1 0 1 0 0-2h-2v-2.07A8 8 0 0 0 20 11a1 1 0 0 0-2 0 6 6 0 0 1-12 0z"
        fill="currentColor"
      />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <rect x="4" y="6" width="11" height="12" rx="2" fill="currentColor" />
      <path d="M17 9.5 21 7v10l-4-2.5z" fill="currentColor" />
    </svg>
  );
}

function ScreenIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" fill="currentColor" />
      <rect x="9" y="18" width="6" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

function SmileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="9" cy="10" r="0.8" fill="currentColor" />
      <circle cx="15" cy="10" r="0.8" fill="currentColor" />
      <path
        d="M9 15c.7.8 1.6 1.2 3 1.2s2.3-.4 3-1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <path
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5 0 0 0-.6.22L2.71 7.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.51.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.21.08.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function LeaveIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <path
        d="M5 5h6a1 1 0 0 1 0 2H7v10h4a1 1 0 0 1 0 2H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
        fill="currentColor"
      />
      <path
        d="M13.7 8.3a1 1 0 0 1 1.4 0L19 12l-3.9 3.7a1 1 0 0 1-1.4-1.4L15.6 13H11a1 1 0 0 1 0-2h4.6l-1.3-1.3a1 1 0 0 1 0-1.4z"
        fill="currentColor"
      />
    </svg>
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
function safeParseJson(raw: any) {
  if (!raw) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s || s === "undefined" || s === "null") return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  return raw;
}

/**
 * ✅ NEW: parse "50/5/5" (or "50-5-5") schedule stored as a string.
 * Returns minutes.
 */
function parse50505(
  raw: any
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

  if (
    !Number.isFinite(focus) ||
    !Number.isFinite(br) ||
    !Number.isFinite(intentions)
  )
    return null;
  if (focus <= 0 || br <= 0 || intentions <= 0) return null;

  return { focus, break: br, intentions };
}

function normalizeInfinitePhases(anyPhases: any): { name: string; seconds: number }[] {
  if (!anyPhases) return [];

  const toSeconds = (raw: any): number => {
    const explicitSeconds =
      Number(raw?.seconds) ||
      Number(raw?.duration_seconds) ||
      Number(raw?.durationSeconds);
    if (explicitSeconds > 0) return explicitSeconds;

    const explicitMinutes =
      Number(raw?.minutes) ||
      Number(raw?.mins) ||
      Number(raw?.duration_minutes) ||
      Number(raw?.durationMinutes);
    if (explicitMinutes > 0) return explicitMinutes * 60;

    const n =
      typeof raw === "number"
        ? raw
        : Number(raw?.duration ?? raw?.value ?? raw ?? 0);

    if (!Number.isFinite(n) || n <= 0) return 0;

    // ✅ heuristic: 50/5/5 часто лежит как "минуты"
    if (n <= 180) return n * 60;

    // иначе считаем секундами
    return n;
  };

  // case A: array [{name,seconds|minutes|duration}, ...]
  if (Array.isArray(anyPhases)) {
    return anyPhases
      .map((p: any) => {
        const name = String(p?.name || p?.key || p?.type || "");
        const seconds = toSeconds(p);
        return { name, seconds };
      })
      .filter((x) => x.seconds > 0);
  }

  // case B: object map { focus: 3000, break: 300 } OR { focus: 50, break: 5 } (minutes)
  if (typeof anyPhases === "object") {
    return Object.entries(anyPhases)
      .map(([k, v]: any) => {
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
  if (phaseNameLower.includes("checkin") || phaseNameLower.includes("intention"))
    return "intentions";
  if (phaseNameLower.includes("break") || phaseNameLower.includes("rest"))
    return "break";
  return "focus";
}

const STAGE_COLORS: Record<string, string> = {
  intro: "#80DF86",
  intentions: "#ADD3FF",
  focus: "#4CA0FF",
  break: "#F9ADA2",
  outro: "#80DF86",
};

export function RoomPage() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [devices, setDevices] = useState<{
    videoInputs: MediaDeviceInfo[];
    audioInputs: MediaDeviceInfo[];
    audioOutputs: MediaDeviceInfo[];
  }>({ videoInputs: [], audioInputs: [], audioOutputs: [] });

  const [mediaSettings, setMediaSettings] = useState<RoomMediaSettings>({
    videoInputId: "",
    audioInputId: "",
    audioOutputId: "default",
    bgMode: "none",
    bgImageUrl: undefined,
  });

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  type MediaDevice = MediaDeviceInfo;

  const [videoInputs, setVideoInputs] = useState<MediaDevice[]>([]);
  const [audioInputs, setAudioInputs] = useState<MediaDevice[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDevice[]>([]);

  const [selectedVideoInputId, setSelectedVideoInputId] = useState<string>("");
  const [selectedAudioInputId, setSelectedAudioInputId] = useState<string>("");
  const [selectedAudioOutputId, setSelectedAudioOutputId] =
    useState<string>("default");

  const [bgMode, setBgMode] = useState<"none" | "blur" | "image">("none");
  const [bgImageUrl, setBgImageUrl] = useState<string>("");

  const [stages, setStages] = useState<Stage[]>([]);
  const [hoveredStage, setHoveredStage] = useState<Stage | null>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const [remainingTime, setRemainingTime] = useState<string>("");

  // ✅ stagebar start + infinite cycle
  const [stagebarStartTime, setStagebarStartTime] = useState<string>("");
  const [stagebarCycleSeconds, setStagebarCycleSeconds] = useState<
    number | undefined
  >(undefined);

  const [selectedUser, setSelectedUser] = useState<any>(null);

  const [userName, setUserName] = useState<string>("");
  const [lastErr, setLastErr] = useState<string>("");
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  const engineRef = useRef<JitsiEngine | null>(null);
  const [participants, setParticipants] = useState<JitsiParticipant[]>([]);

  // ★ SOUND WHEN USER JOINS
  const prevCountRef = useRef<number>(0);

  // ★ TRACK SCREEN SHARER
  const [activeScreenSharer, setActiveScreenSharer] = useState<string | null>(
    null
  );

  // ★ REACTIONS RECEIVED FROM OTHER USERS
  const [incomingReactions, setIncomingReactions] = useState<
    { id: number; type: ReactionType }[]
  >([]);
  const reactionIdRef = useRef<number>(0);

  // ★ LOCAL REACTIONS (FOR OVERLAY)
  const [localReactions, setLocalReactions] = useState<
    { id: number; type: ReactionType }[]
  >([]);
  const localReactionIdRef = useRef<number>(0);

  // AUDIO ---------------------------------------------------------
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

  // ✅ detect infinite room by schedule (robust + supports "50/5/5")
  const isInfiniteRoom = useMemo(() => {
    const raw = session?.schedule;

    // support plain string "50/5/5"
    if (parse50505(raw)) return true;

    const parsed = safeParseJson(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;

    const kind = String((parsed as any)?.kind || "").toLowerCase();
    if (kind === "infinite_room") return true;
    if (kind.includes("infinite")) return true;

    if ((parsed as any)?.timer?.phases) return true;
    if ((parsed as any)?.timer?.segments) return true;
    if ((parsed as any)?.phases) return true;
    if ((parsed as any)?.segments) return true;

    return false;
  }, [session]);

  // ✅ SILENT ROOM DETECTION
  const isSilentRoom = useMemo(() => {
    const fmt = String(session?.format || "").toLowerCase();
    const title = String(session?.title || "").toLowerCase();

    const tpl = session?.session_templates;
    const tplName = Array.isArray(tpl)
      ? String(tpl?.[0]?.name || tpl?.[0]?.title || "")
      : String(tpl?.name || tpl?.title || "");
    const tplKey = Array.isArray(tpl)
      ? String(tpl?.[0]?.key || tpl?.[0]?.slug || tpl?.[0]?.type || "")
      : String(tpl?.key || tpl?.slug || tpl?.type || "");
    const tplFmt = Array.isArray(tpl)
      ? String(tpl?.[0]?.format || "")
      : String(tpl?.format || "");

    const hay = `${fmt} ${title} ${tplName} ${tplKey} ${tplFmt}`.toLowerCase();
    return hay.includes("silent");
  }, [session]);

  // ============================================================
  // UNLOCK AUDIO
  // ============================================================
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

  // ============================================================
  // DEVICES
  // ============================================================
  const loadDevices = async () => {
    try {
      const engine = engineRef.current;
      if (!engine) return;

      const res = await (engine as any).listMediaDevices?.();
      if (!res) return;

      const vIn = res.videoInputs || [];
      const aIn = res.audioInputs || [];
      const aOut = res.audioOutputs || [];

      setVideoInputs(vIn);
      setAudioInputs(aIn);
      setAudioOutputs(aOut);

      setDevices({ videoInputs: vIn, audioInputs: aIn, audioOutputs: aOut });

      setSelectedVideoInputId((prev) => prev || vIn?.[0]?.deviceId || "");
      setSelectedAudioInputId((prev) => prev || aIn?.[0]?.deviceId || "");
      setSelectedAudioOutputId((prev) => prev || "default");

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

  // ============================================================
  // LOAD SESSION + BUILD STAGES
  // ============================================================
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
        setSession(data);

        // reset stagebar state
        setStages([]);
        setStagebarCycleSeconds(undefined);
        setStagebarStartTime("");

        const fallbackStart = String(
          data?.start_time || data?.created_at || new Date().toISOString()
        );

        // ✅ parse schedule robustly + support "50/5/5"
        let parsed: any = safeParseJson(data.schedule);

        // if schedule is like "50/5/5" string -> turn it into infinite schedule object
        if (!parsed) {
          const t = parse50505(data.schedule);
          if (t) {
            parsed = {
              kind: "infinite_room",
              timer: {
                phases: {
                  focus: t.focus, // minutes
                  break: t.break, // minutes
                  intentions: t.intentions, // minutes
                },
              },
              anchor_ts: data?.start_time || data?.created_at || fallbackStart,
            };
          }
        }

        // ✅ scheduled: array [{name, minutes}, ...]
        if (Array.isArray(parsed)) {
          const formatted: Stage[] = parsed.map((b: any) => {
            const lower = (b.name || "").toLowerCase();
            const type: Stage["type"] =
              b.type ||
              (lower.includes("welcome") || lower.includes("intro")
                ? "intro"
                : lower.includes("intention")
                  ? "intentions"
                  : lower.includes("focus")
                    ? "focus"
                    : lower.includes("break") || lower.includes("pause")
                      ? "break"
                      : lower.includes("farewell") || lower.includes("celebrat")
                        ? "outro"
                        : "focus");

            return {
              name: b.name,
              duration: Number(b.minutes) || 0,
              color: STAGE_COLORS[type] || "#F63135",
              type,
            };
          });

          setStages(formatted);
          setStagebarStartTime(String(data.start_time || fallbackStart));
          setStagebarCycleSeconds(undefined);
        }

        // ✅ infinite: object (robust)
        const isInfiniteScheduleObject =
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          (String((parsed as any)?.kind || "").toLowerCase().includes("infinite") ||
            (parsed as any)?.timer?.phases ||
            (parsed as any)?.timer?.segments ||
            (parsed as any)?.phases ||
            (parsed as any)?.segments);

        if (isInfiniteScheduleObject) {
          const phasesRaw =
            (parsed as any)?.timer?.phases ||
            (parsed as any)?.timer?.segments ||
            (parsed as any)?.phases ||
            (parsed as any)?.segments ||
            null;

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

            return ({
              name: displayName,
              duration: minutes,
              color: STAGE_COLORS[type] || "#F63135",
              type,
              durationSeconds: seconds,
            } as any) as Stage;
          });

          setStages(formatted);

          const anchor = String(
            (parsed as any)?.anchor_ts ||
            (parsed as any)?.anchorTs ||
            data?.start_time ||
            fallbackStart
          );
          setStagebarStartTime(anchor);

          const sumSeconds = phases.reduce(
            (acc, p) => acc + (Number(p.seconds) || 0),
            0
          );

          let cycleSeconds =
            Number((parsed as any)?.timer?.cycle_seconds) ||
            Number((parsed as any)?.timer?.cycleSeconds) ||
            Number((parsed as any)?.cycle_seconds) ||
            Number((parsed as any)?.cycleSeconds) ||
            0;

          if (!cycleSeconds || cycleSeconds <= 0) cycleSeconds = sumSeconds;
          if (cycleSeconds < sumSeconds) cycleSeconds = sumSeconds;

          setStagebarCycleSeconds(Math.max(1, cycleSeconds));
        }

        // if no schedule or failed parse -> just set start (no stages)
        if (!parsed) {
          setStagebarStartTime(fallbackStart);
        }
      }

      setLoading(false);
    })();
  }, [id]);

  // ============================================================
  // RESOLVE USER NAME
  // ============================================================
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data.user;
      setAuthUserId(u?.id || null);

      let name =
        u?.user_metadata?.full_name ||
        u?.user_metadata?.name ||
        (u?.email ? u.email.split("@")[0] : "");

      if (!name && u?.id) {
        const { data: p } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", u.id)
          .single();
        name = p?.full_name || "";
      }

      setUserName(name);
    })();
  }, []);

  // ============================================================
  // ✅ PRESENCE (LIVE ATTENDANCE)
  // ============================================================
  useAttendancePresence(id && authUserId ? id : null, { heartbeatMs: 10_000 });

  // ============================================================
  // JITSI INIT + REACTIONS
  // ============================================================
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
            if (
              session?.host_profile?.full_name &&
              session.host_profile.id === p.id
            ) {
              return { ...p, displayName: session.host_profile.full_name };
            }
          }
          return p;
        });

        setParticipants(updated);
      },

      onConferenceJoin: () => {
        console.log("Jitsi conference joined");
        setTimeout(() => loadDevices(), 0);
      },

      onReactionReceived: (_fromId, reaction) => {
        const newId = reactionIdRef.current + 1;
        reactionIdRef.current = newId;

        setIncomingReactions((prev) => [
          ...prev,
          { id: newId, type: reaction as ReactionType },
        ]);

        setTimeout(() => {
          setIncomingReactions((prev) => prev.filter((r) => r.id !== newId));
        }, 1500);
      },

      onError: (msg) => {
        console.error("Jitsi error:", msg);
        setLastErr(msg);
      },
    });

    engineRef.current = engine;
    (window as any).engine = engine;

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
      .catch((e) => {
        console.error("initAndJoin error", e);
        setLastErr(String(e?.message || e));
      });

    return () => {
      engine
        .dispose()
        .catch(() => { })
        .finally(() => {
          engineRef.current = null;
          try {
            delete (window as any).engine;
          } catch { }
        });
      stopWelcomeLoop();
    };
  }, [session, userName]);

  // ============================================================
  // APPLY MEDIA SETTINGS
  // ============================================================
  const applyMediaSettings = async (next: RoomMediaSettings) => {
    try {
      const engine = engineRef.current as any;
      if (!engine) return;

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
        engine.setAudioOutputDevice?.(next.audioOutputId);
      } catch (e) {
        console.warn("setAudioOutputDevice warning:", e);
      }

      setSelectedVideoInputId(next.videoInputId || "");
      setSelectedAudioInputId(next.audioInputId || "");
      setSelectedAudioOutputId(next.audioOutputId || "default");
      setBgMode(next.bgMode);
      setBgImageUrl(next.bgImageUrl || "");
      setMediaSettings(next);
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

  // ============================================================
  // STAGES TIMER (scheduled OR infinite)
  // ============================================================
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

    const stageSeconds = stages.map((s: any) => {
      const sec =
        Number(s?.durationSeconds) ||
        Number(s?.duration_seconds) ||
        Number(s?.seconds) ||
        0;
      if (sec > 0) return sec;
      const mins = Number(s?.duration) || 0;
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

      // normalize for infinite rooms
      const diffSec =
        loopSeconds > 0 && isInfiniteRoom
          ? ((diffSecRaw % loopSeconds) + loopSeconds) % loopSeconds
          : diffSecRaw;

      let total = 0;
      let active = 0;

      for (let i = 0; i < stages.length; i++) {
        const dur = stageSeconds[i] || 0;
        const next = total + dur;

        if (dur <= 0) continue;

        if (diffSec < next) {
          active = i;
          const rem = next - diffSec;
          setRemainingTime(
            `${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(
              2,
              "0"
            )}`
          );
          break;
        }
        total = next;
        active = i;
      }

      setCurrentStage(active);

      // Sounds only for scheduled sessions (avoid looping spam)
      if (!isInfiniteRoom) {
        const stage = stages[active];

        if (!firstTickDoneRef.current) {
          if (stage.type === "intro") startWelcomeLoop();
          else stopWelcomeLoop();

          prevStageRef.current = active;
          firstTickDoneRef.current = true;
          return;
        }

        if (prevStageRef.current !== active) {
          const prev = stages[prevStageRef.current];
          const prevType = prev?.type;
          const newType = stage.type;

          if (prevType === "break" && newType !== "break") {
            playOneShot(BREAK_END_SOUND);
          }

          if (newType === "intro") {
            startWelcomeLoop();
          } else {
            stopWelcomeLoop();
            const sound = STAGE_SOUND_MAP[newType];
            if (sound) playOneShot(sound);
          }

          prevStageRef.current = active;
        }

        if (stage.type !== "intro" && welcomeLoopRef.current) {
          stopWelcomeLoop();
        }
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [stagebarStartTime, stages, isSilentRoom, isInfiniteRoom, stagebarCycleSeconds]);

  // ============================================================
  // DERIVED
  // ============================================================
  const localParticipant = useMemo(
    () => participants.find((p) => p.isLocal) || null,
    [participants]
  );

  const isAudioMuted = !!localParticipant?.audioMuted;
  const isVideoMuted = !!localParticipant?.videoMuted;
  const isScreenSharing = !!localParticipant?.isScreenSharing;

  // ============================================================
  // REACTIONS MENU
  // ============================================================
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
      (engineRef.current as any)?.sendReaction?.(type);
    } catch { }

    setTimeout(() => {
      setLocalReactions((prev) => prev.filter((r) => r.id !== rid));
    }, 1500);
  };

  // ============================================================
  // RIGHT PANEL CONTENT
  // ============================================================
  const [participantsSearch, setParticipantsSearch] = useState("");

  const filteredParticipants = useMemo(() => {
    const q = participantsSearch.trim().toLowerCase();
    if (!q) return participants;
    return participants.filter((p) =>
      (p.isLocal ? "you" : p.displayName || "guest").toLowerCase().includes(q)
    );
  }, [participants, participantsSearch]);

  const participantsCount = participants.length;

  // ============================================================
  // RENDER
  // ============================================================
  if (loading)
    return (
      <div className="flex h-screen justify-center items-center text-white bg-[#050F1A]">
        Loading session...
      </div>
    );

  if (!session)
    return (
      <div className="flex h-screen justify-center items-center text-white bg-[#050F1A]">
        <button onClick={() => navigate("/sessions")}>Back</button>
      </div>
    );

  return (
    <div className="min-h-screen bg-[#050F1A] text-white flex justify-center">
      {/* ✅ pb учитывает safe-area */}
      <div className="max-w-[1720px] w-full px-5 pt-5 pb-[calc(110px+env(safe-area-inset-bottom))] flex flex-col gap-5 min-h-screen">
        {/* TOP BAR */}
        <div className="flex w-full rounded-2xl overflow-hidden bg-[#111827]/40 border border-white/5">
          <div className="flex-1 px-6 py-4">
            {/* row 1: title + right controls */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-inter font-semibold text-[18px] text-[#F3F4F6]/90 truncate">
                  {session.title}
                </p>
                <p className="font-inter text-[13px] text-[#9CA3AF]">
                  {participantsCount} participants
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* timer */}
                {!isSilentRoom && stages.length > 0 && !!stagebarStartTime && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0B1220]/70 border border-white/5">
                    <span className="text-[12px] text-white/70">⏱</span>
                    <span className="font-inter text-[14px] text-white/90">
                      {remainingTime || "--:--"}
                    </span>
                  </div>
                )}

                {session.host_profile && (
                  <button
                    onClick={() => setSelectedUser(session.host_profile)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/10 bg-[#0B1220]/60 text-[13px] text-[#F3F4F6]/85 hover:bg-[#0B1220]/80 transition font-inter"
                  >
                    <img
                      src="/icons/host_session_icon.svg"
                      className="h-5 w-5 opacity-90"
                      alt=""
                    />
                    <span className="flex items-center gap-1">
                      <span className="font-normal text-white/70">Host:</span>
                      <span className="font-semibold">
                        {session.host_profile.full_name}
                      </span>
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* ✅ row 2: StageBar FULL WIDTH */}
            {!isSilentRoom && stages.length > 0 && !!stagebarStartTime && (
              <div className="mt-3 w-full">
                <SessionStageBar
                  stages={stages as any}
                  startTime={stagebarStartTime}
                  cycleSeconds={stagebarCycleSeconds}
                  onHoverStage={setHoveredStage as any}
                />
              </div>
            )}
          </div>
        </div>

        {/* MAIN AREA */}
        <div
          className={
            "grid gap-5 flex-1 min-h-0 " +
            (rightPanelOpen
              ? "lg:grid-cols-[minmax(0,1fr),420px]"
              : "grid-cols-1")
          }
        >
          {/* VIDEO AREA */}
          <div className="rounded-2xl bg-[#0B1220]/55 border border-white/5 shadow-lg overflow-hidden relative min-h-0">
            <div className="w-full h-full p-3 min-h-0">
              <VideoRoom
                participants={participants}
                onToggleAudio={handleToggleAudio}
                onToggleVideo={handleToggleVideo}
                onToggleScreenShare={handleToggleScreenShare}
                onLeave={handleLeave}
                activeScreenSharer={activeScreenSharer}
                incomingReactions={incomingReactions}
                localReactions={localReactions}
                showControls={false}
                onVisibleVideoIdsChange={(ids) =>
                  engineRef.current?.setVisibleVideoParticipants(ids)
                }
                audioOutputId={selectedAudioOutputId}
              />
            </div>

            {lastErr && (
              <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow">
                {lastErr}
              </div>
            )}
          </div>

          {/* RIGHT PANEL */}
          {rightPanelOpen && (
            <div className="rounded-2xl bg-[#0B1220]/55 border border-white/5 shadow-lg overflow-hidden min-h-0">
              {rightTab === "participants" && (
                <div className="h-full flex flex-col">
                  <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-white/85 font-inter font-semibold">
                        Participants
                      </span>
                      <span className="text-white/55 text-sm">
                        ({participantsCount})
                      </span>
                    </div>
                    <button
                      onClick={() => openRightTab(null)}
                      className="w-9 h-9 rounded-xl bg-[#111827] hover:bg-[#1f2937] flex items-center justify-center text-white/80"
                      title="Close"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="p-4">
                    <div className="bg-[#0B1220]/70 border border-white/10 rounded-xl px-3 py-2">
                      <input
                        value={participantsSearch}
                        onChange={(e) => setParticipantsSearch(e.target.value)}
                        placeholder="Search participants..."
                        className="w-full bg-transparent outline-none text-[13px] text-white/85 placeholder:text-white/35"
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-4 pb-4">
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
                            className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/5 transition"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-full bg-emerald-500/80 flex items-center justify-center text-[#02140B] font-semibold">
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <div className="text-[13px] text-white/90 font-medium truncate">
                                  {name}
                                </div>
                                <div className="text-[11px] text-white/45 truncate">
                                  {p.isLocal ? "Team member" : "Participant"}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <div
                                className={
                                  "w-8 h-8 rounded-lg flex items-center justify-center " +
                                  (p.audioMuted
                                    ? "bg-red-500/20 text-red-300"
                                    : "bg-white/5 text-white/65")
                                }
                                title={p.audioMuted ? "Muted" : "Unmuted"}
                              >
                                <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
                                  <path
                                    d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"
                                    fill="currentColor"
                                  />
                                  <path
                                    d="M6 11a1 1 0 0 0-2 0 8 8 0 0 0 7 7.93V21H9a1 1 0 0 0 0 2h6a1 1 0 1 0 0-2h-2v-2.07A8 8 0 0 0 20 11a1 1 0 0 0-2 0 6 6 0 0 1-12 0z"
                                    fill="currentColor"
                                    opacity="0.85"
                                  />
                                </svg>
                              </div>

                              <div
                                className={
                                  "w-8 h-8 rounded-lg flex items-center justify-center " +
                                  (p.videoMuted
                                    ? "bg-red-500/20 text-red-300"
                                    : "bg-white/5 text-white/65")
                                }
                                title={p.videoMuted ? "Video off" : "Video on"}
                              >
                                <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
                                  <rect x="4" y="6" width="11" height="12" rx="2" fill="currentColor" />
                                  <path d="M17 9.5 21 7v10l-4-2.5z" fill="currentColor" opacity="0.85" />
                                </svg>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="p-4 border-t border-white/5">
                    <button
                      onClick={() => { }}
                      className="w-full h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-[#02140B] font-semibold flex items-center justify-center gap-2"
                    >
                      <span className="text-lg">+</span>
                      <span>Invite People</span>
                    </button>
                  </div>
                </div>
              )}

              {rightTab === "chat" && (
                <div className="h-full">
                  <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                    <div className="text-white/85 font-inter font-semibold">Chat</div>
                    <button
                      onClick={() => openRightTab(null)}
                      className="w-9 h-9 rounded-xl bg-[#111827] hover:bg-[#1f2937] flex items-center justify-center text-white/80"
                      title="Close"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="p-4 h-[calc(100%-64px)]">
                    {session?.id ? <ChatPanel sessionId={session.id} /> : null}
                  </div>
                </div>
              )}

              {rightTab === "intentions" && (
                <div className="h-full">
                  <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                    <div className="text-white/85 font-inter font-semibold">Intentions</div>
                    <button
                      onClick={() => openRightTab(null)}
                      className="w-9 h-9 rounded-xl bg-[#111827] hover:bg-[#1f2937] flex items-center justify-center text-white/80"
                      title="Close"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="h-[calc(100%-64px)]">
                    <IntentionsPanel />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ✅ FIXED BOTTOM CONTROLS (RESPONSIVE, NO OVERFLOW) */}
      <div className="fixed inset-x-0 bottom-0 z-50">
        <div className="max-w-[1720px] mx-auto px-3 sm:px-5 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <div className="h-[64px] sm:h-[74px] rounded-2xl bg-[#07101E]/85 border border-white/10 shadow-2xl backdrop-blur grid grid-cols-[auto,1fr,auto] items-center px-2 sm:px-4">
            {/* LEFT GROUP */}
            <div className="flex items-center gap-1 sm:gap-2">
              <button onClick={() => openRightTab("participants")} className="outline-none">
                <div className="w-10 h-10 sm:w-11 sm:h-11">
                  <ParticipantsIcon active={rightPanelOpen && rightTab === "participants"} />
                </div>
              </button>

              <button onClick={() => openRightTab("chat")} className="outline-none">
                <div className="w-10 h-10 sm:w-11 sm:h-11">
                  <ChatIcon active={rightPanelOpen && rightTab === "chat"} />
                </div>
              </button>

              <button onClick={() => openRightTab("intentions")} className="outline-none">
                <div className="w-10 h-10 sm:w-11 sm:h-11">
                  <IntentionsIcon active={rightPanelOpen && rightTab === "intentions"} />
                </div>
              </button>
            </div>

            {/* CENTER GROUP */}
            <div className="flex items-center justify-center gap-2 sm:gap-3">
              <button
                onClick={() => engineRef.current?.toggleAudioMute()}
                className={
                  "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                  (isAudioMuted
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-[#111827] hover:bg-[#1f2937]")
                }
                title="Toggle mic"
              >
                <MicIcon />
              </button>

              <button
                onClick={() => engineRef.current?.toggleVideoMute()}
                className={
                  "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                  (isVideoMuted
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-[#111827] hover:bg-[#1f2937]")
                }
                title="Toggle camera"
              >
                <CameraIcon />
              </button>

              <button
                onClick={() => engineRef.current?.toggleScreenShare()}
                className={
                  "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                  (isScreenSharing
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "bg-[#111827] hover:bg-[#1f2937]")
                }
                title="Share screen"
              >
                <ScreenIcon />
              </button>

              {/* reactions */}
              <div className="relative" ref={reactionsMenuRef}>
                <button
                  onClick={() => setShowReactionsMenu((v) => !v)}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition bg-[#111827] hover:bg-[#1f2937]"
                  title="Reactions"
                >
                  <SmileIcon />
                </button>

                {showReactionsMenu && (
                  <div className="absolute bottom-[54px] sm:bottom-[58px] left-1/2 -translate-x-1/2 bg-[#020617] border border-white/10 rounded-2xl px-3 py-2 flex gap-2 text-xl shadow-xl">
                    {(
                      ["fire", "laugh", "clap", "heart", "thumbsUp", "thumbsDown"] as ReactionType[]
                    ).map((t) => (
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
                onClick={() => {
                  setSettingsOpen(true);
                  setTimeout(() => loadDevices(), 0);
                }}
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition bg-[#111827] hover:bg-[#1f2937] text-white/85"
                title="Settings"
              >
                <SettingsIcon />
              </button>

              {/* Desktop leave */}
              <button
                onClick={handleLeave}
                className="hidden sm:flex h-11 px-6 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-semibold items-center justify-center gap-2"
                title="Leave"
              >
                <span className="text-[14px]">Leave</span>
              </button>

              {/* Mobile leave icon-only */}
              <button
                onClick={handleLeave}
                className="sm:hidden w-10 h-10 rounded-2xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center"
                title="Leave"
              >
                <LeaveIcon />
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
          setSelectedVideoInputId(next.videoInputId || "");
          setSelectedAudioInputId(next.audioInputId || "");
          setSelectedAudioOutputId(next.audioOutputId || "default");
          setBgMode(next.bgMode);
          setBgImageUrl(next.bgImageUrl || "");
        }}
        onApply={async (next) => {
          await applyMediaSettings(next);
          setSettingsOpen(false);
        }}
      />

      {selectedUser && (
        <UserProfileModal user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  );
}

export default RoomPage;
