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
import { RoomMediaSettingsModal, RoomMediaSettings } from "../components/RoomMediaSettingsModal";
import { useAttendancePresence } from "../hooks/useAttendancePresence";

type Stage = {
  name: string;
  duration: number; // minutes
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
        <path d="M8 13c-2.67 0-8 1.34-8 4v2h12v-2c0-2.66-5.33-4-4-4z" fill="currentColor" />
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
      <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" fill="currentColor" />
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
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
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
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 7.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.51.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.21.08.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z"
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

function stageMetaFromName(name: string): { type: Stage["type"]; color: string } {
  const lower = (name || "").toLowerCase();

  const type: Stage["type"] =
    lower.includes("welcome") || lower.includes("intro")
      ? "intro"
      : lower.includes("intention") || lower.includes("checkin")
        ? "intentions"
        : lower.includes("focus")
          ? "focus"
          : lower.includes("break") || lower.includes("pause")
            ? "break"
            : lower.includes("farewell") || lower.includes("celebrat") || lower.includes("outro")
              ? "outro"
              : "focus";

  const color =
    (
      {
        intro: "#80DF86",
        intentions: "#ADD3FF",
        focus: "#4CA0FF",
        break: "#F9ADA2",
        outro: "#80DF86",
      } as Record<string, string>
    )[type] || "#F63135";

  return { type, color };
}

// ✅ parse schedule: supports BOTH formats
function parseScheduleToStages(schedule: any): { stages: Stage[]; anchorISO: string | null } {
  if (!schedule) return { stages: [], anchorISO: null };

  try {
    const parsed = typeof schedule === "string" ? JSON.parse(schedule) : schedule;

    // 1) NEW preferred format: array [{name, minutes}]
    if (Array.isArray(parsed)) {
      const stages: Stage[] = parsed
        .map((b: any) => {
          const name = String(b?.name || "").trim();
          const minutes = Number(b?.minutes);
          if (!name || !Number.isFinite(minutes) || minutes <= 0) return null;

          const meta = stageMetaFromName(name);
          return { name, duration: minutes, color: meta.color, type: meta.type };
        })
        .filter(Boolean) as Stage[];

      return { stages, anchorISO: null };
    }

    // 2) OLD infinite format: { kind: "infinite_room", timer: { phases }, anchor_ts }
    if (parsed && typeof parsed === "object" && parsed.kind === "infinite_room" && parsed.timer?.phases) {
      const phases = Array.isArray(parsed.timer.phases) ? parsed.timer.phases : [];
      const anchorISO = parsed.anchor_ts ? String(parsed.anchor_ts) : null;

      const stages: Stage[] = phases
        .map((p: any) => {
          const phaseNameRaw = String(p?.name || "").toLowerCase();
          const seconds = Number(p?.seconds);

          if (!phaseNameRaw || !Number.isFinite(seconds) || seconds <= 0) return null;

          // map phase names -> human names
          const niceName =
            phaseNameRaw === "focus"
              ? "Focus"
              : phaseNameRaw === "checkin"
                ? "Intentions (spoken)"
                : phaseNameRaw === "break"
                  ? "Break"
                  : phaseNameRaw;

          const minutes = Math.round(seconds / 60);
          const meta = stageMetaFromName(niceName);
          return { name: niceName, duration: minutes, color: meta.color, type: meta.type };
        })
        .filter(Boolean) as Stage[];

      return { stages, anchorISO };
    }

    return { stages: [], anchorISO: null };
  } catch {
    return { stages: [], anchorISO: null };
  }
}

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
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState<string>("default");

  const [bgMode, setBgMode] = useState<"none" | "blur" | "image">("none");
  const [bgImageUrl, setBgImageUrl] = useState<string>("");

  const [stages, setStages] = useState<Stage[]>([]);
  const [hoveredStage, setHoveredStage] = useState<Stage | null>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const [remainingTime, setRemainingTime] = useState<string>("");

  const [selectedUser, setSelectedUser] = useState<any>(null);

  const [userName, setUserName] = useState<string>("");
  const [lastErr, setLastErr] = useState<string>("");
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  const engineRef = useRef<JitsiEngine | null>(null);
  const [participants, setParticipants] = useState<JitsiParticipant[]>([]);

  // ★ SOUND WHEN USER JOINS
  const prevCountRef = useRef<number>(0);

  // ★ TRACK SCREEN SHARER
  const [activeScreenSharer, setActiveScreenSharer] = useState<string | null>(null);

  // ★ REACTIONS RECEIVED FROM OTHER USERS
  const [incomingReactions, setIncomingReactions] = useState<{ id: number; type: ReactionType }[]>([]);
  const reactionIdRef = useRef<number>(0);

  // ★ LOCAL REACTIONS (FOR OVERLAY)
  const [localReactions, setLocalReactions] = useState<{ id: number; type: ReactionType }[]>([]);
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

  // ✅ session type helpers
  const sessionFormatType = useMemo(() => String(session?.session_format_type || "group").toLowerCase(), [session]);
  const isInfiniteRoom = sessionFormatType === "infinite";

  // ✅ SILENT ROOM DETECTION
  const isSilentRoom = useMemo(() => {
    // 1) explicit flag (best)
    if (session?.is_silent === true) return true;

    // 2) fallback: name/format/template contains "silent"
    const fmt = String(session?.format || "").toLowerCase();
    const title = String(session?.title || "").toLowerCase();

    const tpl = session?.session_templates;
    const tplName = Array.isArray(tpl)
      ? String(tpl?.[0]?.name || tpl?.[0]?.title || "")
      : String(tpl?.name || tpl?.title || "");
    const tplKey = Array.isArray(tpl)
      ? String(tpl?.[0]?.key || tpl?.[0]?.slug || tpl?.[0]?.type || "")
      : String(tpl?.key || tpl?.slug || tpl?.type || "");
    const tplFmt = Array.isArray(tpl) ? String(tpl?.[0]?.format || "") : String(tpl?.format || "");

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
  // LOAD SESSION
  // ============================================================
  const [stageAnchorISO, setStageAnchorISO] = useState<string>("");

  useEffect(() => {
    (async () => {
      if (!id) return;

      const { data, error } = await supabase
        .from("sessions")
        .select("*, created_at, host_profile:profiles!sessions_host_id_fkey(id, full_name, avatar_url, bio), session_templates(*)")
        .eq("id", id)
        .single();

      if (data && !error) {
        setSession(data);

        const { stages: parsedStages, anchorISO } = parseScheduleToStages(data.schedule);
        if (parsedStages?.length) setStages(parsedStages);

        // ✅ anchor time priority:
        // 1) schedule.anchor_ts (old infinite)
        // 2) session.start_time
        // 3) created_at
        // 4) now
        const anchor =
          anchorISO ||
          (data.start_time ? String(data.start_time) : null) ||
          (data.created_at ? String(data.created_at) : null) ||
          new Date().toISOString();

        setStageAnchorISO(anchor);
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
        const { data: p } = await supabase.from("profiles").select("full_name").eq("id", u.id).single();
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
            if (session?.host_profile?.full_name && session.host_profile.id === p.id) {
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

      onReactionReceived: (fromId, reaction) => {
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

    engine.initAndJoin(safeRoomName || `session-${session.id}`, userName || "Guest").catch((e) => {
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
  // STAGES TIMER (group linear, infinite loops)
  // ============================================================
  useEffect(() => {
    // silent rooms: no stage timer & no sounds
    if (isSilentRoom) {
      setRemainingTime("");
      setCurrentStage(0);
      firstTickDoneRef.current = false;
      prevStageRef.current = -1;
      stopWelcomeLoop();
      return;
    }

    if (!stageAnchorISO || !stages.length) return;

    const totalSec = stages.reduce((sum, s) => sum + s.duration * 60, 0);
    const totalSecSafe = Math.max(1, totalSec);

    const tick = () => {
      const now = Date.now();
      const anchorMs = new Date(stageAnchorISO).getTime();
      const rawElapsedSec = Math.max(0, Math.floor((now - anchorMs) / 1000));

      const elapsedSec = isInfiniteRoom ? rawElapsedSec % totalSecSafe : rawElapsedSec;

      let total = 0;
      let active = stages.length - 1;

      for (let i = 0; i < stages.length; i++) {
        const next = total + stages[i].duration * 60;
        if (elapsedSec < next) {
          active = i;
          const rem = next - elapsedSec;
          setRemainingTime(`${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, "0")}`);
          break;
        }
        total = next;
      }

      const stage = stages[active];

      if (!firstTickDoneRef.current) {
        if (stage.type === "intro") startWelcomeLoop();
        else stopWelcomeLoop();

        prevStageRef.current = active;
        firstTickDoneRef.current = true;
        setCurrentStage(active);
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

      setCurrentStage(active);
    };

    // initial tick immediately
    tick();

    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [stageAnchorISO, stages, isSilentRoom, isInfiniteRoom]);

  // ============================================================
  // DERIVED
  // ============================================================
  const localParticipant = useMemo(() => participants.find((p) => p.isLocal) || null, [participants]);

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
    return participants.filter((p) => (p.isLocal ? "you" : p.displayName || "guest").toLowerCase().includes(q));
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
      <div className="max-w-[1720px] w-full px-5 pt-5 pb-[110px] flex flex-col gap-5 min-h-screen">
        {/* TOP BAR */}
        <div className="flex w-full rounded-2xl overflow-hidden bg-[#111827]/40 border border-white/5">
          <div className="flex-1 px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-inter font-semibold text-[18px] text-[#F3F4F6]/90 truncate">
                  {session.title}
                </p>
                <p className="font-inter text-[13px] text-[#9CA3AF]">{participantsCount} participants</p>

                {/* ✅ StageBar: render for infinite + group; hide for silent */}
                {!isSilentRoom && stages.length > 0 && stageAnchorISO && (
                  <div className="mt-2 max-h-[14px] overflow-hidden">
                    <div className="origin-left scale-y-[0.72]">
                      <SessionStageBar
                        stages={stages}
                        startTime={stageAnchorISO}
                        cycle={isInfiniteRoom}
                        onHoverStage={setHoveredStage}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* ✅ Timer: hide for silent */}
                {!isSilentRoom && stages.length > 0 && stageAnchorISO && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0B1220]/70 border border-white/5">
                    <span className="text-[12px] text-white/70">⏱</span>
                    <span className="font-inter text-[14px] text-white/90">{remainingTime || "--:--"}</span>
                  </div>
                )}

                {session.host_profile && (
                  <button
                    onClick={() => setSelectedUser(session.host_profile)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/10 bg-[#0B1220]/60 text-[13px] text-[#F3F4F6]/85 hover:bg-[#0B1220]/80 transition font-inter"
                  >
                    <img src="/icons/host_session_icon.svg" className="h-5 w-5 opacity-90" />
                    <span className="flex items-center gap-1">
                      <span className="font-normal text-white/70">Host:</span>
                      <span className="font-semibold">{session.host_profile.full_name}</span>
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* MAIN AREA */}
        <div className={"grid gap-5 flex-1 min-h-0 " + (rightPanelOpen ? "lg:grid-cols-[minmax(0,1fr),420px]" : "grid-cols-1")}>
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
                onVisibleVideoIdsChange={(ids) => engineRef.current?.setVisibleVideoParticipants(ids)}
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
                      <span className="text-white/85 font-inter font-semibold">Participants</span>
                      <span className="text-white/55 text-sm">({participantsCount})</span>
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
                                <div className="text-[13px] text-white/90 font-medium truncate">{name}</div>
                                <div className="text-[11px] text-white/45 truncate">
                                  {p.isLocal ? "Team member" : "Participant"}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <div
                                className={
                                  "w-8 h-8 rounded-lg flex items-center justify-center " +
                                  (p.audioMuted ? "bg-red-500/20 text-red-300" : "bg-white/5 text-white/65")
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
                                  (p.videoMuted ? "bg-red-500/20 text-red-300" : "bg-white/5 text-white/65")
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
                  <div className="p-4 h-[calc(100%-64px)]">{session?.id ? <ChatPanel sessionId={session.id} /> : null}</div>
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

      {/* FIXED BOTTOM CONTROLS */}
      <div className="fixed inset-x-0 bottom-0 z-50">
        <div className="max-w-[1720px] mx-auto px-5 pb-5">
          <div className="h-[74px] rounded-2xl bg-[#07101E]/85 border border-white/10 shadow-2xl backdrop-blur flex items-center justify-between px-4">
            {/* LEFT GROUP */}
            <div className="flex items-center gap-2">
              <button onClick={() => openRightTab("participants")} className="outline-none">
                <ParticipantsIcon active={rightPanelOpen && rightTab === "participants"} />
              </button>

              <button onClick={() => openRightTab("chat")} className="outline-none">
                <ChatIcon active={rightPanelOpen && rightTab === "chat"} />
              </button>

              <button onClick={() => openRightTab("intentions")} className="outline-none">
                <IntentionsIcon active={rightPanelOpen && rightTab === "intentions"} />
              </button>
            </div>

            {/* CENTER GROUP */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleToggleAudio}
                className={
                  "w-11 h-11 rounded-2xl flex items-center justify-center transition " +
                  (isAudioMuted ? "bg-red-600 hover:bg-red-700" : "bg-[#111827] hover:bg-[#1f2937]")
                }
                title="Toggle mic"
              >
                <MicIcon />
              </button>

              <button
                onClick={handleToggleVideo}
                className={
                  "w-11 h-11 rounded-2xl flex items-center justify-center transition " +
                  (isVideoMuted ? "bg-red-600 hover:bg-red-700" : "bg-[#111827] hover:bg-[#1f2937]")
                }
                title="Toggle camera"
              >
                <CameraIcon />
              </button>

              <button
                onClick={handleToggleScreenShare}
                className={
                  "w-11 h-11 rounded-2xl flex items-center justify-center transition " +
                  (isScreenSharing ? "bg-blue-600 hover:bg-blue-700" : "bg-[#111827] hover:bg-[#1f2937]")
                }
                title="Share screen"
              >
                <ScreenIcon />
              </button>

              {/* reactions */}
              <div className="relative" ref={reactionsMenuRef}>
                <button
                  onClick={() => setShowReactionsMenu((v) => !v)}
                  className="w-11 h-11 rounded-2xl flex items-center justify-center transition bg-[#111827] hover:bg-[#1f2937]"
                  title="Reactions"
                >
                  <SmileIcon />
                </button>

                {showReactionsMenu && (
                  <div className="absolute bottom-[58px] left-1/2 -translate-x-1/2 bg-[#020617] border border-white/10 rounded-2xl px-3 py-2 flex gap-2 text-xl shadow-xl">
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
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setSettingsOpen(true);
                  setTimeout(() => loadDevices(), 0);
                }}
                className="w-11 h-11 rounded-2xl flex items-center justify-center transition bg-[#111827] hover:bg-[#1f2937] text-white/85"
                title="Settings"
              >
                <SettingsIcon />
              </button>

              <button
                onClick={handleLeave}
                className="h-11 px-6 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-semibold flex items-center justify-center gap-2"
                title="Leave"
              >
                <span className="text-[14px]">Leave</span>
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

      {selectedUser && <UserProfileModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
    </div>
  );
}

export default RoomPage;
