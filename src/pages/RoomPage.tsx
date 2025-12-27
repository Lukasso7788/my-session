// src/pages/RoomPage.tsx
// ROOMPAGE + JITSI ENGINE + VIDEO UI (UPDATED WITH REACTIONS)
// ✅ Updated: full-width layout (no max-w clamp), unified FILLED icons,
// ✅ Video area border removed, keep tiny page gutters (24-40px),
// ✅ BottomControls full width,
// ✅ Video tiles reset fix is in VideoRoom (no unmount of <video> on mute)

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

import { useAttendancePresence } from "../hooks/useAttendancePresence";

type Stage = {
  name: string;
  duration: number; // minutes (for display / legacy)
  color: string;
  type: "intro" | "intentions" | "focus" | "break" | "outro" | string;
};

type RightPanelTab = "participants" | "chat" | "intentions" | null;

/* ============================================================
   ✅ FILLED ICON SET (unified style)
   ============================================================ */

function IconMic({ off }: { off?: boolean }) {
  // filled mic + slash when off
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      {!off ? (
        <>
          <path
            d="M12 3a3.25 3.25 0 0 1 3.25 3.25v5.5A3.25 3.25 0 0 1 12 15a3.25 3.25 0 0 1-3.25-3.25v-5.5A3.25 3.25 0 0 1 12 3Z"
            fill="currentColor"
          />
          <path
            d="M6.25 11a.95.95 0 0 0-1.9 0 7.65 7.65 0 0 0 6.7 7.6V20H9.25a.95.95 0 0 0 0 1.9h5.5a.95.95 0 0 0 0-1.9H13v-1.4a7.65 7.65 0 0 0 6.7-7.6.95.95 0 0 0-1.9 0 5.8 5.8 0 0 1-11.6 0Z"
            fill="currentColor"
            opacity="0.92"
          />
        </>
      ) : (
        <>
          <path
            d="M12 3a3.25 3.25 0 0 1 3.25 3.25v4.2c0 .35-.03.68-.1 1l-6.3-6.3A3.25 3.25 0 0 1 12 3Z"
            fill="currentColor"
          />
          <path
            d="M7.4 6.2 6.06 4.86a.95.95 0 0 0-1.35 1.35l1.38 1.38v4.16A3.25 3.25 0 0 0 9.34 15c.4.05.8.06 1.2.04l1.92 1.92c-.15.01-.31.02-.46.02a5.8 5.8 0 0 1-5.8-5.8.95.95 0 0 0-1.9 0 7.65 7.65 0 0 0 6.7 7.6V20H9.25a.95.95 0 0 0 0 1.9h5.5a.95.95 0 0 0 0-1.9H13v-1.44c.45-.07.9-.18 1.32-.32l2.62 2.62a.95.95 0 1 0 1.35-1.35L7.4 6.2Z"
            fill="currentColor"
            opacity="0.92"
          />
        </>
      )}
    </svg>
  );
}

function IconCamera({ off }: { off?: boolean }) {
  // filled camera + slash when off
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      {!off ? (
        <>
          <path
            d="M8 6.25h5.6c.35 0 .68.14.93.39l1.02 1.02H18.3c1.1 0 2 .9 2 2v6.2c0 1.1-.9 2-2 2H8c-1.1 0-2-.9-2-2V8.25c0-1.1.9-2 2-2Z"
            fill="currentColor"
          />
          <path
            d="M15.85 12.2 21 9.3v5.4l-5.15-2.9a.8.8 0 0 1 0-1.6Z"
            fill="currentColor"
            opacity="0.9"
          />
        </>
      ) : (
        <>
          <path
            d="M8 6.25h5.2c.35 0 .68.14.93.39l1.02 1.02H18.3c1.1 0 2 .9 2 2v4.5l-3.2-3.2 3.2-1.8v-. -"
            fill="none"
          />
          <path
            d="M6.12 4.86a.95.95 0 1 0-1.35 1.35l1.28 1.28A1.98 1.98 0 0 0 6 8.25v7.6c0 1.1.9 2 2 2h10.3c.3 0 .59-.07.85-.19l1.08 1.08a.95.95 0 1 0 1.35-1.35L6.12 4.86Zm8.26 8.26L8.01 6.75H13.2c.35 0 .68.14.93.39l1.02 1.02H18.3c1.1 0 2 .9 2 2v5.08l-5.23-5.23-.7.4a.8.8 0 0 0-.39.7.8.8 0 0 0 .39.7Z"
            fill="currentColor"
          />
          <path
            d="M21 9.3v5.4l-2.46-1.39-3.65-3.65L21 9.3Z"
            fill="currentColor"
            opacity="0.9"
          />
        </>
      )}
    </svg>
  );
}

