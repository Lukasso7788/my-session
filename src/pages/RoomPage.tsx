import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DailyIframe, { DailyCall } from "@daily-co/daily-js";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";
import { supabase } from "../lib/supabase";

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<any[]>([]);
  const [currentStage, setCurrentStage] = useState(0);
  const [progress, setProgress] = useState(0);
  const [hoveredStage, setHoveredStage] = useState<any>(null);
  const [remainingTime, setRemainingTime] = useState<string>("");

  const STAGE_COLOR_MAP: Record<string, string> = {
    intro: "#8FD8C6",
    intentions: "#FFF9F2",
    focus: "#9ADEDC",
    break: "#FF9F8E",
    outro: "#8FD8C6",
  };

  // ✅ Load session
  useEffect(() => {
    async function loadSession() {
      if (!id) return;
      const { data, error } = await supabase
        .from("sessions")
        .select("*, session_templates(*)")
        .eq("id", id)
        .single();

      if (error) console.error("❌ Error loading session:", error.message);
      else setSession(data);

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

      setLoading(false);
    }

    loadSession();
  }, [id]);

  // ✅ Initialize Daily
  useEffect(() => {
    if (!session?.daily_room_url || !containerRef.current) return;

    let destroyed = false;
    if (callRef.current) {
      callRef.current.destroy().catch(() => {});
      callRef.current = null;
    }

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

    const urlWithGrid = session.daily_room_url.includes("?")
      ? `${session.daily_room_url}&layout=grid`
      : `${session.daily_room_url}?layout=grid`;

    callFrame.join({ url: urlWithGrid }).catch(console.error);

    callFrame.on("left-meeting", async () => {
      try {
        await callFrame.destroy();
      } catch {}
      callRef.current = null;
      navigate("/sessions");
    });

    return () => {
      destroyed = true;
      if (callRef.current) {
        callRef.current.destroy().catch(() => {});
        callRef.current = null;
      }
    };
  }, [session?.daily_room_url, navigate]);

  // ✅ Stage progress
  useEffect(() => {
    if (!stages.length) return;

    const current = stages[currentStage];
    const durationMs = current.duration * 60 * 1000;
    const startTime = Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const ratio = Math.min(elapsed / durationMs, 1);
      setProgress(ratio);

      const remaining = Math.max(0, durationMs - elapsed);
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      setRemainingTime(`${minutes}:${seconds.toString().padStart(2, "0")}`);

      if (ratio >= 1) {
        setCurrentStage((prev) =>
          prev + 1 < stages.length ? prev + 1 : prev
        );
        setProgress(0);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentStage, stages]);

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
              currentStageIndex={currentStage}
              currentStageProgress={progress}
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
        </div>

        {/* Video + Sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,370px] gap-5">
          {/* 🎥 Daily iframe */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-lg overflow-hidden h-[80vh]">
            <div ref={containerRef} className="w-full h-[80vh]" />
          </div>

          {/* 🧠 Intentions panel */}
          <div className="rounded-2xl border border-slate-800 bg-white text-black shadow-lg overflow-hidden h-[80vh]">
            <div className="p-4 h-full">
              <IntentionsPanel />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RoomPage;
