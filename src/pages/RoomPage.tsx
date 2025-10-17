import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DailyIframe, { DailyCall, DailyParticipant } from "@daily-co/daily-js";
import { SessionTimer } from "../components/SessionTimer";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff } from "lucide-react";

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const callObjectRef = useRef<DailyCall | null>(null);

  const [participants, setParticipants] = useState<Record<string, DailyParticipant>>({});
  const [session, setSession] = useState<any>(null);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

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

  // === Initialize Daily call ===
  useEffect(() => {
    if (!session?.daily_room_url) return;

    const call = DailyIframe.createCallObject();
    callObjectRef.current = call;

    const updateParticipants = () => {
      const parts = call.participants();
      console.log("[Daily] participants:", parts);
      setParticipants(parts);
    };

    call.on("joined-meeting", updateParticipants);
    call.on("participant-joined", updateParticipants);
    call.on("participant-updated", updateParticipants);
    call.on("participant-left", updateParticipants);

    call.on("camera-error", (e) => console.error("[Daily] Camera error:", e));
    call.on("error", (e) => console.error("[Daily] Error:", e));

    call.on("left-meeting", async () => {
      console.log("[Daily] Left meeting");
      await call.destroy();
      navigate("/sessions");
    });

    (async () => {
      try {
        console.log("[Daily] Requesting camera access...");

        // 🚀 Явно запрашиваем доступ
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        console.log(
          "[Daily] Devices:",
          stream.getVideoTracks().map((t) => t.label)
        );

        // Включаем камеру через Daily
        await call.startCamera();
        await call.join({ url: session.daily_room_url });

        // Если у Daily нет видео, вставляем трек вручную
        const local = call.participants().local;
        if (!local.tracks.video.track && stream.getVideoTracks().length > 0) {
          const track = stream.getVideoTracks()[0];
          console.log("[Daily] Manually attaching video track:", track.label);
          call.setLocalVideo(true);
        }

        console.log("[Daily] Joined room:", session.daily_room_url);
      } catch (err) {
        console.error("[Daily] Failed to start camera/join:", err);
      }
    })();

    return () => {
      call.leave();
      call.destroy();
      callObjectRef.current = null;
    };
  }, [session, navigate]);

  // === Render participants video ===
  useEffect(() => {
    if (!videoContainerRef.current) return;
    const container = videoContainerRef.current;
    container.innerHTML = "";

    Object.values(participants).forEach((p) => {
      const videoTrack = p.tracks?.video?.track;
      const audioTrack = p.tracks?.audio?.track;

      if (!videoTrack) {
        console.warn("[Daily] Missing videoTrack for participant:", p.session_id);
        return;
      }

      const videoEl = document.createElement("video");
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.muted = p.local;
      videoEl.srcObject = new MediaStream([videoTrack]);
      videoEl.className =
        "rounded-xl object-cover w-full h-full max-h-[360px] sm:max-h-[480px] bg-black";

      const wrapper = document.createElement("div");
      wrapper.className = "relative rounded-lg overflow-hidden";
      wrapper.appendChild(videoEl);

      const nameTag = document.createElement("div");
      nameTag.className =
        "absolute bottom-2 left-2 bg-black bg-opacity-60 text-xs text-white px-2 py-1 rounded";
      nameTag.textContent = p.user_name || (p.local ? "You" : "Guest");
      wrapper.appendChild(nameTag);

      container.appendChild(wrapper);

      if (audioTrack && !p.local) {
        const audioEl = document.createElement("audio");
        audioEl.srcObject = new MediaStream([audioTrack]);
        audioEl.autoplay = true;
        container.appendChild(audioEl);
      }
    });
  }, [participants]);

  // === Controls ===
  const toggleMute = () => {
    if (!callObjectRef.current) return;
    const newMuted = !isMuted;
    callObjectRef.current.setLocalAudio(!newMuted);
    setIsMuted(newMuted);
  };

  const toggleCamera = () => {
    if (!callObjectRef.current) return;
    const newOff = !isCameraOff;
    callObjectRef.current.setLocalVideo(!newOff);
    setIsCameraOff(newOff);
  };

  const toggleScreenShare = async () => {
    if (!callObjectRef.current) return;
    const newSharing = !isSharing;
    if (newSharing) await callObjectRef.current.startScreenShare();
    else await callObjectRef.current.stopScreenShare();
    setIsSharing(newSharing);
  };

  const leaveMeeting = async () => {
    if (!callObjectRef.current) return;
    await callObjectRef.current.leave();
    navigate("/sessions");
  };

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
              >
                {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
              </button>

              <button
                onClick={toggleCamera}
                className={`p-3 rounded-full ${
                  isCameraOff ? "bg-red-600" : "bg-gray-700"
                } hover:bg-red-700`}
              >
                {isCameraOff ? <VideoOff size={22} /> : <Video size={22} />}
              </button>

              <button
                onClick={toggleScreenShare}
                className={`p-3 rounded-full ${
                  isSharing ? "bg-blue-600" : "bg-gray-700"
                } hover:bg-blue-700`}
              >
                <MonitorUp size={22} />
              </button>

              <button
                onClick={leaveMeeting}
                className="p-3 rounded-full bg-red-600 hover:bg-red-700"
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
