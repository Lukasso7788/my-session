// src/pages/RoomPage.tsx
// ROOMPAGE + JITSI ENGINE + VIDEO UI (UPDATED WITH REACTIONS)

/*
================================================================================
CHANGELOG (AS CODE)
================================================================================
ADD:
- Right drawer state:
  - const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  - const [rightPanelTab, setRightPanelTab] = useState<"intentions"|"chat">("intentions");
  - toggleRightPanel(tab) helper
- Bottom-left overlay buttons (Intentions / Chat) to open/close right drawer.
- Single "frame" layout (like screenshot): header inside the main card + content below.
- Participants count shown in header.

CHANGE:
- SessionStageBar moved into the header (under title) to match screenshot area.
- Video + Right panel are now inside ONE container (divider + responsive shrink), not 2 separate cards.
- Timer moved to header pill (keeps remainingTime logic intact).

REMOVE:
- None (logic kept; only render structure adjusted).
================================================================================
*/

import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";
import { supabase } from "../lib/supabase";
import { UserProfileModal } from "../components/UserProfileModal";
import { JitsiEngine, JitsiParticipant } from "../lib/jitsiEngine";
import { VideoRoom } from "../components/VideoRoom";
import type { ReactionType } from "../components/VideoRoom";
import { Target, MessageCircle, X } from "lucide-react";

