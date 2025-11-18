// src/pages/SessionsPage.tsx
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CreateSessionModal } from "../components/CreateSessionModal";
import { SessionTypeSwitcher } from "../components/SessionTypeSwitcher";
import SessionCard from "../components/SessionCard";
import Header from "../components/Header";
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

  const [sessionTypeTab, setSessionTypeTab] = useState<
    "group" | "infinite" | "body"
  >("group");

  // AUTH RESTORE
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

  // LOAD SESSIONS
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

  // REALTIME ATTENDANCE
  useEffect(() => {
    const channel = supabase
      .channel("session-attendance")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_attendance" },
        (payload) => {
          setSessions((prev) => {
            // @ts-ignore
            const sessionId =
              payload.new?.session_id || payload.old?.session_id;
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

  // HELPERS
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

  const visibleSessions =
    sessionTypeTab === "group" ? activeSessions : [];

  const handleJoinSession = (sessionId: string) => {
    if (!user) {
      setIsLoginPromptOpen(true);
      return;
    }
    navigate(`/room/${sessionId}`);
  };

  // RENDER
  return (
    <div className="min-h-screen bg-white text-brandBlack font-inter">

      {/* GLOBAL HEADER */}
      <Header />

      {/* MAIN CONTENT */}
      <main className="w-full px-8 pb-12">

        <div className="pt-[100px] pb-[50px] text-center">
          <h1
            className="
              text-[24px]
              md:text-[28px]
              xl:text-[36px]
              font-normal
              leading-tight
              mx-auto
            "
          >
            Join a group focus session to stay accountable
          </h1>
        </div>

        {/* SWITCHER */}
        <div className="w-full">
          <div className="flex justify-center mb-[55px]">
            <SessionTypeSwitcher
              value={sessionTypeTab}
              onChange={(val: "group" | "infinite" | "body") =>
                setSessionTypeTab(val)
              }
            />
          </div>

          {/* SESSION LIST */}
          <div className="border border-[#DBD8D8] rounded-2xl p-8">
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
                  onClick={() => setIsModalOpen(true)}
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
                    onJoin={handleJoinSession}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      <CreateSessionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSessionCreated={fetchSessions}
      />
    </div>
  );
}

export default SessionsPage;
