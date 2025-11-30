// FULL UPDATED ROOMPAGE WITH FIXED WELCOME LOOP BEHAVIOR + NEW DOUBLE-CONTAINER TOP BAR (REV 3)

import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DailyIframe, { DailyCall } from "@daily-co/daily-js";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";
import { supabase } from "../lib/supabase";
import { UserProfileModal } from "../components/UserProfileModal";

type Stage = {
  name: string;
  duration: number;
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

  // LOAD SESSION
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

  // RESOLVE USER NAME
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

  // REALTIME ATTENDANCE
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
          console.log("Realtime attendance change received");
          fetchAttendance();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, [id]);

  // DAILY INIT
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

  // STAGE LOGIC
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

    const { starts } = getStageWindows(session.start_time, stages);

    const timer = setInterval(() => {
      const now = Date.now();
      const diffSec =
        (now - new Date(session.start_time).getTime()) / 1000;

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

        {/* ======================
            DOUBLE-CONTAINER TOP BAR (REV 3)
        ====================== */}
        <div className="flex w-full rounded-2xl overflow-hidden">

          {/* LEFT BLOCK (91%) */}
          <div className="w-[91%] bg-[#1F2937] px-6 py-8 rounded-l-2xl">

            {/* ROW: SESSION TITLE + HOST BADGE */}
            <div className="flex items-center justify-between w-full">
              <p className="font-inter font-medium text-[17px] text-[#F3F4F6]/85">
                {session.title}
              </p>

              {session.host_profile && (
                <button
                  onClick={() => setSelectedUser(session.host_profile)}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#DBD8D8] bg-transparent text-[14px] text-[#F3F4F6]/85 hover:bg-[#111827] transition font-inter"
                >
                  <img
                    src="/icons/host_session_icon.svg"
                    className="h-5 w-5 opacity-90"
                  />

                  <span className="flex items-center gap-1">
                    <span className="font-normal">Host:</span>
                    <span className="font-bold">
                      {session.host_profile.full_name}
                    </span>
                  </span>
                </button>
              )}
            </div>

            {/* STAGE BAR (max height 24px, spacing 10px) */}
            <div className="mt-2 max-h-[24px]">
              <SessionStageBar
                stages={stages}
                startTime={session.start_time}
                onHoverStage={setHoveredStage}
              />
            </div>
          </div>

          {/* RIGHT TIMER BLOCK (9%) */}
          <div className="w-[9%] bg-[#1F2937] rounded-r-2xl flex flex-col items-center justify-center gap-1 border-l border-[#404651]">
            <img
              src="/icons/session_timer.svg"
              className="w-[48px] h-[48px]"
            />

            <span className="font-inter text-[26px]">
              {remainingTime || "--:--"}
            </span>
          </div>
        </div>

        {/* MAIN GRID */}
        <div className="grid lg:grid-cols-[minmax(0,1fr),420px] gap-5">

          {/* VIDEO AREA */}
          <div
            className="rounded-2xl bg-[#1F2937] shadow-lg overflow-hidden relative h-[77vh]"
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

          {/* INTENTIONS */}
          <div className="rounded-2xl bg-[#1F2937] text-white shadow-lg h-[77vh] overflow-hidden">
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
