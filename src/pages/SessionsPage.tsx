import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Clock, Calendar, UserCircle } from "lucide-react";
import { CreateSessionModal } from "../components/CreateSessionModal";
import { SessionTypeSwitcher } from "../components/SessionTypeSwitcher";
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

  const [sessionTypeTab, setSessionTypeTab] = useState<
    "group" | "infinite" | "body"
  >("group");

  // ---------- restore auth ----------
  useEffect(() => {
    const getCurrentSession = async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data?.session?.user ?? null);
    };
    getCurrentSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  // ---------- load sessions ----------
  const fetchSessions = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("sessions")
        .select(
          `
          id,
          title,
          host_id,
          host_name,
          duration_minutes,
          format,
          start_time,
          status
        `
        )
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

  // ---------- helpers ----------
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

  // ------- визуальные хелперы под тип сессии -------
  const getSessionKind = (type?: string | null) => {
    const low = (type || "").toLowerCase();
    if (low.includes("deep")) return "deep";
    if (low.includes("pomo")) return "pomo";
    if (low.includes("sprint")) return "sprint";
    return "other";
  };

  const formatBadgeClasses = (type: string) => {
    const kind = getSessionKind(type);
    switch (kind) {
      case "deep":
        return "border-deepWork text-deepWork";
      case "pomo":
        return "border-pomodoro text-pomodoro";
      case "sprint":
        return "border-sprints text-sprints";
      default:
        return "border-brandBlack text-brandBlack";
    }
  };

  const joinHoverClasses = (type: string) => {
    const kind = getSessionKind(type);
    switch (kind) {
      case "deep":
        return "hover:bg-deepWork";
      case "pomo":
        return "hover:bg-pomodoro";
      case "sprint":
        return "hover:bg-sprints";
      default:
        return "hover:bg-brandBlack";
    }
  };

  const visibleSessions =
    sessionTypeTab === "group" ? activeSessions : [];

  return (
    <div className="min-h-screen bg-white text-brandBlack font-inter">
      {/* ================= HEADER ================= */}
      <header className="border-b border-borderGray">
        <div className="max-w-[1280px] mx-auto px-8 py-6 flex items-center justify-between gap-3">
          {/* Left nav */}
          <nav className="flex items-center gap-6 flex-1 text-sm text-[#2E2E2E]">
            <button
              onClick={() => navigate("/sessions")}
              className="hover:text-black"
            >
              Sessions
            </button>
            <button className="hover:text-black">Pricing</button>
            <button className="hover:text-black">Latest updates</button>
          </nav>

          {/* Center logo */}
          <div className="flex-1 flex justify-center">
            <div className="text-4xl font-extrabold">MySession</div>
          </div>

          {/* Right auth / create */}
          <div className="flex-1 flex items-center justify-end gap-3 relative">
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
              <>
                <button
                  onClick={handleCreateSessionClick}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-borderGray text-sm font-medium hover:bg-slate-50"
                >
                  <img
                    src="/icons/create-session.svg"
                    alt="create session"
                    className="w-5 h-5"
                  />
                  <span>Create a session</span>
                </button>

                <button
                  onClick={() => setShowUserMenu((v) => !v)}
                  className="flex items-center"
                >
                  {user.user_metadata?.avatar_url ? (
                    <img
                      src={user.user_metadata.avatar_url}
                      alt="avatar"
                      className="w-10 h-10 rounded-full border border-borderGray"
                    />
                  ) : (
                    <UserCircle className="w-10 h-10 text-slate-600" />
                  )}
                </button>

                {showUserMenu && (
                  <div className="absolute right-0 top-12 w-48 bg-white rounded-xl shadow-lg border border-borderGray z-20">
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
              </>
            )}
          </div>
        </div>
      </header>

      {/* ================= H1 + SWITCHER ================= */}
      <section className="max-w-[1280px] mx-auto px-8 pt-10 pb-6 space-y-8 text-center">
        <h1
          className="
            text-[24px]
            md:text-[28px]
            xl:text-[36px]
            font-normal
            leading-tight
            mx-auto
            text-center
          "
        >
          Join a group focus session to stay accountable
        </h1>

        <div className="flex justify-center">
          <SessionTypeSwitcher
            value={sessionTypeTab}
            onChange={(val: "group" | "infinite" | "body") =>
              setSessionTypeTab(val)
            }
          />
        </div>
      </section>

      {/* ================= SESSION LIST ================= */}
      <main className="max-w-[1280px] mx-auto px-8 pb-12">
        {sessionTypeTab !== "group" && (
          <div className="border border-borderGray rounded-2xl p-8 mb-6 text-sm text-slate-600">
            {sessionTypeTab === "infinite"
              ? "Infinite rooms are coming soon."
              : "Body tripling is coming soon."}
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brandBlack" />
          </div>
        ) : visibleSessions.length === 0 ? (
          <div className="border border-borderGray rounded-2xl p-10 text-center">
            <p className="text-sm text-slate-600 mb-4">
              No active sessions available
            </p>
            <button
              onClick={handleCreateSessionClick}
              className="text-sm underline underline-offset-4"
            >
              Create the first session
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {visibleSessions.map((session) => (
              <div
                key={session.id}
                className="border border-borderGray rounded-[42px] px-8 py-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6 hover:bg-slate-50 transition-colors"
              >
                {/* LEFT: текст и мета */}
                <div className="flex-1 space-y-3">
                  <h3 className="text-[22px] font-semibold">
                    {session.title}
                  </h3>

                  <div className="flex flex-wrap gap-4 text-xs md:text-sm text-slate-600">
                    {/* Host */}
                    <div className="flex items-center gap-1">
                      <Users size={16} />
                      <span>Host</span>
                      <button
                        className="underline underline-offset-2"
                        onClick={() => navigate(`/profile/${session.host_id}`)}
                      >
                        {session.host_name || "Unknown"}
                      </button>
                    </div>

                    {/* Duration */}
                    <div className="flex items-center gap-1">
                      <Clock size={16} />
                      <span>{session.duration_minutes} min</span>
                    </div>

                    {/* Start time */}
                    {session.start_time && (
                      <div
                        className={`flex items-center gap-1 font-medium ${
                          isFutureSession(session.start_time)
                            ? "text-deepWork"
                            : "text-pomodoro"
                        }`}
                      >
                        <Calendar size={16} />
                        <span>
                          {isFutureSession(session.start_time)
                            ? `Starts ${formatDateTime(session.start_time)}`
                            : `Started ${formatDateTime(session.start_time)}`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* формат / тип сессии */}
                  <div
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${formatBadgeClasses(
                      session.format
                    )}`}
                  >
                    {formatSessionFormat(session.format)}
                  </div>
                </div>

                {/* RIGHT: Join button */}
                <div className="flex-shrink-0">
                  <button
                    onClick={() => handleJoinSession(session.id)}
                    className={`
                      px-6 py-2 rounded-full border text-sm font-medium
                      bg-brandBlack text-white border-brandBlack
                      transition-colors
                      ${joinHoverClasses(session.format)}
                    `}
                  >
                    Join session
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <CreateSessionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSessionCreated={fetchSessions}
      />

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

export default SessionsPage;
