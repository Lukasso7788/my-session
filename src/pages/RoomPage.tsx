import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DailyIframe, { DailyCall } from "@daily-co/daily-js";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";
import { supabase } from "../lib/supabase";
import { UserProfileModal } from "../components/UserProfileModal";

type Stage = {
  name: string;
  duration: number; // minutes
  color: string;
  type: "intro" | "intentions" | "focus" | "break" | "outro" | string;
};

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  const initGuardRef = useRef(false);

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<Stage[]>([]);
  const [hoveredStage, setHoveredStage] = useState<Stage | null>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const [remainingTime, setRemainingTime] = useState<string>("");

  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userName, setUserName] = useState<string>("");

  const [lastErr, setLastErr] = useState<string>("");

  // ====== SOUND STATE ======
  const prevStageRef = useRef<number>(-1);
  const firstTickDoneRef = useRef<boolean>(false);
  const welcomeLoopRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef<boolean>(false); // autoplay unlock flag

  // Config: how close to exact stage start counts as "real-time start"
  const REALTIME_STAGE_START_TOLERANCE_SEC = 2;

  const STAGE_COLOR_MAP: Record<string, string> = {
    intro: "#8FD8C6",
    intentions: "#FFF9F2",
    focus: "#9ADEDC",
    break: "#FF9F8E",
    outro: "#8FD8C6",
  };

  // One-shot sounds (start cues)
  const STAGE_SOUND_MAP: Record<string, string> = {
    intentions: "/sounds/intentions.mp3",
    focus: "/sounds/focus.mp3",
    break: "/sounds/break_start.mp3",
    outro: "/sounds/outro.mp3",
  };

  // Closing sound for break
  const BREAK_END_SOUND = "/sounds/break_end.mp3";

  // Welcome loop (only if user is at the real start of intro)
  const WELCOME_LOOP_SOUND = "/sounds/welcome_loop.mp3";

  // -------- helper: unlock audio on first user gesture --------
  useEffect(() => {
    const unlock = () => {
      if (audioUnlockedRef.current) return;
      const a = new Audio();
      a.play().catch(() => {});
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
    a.play().catch(() => {});
  };

  const startWelcomeLoop = () => {
    stopWelcomeLoop();
    const a = new Audio(WELCOME_LOOP_SOUND);
    a.loop = true;
    a.volume = 0.6;
    welcomeLoopRef.current = a;
    a.play().catch(() => {});
  };

  const stopWelcomeLoop = () => {
    try {
      if (welcomeLoopRef.current) {
        welcomeLoopRef.current.pause();
        welcomeLoopRef.current.currentTime = 0;
        welcomeLoopRef.current = null;
      }
    } catch {}
  };

  // ---------- helpers ----------
  const getRoomName = (url: string) => {
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      return parts[parts.length - 1] || "";
    } catch {
      return "";
    }
  };

  const fetchToken = async (roomUrl: string) => {
    const roomName = getRoomName(roomUrl);
    const { data, error } = await supabase.functions.invoke("daily-token", {
      body: { roomName, userName, roomUrl },
    });
    if (error) throw error;
    if (!data?.token) throw new Error("No token returned");
    return data.token as string;
  };

  // ---------- LOAD SESSION ----------
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

      if (!error && data) {
        setSession(data);

        if (data?.schedule) {
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
                color: STAGE_COLOR_MAP[type] || "#9ADEDC",
                type,
              };
            });

            setStages(formatted);
          } catch (e) {
            console.error("schedule parse error", e);
          }
        }
      } else {
        console.error("load session error:", error?.message);
      }
      setLoading(false);
    })();
  }, [id]);

  // ---------- RESOLVE USER NAME ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data.user;

      let name =
        (u?.user_metadata?.full_name as string) ||
        (u?.user_metadata?.name as string) ||
        "";

      if (!name && u?.id) {
        const { data: p } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", u.id)
          .single();
        name = p?.full_name || "";
      }

      if (!name && u?.email) name = u.email.split("@")[0];
      if (!cancelled) setUserName(name);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- DAILY INIT ----------
  useEffect(() => {
    if (!session?.daily_room_url || !containerRef.current || !userName) return;
    if (initGuardRef.current) return;
    initGuardRef.current = true;

    const container = containerRef.current;
    const bounds = container.getBoundingClientRect();

    if (bounds.height < 100) {
      container.style.minHeight = "70vh";
      container.style.height = "70vh";
    }

    if (callRef.current) {
      try { callRef.current.destroy(); } catch {}
      callRef.current = null;
    }

    const frame = DailyIframe.createFrame(container, {
      iframeStyle: {
        width: "100%",
        height: "100%",
        border: "0",
        borderRadius: "1rem",
      },
      showFullscreenButton: true,
      showLeaveButton: true,
    });

    callRef.current = frame;

    const urlWithGrid = session.daily_room_url.includes("?")
      ? `${session.daily_room_url}&layout=grid`
      : `${session.daily_room_url}?layout=grid`;

    let destroyed = false;

    const onJoined = () => {};
    const onLeft = async () => {
      await safeTearDownAndNavigate();
    };
    const onError = (e: any) => {
      console.error("DAILY ERROR:", e);
      setLastErr(String(e?.errorMsg || e?.message || e));
    };

    const removeAll = () => {
      try { frame.off("joined-meeting", onJoined); } catch {}
      try { frame.off("left-meeting", onLeft); } catch {}
      try { frame.off("error", onError); } catch {}
    };

    (async () => {
      try {
        const token = await fetchToken(session.daily_room_url);
        if (destroyed) return;

        await frame.join({
          url: urlWithGrid,
          token,
          userName,
          audioSource: true,
          videoSource: true,
        });
      } catch (e: any) {
        if (!destroyed) setLastErr(e?.message || "Failed to init Daily");
      }
    })();

    frame.on("joined-meeting", onJoined);
    frame.on("left-meeting", onLeft);
    frame.on("error", onError);

    const safeTearDownAndNavigate = async () => {
      if (destroyed) return;
      destroyed = true;

      removeAll();
      try { await frame.leave?.(); } catch {}
      try { await frame.destroy(); } catch {}

      if (callRef.current === frame) callRef.current = null;
      initGuardRef.current = false;

      // always stop any loop when we leave
      stopWelcomeLoop();

      navigate("/sessions", { replace: true });
    };

    return () => {
      // unmount
      if (!destroyed) {
        destroyed = true;
        removeAll();
        try { frame.leave?.(); } catch {}
        try { frame.destroy(); } catch {}
        if (callRef.current === frame) callRef.current = null;
        initGuardRef.current = false;
        stopWelcomeLoop();
      }
    };
  }, [session?.daily_room_url, userName, navigate]);

  // ---------- UTILS FOR STAGE TIME ----------
  const getStageBoundaries = (startISO: string, items: Stage[]) => {
    const startMs = new Date(startISO).getTime();
    const starts: number[] = [];
    const ends: number[] = [];
    let acc = 0;
    for (const st of items) {
      const stStart = startMs + acc * 60 * 1000;
      const stEnd = stStart + st.duration * 60 * 1000;
      starts.push(stStart);
      ends.push(stEnd);
      acc += st.duration;
    }
    return { starts, ends };
  };

  // ---------- STAGE TIMER + SOUND TRIGGER ----------
  useEffect(() => {
    if (!session?.start_time || !stages.length) return;

    const { starts, ends } = getStageBoundaries(session.start_time, stages);

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
          const m = Math.floor(rem / 60);
          const s = Math.floor(rem % 60);
          setRemainingTime(`${m}:${s.toString().padStart(2, "0")}`);
          break;
        }
        total = next;
      }

      const stage = stages[active];
      const stageStartMs = starts[active];
      const stageEndMs = ends[active];
      const offsetInStageSec = Math.max(0, Math.floor((now - stageStartMs) / 1000));

      // FIRST TICK: don't play any one-shot if we are mid-block
      if (!firstTickDoneRef.current) {
        // Welcome loop special rule:
        // start only if we are at real start of welcome (within tolerance)
        if (stage?.type === "intro" && offsetInStageSec <= REALTIME_STAGE_START_TOLERANCE_SEC) {
          startWelcomeLoop();
        } else {
          stopWelcomeLoop();
        }
        prevStageRef.current = active;
        firstTickDoneRef.current = true;
        setCurrentStage(active);
        return;
      }

      // Stage changed?
      if (prevStageRef.current !== active) {
        const prev = stages[prevStageRef.current];
        const prevType = prev?.type;
        const newType = stage?.type;

        // leaving a break => play break_end
        if (prevType === "break" && newType !== "break") {
          playOneShot(BREAK_END_SOUND);
        }

        // whenever we enter intro — start loop
        if (newType === "intro") {
          startWelcomeLoop();
        } else {
          // entering anything else — stop welcome loop
          stopWelcomeLoop();
          // play stage start one-shot if defined (intentions/focus/break/outro)
          const url = STAGE_SOUND_MAP[newType as keyof typeof STAGE_SOUND_MAP];
          if (url) playOneShot(url);
        }

        prevStageRef.current = active;
      }

      // Hard stop loop at exact end of intro (in case timers drift)
      if (stage?.type !== "intro" && welcomeLoopRef.current) {
        stopWelcomeLoop();
      }
      if (stage?.type === "intro" && now >= stageEndMs) {
        stopWelcomeLoop();
      }

      setCurrentStage(active);
    }, 1000);

    return () => clearInterval(timer);
  }, [session?.start_time, stages]);

  // ---------- UI ----------
  if (loading)
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
        Loading session...
      </div>
    );

  if (!session)
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
        <div className="text-center space-y-3">
          <p className="text-lg font-medium">Session not found</p>
          <button
            onClick={() => navigate("/sessions")}
            className="text-blue-400 hover:text-blue-300 underline"
          >
            Back to sessions
          </button>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-900 text-white flex justify-center">
      <div className="w-full max-w-[1720px] px-5 py-5 space-y-5">
        {/* Header */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 shadow-lg p-4">
          <div className="flex justify-between items-end mb-3">
            <div className="text-sm font-medium text-slate-400">
              {session?.title ?? ""}
            </div>
            <div className="text-xs text-slate-500">
              Stage {currentStage + 1} / {stages.length}
            </div>
          </div>

          <div className="bg-white rounded-2xl overflow-hidden shadow-sm p-4 space-y-3">
            <SessionStageBar
              stages={stages}
              startTime={session.start_time}
              onHoverStage={setHoveredStage}
            />
            <div className="flex justify-between items-center text-sm font-medium text-slate-700 mt-1">
              <span>
                {hoveredStage
                  ? `${hoveredStage.name} • ${hoveredStage.duration} min`
                  : stages[currentStage]?.name ?? ""}
              </span>
              <span className="text-slate-500">⏱ {remainingTime}</span>
            </div>
          </div>

          {session.host_profile && (
            <p
              onClick={() => setSelectedUser(session.host_profile)}
              className="text-sm text-slate-400 hover:text-blue-400 cursor-pointer mt-3"
            >
              👤 Hosted by {session.host_profile.full_name ?? "Unknown"}
            </p>
          )}
        </div>

        {/* Video + Sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,370px] gap-5">
          <div
            className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-lg overflow-hidden h-[77vh] relative"
            style={{ minHeight: "70vh" }}
          >
            <div
              ref={containerRef}
              className="w-full h-full"
              style={{ minHeight: "70vh" }}
            />

            {lastErr && (
              <div className="absolute top-4 left-4 bg-red-600 text-white px-3 py-2 rounded-lg text-xs shadow">
                {lastErr}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-white text-black shadow-lg overflow-hidden h-[77vh]">
            <div className="p-4 h-full">
              <IntentionsPanel />
            </div>
          </div>
        </div>
      </div>

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
