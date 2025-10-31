import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Clock, Plus, Calendar } from "lucide-react";
import { CreateSessionModal } from "../components/CreateSessionModal";
import { formatSessionFormat } from "../utils/sessionHelpers";
import { supabase } from "../lib/supabase";
import type { Session } from "../types/session";

export function SessionsPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // ✅ Fetch sessions from Supabase
  const fetchSessions = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("sessions")
        .select(`
          id,
          title,
          host,
          duration_minutes,
          format,
          start_time,
          status
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setSessions((data || []) as Session[]);
      localStorage.setItem("sessions", JSON.stringify(data || []));
    } catch (error) {
      console.error("Error fetching sessions:", error);
      const saved = localStorage.getItem("sessions");
      if (saved) setSessions(JSON.parse(saved));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleJoinSession = (sessionId: string) => {
    navigate(`/room/${sessionId}`);
  };

  // 🧮 Вспомогательные функции
  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const isFutureSession = (dateString: string) => {
    return new Date(dateString) > new Date();
  };

  // ⏳ Проверка на истёкшие сессии
  const isExpired = (s: Session) => {
    if (!s.start_time) return false;
    const end = new Date(s.start_time).getTime() + s.duration_minutes * 60_000;
    return Date.now() > end;
  };

  // 💡 Фильтруем активные сессии (не истёкшие)
  const activeSessions = useMemo(
    () => sessions.filter((s) => !isExpired(s)),
    [sessions]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* ===== Header ===== */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              Focus Sessions
            </h1>
            <p className="text-gray-600">
              Join a group focus session and stay accountable
            </p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-md hover:shadow-lg"
          >
            <Plus size={20} />
            Create Session
          </button>
        </div>

        {/* ===== Main content ===== */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : activeSessions.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <p className="text-gray-600 mb-4">
              No active sessions available
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              Create the first session
            </button>
          </div>
        ) : (
          <div className="grid gap-6">
            {activeSessions.map((session) => (
              <div
                key={session.id}
                className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">
                      {session.title}
                    </h3>

                    {/* Info line */}
                    <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-4">
                      <div className="flex items-center gap-1">
                        <Users size={16} />
                        <span>Host: {session.host}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock size={16} />
                        <span>{session.duration_minutes} min</span>
                      </div>

                      {session.start_time && (
                        <div
                          className={`flex items-center gap-1 font-medium ${
                            isFutureSession(session.start_time)
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          <Calendar size={16} />
                          <span>
                            {isFutureSession(session.start_time)
                              ? `Starts at ${formatDateTime(session.start_time)}`
                              : `Started at ${formatDateTime(
                                  session.start_time
                                )}`}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Format pill */}
                    <div className="inline-block bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm font-medium">
                      {formatSessionFormat(session.format)}
                    </div>
                  </div>

                  <button
                    onClick={() => handleJoinSession(session.id)}
                    className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium ml-4"
                  >
                    Join Session
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== Modal ===== */}
      <CreateSessionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSessionCreated={fetchSessions}
      />
    </div>
  );
}
