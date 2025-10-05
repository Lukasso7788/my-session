import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DailyIframe from "@daily-co/daily-js";

export default function RoomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<any>(null);
  const [callFrame, setCallFrame] = useState<any>(null);

  // Загружаем данные сессии
  useEffect(() => {
    async function fetchSession() {
      const res = await fetch(`/api/sessions`);
      const sessions = await res.json();
      const found = sessions.find((s: any) => s.id === id);
      if (found) setSession(found);
      else navigate("/sessions");
    }
    fetchSession();
  }, [id, navigate]);

  // Подключаем Daily iframe
  useEffect(() => {
    if (!session || !containerRef.current) return;

    const frame = DailyIframe.createFrame(containerRef.current, {
      showLeaveButton: true, // Daily сам покажет кнопку выхода
      iframeStyle: {
        width: "100%",
        height: "100vh",
        border: "none",
        borderRadius: "12px",
      },
    });

    frame.join({ url: session.daily_room_url });
    setCallFrame(frame);

    frame.on("left-meeting", () => {
      navigate("/sessions"); // возвращаемся на список
    });

    return () => {
      frame.destroy();
    };
  }, [session, navigate]);

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-gray-100">
      <div ref={containerRef} className="w-full h-full max-w-6xl" />
    </div>
  );
}
