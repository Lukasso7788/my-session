import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DailyIframe, { DailyCall } from "@daily-co/daily-js";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";
import { getSessionFormatById, sessionFormats } from "../SessionConfig";

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

  // ---- Load session from localStorage ----
  useEffect(() => {
    const saved = localStorage.getItem("sessions");
    if (saved) {
      const found = JSON.parse(saved).find((s: any) => s.id === id);
      if (found) {
        setSession(found);

        const format =
          getSessionFormatById(found.format_id || found.format) ||
          sessionFormats[0];

        setStages(format.stages || []);
      }
    }
    setLoading(false);
  }, [id]);

  // ---- Initialize Daily iframe safely ----
  useEffect(() => {
    if (!containerRef.current || !session?.daily_room_url) return;

    // Destroy previous instance if exists
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

    callFrame.on("left-meeting", async () => {
      try {
        await callFrame.destroy();
      } catch {}
      callRef.current = null;
      navigate("/sessions");
    });

    const urlWithGrid = session.daily_room_url.includes("?")
      ? `${session.daily_room_url}&layout=grid`
      : `${session.daily_room_url}?layout=grid`;

    callFrame
      .join({ url: urlWithGrid })
      .catch((err) => console.error("Daily join error:", err));

    return () => {
      if (callRef.current) {
        callRef.current.destroy().catch(() => {});
        callRef.current = null;
      }
    };
  }, [session?.daily_room_url, navigate]);

  // ---- Stage progression and timer ----
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
        setCurrentStage((prev) => {
          if (prev + 1 < stages.length) return prev + 1;
          return prev;
        });
        setProgress(0);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentStage, stages]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
        Loading session...
      </div>
    );
  }

  if (!session) {
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
  }

  // ---- UI ----
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

        {/* Main */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,370px] gap-5">
          {/* Video area */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-lg overflow-hidden">
            <div ref={containerRef} className="w-full h-[75vh] min-h-[520px]" />
          </div>

          {/* Intentions sidebar */}
          <div className="rounded-2xl border border-slate-800 bg-white text-black shadow-lg overflow-hidden">
            <div className="p-4">
              <IntentionsPanel />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RoomPage;
