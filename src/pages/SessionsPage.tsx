// src/pages/SessionsPage.tsx

import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SessionTypeSwitcher } from "../components/SessionTypeSwitcher";
import SessionCard from "../components/SessionCard";
import { SessionsDateFilter } from "../components/SessionsDateFilter";
import { supabase } from "../lib/supabase";
import { useCreateSessionModal } from "../context/CreateSessionModalContext";
import { useAuth } from "../context/AuthContext";
import type { Session } from "../types/session";

const DEBUG = true;

type SessionWithRelations = Session & {
  host_id?: string;
  host_name?: string;
  duration_minutes?: number;
  format?: string;
  start_time?: string;
  status?: string;

  // ✅ NEW columns (идеальный способ маршрутизации)
  session_format_type?: "group" | "infinite" | "body" | string;
  is_silent?: boolean;

  // ✅ fallback (для старых записей/пока не везде проставили session_format_type)
  schedule?: any;

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

// ✅ fallback-детектор infinite по schedule (старый формат)
function isInfiniteBySchedule(s: SessionWithRelations) {
  const sch = safeParseSchedule((s as any)?.schedule);
  if (!sch || typeof sch !== "object") return false;

  // самый надёжный маркер старого infinite
  if ((sch as any)?.kind === "infinite_room") return true;

  // если раньше ты хранил infinite как объект (а group как массив)
  if (!Array.isArray(sch) && (sch as any)?.timer?.phases) return true;

  return false;
}

// ✅ главный резолвер типа (с fallback)
function resolveSessionType(s: SessionWithRelations): "group" | "infinite" | "body" {
  const t = String(s.session_format_type || "").toLowerCase();

  if (t === "infinite") return "infinite";
  if (t === "body") return "body";
  if (t === "group") return "group";

  // fallback: если колонка ещё не проставлена
  if (isInfiniteBySchedule(s)) return "infinite";
  if (String(s.format || "").toLowerCase() === "body") return "body";

  return "group";
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

      // ✅ ВАЖНО: выбираем и session_format_type, и schedule (для fallback)
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
          schedule,
          session_format_type,
          is_silent,
          session_bookings ( user_id ),
          session_attendance ( id, session_id, user_id )
        `
        )
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
    const type = resolveSessionType(s);

    // ✅ Infinite rooms never expire
    if (type === "infinite") return false;

    if (!s.start_time) return false;
    const dur = Number(s.duration_minutes) || 0;
    if (dur <= 0) return false;

    return Date.now() > new Date(s.start_time).getTime() + dur * 60_000;
  };

  const activeSessions = useMemo(() => sessions.filter((s) => !isExpired(s)), [sessions]);

  const typeFilteredSessions = useMemo(() => {
    return activeSessions.filter((s) => resolveSessionType(s) === sessionTypeTab);
  }, [sessionTypeTab, activeSessions]);

  // ✅ Date filtering (only for group/body; infinite ignores date filter)
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

  return (
    <div className="min-h-screen bg-white text-brandBlack font-inter">
      <main className="w-full px-3 md:px-6 lg:px-10 pb-12">
        <div className="pt-[100px] pb-[50px] text-center">
          <h1 className="text-[24px] md:text-[28px] xl:text-[36px] font-normal leading-tight mx-auto">
            Join a focus session to stay accountable
          </h1>
        </div>

        <div className="w-full">
          <div className="w-full flex justify-center mb-[55px]">
            <SessionTypeSwitcher
              value={sessionTypeTab}
              onChange={(v) => {
                if (DEBUG) console.log("[DEBUG Sessions] Tab changed:", v);
                setSessionTypeTab(v);

                // чтобы не было "почему всё пропало" после infinite -> group
                if (v === "infinite") setDateFilter(null);
              }}
            />
          </div>

          {/* Calendar filter: hide for infinite (doesn't make sense) */}
          {sessionTypeTab !== "infinite" && (
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

          <div className="rounded-[24px] px-3 py-3 md:border md:border-[#DBD8D8] md:p-8">
            {isLoading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brandBlack" />
              </div>
            ) : visibleSessions.length === 0 ? (
              <div className="p-2 text-center">
                <p className="text-sm text-slate-600 mb-4">
                  No active sessions {dateFilter && sessionTypeTab !== "infinite" ? "for this date" : "available"}
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
