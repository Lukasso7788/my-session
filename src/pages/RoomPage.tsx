import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { SessionTimer } from "../components/SessionTimer";
import { IntentionsPanel } from "../components/IntentionsPanel";

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [session, setSession] = useState<any>(null);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

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

  // === Load prebuilt Daily room into iframe ===
  useEffect(() => {
    if (!session?.daily_room_url || !iframeRef.current) return;
    iframeRef.current.src = session.daily_room_url;
  }, [session]);

  if (loading)
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-white">
        Loading session...
      </div>
    );

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* === Top bar === */}
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <SessionTimer
          focusBlocks={session?.focus_blocks || []}
          durationMinutes={session?.duration_minutes || 50}
          startTime={sessionStartTime || new Date()}
        />
        <span className="text-sm text-gray-400">
          {session?.title || "Focus Session"}
        </span>
      </div>

      {/* === Main area === */}
      <div className="flex flex-1 overflow-hidden">
        {/* === Video area (with embedded Daily prebuilt UI) === */}
        <div className="flex-1 flex flex-col items-center justify-center bg-black relative">
          <div className="w-full h-full max-w-7xl aspect-video relative rounded-xl overflow-hidden border border-gray-800 shadow-lg">
            <iframe
              ref={iframeRef}
              allow="camera; microphone; display-capture; autoplay"
              className="absolute top-0 left-0 w-full h-full border-0"
              title="Focus Room"
            />
          </div>
        </div>

        {/* === Sidebar === */}
        <div className="w-80 border-l border-gray-800 bg-gray-950">
          <IntentionsPanel />
        </div>
      </div>
    </div>
  );
}

export default RoomPage;
