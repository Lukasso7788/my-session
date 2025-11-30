// FULL UPDATED ROOMPAGE WITH FIXED WELCOME LOOP BEHAVIOR

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
  const audioUnlockedRef = useRef<boolean>(false);

  // ====== SOUND FILES ======
  const STAGE_SOUND_MAP: Record<string, string> = {
    intentions: "/sounds/intentions.mp3",
    focus: "/sounds/focus.mp3",
    break: "/sounds/break_start.mp3",
    outro: "/sounds/outro.mp3",
  };

  const BREAK_END_SOUND = "/sounds/break_end.mp3";
  const WELCOME_LOOP_SOUND = "/sounds/welcome_loop.mp3";

  // unlock browser autoplay
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

  // ============================================
  // LOAD SESSION
  // ============================================
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
                    intro: "#8FD8C6",
                    intentions: "#FFF9F2",
                    focus: "#9ADEDC",
                    break: "#FF9F8E",
                    outro: "#8FD8C6",
                  }[type] || "#9ADEDC",
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

  // ============================================
  // RESOLVE USER NAME
  // ============================================
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

  // ====== ATTENDANCE REALTIME ======
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

      console.log("Attendance updated:", data);
    };

    // INITIAL LOAD
    fetchAttendance();

    // SUBSCRIBE TO CHANGES IN attendance TABLE
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
          console.log("Realtime attendance change received");
          fetchAttendance();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, [id]);

  // ============================================
  // DAILY INIT
  // ============================================
  useEffect(() => {
    if (!session?.daily_room_url || !containerRef.current || !userName) return;
    if (initGuardRef.current) return;
    initGuardRef.current = true;

    const container = containerRef.current;

    if (container.getBoundingClientRect().height < 100) {
      container.style.minHeight = "70vh";
      container.style.height = "70vh";
    }

    if (callRef.current) {
      try {
        callRef.current.destroy();
      } catch { }
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

    const withGrid = session.daily_room_url.includes("?")
      ? `${session.daily_room_url}&layout=grid`
      : `${session.daily_room_url}?layout=grid`;

    let destroyed = false;

    const removeAll = () => {
      try {
        frame.off("joined-meeting");
      } catch { }
      try {
        frame.off("left-meeting");
      } catch { }
      try {
        frame.off("error");
      } catch { }
    };

    const safeLeave = async () => {
      if (destroyed) return;
      destroyed = true;
      removeAll();
      try {
        await frame.leave?.();
      } catch { }
      try {
        await frame.destroy();
      } catch { }
      callRef.current = null;
      stopWelcomeLoop();
      navigate("/sessions", { replace: true });
    };

    frame.on("left-meeting", safeLeave);
    frame.on("error", (e) =>
      setLastErr(String(e?.errorMsg || e?.message || e))
    );

    (async () => {
      try {
        const roomName =
          new URL(session.daily_room_url).pathname.split("/").pop() || "";
        const { data } = await supabase.functions.invoke("daily-token", {
          body: { roomName, userName, roomUrl: session.daily_room_url },
        });

        await frame.join({
          url: withGrid,
          token: data.token,
          userName,
          audioSource: true,
          videoSource: true,
        });
      } catch (e: any) {
        if (!destroyed) setLastErr(e?.message);
      }
    })();

    return () => {
      if (!destroyed) {
        destroyed = true;
        removeAll();
        try {
          frame.leave?.();
        } catch { }
        try {
          frame.destroy();
        } catch { }
        callRef.current = null;
        stopWelcomeLoop();
      }
    };
  }, [session?.daily_room_url, userName]);

  // ============================================
  // STAGE TIME CALC + SOUND LOGIC
  // ============================================
  const getStageWindows = (startISO: string, items: Stage[]) => {
    const startMs = new Date(startISO).getTime();
    let acc = 0;
    const starts = items.map((st) => {
      const ms = startMs + acc * 60 * 1000;
      acc += st.duration;
      return ms;
    });
    const ends = items.map(
      (_, i) => starts[i] + items[i].duration * 60 * 1000
    );
    return { starts, ends };
  };

  useEffect(() => {
    if (!session?.start_time || !stages.length) return;

    const { starts, ends } = getStageWindows(session.start_time, stages);

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
            `${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(
              2,
              "0"
            )}`
          );
          break;
        }
        total = next;
      }

      const stage = stages[active];

      // ===== FIRST TICK =====
      if (!firstTickDoneRef.current) {
        // ✅ NEW LOGIC: welcome loop plays ALWAYS if we are in intro
        if (stage.type === "intro") startWelcomeLoop();
        else stopWelcomeLoop();

        prevStageRef.current = active;
        firstTickDoneRef.current = true;
        setCurrentStage(active);
        return;
      }

      // ===== STAGE CHANGED =====
      if (prevStageRef.current !== active) {
        const prev = stages[prevStageRef.current];
        const prevType = prev?.type;
        const newType = stage.type;

        // break end sound
        if (prevType === "break" && newType !== "break") {
          playOneShot(BREAK_END_SOUND);
        }

        // entering intro → ALWAYS start loop
        if (newType === "intro") {
          startWelcomeLoop();
        } else {
          // entering any non-intro → stop loop
          stopWelcomeLoop();
          const startSound = STAGE_SOUND_MAP[newType];
          if (startSound) playOneShot(startSound);
        }

        prevStageRef.current = active;
      }

      // safety stop for loop after intro ends
      if (stage.type !== "intro" && welcomeLoopRef.current) {
        stopWelcomeLoop();
      }

      setCurrentStage(active);
    }, 1000);

    return () => clearInterval(timer);
  }, [session?.start_time, stages]);

  // ============================================
  // UI
  // ============================================
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
      <div className="max-w-[1720px] w-full px-5 py-5 space-y-5">
        {/* TOP BAR CARD */}
        <div className="rounded-2xl border border-[#223247] bg-[#101B29] shadow-lg px-6 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-3">
            <div>
              <p className="text-sm text-slate-200">{session.title}</p>
              {stages.length > 0 && (
                <p className="text-xs text-slate-400 mt-1">
                  Stage {currentStage + 1} / {stages.length}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              {session.host_profile && (
                <button
                  onClick={() => setSelectedUser(session.host_profile)}
                  className="flex items-center gap-2 px-3 py-1 rounded-full border border-[#2C3E52] bg-[#0B1824] text-xs text-slate-200 hover:bg-[#142235] transition"
                >
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-[#101B29]">
                    {session.host_profile.full_name?.[0] ?? "H"}
                  </span>
                  <span>Host: {session.host_profile.full_name}</span>
                </button>
              )}

              <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-[#2C3E52] bg-[#0B1824] text-xs text-slate-200">
                <span role="img" aria-hidden="true">
                  ⏱
                </span>
                <span>{remainingTime || "--:--"}</span>
              </div>
            </div>
          </div>

          <div className="mt-1">
            <SessionStageBar
              stages={stages}
              startTime={session.start_time}
              onHoverStage={setHoveredStage}
            />
          </div>

          <div className="mt-3 flex justify-between text-xs text-slate-300">
            <span>
              {hoveredStage
                ? `${hoveredStage.name} • ${hoveredStage.duration} min`
                : stages[currentStage]?.name}
            </span>
          </div>
        </div>

        {/* MAIN GRID */}
        <div className="grid lg:grid-cols-[minmax(0,1fr),420px] gap-5">
          {/* VIDEO AREA */}
          <div
            className="rounded-2xl border border-[#223247] bg-[#101B29] shadow-lg overflow-hidden relative h-[77vh]"
            style={{ minHeight: "70vh" }}
          >
            <div
              ref={containerRef}
              className="w-full h-full"
              style={{ minHeight: "70vh" }}
            />

            {lastErr && (
              <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow">
                {lastErr}
              </div>
            )}
          </div>

          {/* INTENTIONS PANEL */}
          <div className="rounded-2xl border border-[#223247] bg-[#101B29] text-white shadow-lg h-[77vh] overflow-hidden">
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
