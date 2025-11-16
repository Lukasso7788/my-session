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

  // -------------------------------------
  // AUTH RESTORE
  // -------------------------------------
  useEffect(() => {
    const getCurrent = async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data?.session?.user ?? null);
    };
    getCurrent();

    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // -------------------------------------
  // LOAD SESSIONS
  // -------------------------------------
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

      setSessions(data || []);
      localStorage.setItem("sessions", JSON.stringify(data || []));
    } catch (err) {
      // fallback
      const stored = localStorage.getItem("sessions");
      if (stored) setSessions(JSON.parse(stored));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  // -------------------------------------
  // Filters
  // -------------------------------------
  const isExpired = (s: Session) => {
    if (!s.start_time) return false;
    return Date.now() > new Date(s.start_time).getTime() + s.duration_minutes * 60_000;
  };

  const activeSessions = useMemo(
    () => sessions.filter((s) => !isExpired(s)),
    [sessions]
  );

  const isFutureSession = (dateString: string) =>
    new Date(dateString) > new Date();

  const formatDateTime = (dateString: string) => {
    const d = new Date(dateString);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  };

  // -------------------------------------
  // JOIN SESSION
  // -------------------------------------
  const handleJoinSession = (sessionId: string) => {
    if (!user) return setIsLoginPromptOpen(true);
    navigate(`/room/${sessionId}`);
  };

  // -------------------------------------
  // CREATE SESSION
  // -------------------------------------
  const handleCreateSessionClick = () => {
    if (!user) return setIsLoginPromptOpen(true);
    setIsModalOpen(true);
  };

  // -------------------------------------
  // UI
  // -------------------------------------
  return (
    <div className="min-h-screen bg-white text-brandBlack font-inter">

      {/* ---------------------------------------------------
         HEADER
      --------------------------------------------------- */}
      <header className="max-w-6xl mx-auto px-8 py-6 flex items-center justify-between border-b border-borderGray">

        {/* Logo + Heading */}
        <div className="flex flex-col gap-2">
          <div className="text-[36px] font-extrabold leading-none">
            MySession
          </div>

          <h1 className="
            text-[24px]
            md:text-[28px]
            xl:text-[36px]
            font-normal
            leading-tight
          ">
            Join a group focus session to stay accountable
          </h1>
        </div>

        {/* Auth */}
        <div className="relative">
          {!user ? (
            <div className="flex gap-3">
              <button
                onClick={() => navigate("/login")}
                className="px-4 py-2 rounded-full border border-borderGray text-brandBlack hover:bg-slate-50 text-sm font-medium"
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
                className="focus:outline-none"
              >
                {user.user_metadata?.avatar_url ? (
                  <img
                    src={user.user_metadata.avatar_url}
                    className="w-10 h-10 rounded-full border border-borderGray"
                    alt="avatar"
                  />
                ) : (
                  <UserCircle className="w-10 h-10 text-slate-600" />
                )}
              </button>

              {showUserMenu && (
                <div className="absolute right-0 mt-2 bg-white border border-borderGray rounded-xl shadow-lg w-48 z-20">
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

      {/* ---------------------------------------------------
         Create Session Button
      --------------------------------------------------- */}
      <div className="max-w-6xl mx-auto px-8 py-6">
        <button
          onClick={handleCreateSessionClick}
          className="
            inline-flex items-center gap-2
            rounded-full bg-brandBlack text-white
            px-5 py-2.5 text-sm font-medium
            hover:bg-black transition-colors
          "
        >
          <Plus size={18} />
          Create session
        </button>
      </div>

      {/* ---------------------------------------------------
         Sessions List
      --------------------------------------------------- */}
      <main className="max-w-6xl mx-auto px-8 pb-12">

        {isLoading ? (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-b-2 border-brandBlack rounded-full animate-spin mx-auto" />
          </div>
        ) : activeSessions.length === 0 ? (
          <div className="border border-borderGray rounded-2xl p-10 text-center">
            <p className="text-sm text-slate-600 mb-4">No active sessions available</p>
            <button
              onClick={handleCreateSessionClick}
              className="text-sm text-brandBlack underline underline-offset-4"
            >
              Create the first session
            </button>
          </div>
        ) : (
          <div className="space-y-4">

            {activeSessions.map((s) => (
              <div
                key={s.id}
                className="
                  border border-borderGray rounded-2xl
                  px-6 py-4 flex justify-between items-start
                  hover:bg-slate-50 transition-colors
                "
              >
                <div className="flex-1 space-y-3">

                  <h3 className="text-lg font-semibold text-brandBlack">
                    {s.title}
                  </h3>

                  <div className="flex flex-wrap gap-4 text-xs text-slate-600">

                    <div className="flex items-center gap-1">
                      <Users size={14} />
                      <span>
                        Host{" "}
                        <button
                          className="underline underline-offset-2"
                          onClick={() => navigate(`/profile/${s.host_id}`)}
                        >
                          {s.host_name ?? "Unknown"}
                        </button>
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <Clock size={14} />
                      <span>{s.duration_minutes} min</span>
                    </div>

                    {s.start_time && (
                      <div
                        className={`
                          flex items-center gap-1 font-medium
                          ${
                            isFutureSession(s.start_time)
                              ? "text-deepWork"
                              : "text-pomodoro"
                          }
                        `}
                      >
                        <Calendar size={14} />
                        <span>
                          {isFutureSession(s.start_time)
                            ? `Starts ${formatDateTime(s.start_time)}`
                            : `Started ${formatDateTime(s.start_time)}`}
                        </span>
                      </div>
                    )}

                  </div>

                  <div className="inline-flex items-center border border-borderGray rounded-full px-3 py-1 text-xs font-medium">
                    {formatSessionFormat(s.format)}
                  </div>
                </div>

                <button
                  onClick={() => handleJoinSession(s.id)}
                  className="
                    ml-4 rounded-full
                    bg-deepWork text-white text-sm font-medium
                    px-5 py-2 hover:opacity-90 transition-colors
                  "
                >
                  Join session
                </button>
              </div>
            ))}
          </div>
        )}

      </main>

      {/* MODALS */}
      <CreateSessionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSessionCreated={fetchSessions}
      />

      {isLoginPromptOpen && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-30">
          <div className="bg-white rounded-2xl p-8 w-[400px] text-center space-y-4 shadow-xl">
            <h2 className="text-xl font-semibold text-brandBlack">
              Sign up or Log in
            </h2>
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
