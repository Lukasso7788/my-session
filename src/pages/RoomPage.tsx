// FULL JITSI SDK ROOMPAGE (multi-video grid, Daily-like UI)

// =====================
// Types & React imports
// =====================
import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
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

declare global {
  interface Window {
    JitsiMeetJS?: any;
    config?: any;
  }
}

// =====================
// Jitsi constants/helpers
// =====================

const JITSI_DOMAIN = "jitsi.lukassodesign.site";
const JITSI_CONFIG_URL = `https://${JITSI_DOMAIN}/config.js`;
const JITSI_LIB_URL = `https://${JITSI_DOMAIN}/libs/lib-jitsi-meet.min.js`;

let jitsiLoaderPromise: Promise<void> | null = null;

function loadJitsiScripts(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Jitsi can only be loaded in browser"));
  }

  if (window.JitsiMeetJS && window.config) {
    return Promise.resolve();
  }

  if (jitsiLoaderPromise) return jitsiLoaderPromise;

  jitsiLoaderPromise = new Promise<void>((resolve, reject) => {
    let loaded = 0;
    const onLoad = () => {
      loaded += 1;
      if (loaded === 2) {
        if (window.JitsiMeetJS && window.config) {
          resolve();
        } else {
          reject(new Error("Jitsi scripts loaded but globals are missing"));
        }
      }
    };

    const onError = (src: string) => {
      reject(new Error(`Failed to load Jitsi script: ${src}`));
    };

    // config.js
    if (!document.querySelector(`script[src="${JITSI_CONFIG_URL}"]`)) {
      const scConfig = document.createElement("script");
      scConfig.src = JITSI_CONFIG_URL;
      scConfig.async = true;
      scConfig.onload = onLoad;
      scConfig.onerror = () => onError(JITSI_CONFIG_URL);
      document.head.appendChild(scConfig);
    } else {
      onLoad();
    }

    // lib-jitsi-meet.min.js
    if (!document.querySelector(`script[src="${JITSI_LIB_URL}"]`)) {
      const scLib = document.createElement("script");
      scLib.src = JITSI_LIB_URL;
      scLib.async = true;
      scLib.onload = onLoad;
      scLib.onerror = () => onError(JITSI_LIB_URL);
      document.head.appendChild(scLib);
    } else {
      onLoad();
    }
  });

  return jitsiLoaderPromise;
}

