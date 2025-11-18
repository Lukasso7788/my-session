// src/pages/SessionsPage.tsx
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { UserCircle } from "lucide-react";
import { CreateSessionModal } from "../components/CreateSessionModal";
import { SessionTypeSwitcher } from "../components/SessionTypeSwitcher";
import SessionCard from "../components/SessionCard";
import { supabase } from "../lib/supabase";
import type { Session } from "../types/session";

type SessionWithRelations = Session & {
  session_bookings?: { user_id: string }[];
  session_attendance?: { id: string; session_id: string; user_id: string }[];
};

export function SessionsPage() {
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<SessionWithRelations[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoginPromptOpen, setIsLoginPromptOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const [sessionTypeTab, setSessionTypeTab] = useState<
    "group" | "infinite" | "body"
  >("group");

  // ---------- auth restore ----------
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
          status,
          session_bookings ( user_id ),
          session_attendance ( id, session_id, user_id )
        `
        )
        .order("start_time", { ascending: true });

      if (error) throw error;

      setSessions((data || []) as SessionWithRelations[]);
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

  // ---------- realtime attendance ----------
  useEffect(() => {
    const channel = supabase
      .channel("session-attendance")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_attendance" },
        (payload) => {
          setSessions((prev) => {
            // @ts-ignore – supabase payload shape
            const sessionId = payload.new?.session_id || payload.old?.session_id;
            if (!sessionId) return prev;

            return prev.map((s) => {
              if (s.id !== sessionId) return s;

              let attendance = s.session_attendance || [];

              if (payload.eventType === "INSERT") {
                // @ts-ignore
                attendance = [...attendance, payload.new];
              } else if (payload.eventType === "DELETE") {
                // @ts-ignore
                const delId = payload.old.id;
                attendance = attendance.filter((a) => a.id !== delId);
              } else if (payload.eventType === "UPDATE") {
                // @ts-ignore
                const newRow = payload.new;
                attendance = attendance.map((a) =>
                  a.id === newRow.id ? newRow : a
                );
              }

              return { ...s, session_attendance: attendance };
            });
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // ---------- helpers ----------
  const isExpired = (s: SessionWithRelations) => {
    if (!s.start_time) return false;
    const end =
      new Date(s.start_time).getTime() + s.duration_minutes * 60_000;
    return Date.now() > end;
  };

  const activeSessions = useMemo(
    () => sessions.filter((s) => !isExpired(s)),
    [sessions]
  );

  const visibleSessions = sessionTypeTab === "group" ? activeSessions : [];

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

  // ---------- booking actions ----------
  const handleBook = async (sessionId: string) => {
    if (!user) {
      setIsLoginPromptOpen(true);
      return;
    }
    const { error } = await supabase
      .from("session_bookings")
      .upsert(
        { session_id: sessionId, user_id: user.id },
        { onConflict: "session_id,user_id" }
      );

    if (error) {
      console.error("Error booking session:", error);
    } else {
      fetchSessions();
    }
  };

  const handleCancelBooking = async (sessionId: string) => {
    if (!user) {
      setIsLoginPromptOpen(true);
      return;
    }
    const { error } = await supabase
      .from("session_bookings")
      .delete()
      .eq("session_id", sessionId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error cancelling booking:", error);
    } else {
      fetchSessions();
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from("sessions")
        .delete()
        .eq("id", sessionId)
        .eq("host_id", user.id);

      if (error) throw error;
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (e) {
      console.error("Error deleting session:", e);
    }
  };

  // ---------- render ----------
  return (
    <div className="min-h-screen bg-white text-brandBlack font-inter">
      {/* HEADER */}
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

      {/* H1 - отдельная секция с py-[100px] */}
      <section className="max-w-[1280px] mx-auto px-8 py-[100px] text-center">
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
      </section>

      {/* SWITCHER - отдельная секция с mb-[55px] */}
      <section className="max-w-[1280px] mx-auto px-8 mb-[55px] text-center">
        <div className="flex justify-center">
          <SessionTypeSwitcher
            value={sessionTypeTab}
            onChange={(val: "group" | "infinite" | "body") =>
              setSessionTypeTab(val)
            }
          />
        </div>
      </section>

      {/* SESSION LIST */}
      <main className="max-w-[1280px] mx-auto px-8 pb-12">
        {/* Контейнер для карточек сессий с рамкой и паддингом 32px */}
        <div className="border border-[#DBD8D8] rounded-2xl p-8">
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
            <div className="p-2 text-center">
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
                <SessionCard
                  key={session.id}
                  session={session}
                  userId={user?.id}
                  onBook={handleBook}
                  onCancelBooking={handleCancelBooking}
                  onJoin={handleJoinSession}
                  onDelete={handleDeleteSession}
                />
              ))}
            </div>
          )}
        </div>
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
