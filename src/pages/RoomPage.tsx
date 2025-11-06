import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DailyIframe, { DailyCall } from "@daily-co/daily-js";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";
import { supabase } from "../lib/supabase";
import { UserProfileModal } from "../components/UserProfileModal";

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  const initGuardRef = useRef(false);

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<any[]>([]);
  const [hoveredStage, setHoveredStage] = useState<any>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const [remainingTime, setRemainingTime] = useState<string>("");
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userName, setUserName] = useState<string>("");

  // наш prejoin
  const [token, setToken] = useState<string | null>(null);
  const [showPrejoin, setShowPrejoin] = useState(false);
  const [joining, setJoining] = useState(false);
  const [lastErr, setLastErr] = useState<string>("");

  const LS_JOINED = "daily-joined";
  const markJoined = (v: boolean) => localStorage.setItem(LS_JOINED, v ? "true" : "false");
  const wasJoined = () => localStorage.getItem(LS_JOINED) === "true";

  const STAGE_COLOR_MAP: Record<string, string> = {
    intro: "#8FD8C6",
    intentions: "#FFF9F2",
    focus: "#9ADEDC",
    break: "#FF9F8E",
    outro: "#8FD8C6",
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

      if (!error && data) {
        setSession(data);

        if (data?.schedule) {
          try {
            const parsed = typeof data.schedule === "string" ? JSON.parse(data.schedule) : data.schedule;
            const formatted = parsed.map((b: any) => {
              const lower = (b.name || "").toLowerCase();
              const type =
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
              return { name: b.name, duration: b.minutes, color: STAGE_COLOR_MAP[type] || "#9ADEDC" };
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
        const { data: p } = await supabase.from("profiles").select("full_name").eq("id", u.id).single();
        name = p?.full_name || "";
      }
      if (!name && u?.email) name = u.email.split("@")[0];
      if (!cancelled) setUserName(name);
    })();
    return () => { cancelled = true; };
  }, []);

  const getRoomName = (url: string) => {
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      return parts[parts.length - 1] || "";
    } catch { return ""; }
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

  // создаём frame один раз на маунт/смену URL/имени
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
      callRef.current.destroy().catch(() => {});
      callRef.current = null;
    }

    const frame = DailyIframe.createFrame(container, {
      iframeStyle: { width: "100%", height: "100%", border: "0", borderRadius: "1rem" },
      showFullscreenButton: true,
      showLeaveButton: true,
    });
    callRef.current = frame;

    const urlWithGrid = session.daily_room_url.includes("?")
      ? `${session.daily_room_url}&layout=grid`
      : `${session.daily_room_url}?layout=grid`;

    (async () => {
      try {
        const t = await fetchToken(session.daily_room_url);
        setToken(t);

        if (wasJoined()) {
          // авто-rejoin после refresh
          await frame.join({ url: urlWithGrid, token: t, userName });
        } else {
          // показываем свой prejoin
          setShowPrejoin(true);
        }
      } catch (e: any) {
        console.error("daily init error:", e);
        setLastErr(e?.message || "Failed to init Daily");
        setShowPrejoin(true); // всё равно показать кнопку Join — попробовать ещё раз
      }
    })();

    const onJoined = () => { markJoined(true); setShowPrejoin(false); };
    const onLeft = async () => {
      markJoined(false);
      try { await frame.destroy(); } catch {}
      callRef.current = null;
      initGuardRef.current = false;
      navigate("/sessions");
    };
    const onError = (e: any) => { console.error("daily error:", e); setLastErr(String(e?.errorMsg || e)); };

    frame.on("joined-meeting", onJoined);
    frame.on("left-meeting", onLeft);
    frame.on("error", onError);

    return () => {
      frame.off("joined-meeting", onJoined);
      frame.off("left-meeting", onLeft);
      frame.off("error", onError);
      try { frame.destroy(); } catch {}
      callRef.current = null;
      initGuardRef.current = false;
    };
  }, [session?.daily_room_url, userName, navigate]);

  // Кнопка Join
  const handleJoin = async () => {
    if (!callRef.current || !session?.daily_room_url || !token) return;
    setJoining(true);
    setLastErr("");
    const urlWithGrid = session.daily_room_url.includes("?")
      ? `${session.daily_room_url}&layout=grid`
      : `${session.daily_room_url}?layout=grid`;
    try {
      await callRef.current.join({ url: urlWithGrid, token, userName });
      // joined-meeting снимет prejoin
    } catch (e: any) {
      setLastErr(e?.message || "Join failed");
      setJoining(false);
    }
  };

  // таймер стадий
  useEffect(() => {
    if (!session?.start_time || !stages.length) return;
    const timer = setInterval(() => {
      const diffSec = (Date.now() - new Date(session.start_time).getTime()) / 1000;
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
      setCurrentStage(active);
    }, 1000);
    return () => clearInterval(timer);
  }, [session?.start_time, stages]);

  if (loading)
    return <div className="flex h-screen items-center justify-center bg-slate-900 text-white">Loading session...</div>;

  if (!session)
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
        <div className="text-center space-y-3">
          <p className="text-lg font-medium">Session not found</p>
          <button onClick={() => navigate("/sessions")} className="text-blue-400 hover:text-blue-300 underline">
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
            <div className="text-sm font-medium text-slate-400">{session?.title ?? ""}</div>
            <div className="text-xs text-slate-500">Stage {currentStage + 1} / {stages.length}</div>
          </div>

          <div className="bg-white rounded-2xl overflow-hidden shadow-sm p-4 space-y-3">
            <SessionStageBar stages={stages} startTime={session.start_time} onHoverStage={setHoveredStage} />
            <div className="flex justify-between items-center text-sm font-medium text-slate-700 mt-1">
              <span>
                {hoveredStage ? `${hoveredStage.name} • ${hoveredStage.duration} min` : stages[currentStage]?.name ?? ""}
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
            <div ref={containerRef} className="w-full h-full" style={{ minHeight: "70vh" }} />

            {/* Наш prejoin-оверлей */}
            {showPrejoin && (
              <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center">
                <div className="bg-white text-slate-900 rounded-2xl shadow-xl p-6 w-[360px] text-center space-y-4">
                  <h3 className="text-lg font-semibold">Ready to join?</h3>
                  <p className="text-sm text-slate-600">
                    You’ll join as <span className="font-medium">{userName || "Guest"}</span>
                  </p>
                  {lastErr && (
                    <p className="text-xs text-red-600 bg-red-50 rounded-md p-2">{lastErr}</p>
                  )}
                  <button
                    onClick={handleJoin}
                    disabled={joining || !token}
                    className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {joining ? "Joining..." : "Join session"}
                  </button>
                  <button
                    onClick={() => navigate("/sessions")}
                    className="w-full px-4 py-2 rounded-lg bg-slate-200 text-slate-800 hover:bg-slate-300"
                  >
                    Cancel
                  </button>
                </div>
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
        <UserProfileModal user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  );
}

export default RoomPage;
