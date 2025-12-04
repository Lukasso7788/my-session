const DEBUG = true;

import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { SessionTypeSwitcher } from "../components/SessionTypeSwitcher";
import SessionCard from "../components/SessionCard";
import Header from "../components/Header";
import { supabase } from "../lib/supabase";
import { useCreateSessionModal } from "../context/CreateSessionModalContext";
import { useAuth } from "../context/AuthContext";
import type { Session } from "../types/session";

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

export function SessionsPage() {
  const navigate = useNavigate();
  const modal = useCreateSessionModal();
  const { user } = useAuth();

  const [sessions, setSessions] = useState<SessionWithRelations[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [sessionTypeTab, setSessionTypeTab] = useState<
    "group" | "infinite" | "body"
  >("group");

  // --- LOAD SESSIONS ---
  const fetchSessions = useCallback(async () => {
    if (DEBUG) console.log("[DEBUG Sessions] Fetch sessions…");

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

      if (error) {
        console.error("[DEBUG Sessions] Fetch error:", error);
        throw error;
      }

      if (DEBUG) console.log("[DEBUG Sessions] Loaded:", data);

      setSessions(data || []);
    } catch (err) {
      console.error("[DEBUG Sessions] FAILED LOADING:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // --- Refresh after modal creates session ---
  useEffect(() => {
    modal.setOnCreatedCallback(fetchSessions);
    if (DEBUG) console.log("[DEBUG Sessions] Modal callback set");
  }, [modal, fetchSessions]);

  // --- REALTIME ATTENDANCE ---
  useEffect(() => {
    if (DEBUG) console.log("[DEBUG Sessions] Subscribe to realtime attendance");

    const channel = supabase
      .channel("session-attendance")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_attendance" },
        (payload) => {
          if (DEBUG) console.log("[DEBUG Sessions] Realtime event:", payload);

          setSessions((prev) => {
            // @ts-ignore
            const sessionId = payload.new?.session_id || payload.old?.session_id;
            if (!sessionId) return prev;

            return prev.map((s) => {
              if (s.id !== sessionId) return s;

              let attendance = s.session_attendance || [];

              if (payload.eventType === "INSERT") {
                attendance = [...attendance, payload.new];
              } else if (payload.eventType === "DELETE") {
                attendance = attendance.filter((a) => a.id !== payload.old.id);
              } else if (payload.eventType === "UPDATE") {
                attendance = attendance.map((a) =>
                  a.id === payload.new.id ? payload.new : a
                );
              }

              return { ...s, session_attendance: attendance };
            });
          });
        }
      )
      .subscribe();

    return () => {
      if (DEBUG) console.log("[DEBUG Sessions] Remove realtime channel");
      supabase.removeChannel(channel);
    };
  }, []);

  // --- HELPERS ---
  const isExpired = (s: SessionWithRelations) => {
    if (!s.start_time) return false;
    return (
      Date.now() >
      new Date(s.start_time).getTime() + s.duration_minutes * 60_000
    );
  };

  const activeSessions = useMemo(
    () => sessions.filter((s) => !isExpired(s)),
    [sessions]
  );

  const visibleSessions =
    sessionTypeTab === "group" ? activeSessions : [];

  // --- ACTIONS ---
  const join = (id: string) => {
    if (!user) {
      if (DEBUG) console.log("[DEBUG Sessions] Join -> no user, redirect");
      return navigate("/login");
    }

    if (DEBUG) console.log("[DEBUG Sessions] Join session:", id);
    navigate(`/room/${id}`);
  };

  const book = async (id: string) => {
    if (!user) {
      if (DEBUG) console.log("[DEBUG Sessions] Book -> no user, redirect");
      return navigate("/login");
    }

    if (DEBUG) console.log("[DEBUG Sessions] Booking:", id);

    try {
      await supabase.from("session_bookings").insert({
        session_id: id,
        user_id: user.id,
      });
      fetchSessions();
    } catch (err) {
      console.error("[DEBUG Sessions] Booking error:", err);
    }
  };

  const cancel = async (id: string) => {
    if (!user) return navigate("/login");

    if (DEBUG) console.log("[DEBUG Sessions] Cancel booking:", id);

    try {
      await supabase
        .from("session_bookings")
        .delete()
        .eq("session_id", id)
        .eq("user_id", user.id);

      fetchSessions();
    } catch (err) {
      console.error("[DEBUG Sessions] Cancel error:", err);
    }
  };

  const remove = async (id: string) => {
    if (!user) return navigate("/login");

    if (DEBUG) console.log("[DEBUG Sessions] Delete session:", id);

    try {
      await supabase.from("sessions").delete().eq("id", id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error("[DEBUG Sessions] Delete error:", err);
    }
  };

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-white text-brandBlack font-inter">
      <Header />

      <main className="w-full px-8 pb-12">
        <div className="pt-[100px] pb-[50px] text-center">
          <h1 className="text-[24px] md:text-[28px] xl:text-[36px] font-normal leading-tight mx-auto">
            Join a group focus session to stay accountable
          </h1>
        </div>

        <div className="w-full">
          <div className="flex justify-center mb-[55px]">
            <SessionTypeSwitcher
              value={sessionTypeTab}
              onChange={(v) => {
                if (DEBUG) console.log("[DEBUG Sessions] Tab changed:", v);
                setSessionTypeTab(v);
              }}
            />
          </div>

          <div className="border border-[#DBD8D8] rounded-[24px] p-8">
            {isLoading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brandBlack" />
              </div>
            ) : visibleSessions.length === 0 ? (
              <div className="p-2 text-center">
                <p className="text-sm text-slate-600 mb-4">
                  No active sessions available
                </p>

                {user && (
                  <button
                    onClick={() => {
                      if (DEBUG)
                        console.log("[DEBUG Sessions] Create first session");
                      modal.open();
                    }}
                    className="text-sm underline underline-offset-4"
                  >
                    Create the first session
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {visibleSessions.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    userId={user?.id}
                    onJoin={join}
                    onBook={book}
                    onCancelBooking={cancel}
                    onDelete={remove}
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

export default SessionsPage;