import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Clock, Calendar, UserCircle } from "lucide-react";
import { CreateSessionModal } from "../components/CreateSessionModal";
import { formatSessionFormat } from "../utils/sessionHelpers";
import { supabase } from "../lib/supabase";
import type { Session } from "../types/session";

// SVG ICONS
import CreateIcon from "/icons/create-session.svg";

import GroupActive from "/icons/group-active.svg";
import GroupInactive from "/icons/group-inactive.svg";

import InfiniteActive from "/icons/infinite-active.svg";
import InfiniteInactive from "/icons/infinite-inactive.svg";

import BodyActive from "/icons/body-active.svg";
import BodyInactive from "/icons/body-inactive.svg";

export function SessionsPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoginPromptOpen, setIsLoginPromptOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const tabs = [
    { id: "group", label: "Group sessions", active: GroupActive, inactive: GroupInactive },
    { id: "infinite", label: "Infinite rooms", active: InfiniteActive, inactive: InfiniteInactive },
    { id: "body", label: "Body tripling", active: BodyActive, inactive: BodyInactive },
  ];

  const [tab, setTab] = useState("group");

  // restore auth
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
    } catch (error) {
      console.error("Error fetching sessions:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const isExpired = (s: Session) => {
    if (!s.start_time) return false;
    const end =
      new Date(s.start_time).getTime() + s.duration_minutes * 60_000;
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
        <div className="relative flex items-center gap-4">

          {/* Create session button with icon */}
          <button
            onClick={handleCreateSessionClick}
            className="flex items-center gap-2 px-5 py-2 rounded-full bg-brandBlack text-white hover:bg-black text-sm font-medium"
          >
            <img src={CreateIcon} className="w-4 h-4" />
            Create
          </button>

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

      {/* CENTERED H1 + SWITCHER */}
      <div className="max-w-4xl mx-auto px-8 mt-10 text-center flex flex-col items-center">

        <h1 className="text-[28px] md:text-[32px] xl:text-[40px] font-medium">
          Join a group focus session to stay accountable
        </h1>

        <div className="flex items-center gap-3 mt-8">

          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-5 py-2 rounded-full border transition-all ${
                tab === t.id
                  ? "bg-brandBlack text-white border-brandBlack"
                  : "bg-white text-brandBlack border-borderGray hover:border-brandBlack"
              }`}
            >
              <img
                src={tab === t.id ? t.active : t.inactive}
                className="w-5 h-5"
              />
              {t.label}
            </button>
          ))}

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
            <button onClick={handleCreateSessionClick} className="text-sm underline underline-offset-4">
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

                  <div className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium">
                    {formatSessionFormat(session.format)}
                  </div>
                </div>

                {/* right */}
                <button
                  onClick={() => handleJoinSession(session.id)}
                  className="ml-6 px-6 py-2 rounded-full bg-brandBlack text-white hover:opacity-80 transition-all text-sm font-medium"
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
