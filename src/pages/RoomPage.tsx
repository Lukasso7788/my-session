import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DailyIframe, { DailyCall } from "@daily-co/daily-js";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";
import { defaultSession } from "../SessionConfig";

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [currentStage, setCurrentStage] = useState(0);
  const [progress, setProgress] = useState(0);
  const stages = defaultSession;

  // === Load session from localStorage ===
  useEffect(() => {
    const saved = localStorage.getItem("sessions");
    if (saved) {
      const found = JSON.parse(saved).find((s: any) => s.id === id);
      if (found) setSession(found);
    }
    setLoading(false);
  }, [id]);

  // === Join Daily iframe ===
  useEffect(() => {
    if (!containerRef.current || !session?.daily_room_url) return;

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
      await callFrame.destroy();
      callRef.current = null;
      navigate("/sessions");
    });

    const urlWithGrid = session.daily_room_url.includes("?")
      ? `${session.daily_room_url}&layout=grid`
      : `${session.daily_room_url}?layout=grid`;

    callFrame.join({ url: urlWithGrid }).catch(console.error);

    return () => {
      callFrame.destroy();
      callRef.current = null;
    };
  }, [session, navigate]);

  // === Stage logic ===
  useEffect(() => {
    const current = stages[currentStage];
    const durationMs = current.duration * 60 * 1000;
    const startTime = Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const ratio = Math.min(elapsed / durationMs, 1);
      setProgress(ratio);

      if (ratio >= 1) {
        setCurrentStage((prev) => (prev + 1 < stages.length ? prev + 1 : prev));
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
              Stage {currentStage + 1} of {stages.length}
            </div>
          </div>

          <div className="bg-white rounded-2xl overflow-hidden shadow-sm p-4">
            <SessionStageBar
              stages={stages}
              currentStageIndex={currentStage}
              currentStageProgress={progress}
            />
          </div>
        </div>

        {/* Main Area */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,370px] gap-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-lg overflow-hidden">
            <div ref={containerRef} className="w-full h-[75vh] min-h-[520px]" />
          </div>

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
