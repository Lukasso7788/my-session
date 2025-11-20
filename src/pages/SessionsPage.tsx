// src/pages/SessionsPage.tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { SessionTypeSwitcher } from "../components/SessionTypeSwitcher";
import SessionCard from "../components/SessionCard";
import Header from "../components/Header";
import { supabase } from "../lib/supabase";
import type { Session } from "../types/session";
import { useCreateSessionModal } from "../hooks/useCreateSessionModal";

type SessionWithRelations = Session & {
  host_id?: string;
  host_name?: string;
  duration_minutes: number;
  format?: string;
  start_time?: string;
  status?: string;
  session_bookings?: { user_id: string }[];
  session_attendance?: { id: string; session_id: string; user_id: string }[];
};

export default function SessionsPage() {
  const navigate = useNavigate();
  const modal = useCreateSessionModal();

  const [sessions, setSessions] = useState<SessionWithRelations[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  const [sessionTypeTab, setSessionTypeTab] = useState<
    "group" | "infinite" | "body"
  >("group");

  // Restore auth
  useEffect(() => {
    const getCurrentSession = async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data?.session?.user ?? null);
    };
    getCurrentSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => setUser(session?.user ?? null)
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  // Load sessions
  const fetchSessions = useCallback(async () => {
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
          status,
          session_bookings ( user_id ),
          session_attendance ( id, session_id, user_id )
        `)
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
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Realtime attendance
  useEffect(() => {
    const channel = supabase
      .channel("session-attendance")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_attendance" },
        (payload) => {
          setSessions((prev) => {
            const sessionId =
              // @ts-ignore
              payload.new?.session_id || payload.old?.session_id;
            if (!sessionId) return prev;

            return prev.map((s) => {
              if (s.id !== sessionId) return s;

              let attendance = s.session_attendance || [];

              if (payload.eventType === "INSERT") {
                // @ts-ignore
                attendance = [...attendance, payload.new];
              } else if (payload.eventType === "DELETE") {
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

    return () => supabase.removeChannel(channel);
  }, []);

  // Filter expired
  const isExpired = (s: SessionWithRelations) => {
    if (!s.start_time) return false;
    const end =
      new Date(s.start_time).getTime() + s.duration_minutes * 60 * 1000;
    return Date.now() > end;
  };

  const visibleSessions = useMemo(() => {
    const active = sessions.filter((s) => !isExpired(s));
    return sessionTypeTab === "group" ? active : [];
  }, [sessions, sessionTypeTab]);

  return (
    <div className="min-h-screen bg-white text-brandBlack font-inter">
      <Header />

      <main className="w-full px-8 pb-12">
        <div className="pt-[100px] pb-[50px] text-center">
          <h1 className="text-[24px] md:text-[28px] xl:text-[36px]">
            Join a group focus session to stay accountable
          </h1>
        </div>

        <div className="w-full">
          <div className="flex justify-center mb-[55px]">
            <SessionTypeSwitcher
              value={sessionTypeTab}
              onChange={setSessionTypeTab}
            />
          </div>

          <div className="border border-[#DBD8D8] rounded-2xl p-8">
            {isLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brandBlack mx-auto" />
              </div>
            ) : visibleSessions.length === 0 ? (
              <div className="p-2 text-center">
                <p className="text-sm text-slate-600 mb-4">
                  No active sessions available
                </p>
                {user && (
                  <button
                    onClick={() => modal.open()}
                    className="text-sm underline"
                  >
                    Create the first session
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {visibleSessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    userId={user?.id}
                    onJoin={(id) =>
                      user ? navigate(`/room/${id}`) : navigate("/login")
                    }
                    onBook={async (id) => {
                      if (!user) return navigate("/login");
                      await supabase.from("session_bookings").insert({
                        session_id: id,
                        user_id: user.id,
                      });
                      fetchSessions();
                    }}
                    onCancelBooking={async (id) => {
                      if (!user) return navigate("/login");
                      await supabase
                        .from("session_bookings")
                        .delete()
                        .eq("session_id", id)
                        .eq("user_id", user.id);
                      fetchSessions();
                    }}
                    onDelete={async (id) => {
                      if (!user) return navigate("/login");
                      await supabase.from("sessions").delete().eq("id", id);
                      setSessions((p) => p.filter((s) => s.id !== id));
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