// ===============
// RoomPage
// ===============
export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);

  // Jitsi refs
  const connectionRef = useRef<any | null>(null);
  const conferenceRef = useRef<any | null>(null);
  const localTracksRef = useRef<any[]>([]);
  const remoteTracksRef = useRef<Record<string, any[]>>({});
  const screenShareTrackRef = useRef<any | null>(null);
  const jitsiInitGuardRef = useRef(false);

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<Stage[]>([]);
  const [hoveredStage, setHoveredStage] = useState<Stage | null>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const [remainingTime, setRemainingTime] = useState<string>("");

  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userName, setUserName] = useState<string>("");

  const [lastErr, setLastErr] = useState<string>("");

  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

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

  // ================
  // AUDIO UNLOCK HACK
  // ================
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
    } catch {
      // ignore
    }
  };

  // ==========================
  // LOAD SESSION FROM SUPABASE
  // ==========================
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
          } catch {
            // ignore schedule parse errors
          }
        }
      }

      setLoading(false);
    })();
  }, [id]);

  // ====================
  // RESOLVE USER NAME
  // ====================
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

  // =========================
  // REALTIME ATTENDANCE LOGIC
  // =========================
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

  // ===================
  // JITSI: helpers
  // ===================

  const layoutVideoGrid = () => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    container.style.display = "grid";
    container.style.gridTemplateColumns =
      "repeat(auto-fit, minmax(260px, 1fr))";
    container.style.gridAutoRows = "minmax(180px, auto)";
    container.style.gap = "6px";
    container.style.alignItems = "stretch";
    container.style.justifyItems = "stretch";
  };

  const attachVideoTrack = (
    track: any,
    participantId: string,
    isLocal: boolean
  ) => {
    if (!containerRef.current) return;
    if (track.getType && track.getType() !== "video") return;

    const container = containerRef.current;

    const existing = container.querySelector<HTMLVideoElement>(
      `video[data-participant-id="${participantId}"][data-track-id="${track.getId?.() ?? ""
      }"]`
    );
    if (existing) {
      track.attach(existing);
      return;
    }

    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = isLocal;
    video.playsInline = true;
    video.dataset.participantId = participantId;
    video.dataset.trackId = track.getId ? String(track.getId()) : "";
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "cover";
    video.style.borderRadius = "18px";

    const wrapper = document.createElement("div");
    wrapper.dataset.participantId = participantId;
    wrapper.dataset.trackId = video.dataset.trackId;
    wrapper.style.position = "relative";
    wrapper.style.overflow = "hidden";
    wrapper.style.borderRadius = "18px";
    wrapper.style.backgroundColor = "#020617";

    wrapper.appendChild(video);
    container.appendChild(wrapper);

    track.attach(video);
    layoutVideoGrid();
  };

  const detachVideoTrack = (track: any) => {
    if (!containerRef.current) return;

    const id = track.getId ? String(track.getId()) : "";
    const container = containerRef.current;

    const wrapper = container.querySelector<HTMLDivElement>(
      `div[data-track-id="${id}"]`
    );
    if (wrapper) {
      const video = wrapper.querySelector("video");
      try {
        if (video) {
          track.detach(video);
        }
      } catch {
        // ignore
      }
      container.removeChild(wrapper);
      layoutVideoGrid();
    }
  };

  const cleanupAllVideo = () => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    container.innerHTML = "";
  };

  const getLocalTrack = (type: "audio" | "video" | "desktop") => {
    return localTracksRef.current.find(
      (t) => t.getType && t.getType() === type
    );
  };

  // ====================
  // JITSI: main effect
  // ====================
  useEffect(() => {
    if (!session || !userName) return;
    if (jitsiInitGuardRef.current) return;
    jitsiInitGuardRef.current = true;

    let disposed = false;

    const initJitsi = async () => {
      try {
        await loadJitsiScripts();

        if (disposed) return;

        const JitsiMeetJS = window.JitsiMeetJS;
        const cfg = window.config;

        if (!JitsiMeetJS || !cfg) {
          throw new Error("Jitsi globals not available");
        }

        JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);
        JitsiMeetJS.init(cfg);

        const options = {
          hosts: cfg.hosts,
          serviceUrl: cfg.websocket || cfg.bosh,
          clientNode: cfg.clientNode,
        };

        const connection = new JitsiMeetJS.JitsiConnection(
          null,
          undefined,
          options
        );
        connectionRef.current = connection;

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

        const roomName = roomNameRaw || `session-${session.id}`;

        const onConnectionSuccess = async () => {
          if (disposed) return;

          const conferenceOptions: any = { ...(cfg.conference || {}) };

          if (userName) {
            conferenceOptions.statisticsId = userName.toLowerCase();
          }

          const baseRoomName =
            roomName && roomName.trim().length > 0
              ? roomName
              : `session-${session.id}`;

          let safeRoomName = baseRoomName
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, "");

          if (!safeRoomName) {
            safeRoomName = `session-${session.id}`
              .toLowerCase()
              .replace(/[^a-z0-9-_]/g, "");
          }

          console.log("Joining Jitsi room:", {
            rawRoomName: roomName,
            safeRoomName,
          });

          const conf = connection.initJitsiConference(
            safeRoomName,
            conferenceOptions
          );
          conferenceRef.current = conf;

          conf.on(
            JitsiMeetJS.events.conference.TRACK_ADDED,
            (track: any) => {
              if (disposed) return;
              if (track.isLocal && track.isLocal()) return;
              const participantId = track.getParticipantId
                ? track.getParticipantId()
                : "remote";
              if (!remoteTracksRef.current[participantId]) {
                remoteTracksRef.current[participantId] = [];
              }
              remoteTracksRef.current[participantId].push(track);
              attachVideoTrack(track, participantId, false);
            }
          );

          conf.on(
            JitsiMeetJS.events.conference.TRACK_REMOVED,
            (track: any) => {
              detachVideoTrack(track);
            }
          );

          conf.on(
            JitsiMeetJS.events.conference.USER_LEFT,
            (id: string) => {
              const arr = remoteTracksRef.current[id] || [];
              arr.forEach((t: any) => detachVideoTrack(t));
              delete remoteTracksRef.current[id];
            }
          );

          conf.on(
            JitsiMeetJS.events.conference.CONFERENCE_ERROR,
            (e: any) => {
              console.error("Jitsi conference error", e);
              setLastErr("Conference error");
            }
          );

          conf.join();

          const localTracks = await JitsiMeetJS.createLocalTracks({
            devices: ["audio", "video"],
          });

          if (disposed) return;

          localTracksRef.current = localTracks;

          localTracks.forEach((track: any) => {
            if (track.getType && track.getType() === "video") {
              attachVideoTrack(track, "local", true);
            }

            conf.addTrack(track).catch((err: any) => {
              console.error("Error adding local track", err);
            });
          });
        };

        const onConnectionFailed = () => {
          if (disposed) return;
          setLastErr("Jitsi connection failed");
        };

        const onConnectionDisconnected = () => {
          // no-op for now
        };

        connection.addEventListener(
          JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
          onConnectionSuccess
        );
        connection.addEventListener(
          JitsiMeetJS.events.connection.CONNECTION_FAILED,
          onConnectionFailed
        );
        connection.addEventListener(
          JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
          onConnectionDisconnected
        );

        connection.connect();
      } catch (e: any) {
        if (!disposed) {
          console.error("Jitsi init error", e);
          setLastErr(String(e?.message || e));
        }
      }
    };

    initJitsi();

    return () => {
      disposed = true;

      try {
        const conf = conferenceRef.current;
        if (conf) {
          conf.leave().catch(() => { });
        }
      } catch {
        // ignore
      }

      try {
        if (screenShareTrackRef.current && conferenceRef.current) {
          conferenceRef.current
            .removeTrack(screenShareTrackRef.current)
            .catch(() => { });
          screenShareTrackRef.current.dispose?.();
        }
      } catch {
        // ignore
      }
      screenShareTrackRef.current = null;

      try {
        localTracksRef.current.forEach((t) => {
          try {
            t.dispose();
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }

      localTracksRef.current = [];
      remoteTracksRef.current = {};

      try {
        const conn = connectionRef.current;
        if (conn) {
          conn.disconnect().catch(() => { });
        }
      } catch {
        // ignore
      }

      connectionRef.current = null;
      conferenceRef.current = null;

      cleanupAllVideo();
      stopWelcomeLoop();
    };
  }, [session, userName]);

  // =====================
  // CONTROLS HANDLERS
  // =====================

  const toggleAudio = async () => {
    const track = getLocalTrack("audio");
    if (!track) return;
    try {
      if (isAudioMuted) {
        await track.unmute();
        setIsAudioMuted(false);
      } else {
        await track.mute();
        setIsAudioMuted(true);
      }
    } catch (e) {
      console.error("toggleAudio error", e);
    }
  };

  const toggleVideo = async () => {
    const track = getLocalTrack("video");
    if (!track) return;
    try {
      if (isVideoMuted) {
        await track.unmute();
        setIsVideoMuted(false);
      } else {
        await track.mute();
        setIsVideoMuted(true);
      }
    } catch (e) {
      console.error("toggleVideo error", e);
    }
  };

  const toggleScreenShare = async () => {
    const JitsiMeetJS = (window as any).JitsiMeetJS;
    if (!conferenceRef.current || !JitsiMeetJS) return;

    try {
      if (isScreenSharing) {
        const track = screenShareTrackRef.current;
        if (track) {
          await conferenceRef.current.removeTrack(track);
          try {
            detachVideoTrack(track);
          } catch {
            // ignore
          }
          track.dispose?.();
        }
        screenShareTrackRef.current = null;
        setIsScreenSharing(false);
        return;
      }

      const tracks = await JitsiMeetJS.createLocalTracks({
        devices: ["desktop"],
      });

      const desktopTrack = tracks.find(
        (t: any) => t.getType && t.getType() === "video"
      );
      if (!desktopTrack) return;

      screenShareTrackRef.current = desktopTrack;
      attachVideoTrack(desktopTrack, "local-screen", true);
      await conferenceRef.current.addTrack(desktopTrack);
      setIsScreenSharing(true);
    } catch (e) {
      console.error("toggleScreenShare error", e);
    }
  };

  const handleLeave = () => {
    navigate("/sessions");
  };

  // =====================
  // STAGE LOGIC (как было)
  // =====================
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
            `${Math.floor(rem / 60)}:${String(
              Math.floor(rem % 60)
            ).padStart(2, "0")}`
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

  // =====================
  // RENDER
  // =====================

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
      <div className="max-w-[1720px] w-full px-3 sm:px-5 py-5 space-y-5">
        {/* ======================
            DOUBLE-CONTAINER TOP BAR
        ====================== */}
        <div className="flex w-full rounded-2xl overflow-hidden">
          {/* LEFT BLOCK (91%) */}
          <div className="w-[83%] sm:w-[88%] lg:w-[91%] bg-[#1F2937] px-4 sm:px-6 py-5 sm:py-8 rounded-l-2xl">
            {/* ROW: SESSION TITLE + HOST BADGE */}
            <div className="flex items-center justify-between w-full gap-2">
              <p className="font-inter font-medium text-[15px] sm:text-[17px] text-[#F3F4F6]/85 truncate">
                {session.title}
              </p>

              {session.host_profile && (
                <button
                  onClick={() => setSelectedUser(session.host_profile)}
                  className="flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full border border-[#DBD8D8] bg-transparent text-[13px] sm:text-[14px] text-[#F3F4F6]/85 hover:bg-[#111827] transition font-inter whitespace-nowrap"
                >
                  <img
                    src="/icons/host_session_icon.svg"
                    className="h-4 w-4 sm:h-5 sm:w-5 opacity-90"
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

            {/* STAGE BAR */}
            <div className="mt-2 max-h-[24px]">
              <SessionStageBar
                stages={stages}
                startTime={session.start_time}
                onHoverStage={setHoveredStage}
              />
            </div>
          </div>

          {/* RIGHT TIMER BLOCK (9%) */}
          <div className="w-[17%] sm:w-[12%] lg:w-[9%] bg-[#1F2937] rounded-r-2xl flex flex-col items-center justify-center gap-1 border-l border-[#404651]">
            <img
              src="/icons/session_timer.svg"
              className="w-[32px] h-[32px] sm:w-[40px] sm:h-[40px] lg:w-[48px] lg:h-[48px]"
            />
            <span className="font-inter text-[18px] sm:text-[22px] lg:text-[26px]">
              {remainingTime || "--:--"}
            </span>
          </div>
        </div>

        {/* MAIN GRID */}
        <div className="grid lg:grid-cols-[minmax(0,1fr),420px] gap-4 sm:gap-5">
          {/* VIDEO AREA: Jitsi SDK grid + Daily-like controls */}
          <div className="rounded-2xl bg-[#020617] shadow-lg overflow-hidden relative h-[70vh] sm:h-[74vh] lg:h-[77vh]">
            <div
              ref={containerRef}
              className="w-full h-full"
              style={{ minHeight: "60vh" }}
            />

            {/* Overlay UI (names + controls) */}
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
              {/* Top-left name bubble */}
              <div className="flex items-start justify-between px-3 pt-3">
                <div className="pointer-events-auto bg-black/50 rounded-full px-3 py-1 text-xs sm:text-sm font-medium">
                  {userName || "You"}
                </div>
              </div>

              {/* Bottom control bar */}
              <div className="flex justify-center mb-3 sm:mb-4">
                <div className="pointer-events-auto flex items-center gap-2 sm:gap-3 rounded-full bg-black/60 backdrop-blur px-3 sm:px-4 py-2 text-xs sm:text-sm">
                  {/* Video */}
                  <button
                    onClick={toggleVideo}
                    className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 rounded-full font-medium ${isVideoMuted
                        ? "bg-red-600 text-white"
                        : "bg-white/90 text-gray-900"
                      } hover:opacity-90 transition`}
                  >
                    <span className="text-lg">
                      {isVideoMuted ? "📷" : "📸"}
                    </span>
                    <span className="hidden sm:inline">
                      {isVideoMuted ? "Turn on" : "Camera"}
                    </span>
                  </button>

                  {/* Audio */}
                  <button
                    onClick={toggleAudio}
                    className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 rounded-full font-medium ${isAudioMuted
                        ? "bg-red-600 text-white"
                        : "bg-white/90 text-gray-900"
                      } hover:opacity-90 transition`}
                  >
                    <span className="text-lg">
                      {isAudioMuted ? "🔇" : "🎙️"}
                    </span>
                    <span className="hidden sm:inline">
                      {isAudioMuted ? "Unmute" : "Mute"}
                    </span>
                  </button>

                  {/* People */}
                  <button className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-white hover:bg-white/20 transition">
                    <span className="text-lg">👥</span>
                    <span>People</span>
                  </button>

                  {/* React */}
                  <button className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-white hover:bg-white/20 transition">
                    <span className="text-lg">😊</span>
                    <span>React</span>
                  </button>

                  {/* Share */}
                  <button
                    onClick={toggleScreenShare}
                    className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 rounded-full font-medium ${isScreenSharing
                        ? "bg-emerald-500 text-white"
                        : "bg-white/10 text-white"
                      } hover:bg-white/20 transition`}
                  >
                    <span className="text-lg">🖥️</span>
                    <span className="hidden sm:inline">
                      {isScreenSharing ? "Stop" : "Share"}
                    </span>
                  </button>

                  {/* Leave */}
                  <button
                    onClick={handleLeave}
                    className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 rounded-full bg-red-600 text-white font-semibold hover:bg-red-500 transition"
                  >
                    <span className="text-lg">🚪</span>
                    <span className="hidden sm:inline">Leave</span>
                  </button>
                </div>
              </div>
            </div>

            {lastErr && (
              <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow pointer-events-auto">
                {lastErr}
              </div>
            )}
          </div>

          {/* INTENTIONS */}
          <div className="rounded-2xl bg-[#1F2937] text-white shadow-lg h-[70vh] sm:h-[74vh] lg:h-[77vh] overflow-hidden">
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
