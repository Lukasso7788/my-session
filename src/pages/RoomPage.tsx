import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import DailyIframe, { DailyCall } from '@daily-co/daily-js';
import { VideoControls } from '../components/VideoControls';
import { IntentionsPanel } from '../components/IntentionsPanel';
import { SessionTimer } from '../components/SessionTimer';

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [sessionStartTime] = useState(new Date());

  // --- Load session ---
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const saved = localStorage.getItem('sessions');
        if (saved) {
          const found = JSON.parse(saved).find((s: any) => s.id === id);
          if (found) {
            setSession(found);
            setLoading(false);
            return;
          }
        }

        const res = await fetch(`/api/sessions/${id}`);
        if (!res.ok) throw new Error('Failed to load session');
        const data = await res.json();
        if (!data.daily_room_url) throw new Error('No room URL found');
        setSession(data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [id]);

  // --- Setup Daily call ---
  useEffect(() => {
    if (!containerRef.current || !session) return;

    // 🔥 Ключевое — displayMode: 'custom' и customLayout: true
    const callFrame = DailyIframe.createFrame(containerRef.current, {
      iframeStyle: {
        width: '100%',
        height: '100%',
        border: '0',
        borderRadius: '8px',
      },
      layoutConfig: {
        displayMode: 'custom',
        customLayout: true,
      },
      showLeaveButton: false,
      showFullscreenButton: false,
    });

    callRef.current = callFrame;

    // Подключаемся
    callFrame.join({ url: session.daily_room_url }).then(() => {
      // Удаляем встроенные кнопки окончательно
      try {
        callFrame.updateCustomTrayButtons({});
        callFrame.setShowNamesMode('off');
      } catch (e) {
        console.warn('Tray removal failed, likely not using custom layout yet:', e);
      }
    });

    callFrame.on('left-meeting', handleLeave);
    callFrame.on('app-message', (ev) => {
      if (ev?.data?.type === 'reaction') {
        console.log(`🎉 Reaction received: ${ev.data.emoji}`);
      }
    });

    return () => {
      callFrame.destroy();
      callRef.current = null;
    };
  }, [session]);

  // --- Controls ---
  const handleToggleMic = async () => {
    if (!callRef.current) return;
    await callRef.current.setLocalAudio(isMicMuted);
    setIsMicMuted(!isMicMuted);
  };

  const handleToggleCamera = async () => {
    if (!callRef.current) return;
    await callRef.current.setLocalVideo(isCameraOff);
    setIsCameraOff(!isCameraOff);
  };

  const handleToggleScreenShare = async () => {
    if (!callRef.current) return;
    try {
      if (isScreenSharing) await callRef.current.stopScreenShare();
      else await callRef.current.startScreenShare();
      setIsScreenSharing(!isScreenSharing);
    } catch (err) {
      console.error('Error toggling screen share:', err);
    }
  };

  const handleSendReaction = (emoji: string) => {
    if (!callRef.current) return;
    callRef.current.sendAppMessage({ type: 'reaction', emoji }, '*');
  };

  const handleLeave = async () => {
    if (callRef.current) {
      await callRef.current.leave();
      callRef.current.destroy();
      callRef.current = null;
    }
    navigate('/');
  };

  // --- UI ---
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
          <div ref={containerRef} className="flex-1 w-full" />
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
