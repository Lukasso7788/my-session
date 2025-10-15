import { Mic, MicOff, Video, VideoOff, Monitor, LogOut } from 'lucide-react';

interface VideoControlsProps {
  isMicMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onLeave: () => void;
}

export function VideoControls({
  isMicMuted,
  isCameraOff,
  isScreenSharing,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onLeave,
}: VideoControlsProps) {
  return (
    <div className="flex items-center justify-center gap-3 p-4 bg-gray-900">
      <button
        onClick={onToggleMic}
        className={`p-4 rounded-full transition-colors ${
          isMicMuted
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-gray-700 hover:bg-gray-600'
        }`}
        title={isMicMuted ? 'Unmute' : 'Mute'}
      >
        {isMicMuted ? (
          <MicOff size={20} className="text-white" />
        ) : (
          <Mic size={20} className="text-white" />
        )}
      </button>

      <button
        onClick={onToggleCamera}
        className={`p-4 rounded-full transition-colors ${
          isCameraOff
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-gray-700 hover:bg-gray-600'
        }`}
        title={isCameraOff ? 'Enable Camera' : 'Disable Camera'}
      >
        {isCameraOff ? (
          <VideoOff size={20} className="text-white" />
        ) : (
          <Video size={20} className="text-white" />
        )}
      </button>

      <Button
        onClick={onSendReaction}
        className="bg-yellow-600 hover:bg-yellow-700"
      >
        🎉 React
      </Button>

      <button
        onClick={onToggleScreenShare}
        className={`p-4 rounded-full transition-colors ${
          isScreenSharing
            ? 'bg-blue-600 hover:bg-blue-700'
            : 'bg-gray-700 hover:bg-gray-600'
        }`}
        title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
      >
        <Monitor size={20} className="text-white" />
      </button>

      <div className="w-px h-8 bg-gray-600 mx-2" />

      <button
        onClick={onLeave}
        className="p-4 rounded-full bg-red-600 hover:bg-red-700 transition-colors"
        title="Exit Room"
      >
        <LogOut size={20} className="text-white" />
      </button>
    </div>
  );
}
