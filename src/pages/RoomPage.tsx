import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DailyIframe, { DailyCall } from "@daily-co/daily-js";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionTimer } from "../components/SessionTimer";

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);

  // === Load session ===
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

  // === Daily prebuilt (iframe) ===
  useEffect(() => {
    if (!containerRef.current || !session?.daily_room_url) return;

    const callFrame = DailyIframe.createFrame(containerRef.current, {
      iframeStyle: {
        width: "100%",
        height: "100%",
        border: "0",
        borderRadius: "1rem", // скругление внутри iframe
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

    callFrame.join({ url: session.daily_room_url });

    return () => {
      callFrame.destroy();
      callRef.current = null;
    };
  }, [session, navigate]);

  if (loading)
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
        Loading session...
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-900 text-white flex justify-center">
      <div className="w-full max-w-[1600px] px-8 py-6 space-y-6">
        {/* === Header === */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 shadow-lg p-4">
          <div className="flex justify-between items-end mb-2">
            <div />
            <div className="text-xs text-slate-400">{session?.title ?? ""}</div>
          </div>

          <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
            <SessionTimer
              focusBlocks={session?.focus_blocks || []}
              durationMinutes={session?.duration_minutes || 50}
              startTime={sessionStartTime || new Date()}
            />
          </div>
        </div>

        {/* === Main content === */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,380px] gap-6">
          {/* === Video (iframe) === */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-lg overflow-hidden">
            <div ref={containerRef} className="w-full h-[75vh] min-h-[520px]" />
          </div>

          {/* === Intentions === */}
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