function IconScreenShare({ active }: { active?: boolean }) {
  // filled monitor + arrow
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <path
        d="M4.2 4.8h15.6c1.1 0 2 .9 2 2v8.6c0 1.1-.9 2-2 2H4.2c-1.1 0-2-.9-2-2V6.8c0-1.1.9-2 2-2Z"
        fill="currentColor"
        opacity={active ? 1 : 0.95}
      />
      <path
        d="M9 20.2h6a.95.95 0 0 0 0-1.9H9a.95.95 0 0 0 0 1.9Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M12.2 9.2a.9.9 0 0 1 1.27 0l2.2 2.2a.9.9 0 0 1-1.27 1.27l-.65-.65v2.35a.9.9 0 1 1-1.8 0v-2.35l-.65.65A.9.9 0 1 1 10.05 11l2.15-2.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconSmile() {
  // filled smile
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <path
        d="M12 2.75c-5.1 0-9.25 4.15-9.25 9.25S6.9 21.25 12 21.25 21.25 17.1 21.25 12 17.1 2.75 12 2.75Z"
        fill="currentColor"
        opacity="0.95"
      />
      <path
        d="M8.7 11.05a1.05 1.05 0 1 0 0-2.1 1.05 1.05 0 0 0 0 2.1Zm6.6 0a1.05 1.05 0 1 0 0-2.1 1.05 1.05 0 0 0 0 2.1Z"
        fill="#050F1A"
        opacity="0.95"
      />
      <path
        d="M8.75 13.45a.95.95 0 0 1 1.32.18c.45.58 1.07.92 1.93.92.86 0 1.48-.34 1.93-.92a.95.95 0 0 1 1.5 1.14c-.8 1.05-1.95 1.68-3.43 1.68s-2.63-.63-3.43-1.68a.95.95 0 0 1 .18-1.32Z"
        fill="#050F1A"
        opacity="0.95"
      />
    </svg>
  );
}

function IconSettings() {
  // filled gear
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <path
        d="M19.6 13.25c.05-.41.08-.83.08-1.25s-.03-.84-.08-1.25l1.93-1.5a.9.9 0 0 0 .22-1.15l-1.85-3.2a.9.9 0 0 0-1.08-.4l-2.28.92c-.5-.37-1.05-.68-1.64-.9l-.35-2.44a.9.9 0 0 0-.89-.77h-3.6a.9.9 0 0 0-.89.77l-.35 2.44c-.6.22-1.14.53-1.64.9l-2.28-.92a.9.9 0 0 0-1.08.4L2.25 7.1a.9.9 0 0 0 .22 1.15l1.93 1.5c-.05.41-.08.83-.08 1.25s.03.84.08 1.25l-1.93 1.5a.9.9 0 0 0-.22 1.15l1.85 3.2a.9.9 0 0 0 1.08.4l2.28-.92c.5.37 1.05.68 1.64.9l.35 2.44a.9.9 0 0 0 .89.77h3.6a.9.9 0 0 0 .89-.77l.35-2.44c.6-.22 1.14-.53 1.64-.9l2.28.92a.9.9 0 0 0 1.08-.4l1.85-3.2a.9.9 0 0 0-.22-1.15l-1.93-1.5ZM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconMore() {
  // filled 3-dots
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <circle cx="6" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="18" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

function IconLeave() {
  // filled leave/exit
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <path
        d="M5.2 5.2h7.2a1 1 0 1 1 0 2H7.2v9.6h5.2a1 1 0 1 1 0 2H5.2a1.2 1.2 0 0 1-1.2-1.2V6.4a1.2 1.2 0 0 1 1.2-1.2Z"
        fill="currentColor"
        opacity="0.95"
      />
      <path
        d="M13.65 8.35a1 1 0 0 1 1.4 0L19.2 12l-4.15 3.65a1 1 0 0 1-1.4-1.4L15.3 13H11a1 1 0 1 1 0-2h4.3l-1.65-1.25a1 1 0 0 1 0-1.4Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ParticipantsIcon() {
  // filled people
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <path
        d="M12 11.6a3.7 3.7 0 1 0-3.7-3.7 3.7 3.7 0 0 0 3.7 3.7Z"
        fill="currentColor"
      />
      <path
        d="M4.2 20.2c0-3.55 3.55-6.4 7.8-6.4s7.8 2.85 7.8 6.4v.55H4.2v-.55Z"
        fill="currentColor"
        opacity="0.92"
      />
    </svg>
  );
}

