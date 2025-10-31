import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Clock, Plus, Calendar, UserCircle } from "lucide-react";
import { CreateSessionModal } from "../components/CreateSessionModal";
import { formatSessionFormat } from "../utils/sessionHelpers";
import { supabase } from "../lib/supabase";
import type { Session } from "../types/session";

export function SessionsPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoginPromptOpen, setIsLoginPromptOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // ✅ Правильное восстановление сессии (фикс OAuth)
  useEffect(() => {
    const getCurrentSession = async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data?.session?.user ?? null);
    };
    getCurrentSession();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  // ✅ Загружаем сессии
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

  // 🔎 Проверка на истёкшие сессии
  const isExpired = (s: Session) => {
    if (!s.start_time) return false;
    const end = new Date(s.start_time).getTime() + s.duration_minutes * 60_000;
    return Date.now() > end;
  };

  const activeSessions = useMemo(
    () => sessions.filter((s) => !isExpired(s)),
    [sessions]
  );

  // ⏰ Форматирование
  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const isFutureSession = (dateString: string) => new Date(dateString) > new Date();

  // 🚪 Обработчики
  const handleJoinSession = (sessionId: string) => {
    if (!user) {
      setIsLoginPromptOpen(true);
      return;
    }
    navigate(`/room/${sessionId}`);
  };

  const handleCreateSessionClick = () => {
    if (!user) {
      setIsLoginPromptOpen(true);
      return;
    }
    setIsModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* ===== Header ===== */}
      <div className="max-w-6xl mx-auto px-4 py-8 flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 mb-1">Focus Sessions</h1>
          <p className="text-gray-600">
            Join a group focus session and stay accountable
          </p>
        </div>

        {/* 🔐 Auth section */}
        <div className="relative">
          {!user ? (
            <div className="flex gap-3">
              <button
                onClick={() => navigate("/login")}
                className="px-4 py-2 rounded-md bg-white text-gray-800 border border-gray-300 hover:bg-gray-100 font-medium"
              >
                Log in
              </button>
              <button
                onClick={() => navigate("/login")}
                className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 font-medium shadow"
              >
                Sign up
              </button>
            </div>
          ) : (
            <div>
              <button
                onClick={() => setShowUserMenu((v) => !v)}
                className="flex items-center focus:outline-none"
              >
                {user.user_metadata?.avatar_url ? (
                  <img
                    src={user.user_metadata.avatar_url}
                    alt="avatar"
                    className="w-10 h-10 rounded-full border border-gray-300"
                  />
                ) : (
                  <UserCircle className="w-10 h-10 text-gray-600" />
                )}
              </button>

              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
                  <button
                    onClick={() => navigate("/profile")}
                    className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-50"
                  >
                    Profile
                  </button>
                  <button
                    onClick={async () => {
                      await supabase.auth.signOut();
                      setShowUserMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-red-600 hover:bg-red-50"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ===== Create Session ===== */}
      <div className="max-w-6xl mx-auto px-4 mb-10">
        <button
          onClick={handleCreateSessionClick}
          className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-md hover:shadow-lg"
        >
          <Plus size={20} />
          Create Session
        </button>
      </div>

      {/* ===== Main content ===== */}
      <div className="max-w-6xl mx-auto px-4 pb-12">
        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : activeSessions.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <p className="text-gray-600 mb-4">No active sessions available</p>
            <button
              onClick={handleCreateSessionClick}
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
                              : `Started at ${formatDateTime(session.start_time)}`}
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

      {/* ===== Create Modal ===== */}
      <CreateSessionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSessionCreated={fetchSessions}
      />

      {/* ===== Login Prompt ===== */}
      {isLoginPromptOpen && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-30">
          <div className="bg-white rounded-2xl p-8 w-[400px] text-center space-y-4 shadow-xl">
            <h2 className="text-xl font-semibold text-gray-900">Sign up or Log in</h2>
            <p className="text-gray-600 text-sm">
              You need an account to create or join sessions.
            </p>
            <div className="flex justify-center gap-3 mt-4">
              <button
                onClick={() => navigate("/login")}
                className="px-5 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
              >
                Continue
              </button>
              <button
                onClick={() => setIsLoginPromptOpen(false)}
                className="px-5 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
