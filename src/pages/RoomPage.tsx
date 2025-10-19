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
  const [error, setError] = useState<string | null>(null);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);

  // === Load session ===
  useEffect(() => {
    const run = async () => {
      try {
        const saved = localStorage.getItem("sessions");
        if (saved) {
          const found = JSON.parse(saved).find((s: any) => s.id === id);
          if (found) {
            setSession(found);
            setSessionStartTime(new Date(found.scheduled_at || found.created_at));
            setLoading(false);
            return;
          }
        }
        const res = await fetch(`/api/sessions/${id}`);
        if (!res.ok) throw new Error("Failed to load session");
        const data = await res.json();
        setSession(data);
        setSessionStartTime(new Date(data.scheduled_at || data.created_at));
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [id]);

  // === Daily prebuilt (iframe) ===
  useEffect(() => {
    if (!containerRef.current || !session?.daily_room_url) return;

    const callFrame = DailyIframe.createFrame(containerRef.current, {
      iframeStyle: {
        width: "100%",
        height: "100%",
        border: "0",
      },
      // используем предустановленный UI
      showFullscreenButton: true,
      showLeaveButton: true,
    });

    callRef.current = callFrame;

    callFrame.on("left-meeting", async () => {
      await callFrame.destroy();
      callRef.current = null;
      navigate("/sessions");
    });

    callFrame
      .join({ url: session.daily_room_url })
      .catch((err) => console.error("Join error:", err));

    return () => {
      callFrame.destroy();
      callRef.current = null;
    };
  }, [session, navigate]);

  // === UI states ===
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
        Loading session…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="mx-auto w-full max-w-[1400px] px-5 md:px-6 py-5 space-y-5">
        {/* Header: title (small, right) + timer card with same radius */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 shadow-lg backdrop-blur-sm">
          <div className="flex items-center justify-between px-4 pt-3">
            <div />
            <div className="text-xs tracking-wide text-slate-400">
              {session?.title ?? ""}
            </div>
          </div>
          <div className="px-4 pb-4">
            <div className="rounded-2xl overflow-hidden bg-white/95">
              <SessionTimer
                focusBlocks={session?.focus_blocks || []}
                durationMinutes={session?.duration_minutes || 50}
                startTime={sessionStartTime || new Date()}
              />
            </div>
          </div>
        </div>

        {/* Main grid: left = video (iframe), right = intentions; радиусы совпадают */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-5 items-start">
          {/* Video card */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-lg overflow-hidden">
            <div className="relative h-[72vh] min-h-[520px]">
              <div ref={containerRef} className="absolute inset-0" />
            </div>
          </div>

          {/* Intentions card with same radius */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-lg overflow-hidden">
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
