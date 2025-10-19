import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { SessionTimer } from "../components/SessionTimer";
import { IntentionsPanel } from "../components/IntentionsPanel";

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
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

  // === Load prebuilt Daily room ===
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
    <div className="flex flex-col h-screen bg-gray-900 text-white px-6 py-4 gap-4">
      {/* === Top bar === */}
      <div className="border border-gray-800 bg-gray-950 rounded-2xl p-4 flex items-center justify-between shadow-lg">
        <SessionTimer
          focusBlocks={session?.focus_blocks || []}
          durationMinutes={session?.duration_minutes || 50}
          startTime={sessionStartTime || new Date()}
        />
        <span className="text-sm text-gray-400 pr-2">
          {session?.title || "Focus Session"}
        </span>
      </div>

      {/* === Main area === */}
      <div className="flex flex-1 overflow-hidden gap-4">
        {/* === Video area === */}
        <div className="flex-1 flex justify-center items-center rounded-2xl overflow-hidden border border-gray-800 bg-black shadow-lg">
          <iframe
            ref={iframeRef}
            allow="camera; microphone; display-capture; autoplay"
            className="w-full h-full border-0 rounded-2xl"
            title="Focus Room"
          />
        </div>

        {/* === Sidebar === */}
        <div className="w-80 border border-gray-800 bg-gray-950 rounded-2xl shadow-lg">
          <IntentionsPanel />
        </div>
      </div>
    </div>
  );
}

export default RoomPage;
