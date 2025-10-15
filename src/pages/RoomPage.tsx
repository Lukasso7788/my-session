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

  // === 1. Загружаем данные сессии ===
  useEffect(() => {
    const fetchSession = async () => {
      try {
        // Проверяем localStorage
        const saved = localStorage.getItem('sessions');
        if (saved) {
          const found = JSON.parse(saved).find((s: any) => s.id === id);
          if (found) {
            setSession(found);
            setLoading(false);
            return;
          }
        }

        // Иначе — запрашиваем с API
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

  // === 2. Инициализация Daily Call ===
  useEffect(() => {
    if (!containerRef.current || !session) return;

    // Убираем theme — Daily его не принимает
    const callFrame = DailyIframe.createFrame(containerRef.current, {
      iframeStyle: {
        width: '100%',
        height: '100%',
        border: '0',
        borderRadius: '8px',
      },
      layoutConfig: {
        displayMode: 'custom', // 🔥 отключает стандартный UI
      },
    });

    callRef.current = callFrame;

    // Слушаем события
    callFrame.on('left-meeting', handleLeave);
    callFrame.on('app-message', (ev) => {
      if (ev?.data?.type === 'reaction') {
        console.log(`🎉 Reaction received: ${ev.data.emoji}`);
      }
    });

    // Присоединяемся к комнате
    callFrame.join({ url: session.daily_room_url });

    return () => {
      callFrame.destroy();
      callRef.current = null;
    };
  }, [session]);

  // === 3. Контролы ===
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

  // === 4. Реакции ===
  const handleSendReaction = (emoji: string = '🎉') => {
    if (!callRef.current) return;
    callRef.current.sendAppMessage({ type: 'reaction', emoji }, '*');
    console.log(`✅ Reaction sent: ${emoji}`);
  };

  // === 5. Выход ===
  const handleLeave = async () => {
    if (callRef.current) {
      await callRef.current.leave();
      callRef.current.destroy();
      callRef.current = null;
    }
    navigate('/');
  };

  // === 6. UI ===
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
      {/* Верхняя панель — таймер */}
      <div className="p-4 border-b border-gray-800">
        <SessionTimer
          focusBlocks={session?.focus_blocks || []}
          durationMinutes={session?.duration_minutes || 50}
          startTime={sessionStartTime}
        />
      </div>

      {/* Основная часть */}
      <div className="flex flex-1 overflow-hidden">
        {/* Видео + контролы */}
        <div className="flex-1 flex flex-col items-center justify-between bg-black">
          <div
            ref={containerRef}
            className="flex-1 w-full flex items-center justify-center text-gray-500"
          >
            {/* Показываем плейсхолдер, если Daily ещё не отрисовался */}
            <span className="text-gray-600">Connecting to room...</span>
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

        {/* Правая панель */}
        <div className="w-80 border-l border-gray-800 bg-gray-950">
          <IntentionsPanel />
        </div>
      </div>
    </div>
  );
}

export default RoomPage;
