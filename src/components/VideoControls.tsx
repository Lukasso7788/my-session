import { Button } from "@/components/ui/button";
import { Mic, MicOff, Video, VideoOff, Monitor, LogOut, Smile } from "lucide-react";

interface VideoControlsProps {
  isMicMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onLeave: () => void;
  onSendReaction?: (emoji?: string) => void; // ← добавляем сюда
}

export function VideoControls({
  isMicMuted,
  isCameraOff,
  isScreenSharing,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onLeave,
  onSendReaction, // ← и сюда
}: VideoControlsProps) {
  return (
    <div className="flex justify-center gap-4 p-4 bg-gray-900 border-t border-gray-800">
      <Button
        variant="ghost"
        onClick={onToggleMic}
        className="text-white hover:bg-gray-700"
      >
        {isMicMuted ? <MicOff /> : <Mic />}
      </Button>

      <Button
        variant="ghost"
        onClick={onToggleCamera}
        className="text-white hover:bg-gray-700"
      >
        {isCameraOff ? <VideoOff /> : <Video />}
      </Button>

      <Button
        variant="ghost"
        onClick={onToggleScreenShare}
        className="text-white hover:bg-gray-700"
      >
        <Monitor className={isScreenSharing ? "text-blue-400" : ""} />
      </Button>

      {/* 🎉 Новая кнопка реакций */}
      <Button
        variant="ghost"
        onClick={() => onSendReaction && onSendReaction("🎉")}
        className="text-white hover:bg-gray-700"
      >
        <Smile />
      </Button>

      <Button
        variant="destructive"
        onClick={onLeave}
        className="text-white hover:bg-red-700"
      >
        <LogOut />
      </Button>
    </div>
  );
}
