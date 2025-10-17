import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DailyIframe, {
  DailyCall,
  DailyParticipant,
} from "@daily-co/daily-js";
import { SessionTimer } from "../components/SessionTimer";
import { IntentionsPanel } from "../components/IntentionsPanel";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
} from "lucide-react";

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const callObjectRef = useRef<DailyCall | null>(null);

  const [participants, setParticipants] = useState<
    Record<string, DailyParticipant>
  >({});
  const [session, setSession] = useState<any>(null);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  // Local state for controls
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  // === Load session ===
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const saved = localStorage.getItem("sessions");
        if (saved) {
          const found = JSON.parse(saved).find((s: any) => s.id === id);
          if (found) {
            setSession(found);
            setSessionStartTime(
              new Date(found.scheduled_at || found.created_at)
            );
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [id]);

  // === Initialize Daily Call ===
  useEffect(() => {
    if (!session?.daily_room_url) return;

    const callObject = DailyIframe.createCallObject();
    callObjectRef.current = callObject;

    const updateParticipants = () => {
      setParticipants(callObject.participants());
    };

    callObject.on("joined-meeting", updateParticipants);
    callObject.on("participant-joined", updateParticipants);
    callObject.on("participant-updated", updateParticipants);
    callObject.on("participant-left", updateParticipants);

    callObject.on("left-meeting", async () => {
      await callObject.destroy();
      navigate("/");
    });

    callObject.join({ url: session.daily_room_url });

    return () => {
      callObject.leave();
      callObject.destroy();
      callObjectRef.current = null;
    };
  }, [session]);

  // === Render video streams ===
  useEffect(() => {
    if (!videoContainerRef.current) return;
    const container = videoContainerRef.current;
    container.innerHTML = "";

    Object.values(participants).forEach((p) => {
      if (!p.videoTrack) return;

      const videoEl = document.createElement("video");
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.muted = p.local;
      videoEl.srcObject = new MediaStream([p.videoTrack]);
      videoEl.className =
        "rounded-lg object-cover w-full h-full max-h-[320px] sm:max-h-[480px]";
      container.appendChild(videoEl);
    });
  }, [participants]);

  // === Control handlers ===
  const toggleMute = () => {
    if (!callObjectRef.current) return;
    const newMute = !isMuted;
    callObjectRef.current.setLocalAudio(!newMute);
    setIsMuted(newMute);
  };

  const toggleCamera = () => {
    if (!callObjectRef.current) return;
    const newState = !isCameraOff;
    callObjectRef.current.setLocalVideo(!newState);
    setIsCameraOff(newState);
  };

  const toggleScreenShare = async () => {
    if (!callObjectRef.current) return;
    const newSharing = !isSharing;
    if (newSharing) {
      await callObjectRef.current.startScreenShare();
    } else {
      await callObjectRef.current.stopScreenShare();
    }
    setIsSharing(newSharing);
  };

  const leaveMeeting = async () => {
    if (!callObjectRef.current) return;
    await callObjectRef.current.leave();
    navigate("/");
  };

  // === UI ===
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
          {Object.keys(participants).length} participants
        </span>
      </div>

      {/* === Main area === */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center bg-black relative">
          <div
            ref={videoContainerRef}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 w-full h-full overflow-auto"
          ></div>

          {/* === Control bar === */}
          <div className="absolute bottom-6 inset-x-0 flex justify-center">
            <div className="flex gap-4 bg-gray-800 bg-opacity-80 px-6 py-3 rounded-2xl shadow-lg">
              <button
                onClick={toggleMute}
                className={`p-3 rounded-full ${
                  isMuted ? "bg-red-600" : "bg-gray-700"
                } hover:bg-red-700`}
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
              </button>

              <button
                onClick={toggleCamera}
                className={`p-3 rounded-full ${
                  isCameraOff ? "bg-red-600" : "bg-gray-700"
                } hover:bg-red-700`}
                title={isCameraOff ? "Turn camera on" : "Turn camera off"}
              >
                {isCameraOff ? <VideoOff size={22} /> : <Video size={22} />}
              </button>

              <button
                onClick={toggleScreenShare}
                className={`p-3 rounded-full ${
                  isSharing ? "bg-blue-600" : "bg-gray-700"
                } hover:bg-blue-700`}
                title={
                  isSharing ? "Stop screen sharing" : "Share your screen"
                }
              >
                <MonitorUp size={22} />
              </button>

              <button
                onClick={leaveMeeting}
                className="p-3 rounded-full bg-red-600 hover:bg-red-700"
                title="Leave meeting"
              >
                <PhoneOff size={22} />
              </button>
            </div>
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
