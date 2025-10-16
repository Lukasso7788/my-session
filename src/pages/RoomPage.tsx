import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DailyIframe, { DailyCall } from "@daily-co/daily-js";
import { VideoControls } from "../components/VideoControls";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionTimer } from "../components/SessionTimer";

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [callObject, setCallObject] = useState<DailyCall | null>(null);
  const [participants, setParticipants] = useState<Record<string, any>>({});
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [sessionStartTime] = useState(new Date());

  // === Load session ===
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const saved = localStorage.getItem("sessions");
        if (saved) {
          const found = JSON.parse(saved).find((s: any) => s.id === id);
          if (found) {
            setSession(found);
            setLoading(false);
            return;
          }
        }

        const res = await fetch(`/api/sessions/${id}`);
        if (!res.ok) throw new Error("Failed to load session");
        const data = await res.json();
        if (!data.daily_room_url) throw new Error("No room URL found");
        setSession(data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [id]);

  // === Setup CallObject ===
  useEffect(() => {
    if (!session) return;

    const co = DailyIframe.createCallObject();
    setCallObject(co);

    const updateParticipants = () => setParticipants(co.participants());

    co.on("joined-meeting", () => {
      console.log("✅ Joined meeting");
      updateParticipants();
    });
    co.on("participant-joined", updateParticipants);
    co.on("participant-updated", updateParticipants);
    co.on("participant-left", updateParticipants);
    co.on("track-started", updateParticipants);
    co.on("track-stopped", updateParticipants);

    co.join({ url: session.daily_room_url });

    return () => {
      co.destroy();
      setCallObject(null);
    };
  }, [session]);

  // === Controls ===
  const handleToggleMic = async () => {
    if (!callObject) return;
    await callObject.setLocalAudio(isMicMuted);
    setIsMicMuted(!isMicMuted);
  };

  const handleToggleCamera = async () => {
    if (!callObject) return;
    await callObject.setLocalVideo(isCameraOff);
    setIsCameraOff(!isCameraOff);
  };

  const handleToggleScreenShare = async () => {
    if (!callObject) return;
    try {
      if (isScreenSharing) await callObject.stopScreenShare();
      else await callObject.startScreenShare();
      setIsScreenSharing(!isScreenSharing);
    } catch (err) {
      console.error("Error toggling screen share:", err);
    }
  };

  const handleSendReaction = (emoji: string) => {
    if (!callObject) return;
    callObject.sendAppMessage({ type: "reaction", emoji }, "*");
  };

  const handleLeave = async () => {
    if (callObject) {
      await callObject.leave();
      callObject.destroy();
      setCallObject(null);
    }
    navigate("/");
  };

  // === UI ===
  if (loading)
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-white">
        Loading session...
      </div>
    );

  if (error)
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-red-500">
        {error}
      </div>
    );

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      <div className="p-4 border-b border-gray-800">
        <SessionTimer
          focusBlocks={session?.focus_blocks || []}
          durationMinutes={session?.duration_minutes || 50}
          startTime={sessionStartTime}
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-between bg-black">
          <div className="flex flex-wrap justify-center items-center w-full h-full bg-black">
            {Object.values(participants).map((p: any) => {
              const videoTrack = p.tracks?.video?.track;
              if (!videoTrack) return null;
              return (
                <div key={p.session_id} className="relative m-2">
                  <video
                    ref={(el) => {
                      if (el && videoTrack) {
                        el.srcObject = new MediaStream([videoTrack]);
                        el.play().catch(() => {});
                      }
                    }}
                    className="w-1/2 max-w-[400px] rounded-xl"
                    autoPlay
                    muted={p.local}
                  />
                  <div className="absolute bottom-2 left-2 text-sm text-gray-300 bg-black/40 px-2 py-1 rounded">
                    {p.user_name || (p.local ? "You" : "Guest")}
                  </div>
                </div>
              );
            })}
          </div>

          <VideoControls
            isMicMuted={isMicMuted}
            isCameraOff={isCameraOff}
            isScreenSharing={isScreenSharing}
            onToggleMic={handleToggleMic}
            onToggleCamera={handleToggleCamera}
            onToggleScreenShare={handleToggleScreenShare}
            onSendReaction={handleSendReaction}
            onLeave={handleLeave}
          />
        </div>

        <div className="w-80 border-l border-gray-800 bg-gray-950">
          <IntentionsPanel />
        </div>
      </div>
    </div>
  );
}

export default RoomPage;