function ChatIcon() {
  // filled chat bubble
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <path
        d="M6.2 4.6h11.6a2.2 2.2 0 0 1 2.2 2.2v8.2a2.2 2.2 0 0 1-2.2 2.2H10l-4.4 2.65v-2.65H6.2A2.2 2.2 0 0 1 4 15V6.8a2.2 2.2 0 0 1 2.2-2.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function TargetIcon() {
  // filled target
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <path
        d="M12 2.75c-5.1 0-9.25 4.15-9.25 9.25S6.9 21.25 12 21.25 21.25 17.1 21.25 12 17.1 2.75 12 2.75Z"
        fill="currentColor"
        opacity="0.35"
      />
      <path
        d="M12 6.1a5.9 5.9 0 1 0 0 11.8 5.9 5.9 0 0 0 0-11.8Z"
        fill="currentColor"
        opacity="0.55"
      />
      <path
        d="M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
        fill="currentColor"
      />
    </svg>
  );
}

/* ============================================================
   helpers
   ============================================================ */

const reactionEmoji: Record<ReactionType, string> = {
  fire: "🔥",
  laugh: "😂",
  clap: "👏",
  heart: "❤️",
  thumbsUp: "👍",
  thumbsDown: "👎",
};

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

function normalizeInfinitePhases(
  anyPhases: any
): { name: string; seconds: number }[] {
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

    // heuristic: 50/5/5 often stored as minutes
    if (n <= 180) return n * 60;

    return n;
  };

  if (Array.isArray(anyPhases)) {
    return anyPhases
      .map((p: any) => {
        const name = String(p?.name || p?.key || p?.type || "");
        const seconds = toSeconds(p);
        return { name, seconds };
      })
      .filter((x) => x.seconds > 0);
  }

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

  const prevCountRef = useRef<number>(0);

  const [activeScreenSharer, setActiveScreenSharer] = useState<string | null>(
    null
  );

  const [incomingReactions, setIncomingReactions] = useState<
    { id: number; type: ReactionType }[]
  >([]);
  const reactionIdRef = useRef<number>(0);

  const [localReactions, setLocalReactions] = useState<
    { id: number; type: ReactionType }[]
  >([]);
  const localReactionIdRef = useRef<number>(0);

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

  const isInfiniteRoom = useMemo(() => {
    const raw = session?.schedule;

    if (parse50505(raw)) return true;

    const parsed = safeParseJson(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return false;

    const kind = String((parsed as any)?.kind || "").toLowerCase();
    if (kind === "infinite_room") return true;
    if (kind.includes("infinite")) return true;

    if ((parsed as any)?.timer?.phases) return true;
    if ((parsed as any)?.timer?.segments) return true;
    if ((parsed as any)?.phases) return true;
    if ((parsed as any)?.segments) return true;

    return false;
  }, [session]);

  const isSilentRoom = useMemo(() => {
    const fmt = String(session?.format || "").toLowerCase();
    const title = String(session?.title || "").toLowerCase();

    const tpl = session?.session_templates;
    const tplName =
      Array.isArray(tpl)
        ? String(tpl?.[0]?.name || tpl?.[0]?.title || "")
        : String(tpl?.name || tpl?.title || "");
    const tplKey =
      Array.isArray(tpl)
        ? String(tpl?.[0]?.key || tpl?.[0]?.slug || tpl?.[0]?.type || "")
        : String(tpl?.key || tpl?.slug || tpl?.type || "");
    const tplFmt =
      Array.isArray(tpl)
        ? String(tpl?.[0]?.format || "")
        : String(tpl?.format || "");

    const hay = `${fmt} ${title} ${tplName} ${tplKey} ${tplFmt}`.toLowerCase();
    return hay.includes("silent");
  }, [session]);

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

        setStages([]);
        setStagebarCycleSeconds(undefined);
        setStagebarStartTime("");

        const fallbackStart = String(
          data?.start_time || data?.created_at || new Date().toISOString()
        );

        let parsed: any = safeParseJson(data.schedule);

        if (!parsed) {
          const t = parse50505(data.schedule);
          if (t) {
            parsed = {
              kind: "infinite_room",
              timer: {
                phases: {
                  focus: t.focus,
                  break: t.break,
                  intentions: t.intentions,
                },
              },
              anchor_ts: data?.start_time || data?.created_at || fallbackStart,
            };
          }
        }

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

        const isInfiniteScheduleObject =
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          (String((parsed as any)?.kind || "")
            .toLowerCase()
            .includes("infinite") ||
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

        if (!parsed) {
          setStagebarStartTime(fallbackStart);
        }
      }

      setLoading(false);
    })();
  }, [id]);

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

  useAttendancePresence(id && authUserId ? id : null, { heartbeatMs: 10_000 });

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
  }, [
    stagebarStartTime,
    stages,
    isSilentRoom,
    isInfiniteRoom,
    stagebarCycleSeconds,
  ]);

  const localParticipant = useMemo(
    () => participants.find((p) => p.isLocal) || null,
    [participants]
  );

  const isAudioMuted = !!localParticipant?.audioMuted;
  const isVideoMuted = !!localParticipant?.videoMuted;
  const isScreenSharing = !!localParticipant?.isScreenSharing;

  const [showReactionsMenu, setShowReactionsMenu] = useState(false);
  const reactionsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showReactionsMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!reactionsMenuRef.current || !target) return;
      if (!reactionsMenuRef.current.contains(target))
        setShowReactionsMenu(false);
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
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
  }, []);

  const [participantsSearch, setParticipantsSearch] = useState("");

  const filteredParticipants = useMemo(() => {
    const q = participantsSearch.trim().toLowerCase();
    if (!q) return participants;
    return participants.filter((p) =>
      (p.isLocal ? "you" : p.displayName || "guest")
        .toLowerCase()
        .includes(q)
    );
  }, [participants, participantsSearch]);

  const participantsCount = participants.length;

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
    <div className="min-h-screen bg-[#050F1A] text-white">
      {/* ✅ Full-width container, small gutters (24-40px) */}
      <div className="w-full px-6 sm:px-8 lg:px-10 pt-5 pb-[calc(110px+env(safe-area-inset-bottom))] flex flex-col gap-5 min-h-screen">
        {/* TOP BAR */}
        <div className="flex w-full rounded-2xl overflow-hidden bg-[#111827]/40 border border-white/5">
          <div className="flex-1 px-6 py-4">
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
                    className="max-[480px]:hidden flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/10 bg-[#0B1220]/60 text-[13px] text-[#F3F4F6]/85 hover:bg-[#0B1220]/80 transition font-inter"
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

            {/* StageBar */}
            {!isSilentRoom && stages.length > 0 && !!stagebarStartTime && (
              <div className="mt-3 w-full overflow-hidden">
                <div className="w-full overflow-hidden">
                  <SessionStageBar
                    stages={stages as any}
                    startTime={stagebarStartTime}
                    cycleSeconds={stagebarCycleSeconds}
                    onHoverStage={setHoveredStage as any}
                  />
                </div>
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
          {/* VIDEO AREA (✅ border removed) */}
          <div className="rounded-2xl bg-[#0B1220]/45 shadow-lg overflow-hidden relative min-h-0">
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
                onRegisterVideoElement={(pid, el, kind) => {
                  try {
                    (engineRef.current as any)?.registerVideoElement?.(
                      pid,
                      el,
                      kind
                    );
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
                                <IconMic off={!!p.audioMuted} />
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
                                <IconCamera off={!!p.videoMuted} />
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
                    <div className="text-white/85 font-inter font-semibold">
                      Chat
                    </div>
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
                    <div className="text-white/85 font-inter font-semibold">
                      Intentions
                    </div>
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

      {/* FIXED BOTTOM CONTROLS (✅ full width, no max-w clamp) */}
      <div className="fixed inset-x-0 bottom-0 z-50">
        <div className="w-full px-6 sm:px-8 lg:px-10 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <div className="h-[64px] sm:h-[74px] rounded-2xl bg-[#07101E]/85 border border-white/10 shadow-2xl backdrop-blur grid grid-cols-[auto,1fr,auto] items-center px-2 sm:px-4">
            {/* LEFT GROUP */}
            <div className="flex items-center gap-2" ref={moreMenuRef}>
              {/* MOBILE (<768): menu */}
              <div className="md:hidden">
                <button
                  onClick={() => setShowMoreMenu((v) => !v)}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition bg-[#111827] hover:bg-[#1f2937] text-white/85"
                  title="Menu"
                >
                  <IconMore />
                </button>

                {showMoreMenu && (
                  <div className="absolute bottom-[76px] sm:bottom-[86px] left-6 sm:left-8 lg:left-10">
                    <div className="w-[240px] rounded-2xl bg-[#020617] border border-white/10 shadow-2xl overflow-hidden">
                      <button
                        onClick={() => {
                          openRightTab("participants");
                          setShowMoreMenu(false);
                        }}
                        className="w-full px-4 py-3 text-left text-[13px] text-white/85 hover:bg-white/5 transition flex items-center gap-2"
                      >
                        <span className="opacity-90">
                          <ParticipantsIcon />
                        </span>
                        <span>Participants</span>
                      </button>

                      <button
                        onClick={() => {
                          openRightTab("chat");
                          setShowMoreMenu(false);
                        }}
                        className="w-full px-4 py-3 text-left text-[13px] text-white/85 hover:bg-white/5 transition flex items-center gap-2"
                      >
                        <span className="opacity-90">
                          <ChatIcon />
                        </span>
                        <span>Chat</span>
                      </button>

                      <button
                        onClick={() => {
                          openRightTab("intentions");
                          setShowMoreMenu(false);
                        }}
                        className="w-full px-4 py-3 text-left text-[13px] text-white/85 hover:bg-white/5 transition flex items-center gap-2"
                      >
                        <span className="opacity-90">
                          <TargetIcon />
                        </span>
                        <span>Intentions</span>
                      </button>

                      <div className="h-px bg-white/10" />

                      <button
                        onClick={() => {
                          setSettingsOpen(true);
                          setTimeout(() => loadDevices(), 0);
                          setShowMoreMenu(false);
                        }}
                        className="w-full px-4 py-3 text-left text-[13px] text-white/85 hover:bg-white/5 transition flex items-center gap-2"
                      >
                        <span className="opacity-90">
                          <IconSettings />
                        </span>
                        <span>Video settings</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* DESKTOP/TABLET (>=768) */}
              <div className="hidden md:flex items-center gap-2">
                <button
                  onClick={() => openRightTab("participants")}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition bg-[#111827] hover:bg-[#1f2937] text-white/85"
                  title="Participants"
                >
                  <ParticipantsIcon />
                </button>

                <button
                  onClick={() => openRightTab("chat")}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition bg-[#111827] hover:bg-[#1f2937] text-white/85"
                  title="Chat"
                >
                  <ChatIcon />
                </button>

                <button
                  onClick={() => openRightTab("intentions")}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition bg-[#111827] hover:bg-[#1f2937] text-white/85"
                  title="Intentions"
                >
                  <TargetIcon />
                </button>

                <button
                  onClick={() => {
                    setSettingsOpen(true);
                    setTimeout(() => loadDevices(), 0);
                  }}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition bg-[#111827] hover:bg-[#1f2937] text-white/85"
                  title="Video settings"
                >
                  <IconSettings />
                </button>
              </div>
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
                <IconMic off={isAudioMuted} />
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
                <IconCamera off={isVideoMuted} />
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
                <IconScreenShare active={isScreenSharing} />
              </button>

              {/* reactions */}
              <div className="relative" ref={reactionsMenuRef}>
                <button
                  onClick={() => setShowReactionsMenu((v) => !v)}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition bg-[#111827] hover:bg-[#1f2937]"
                  title="Reactions"
                >
                  <IconSmile />
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
              {/* Desktop leave (✅ with icon) */}
              <button
                onClick={handleLeave}
                className="hidden sm:flex h-11 px-6 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-semibold items-center justify-center gap-2"
                title="Leave"
              >
                <IconLeave />
                <span className="text-[14px]">Leave</span>
              </button>

              {/* Mobile leave icon-only */}
              <button
                onClick={handleLeave}
                className="sm:hidden w-10 h-10 rounded-2xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center"
                title="Leave"
              >
                <IconLeave />
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
        <UserProfileModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  );
}

export default RoomPage;
