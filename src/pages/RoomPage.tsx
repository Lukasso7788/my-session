import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DailyIframe, { DailyCall, DailyParticipant } from "@daily-co/daily-js";
import { SessionTimer } from "../components/SessionTimer";
import { IntentionsPanel } from "../components/IntentionsPanel";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
  Smile,
} from "lucide-react";

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
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [showEmojis, setShowEmojis] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<{ id: number; emoji: string }[]>([]);

  const emojis = ["👍", "👏", "😂", "❤️", "😮"];

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

  // === Initialize Daily ===
  useEffect(() => {
    if (!session?.daily_room_url) return;

    const call = DailyIframe.createCallObject();
    callObjectRef.current = call;

    const updateParticipants = () => setParticipants(call.participants());
    call.on("joined-meeting", updateParticipants);
    call.on("participant-joined", updateParticipants);
    call.on("participant-updated", updateParticipants);
    call.on("participant-left", updateParticipants);

    // 💬 Catch emoji messages
    call.on("app-message", (event) => {
      const emoji = event.data?.emoji;
      if (emoji) {
        const id = Date.now() + Math.random();
        setFloatingEmojis((prev) => [...prev, { id, emoji }]);
        setTimeout(
          () => setFloatingEmojis((prev) => prev.filter((e) => e.id !== id)),
          2500
        );
      }
    });

    call.on("left-meeting", async () => {
      await call.destroy();
      navigate("/sessions");
    });

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        const devices = await navigator.mediaDevices.enumerateDevices();
        setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
        setSelectedCamera(stream.getVideoTracks()[0].getSettings().deviceId || "");

        await call.startCamera();
        await call.join({ url: session.daily_room_url });
      } catch (err) {
        console.error("[Daily] join error:", err);
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
      if (!videoTrack) return;

      const videoEl = document.createElement("video");
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.muted = p.local;
      videoEl.srcObject = new MediaStream([videoTrack]);
      videoEl.className =
        "rounded-xl object-cover w-full aspect-video max-h-[480px] bg-black";

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

  const changeCamera = async (deviceId: string) => {
    if (!callObjectRef.current) return;
    try {
      await callObjectRef.current.updateInputSettings({
        video: { deviceId },
      });
      setSelectedCamera(deviceId);
      console.log("[Daily] Switched camera:", deviceId);
    } catch (err) {
      console.error("[Daily] Failed to switch camera:", err);
    }
  };

  const sendEmoji = (emoji: string) => {
    if (!callObjectRef.current) return;
    callObjectRef.current.sendAppMessage({ emoji }, "*");

    const id = Date.now() + Math.random();
    setFloatingEmojis((prev) => [...prev, { id, emoji }]);
    setTimeout(
      () => setFloatingEmojis((prev) => prev.filter((e) => e.id !== id)),
      2500
    );
    setShowEmojis(false);
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
          {/* === Video Grid === */}
          <div
            ref={videoContainerRef}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 w-full h-full overflow-auto"
          ></div>

          {/* === Floating Emojis === */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {floatingEmojis.map((e) => (
              <span
                key={e.id}
                className="absolute text-4xl animate-float"
                style={{
                  left: `${Math.random() * 80 + 10}%`,
                  bottom: "0%",
                  animation: `floatUp 2.5s ease-out`,
                }}
              >
                {e.emoji}
              </span>
            ))}
          </div>

          {/* === Control bar === */}
          <div className="absolute bottom-6 inset-x-0 flex flex-col items-center gap-3">
            {/* === Camera selector === */}
            <div className="flex gap-2 items-center">
              <select
                value={selectedCamera}
                onChange={(e) => changeCamera(e.target.value)}
                className="bg-gray-800 text-white text-sm px-2 py-1 rounded-md border border-gray-700"
              >
                {videoDevices.map((dev) => (
                  <option key={dev.deviceId} value={dev.deviceId}>
                    {dev.label || "Camera"}
                  </option>
                ))}
              </select>
            </div>

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
                onClick={() => setShowEmojis(!showEmojis)}
                className="p-3 rounded-full bg-gray-700 hover:bg-gray-600"
              >
                <Smile size={22} />
              </button>

              <button
                onClick={leaveMeeting}
                className="p-3 rounded-full bg-red-600 hover:bg-red-700"
              >
                <PhoneOff size={22} />
              </button>
            </div>

            {showEmojis && (
              <div className="flex gap-2 bg-gray-800 px-4 py-2 rounded-xl">
                {emojis.map((e) => (
                  <button
                    key={e}
                    onClick={() => sendEmoji(e)}
                    className="text-2xl hover:scale-125 transition-transform"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* === Sidebar === */}
        <div className="w-80 border-l border-gray-800 bg-gray-950">
          <IntentionsPanel />
        </div>
      </div>

      {/* === Floating emoji animation === */}
      <style>
        {`
          @keyframes floatUp {
            0% { transform: translateY(0) scale(1); opacity: 1; }
            100% { transform: translateY(-250px) scale(1.5); opacity: 0; }
          }
        `}
      </style>
    </div>
  );
}

export default RoomPage;
