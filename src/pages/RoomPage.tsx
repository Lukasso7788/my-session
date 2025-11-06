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

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<any[]>([]);
  const [hoveredStage, setHoveredStage] = useState<any>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const [remainingTime, setRemainingTime] = useState<string>("");
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userName, setUserName] = useState<string>("");

  const STAGE_COLOR_MAP: Record<string, string> = {
    intro: "#8FD8C6",
    intentions: "#FFF9F2",
    focus: "#9ADEDC",
    break: "#FF9F8E",
    outro: "#8FD8C6",
  };

  // ===== Helpers for localStorage state (persist across refresh) =====
  const LS_ROOM_URL = "daily-room-url";
  const LS_USER_NAME = "daily-user-name";
  const LS_JOINED = "daily-joined"; // "true" | "false"

  const persistState = (roomUrl?: string, name?: string, joined?: boolean) => {
    if (roomUrl !== undefined) localStorage.setItem(LS_ROOM_URL, roomUrl);
    if (name !== undefined) localStorage.setItem(LS_USER_NAME, name);
    if (joined !== undefined) localStorage.setItem(LS_JOINED, joined ? "true" : "false");
  };

  const clearState = () => {
    localStorage.removeItem(LS_ROOM_URL);
    localStorage.removeItem(LS_USER_NAME);
    localStorage.removeItem(LS_JOINED);
  };

  // ===== Load session (with host profile) & build stages =====
  useEffect(() => {
    async function loadSession() {
      if (!id) return;
      const { data, error } = await supabase
        .from("sessions")
        .select(
          "*, host_profile:profiles!sessions_host_id_fkey(id, full_name, avatar_url, bio), session_templates(*)"
        )
        .eq("id", id)
        .single();

      if (error) {
        console.error("❌ Error loading session:", error.message);
      } else {
        setSession(data);

        if (data?.schedule) {
          try {
            const parsed =
              typeof data.schedule === "string"
                ? JSON.parse(data.schedule)
                : data.schedule;

            const formatted = parsed.map((b: any) => {
              const lowerName = (b.name || "").toLowerCase();
              const type =
                b.type ||
                (lowerName.includes("welcome") || lowerName.includes("intro")
                  ? "intro"
                  : lowerName.includes("intention")
                  ? "intentions"
                  : lowerName.includes("focus")
                  ? "focus"
                  : lowerName.includes("break") || lowerName.includes("pause")
                  ? "break"
                  : lowerName.includes("farewell") ||
                    lowerName.includes("celebrat")
                  ? "outro"
                  : "focus");

              return {
                name: b.name,
                duration: b.minutes,
                color: STAGE_COLOR_MAP[type] || "#9ADEDC",
              };
            });

            setStages(formatted);
          } catch (e) {
            console.error("❌ Error parsing schedule:", e);
          }
        }
      }

      setLoading(false);
    }

    loadSession();
  }, [id]);

  // ===== Resolve user display name (from profile/auth) and persist it =====
  useEffect(() => {
    let cancelled = false;
    async function resolveUserName() {
      // If we already have a cached name, prefer it
      const cachedName = localStorage.getItem(LS_USER_NAME);
      if (cachedName) {
        if (!cancelled) setUserName(cachedName);
        return;
      }

      const { data } = await supabase.auth.getUser();
      const u = data.user;

      let name =
        (u?.user_metadata?.full_name as string) ||
        (u?.user_metadata?.name as string) ||
        "";

      if (!name && u?.id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", u.id)
          .single();
        name = profile?.full_name || "";
      }

      // Final fallback
      if (!name && u?.email) {
        name = u.email.split("@")[0];
      }

      if (!cancelled) {
        setUserName(name);
        persistState(undefined, name, undefined);
      }
    }

    resolveUserName();
    return () => {
      cancelled = true;
    };
  }, []);

  // ===== Daily iframe lifecycle (refresh-proof) =====
  useEffect(() => {
    if (!session?.daily_room_url || !containerRef.current) return;

    // Persist current room url for refresh continuity
    persistState(session.daily_room_url, userName || undefined, undefined);

    // Defensive destroy previous frame
    if (callRef.current) {
      callRef.current.destroy().catch(() => {});
      callRef.current = null;
    }

    // Create new iframe
    const callFrame = DailyIframe.createFrame(containerRef.current, {
      iframeStyle: {
        width: "100%",
        height: "100%",
        border: "0",
        borderRadius: "1rem",
      },
      showFullscreenButton: true,
      showLeaveButton: true,
    });
    callRef.current = callFrame;

    // Construct URL w/ layout
    const urlWithGrid = session.daily_room_url.includes("?")
      ? `${session.daily_room_url}&layout=grid`
      : `${session.daily_room_url}?layout=grid`;

    // If the user already joined before refresh → auto-join
    const wasJoined = localStorage.getItem(LS_JOINED) === "true";

    async function safeJoin() {
      try {
        if (wasJoined) {
          // Auto re-join on refresh
          await callFrame.join({
            url: urlWithGrid,
            userName: userName || undefined,
          });
        } else {
          // First visit in this tab: show Daily prejoin UI (no immediate join)
          await callFrame.load({
            url: urlWithGrid,
          });
        }
      } catch (err) {
        console.error("❌ Daily join/load error:", err);
        // Fallback: at least show prejoin
        try {
          await callFrame.load({ url: urlWithGrid });
        } catch (err2) {
          console.error("❌ Daily fallback load failed:", err2);
        }
      }
    }

    safeJoin();

    // Daily events
    const onJoined = () => {
      persistState(undefined, undefined, true);
    };
    const onLeft = async () => {
      persistState(undefined, undefined, false);
      clearState();
      try {
        await callFrame.destroy();
      } catch {}
      callRef.current = null;
      navigate("/sessions");
    };
    const onError = (e: any) => {
      console.error("❌ Daily error event:", e);
    };

    callFrame.on("joined-meeting", onJoined);
    callFrame.on("left-meeting", onLeft);
    callFrame.on("error", onError);

    // Cleanup on unmount
    return () => {
      callFrame.off("joined-meeting", onJoined);
      callFrame.off("left-meeting", onLeft);
      callFrame.off("error", onError);
      try {
        callFrame.destroy();
      } catch {}
      callRef.current = null;
    };
    // include userName so we can re-init when it resolves
  }, [session?.daily_room_url, userName, navigate]);

  // ===== Stage tracking by session.start_time =====
  useEffect(() => {
    if (!session?.start_time || !stages.length) return;

    const tick = setInterval(() => {
      const diffSec =
        (Date.now() - new Date(session.start_time).getTime()) / 1000;
      let total = 0;
      let activeStage = stages.length - 1;

      for (let i = 0; i < stages.length; i++) {
        const nextTotal = total + stages[i].duration * 60;
        if (diffSec < nextTotal) {
          activeStage = i;
          const remaining = nextTotal - diffSec;
          const minutes = Math.floor(remaining / 60);
          const seconds = Math.floor(remaining % 60);
          setRemainingTime(`${minutes}:${seconds.toString().padStart(2, "0")}`);
          break;
        }
        total = nextTotal;
      }

      setCurrentStage(activeStage);
    }, 1000);

    return () => clearInterval(tick);
  }, [session?.start_time, stages]);

  // ===== UI =====
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

          {/* 👤 Host info */}
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
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-lg overflow-hidden h-[77vh]">
            <div ref={containerRef} className="w-full h-[77vh]" />
          </div>

          <div className="rounded-2xl border border-slate-800 bg-white text-black shadow-lg overflow-hidden h-[77vh]">
            <div className="p-4 h-full">
              <IntentionsPanel />
            </div>
          </div>
        </div>
      </div>

      {/* Модалка профиля */}
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
