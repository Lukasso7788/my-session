import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import DailyIframe, { DailyCall } from '@daily-co/daily-js';
import { Session } from '../lib/supabase';
import { VideoControls } from '../components/VideoControls';
import { IntentionsPanel } from '../components/IntentionsPanel';
import { SessionTimer } from '../components/SessionTimer';

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const callFrameRef = useRef<DailyCall | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);

  useEffect(() => {
    const fetchSession = async () => {
      if (!id) return;

      try {
        const response = await fetch(`/api/sessions/${id}`);
        
        if (!response.ok) {
          if (response.status === 404) {
            console.error('Session not found');
            return;
          }
          throw new Error(`Failed to fetch session: ${response.status}`);
        }

        const data = await response.json();
        setSession(data);
        setSessionStartTime(new Date(data.scheduled_at));
      } catch (error) {
        console.error('Error fetching session:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSession();
  }, [id]);

  useEffect(() => {
    if (!containerRef.current || isLoading || !session) return;

    const initializeCall = async () => {
      try {
        const callFrame = DailyIframe.createFrame(containerRef.current!, {
          iframeStyle: {
            width: '100%',
            height: '100%',
            border: '0',
            borderRadius: '8px',
          },
          showLeaveButton: false,
          showFullscreenButton: true,
        });

        callFrameRef.current = callFrame;

        callFrame.on('participant-joined', () => {
          console.log('Participant joined');
        });

        callFrame.on('participant-left', () => {
          console.log('Participant left');
        });

        callFrame.on('left-meeting', () => {
          handleLeave();
        });

        if (!session.daily_room_url) {
          throw new Error('No Daily room URL found for this session');
        }

        await callFrame.join({ url: session.daily_room_url });
      } catch (error) {
        console.error('Error initializing Daily call:', error);
      }
    };

    initializeCall();

    return () => {
      if (callFrameRef.current) {
        callFrameRef.current.destroy();
      }
    };
  }, [isLoading, session]);

  const handleToggleMic = async () => {
    if (!callFrameRef.current) return;
    await callFrameRef.current.setLocalAudio(!isMicMuted);
    setIsMicMuted(!isMicMuted);
  };

  const handleToggleCamera = async () => {
    if (!callFrameRef.current) return;
    await callFrameRef.current.setLocalVideo(!isCameraOff);
    setIsCameraOff(!isCameraOff);
  };

  const handleToggleScreenShare = async () => {
    if (!callFrameRef.current) return;

    try {
      if (isScreenSharing) {
        await callFrameRef.current.stopScreenShare();
      } else {
        await callFrameRef.current.startScreenShare();
      }
      setIsScreenSharing(!isScreenSharing);
    } catch (error) {
      console.error('Error toggling screen share:', error);
    }
  };

  const handleLeave = async () => {
    if (callFrameRef.current) {
      await callFrameRef.current.leave();
      callFrameRef.current.destroy();
    }
    navigate('/');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white">Loading session...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white">Session not found</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      {sessionStartTime && (
        <SessionTimer
          focusBlocks={session.focus_blocks}
          durationMinutes={session.duration_minutes}
          startTime={sessionStartTime}
        />
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col">
          <div ref={containerRef} className="flex-1 bg-black" />
          <VideoControls
            isMicMuted={isMicMuted}
            isCameraOff={isCameraOff}
            isScreenSharing={isScreenSharing}
            onToggleMic={handleToggleMic}
            onToggleCamera={handleToggleCamera}
            onToggleScreenShare={handleToggleScreenShare}
            onLeave={handleLeave}
          />
        </div>

        <div className="w-80 border-l border-gray-700">
          <IntentionsPanel />
        </div>
      </div>
    </div>
  );
}
