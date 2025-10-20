import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DailyIframe, { DailyCall } from "@daily-co/daily-js";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionTimer } from "../components/SessionTimer";
import { SessionStageBar } from "../components/SessionStageBar";
import { defaultSession } from "../SessionConfig";

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);

  // состояние стадий сессии
  const [currentStage, setCurrentStage] = useState(0);
  const [progress, setProgress] = useState(0);
  const stages = defaultSession;

  // загружаем данные сессии
  useEffect(() => {
    const saved = localStorage.getItem("sessions");
    if (saved) {
      const found = JSON.parse(saved).find((s: any) => s.id === id);
      if (found) {
        setSession(found);
        setSessionStartTime(new Date(found.scheduled_at || found.created_at));
      }
    }
    setLoading(false);
  }, [id]);

  // вспомогательная функция для включения grid layout
  function withGridLayout(url: string): string {
    try {
      const u = new URL(url);
      u.searchParams.set("layout", "grid");
      u.searchParams.set("view", "grid");
      return u.toString();
    } catch {
      const sep = url.includes("?") ? "&" : "?";
      return `${url}${sep}layout=grid&view=grid`;
    }
  }

  // инициализация Daily iframe
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

    const urlWithGrid = withGridLayout(session.daily_room_url);
    callFrame.join({ url: urlWithGrid }).catch((err) => {
      console.error("Daily join error:", err);
    });

    return () => {
      callFrame.destroy();
      callRef.current = null;
    };
  }, [session, navigate]);

  // управление стадиями (как в Flown)
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
  }, [currentStage]);

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
          <div className="flex justify-between items-end mb-2">
            <div />
            <div className="text-xs text-slate-400">{session?.title ?? ""}</div>
          </div>

          {/* Progress bar */}
          <div className="bg-white rounded-2xl overflow-hidden shadow-sm p-4">
            <div className="mb-4">
              <SessionStageBar
                stages={stages}
                currentStageIndex={currentStage}
                currentStageProgress={progress}
              />
            </div>
            <SessionTimer
              focusBlocks={session?.focus_blocks || []}
              durationMinutes={session?.duration_minutes || 50}
              startTime={sessionStartTime || new Date()}
            />
          </div>
        </div>

        {/* Main content */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,370px] gap-5">
          {/* Video */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-lg overflow-hidden">
            <div ref={containerRef} className="w-full h-[75vh] min-h-[520px]" />
          </div>

          {/* Intentions panel */}
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
