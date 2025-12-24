// src/pages/SessionsPage.tsx
const DEBUG = true;

import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SessionTypeSwitcher } from "../components/SessionTypeSwitcher";
import SessionCard from "../components/SessionCard";
import { SessionsDateFilter } from "../components/SessionsDateFilter";
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
  schedule?: any; // ✅ added (needed to detect infinite rooms)
  session_bookings?: { user_id: string }[];
  session_attendance?: { id: string; session_id: string; user_id: string }[];
};

function toLocalYMDFromISO(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ✅ NEW: schedule helpers (same logic as RoomPage)
// - group sessions: schedule is Array
// - infinite rooms: schedule is Object (not Array)
function safeParseSchedule(raw: any) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function isInfiniteRoom(s: SessionWithRelations) {
  const sch = safeParseSchedule((s as any)?.schedule);
  return !!(sch && typeof sch === "object" && !Array.isArray(sch));
}

export function SessionsPage() {
  const navigate = useNavigate();
  const modal = useCreateSessionModal();
  const { user } = useAuth();

  const [searchParams] = useSearchParams();

  const [sessions, setSessions] = useState<SessionWithRelations[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [sessionTypeTab, setSessionTypeTab] = useState<"group" | "infinite" | "body">("group");

  // ✅ Date filter (YYYY-MM-DD local) or null = All
  const [dateFilter, setDateFilter] = useState<string | null>(null);

  // Sync tab from querystring: /sessions?tab=group|infinite|body
  useEffect(() => {
    const tab = (searchParams.get("tab") || "").toLowerCase();
    if (tab === "group" || tab === "infinite" || tab === "body") {
      setSessionTypeTab(tab);
      if (DEBUG) console.log("[DEBUG Sessions] Tab from query:", tab);
    }
  }, [searchParams]);

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
          schedule,
          session_bookings ( user_id ),
          session_attendance ( id, session_id, user_id )
        `)
        .order("start_time", { ascending: true });

      if (error) {
        console.error("[DEBUG Sessions] Fetch error:", error);
        throw error;
      }

      if (DEBUG) console.log("[DEBUG Sessions] Loaded:", data);
      setSessions((data || []) as any);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "session_attendance" }, (payload) => {
        if (DEBUG) console.log("[DEBUG Sessions] Realtime event:", payload);

        setSessions((prev) => {
          // @ts-ignore
          const sessionId = payload.new?.session_id || payload.old?.session_id;
          if (!sessionId) return prev;

          return prev.map((s) => {
            if (s.id !== sessionId) return s;

            let attendance = s.session_attendance || [];

            if (payload.eventType === "INSERT") {
              attendance = [...attendance, payload.new as any];
            } else if (payload.eventType === "DELETE") {
              attendance = attendance.filter((a) => a.id !== (payload.old as any).id);
            } else if (payload.eventType === "UPDATE") {
              attendance = attendance.map((a) => (a.id === (payload.new as any).id ? (payload.new as any) : a));
            }

            return { ...s, session_attendance: attendance };
          });
        });
      })
      .subscribe();

    return () => {
      if (DEBUG) console.log("[DEBUG Sessions] Remove realtime channel");
      supabase.removeChannel(channel);
    };
  }, []);

  // --- HELPERS ---
  const isExpired = (s: SessionWithRelations) => {
    // infinite rooms are not time-bound -> never "expire"
    if (isInfiniteRoom(s)) return false;
    if (!s.start_time) return false;
    return Date.now() > new Date(s.start_time).getTime() + s.duration_minutes * 60_000;
  };

  const activeSessions = useMemo(() => sessions.filter((s) => !isExpired(s)), [sessions]);

  // ✅ FIX: real separation by actual "infinite room" detection via schedule shape
  const typeFilteredSessions = useMemo(() => {
    if (sessionTypeTab === "group") {
      // group sessions = everything that is NOT infinite (and not body, if you ever start using format="body")
      return activeSessions.filter((s) => !isInfiniteRoom(s) && s.format !== "body");
    }

    if (sessionTypeTab === "infinite") {
      return activeSessions.filter((s) => isInfiniteRoom(s));
    }

    if (sessionTypeTab === "body") {
      // placeholder for your future "body" sessions logic:
      // either by format or by schedule shape if you invent it later
      return activeSessions.filter((s) => s.format === "body");
    }

    return activeSessions;
  }, [sessionTypeTab, activeSessions]);

  // ✅ Date filtering (by start_time local day)
  // - for infinite rooms: date filter is irrelevant -> do not apply it
  const visibleSessions = useMemo(() => {
    if (sessionTypeTab === "infinite") return typeFilteredSessions;
    if (!dateFilter) return typeFilteredSessions;

    return typeFilteredSessions.filter((s) => {
      if (!s.start_time) return false;
      const ymd = toLocalYMDFromISO(s.start_time);
      return ymd === dateFilter;
    });
  }, [typeFilteredSessions, dateFilter, sessionTypeTab]);

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
      await supabase.from("session_bookings").delete().eq("session_id", id).eq("user_id", user.id);
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

  const headline =
    sessionTypeTab === "group"
      ? "Join a group focus session to stay accountable"
      : sessionTypeTab === "infinite"
        ? "Join an infinite focus room anytime"
        : "Join a body-doubling session";

  return (
    <div className="min-h-screen bg-white text-brandBlack font-inter">
      {/* ✅ responsive horizontal page padding:
          <768px -> 12px, >=768px -> 24px, >=1024px -> 40px */}
      <main className="w-full px-3 md:px-6 lg:px-10 pb-12">
        <div className="pt-[100px] pb-[50px] text-center">
          <h1 className="text-[24px] md:text-[28px] xl:text-[36px] font-normal leading-tight mx-auto">
            {headline}
          </h1>
        </div>

        <div className="w-full">
          {/* ✅ switcher centered */}
          <div className="w-full flex justify-center mb-[55px]">
            <SessionTypeSwitcher
              value={sessionTypeTab}
              onChange={(v) => {
                if (DEBUG) console.log("[DEBUG Sessions] Tab changed:", v);
                setSessionTypeTab(v);

                // optional: reset date filter when leaving group tab (so you don't "hide" group sessions later)
                if (v !== "group") setDateFilter(null);
              }}
            />
          </div>

          {/* Calendar filter only makes sense for scheduled sessions */}
          {sessionTypeTab === "group" && (
            <div className="mb-6 w-full">
              <SessionsDateFilter
                value={dateFilter}
                onChange={(v) => {
                  if (DEBUG) console.log("[DEBUG Sessions] Date filter:", v);
                  setDateFilter(v);
                }}
                weeksAhead={3}
              />
            </div>
          )}

          {/* container */}
          <div className="rounded-[24px] px-3 py-3 md:border md:border-[#DBD8D8] md:p-8">
            {isLoading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brandBlack" />
              </div>
            ) : visibleSessions.length === 0 ? (
              <div className="p-2 text-center">
                <p className="text-sm text-slate-600 mb-4">
                  {sessionTypeTab === "group"
                    ? `No active sessions ${dateFilter ? "for this date" : "available"}`
                    : sessionTypeTab === "infinite"
                      ? "No infinite rooms available"
                      : "No sessions available"}
                </p>

                {user && (
                  <button
                    onClick={() => {
                      if (DEBUG) console.log("[DEBUG Sessions] Create first session");
                      modal.open();
                    }}
                    className="text-sm underline underline-offset-4"
                  >
                    Create the first session
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3 md:space-y-6">
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
