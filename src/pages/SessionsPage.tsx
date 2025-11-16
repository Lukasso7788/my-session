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

  // restore auth
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

  // load sessions
  const fetchSessions = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("sessions")
        .select(`
          id,
          title,
          host_id,
          host_name,
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

  const isExpired = (s: Session) => {
    if (!s.start_time) return false;
    const end = new Date(s.start_time).getTime() + s.duration_minutes * 60_000;
    return Date.now() > end;
  };

  const activeSessions = useMemo(
    () => sessions.filter((s) => !isExpired(s)),
    [sessions]
  );

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const isFutureSession = (dateString: string) =>
    new Date(dateString) > new Date();

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

  const sessionTypeColor = (type: string) => {
    if (!type) return "text-brandBlack";

    const low = type.toLowerCase();

    if (low.includes("deep")) return "text-deepWork";
    if (low.includes("pomo")) return "text-pomodoro";
    if (low.includes("sprint")) return "text-sprints";

    return "text-brandBlack";
  };

  const sessionTypeBadge = (type: string) => {
    if (!type) return "text-brandBlack border-brandBlack";

    const low = type.toLowerCase();

    if (low.includes("deep")) return "text-deepWork border-deepWork";
    if (low.includes("pomo")) return "text-pomodoro border-pomodoro";
    if (low.includes("sprint")) return "text-sprints border-sprints";

    return "text-brandBlack border-brandBlack";
  };

  const hoverType = (type: string) => {
    const low = type.toLowerCase();

    if (low.includes("deep")) return "hover:border-deepWork hover:text-deepWork";
    if (low.includes("pomo")) return "hover:border-pomodoro hover:text-pomodoro";
    if (low.includes("sprint")) return "hover:border-sprints hover:text-sprints";

    return "hover:border-brandBlack hover:text-brandBlack";
  };

  return (
    <div className="min-h-screen bg-white text-brandBlack font-inter">

      {/* HEADER */}
      <header className="max-w-6xl mx-auto px-8 py-6 flex items-center justify-between">

        <div className="text-2xl font-black">MySession</div>

        {/* Nav */}
        <nav className="flex gap-6 text-sm text-slate-600">
          <button onClick={() => navigate("/sessions")} className="hover:text-black">Sessions</button>
          <button className="hover:text-black">Pricing</button>
          <button className="hover:text-black">Latest updates</button>
        </nav>

        {/* Auth */}
        <div className="relative">
          {!user ? (
            <div className="flex gap-3">
              <button
                onClick={() => navigate("/login")}
                className="px-4 py-2 rounded-full border border-borderGray text-sm hover:bg-slate-50"
              >
                Log in
              </button>
              <button
                onClick={() => navigate("/register")}
                className="px-4 py-2 rounded-full bg-brandBlack text-white hover:bg-black text-sm font-medium"
              >
                Sign up
              </button>
            </div>
          ) : (
            <div>
              <button
                onClick={() => setShowUserMenu((v) => !v)}
                className="flex items-center"
              >
                {user.user_metadata?.avatar_url ? (
                  <img
                    src={user.user_metadata.avatar_url}
                    className="w-10 h-10 rounded-full border border-borderGray"
                  />
                ) : (
                  <UserCircle className="w-10 h-10 text-slate-600" />
                )}
              </button>

              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-borderGray z-20">
                  <button
                    onClick={() => navigate("/profile")}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50"
                  >
                    Profile
                  </button>
                  <button
                    onClick={async () => {
                      await supabase.auth.signOut();
                      setShowUserMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* H1 + Button */}
      <div className="max-w-6xl mx-auto px-8 mt-10">
        <h1 className="text-[28px] md:text-[32px] xl:text-[40px] font-medium">
          Join a group focus session to stay accountable
        </h1>

        <div className="flex justify-between items-center mt-8">
          {/* Filter tabs */}
          <div className="flex gap-3">
            <button className="px-4 py-2 rounded-full bg-black text-white text-sm">
              Group sessions
            </button>
            <button className="px-4 py-2 rounded-full bg-slate-100 text-sm">
              Infinite rooms
            </button>
            <button className="px-4 py-2 rounded-full bg-slate-100 text-sm">
              Body tripling
            </button>
          </div>

          <button
            onClick={handleCreateSessionClick}
            className="flex items-center gap-2 px-5 py-2 rounded-full bg-brandBlack text-white hover:bg-black text-sm font-medium"
          >
            <Plus size={18} />
            Create a session
          </button>
        </div>
      </div>

      {/* SESSION LIST */}
      <div className="max-w-6xl mx-auto px-8 py-12">
        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brandBlack"></div>
          </div>
        ) : activeSessions.length === 0 ? (
          <div className="border border-borderGray rounded-2xl p-10 text-center">
            <p className="text-sm text-slate-600 mb-4">No active sessions available</p>
            <button
              onClick={handleCreateSessionClick}
              className="text-sm underline underline-offset-4"
            >
              Create the first session
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {activeSessions.map((session) => (
              <div
                key={session.id}
                className="border border-borderGray rounded-2xl p-6 flex justify-between"
              >
                {/* left */}
                <div className="flex-1 space-y-3">
                  <div className="text-xl font-semibold flex items-center gap-2">
                    {session.title}
                  </div>

                  <div className="flex gap-4 text-sm text-slate-600">
                    {/* host */}
                    <div className="flex items-center gap-1">
                      <Users size={16} />
                      Host:
                      <button
                        className="underline underline-offset-2"
                        onClick={() => navigate(`/profile/${session.host_id}`)}
                      >
                        {session.host_name}
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <Clock size={16} />
                      {session.duration_minutes} min
                    </div>

                    <div
                      className={`flex items-center gap-1 font-medium ${
                        isFutureSession(session.start_time)
                          ? "text-deepWork"
                          : "text-pomodoro"
                      }`}
                    >
                      <Calendar size={16} />
                      {isFutureSession(session.start_time)
                        ? `Starts ${formatDateTime(session.start_time)}`
                        : `Started ${formatDateTime(session.start_time)}`}
                    </div>
                  </div>

                  <div
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${sessionTypeBadge(
                      session.format
                    )}`}
                  >
                    {formatSessionFormat(session.format)}
                  </div>
                </div>

                {/* right */}
                <button
                  onClick={() => handleJoinSession(session.id)}
                  className={`
                    ml-6 px-6 py-2 rounded-full border text-sm font-medium 
                    bg-brandBlack text-white hover:bg-white hover:border-2
                    transition-all
                    ${hoverType(session.format)}
                  `}
                >
                  Join session
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <CreateSessionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSessionCreated={fetchSessions}
      />

      {/* LOGIN PROMPT */}
      {isLoginPromptOpen && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-30">
          <div className="bg-white rounded-2xl p-8 w-[400px] text-center space-y-4 shadow-xl">
            <h2 className="text-xl font-semibold">Sign up or Log in</h2>
            <p className="text-slate-600 text-sm">
              You need an account to create or join sessions.
            </p>
            <div className="flex justify-center gap-3 mt-4">
              <button
                onClick={() => navigate("/login")}
                className="px-5 py-2 bg-brandBlack text-white rounded-full hover:bg-black text-sm font-medium"
              >
                Continue
              </button>
              <button
                onClick={() => setIsLoginPromptOpen(false)}
                className="px-5 py-2 bg-slate-100 text-brandBlack rounded-full hover:bg-slate-200 text-sm font-medium"
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