type Stage = {
  name: string;
  duration: number;
  color: string;
  type: "intro" | "intentions" | "focus" | "break" | "outro" | string;
};

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<Stage[]>([]);
  const [hoveredStage, setHoveredStage] = useState<Stage | null>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const [remainingTime, setRemainingTime] = useState<string>("");

  const [selectedUser, setSelectedUser] = useState<any>(null);

  const [userName, setUserName] = useState<string>("");
  const [lastErr, setLastErr] = useState<string>("");

  const engineRef = useRef<JitsiEngine | null>(null);
  const [participants, setParticipants] = useState<JitsiParticipant[]>([]);

  // ★ SOUND WHEN USER JOINS
  const prevCountRef = useRef<number>(0);

  // ★ TRACK SCREEN SHARER
  const [activeScreenSharer, setActiveScreenSharer] = useState<string | null>(null);

  // ★ REACTIONS RECEIVED FROM OTHER USERS
  const [incomingReactions, setIncomingReactions] = useState<{ id: number; type: ReactionType }[]>([]);
  const reactionIdRef = useRef<number>(0);

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

  // ============================================================
  // RIGHT PANEL (DRAWER) STATE
  // ============================================================
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(false);
  const [rightPanelTab, setRightPanelTab] = useState<"intentions" | "chat">("intentions");

  const toggleRightPanel = (tab: "intentions" | "chat") => {
    setRightPanelTab(tab);
    setIsRightPanelOpen((open) => {
      if (!open) return true;
      // if already open -> clicking same tab closes, clicking other tab switches
      return tab !== rightPanelTab ? true : false;
    });
  };

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
  // LOAD SESSION FROM SUPABASE
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

        if (data.schedule) {
          try {
            const parsed =
              typeof data.schedule === "string"
                ? JSON.parse(data.schedule)
                : data.schedule;

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
                duration: b.minutes,
                color:
                  {
                    intro: "#80DF86",
                    intentions: "#ADD3FF",
                    focus: "#4CA0FF",
                    break: "#F9ADA2",
                    outro: "#80DF86",
                  }[type] || "#F63135",
                type,
              };
            });

            setStages(formatted);
          } catch { }
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
  // REALTIME ATTENDANCE
  // ============================================================
  useEffect(() => {
    if (!id) return;

    const fetchAttendance = async () => {
      const { data, error } = await supabase
        .from("session_attendance")
        .select("*")
        .eq("session_id", id);

      if (error) {
        console.error("Attendance fetch error:", error);
        return;
      }
    };

    fetchAttendance();

    const sub = supabase
      .channel(`session-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_attendance",
          filter: `session_id=eq.${id}`,
        },
        () => {
          fetchAttendance();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, [id]);

  // ============================================================
  // JITSI INIT + REACTIONS HANDLING
  // ============================================================
  useEffect(() => {
    if (!session || !userName) return;
    if (engineRef.current) return;

    const engine = new JitsiEngine({
      onParticipantsUpdate: (list) => {
        // sound on join (only when first participant joins second)
        if (prevCountRef.current < 2 && list.length === 2) {
          playOneShot("/sounds/user_joined.mp3", 0.9);
        }
        prevCountRef.current = list.length;

        // detect screen sharer
        const sharer = list.find((p) => p.isScreenSharing);
        setActiveScreenSharer(sharer ? sharer.id : null);

        // fix displayName for host
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

    // resolve room name
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
        });
      stopWelcomeLoop();
    };
  }, [session, userName]);

  // BUTTON HANDLERS
  const handleToggleAudio = () => engineRef.current?.toggleAudioMute();
  const handleToggleVideo = () => engineRef.current?.toggleVideoMute();
  const handleToggleScreenShare = () => engineRef.current?.toggleScreenShare();
  const handleLeave = () => navigate("/sessions", { replace: true });

  // ============================================================
  // STAGES TIMER
  // ============================================================
  const getStageWindows = (startISO: string, items: Stage[]) => {
    const startMs = new Date(startISO).getTime();
    let acc = 0;
    const starts = items.map((st) => {
      const ms = startMs + acc * 60 * 1000;
      acc += st.duration;
      return ms;
    });
    const ends = items.map((_, i) => starts[i] + items[i].duration * 60 * 1000);
    return { starts, ends };
  };

  useEffect(() => {
    if (!session?.start_time || !stages.length) return;

    const { starts } = getStageWindows(session.start_time, stages);

    const timer = setInterval(() => {
      const now = Date.now();
      const diffSec = (now - new Date(session.start_time).getTime()) / 1000;

      let total = 0;
      let active = stages.length - 1;

      for (let i = 0; i < stages.length; i++) {
        const next = total + stages[i].duration * 60;
        if (diffSec < next) {
          active = i;
          const rem = next - diffSec;
          setRemainingTime(
            `${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, "0")}`
          );
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
    }, 1000);

    return () => clearInterval(timer);
  }, [session?.start_time, stages]);

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
      <div className="max-w-[1720px] w-full px-5 py-5 space-y-5 min-h-0">
        {/* MAIN FRAME (HEADER + CONTENT) */}
        <div className="rounded-2xl bg-[#1F2937] shadow-lg overflow-hidden min-h-0">
          {/* HEADER */}
          <div className="px-6 pt-5 pb-4 border-b border-[#404651]">
            <div className="flex items-start justify-between gap-4">
              {/* LEFT: title + participants */}
              <div className="min-w-0">
                <p className="font-inter font-semibold text-[18px] text-[#F3F4F6]/90 truncate">
                  {session.title}
                </p>
                <p className="mt-0.5 text-[12px] text-[#F3F4F6]/60 font-inter">
                  {participants?.length || 0} participants
                </p>

                {/* STAGE BAR under title */}
                <div className="mt-3 max-w-[760px]">
                  <div className="h-[16px]">
                    <SessionStageBar
                      stages={stages as any}
                      startTime={session.start_time}
                      onHoverStage={setHoveredStage as any}
                    />
                  </div>
                </div>
              </div>

              {/* RIGHT: host + recording + timer */}
              <div className="flex items-center gap-3 flex-shrink-0">
                {session.host_profile && (
                  <button
                    onClick={() => setSelectedUser(session.host_profile)}
                    className="hidden md:flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#DBD8D8]/60 bg-transparent text-[13px] text-[#F3F4F6]/85 hover:bg-[#111827] transition font-inter"
                  >
                    <img src="/icons/host_session_icon.svg" className="h-5 w-5 opacity-90" />
                    <span className="flex items-center gap-1">
                      <span className="font-normal">Host:</span>
                      <span className="font-bold">{session.host_profile.full_name}</span>
                    </span>
                  </button>
                )}

                <div className="px-3 h-9 rounded-full bg-[#111827]/60 border border-white/10 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-[12px] text-[#F3F4F6]/80 font-inter">Recording</span>
                </div>

                <div className="px-4 h-9 rounded-full bg-[#111827]/60 border border-white/10 flex items-center">
                  <span className="font-inter text-[14px] text-[#F3F4F6]/90">
                    {remainingTime || "--:--"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* CONTENT */}
          <div className="relative flex min-h-0 h-[77vh]">
            {/* LEFT (VIDEO) */}
            <div className="relative flex-1 min-w-0 min-h-0">
              <div className="w-full h-full p-3 min-h-0">
                <VideoRoom
                  participants={participants}
                  onToggleAudio={handleToggleAudio}
                  onToggleVideo={handleToggleVideo}
                  onToggleScreenShare={handleToggleScreenShare}
                  onLeave={handleLeave}
                  activeScreenSharer={activeScreenSharer}
                  incomingReactions={incomingReactions}
                  onVisibleVideoIdsChange={(ids) => engineRef.current?.setVisibleVideoParticipants(ids)}
                />
              </div>

              {/* Bottom-left overlay buttons (like screenshot) */}
              <div className="absolute left-5 bottom-5 flex items-center gap-2 z-20">
                <button
                  onClick={() => toggleRightPanel("intentions")}
                  className={
                    "h-11 w-11 rounded-xl flex items-center justify-center border shadow-lg transition " +
                    (isRightPanelOpen && rightPanelTab === "intentions"
                      ? "bg-[#16A34A] border-[#16A34A]/40"
                      : "bg-[#111827]/80 border-white/10 hover:bg-[#0B1220]/80")
                  }
                  title="Intentions"
                >
                  <Target className="w-5 h-5 text-white" />
                </button>

                <button
                  onClick={() => toggleRightPanel("chat")}
                  className={
                    "h-11 w-11 rounded-xl flex items-center justify-center border shadow-lg transition " +
                    (isRightPanelOpen && rightPanelTab === "chat"
                      ? "bg-[#16A34A] border-[#16A34A]/40"
                      : "bg-[#111827]/80 border-white/10 hover:bg-[#0B1220]/80")
                  }
                  title="Chat"
                >
                  <MessageCircle className="w-5 h-5 text-white" />
                </button>
              </div>

              {lastErr && (
                <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow z-30">
                  {lastErr}
                </div>
              )}
            </div>

            {/* RIGHT DRAWER */}
            {isRightPanelOpen && (
              <div className="w-[420px] max-w-[420px] min-h-0 border-l border-[#404651] bg-[#1F2937] relative">
                {/* close (top-right) */}
                <button
                  onClick={() => setIsRightPanelOpen(false)}
                  className="absolute top-4 right-4 z-10 h-9 w-9 rounded-xl bg-[#111827]/70 border border-white/10 hover:bg-[#0B1220]/70 flex items-center justify-center"
                  title="Close"
                >
                  <X className="w-5 h-5 text-white/80" />
                </button>

                <div className="p-4 h-full min-h-0">
                  <IntentionsPanel
                    defaultTab={rightPanelTab as any}
                    onTabChange={(tab: any) => setRightPanelTab(tab)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedUser && (
        <UserProfileModal user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  );
}

export default RoomPage;
