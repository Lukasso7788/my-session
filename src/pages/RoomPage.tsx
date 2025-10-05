import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import DailyIframe from '@daily-co/daily-js';

export function RoomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch('/api/sessions');
        const all = await res.json();
        const found = all.find((s: any) => s.id === id);
        if (!found) throw new Error('Session not found');
        setSession(found);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchSession();
  }, [id]);

  useEffect(() => {
    if (!session || !containerRef.current) return;

    const frame = DailyIframe.createFrame(containerRef.current, {
      showLeaveButton: true,
      iframeStyle: {
        width: '100%',
        height: '100%',
        border: '0',
      },
    });

    frame.join({ url: session.daily_room_url });

    frame.on('left-meeting', () => {
      navigate('/sessions');
    });

    return () => frame.destroy();
  }, [session, navigate]);

  if (loading)
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-b-2 border-blue-600 rounded-full" />
      </div>
    );

  if (error)
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 font-medium mb-4">{error}</p>
        <button
          onClick={() => navigate('/sessions')}
          className="px-4 py-2 bg-blue-600 text-white rounded"
        >
          Back to sessions
        </button>
      </div>
    );

  return (
    <div className="h-screen w-screen bg-gray-50">
      <div className="h-full w-full" ref={containerRef}></div>
    </div>
  );
}

export default RoomPage;
