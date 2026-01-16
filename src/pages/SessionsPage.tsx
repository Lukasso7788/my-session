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
  duration_minutes?: number;
  format?: string;
  start_time?: string;
  status?: string;

  // ✅ NEW columns (идеальный способ маршрутизации)
  session_format_type?: "group" | "infinite" | "body" | string;
  is_silent?: boolean;

  // ✅ fallback for older rows
  schedule?: any;

  // ✅ booking UI
  session_bookings?: { user_id: string }[];

  // ✅ ONLINE NOW (from DB, not history)
  live_count?: number;
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

  // если раньше infinite был объектом (а group — массивом)
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

// =====================
// UI: Infinite intro card
// =====================
function InfinityIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <img
      src="/icons/infinite.svg"
      className={className}
      alt=""
      draggable={false}
    />
  );
}

function ClockIcon({ className = "w-[27px] h-[27px]" }: { className?: string }) {
  return (
    <img
      src="/icons/always-open.svg"
      className={className}
      alt=""
      draggable={false}
    />
  );
}

function EyeIcon({ className = "w-[27px] h-[27px]" }: { className?: string }) {
  return (
    <img
      src="/icons/stay-accountable.svg"
      className={className}
      alt=""
      draggable={false}
    />
  );
}

function WorkflowIcon({ className = "w-[27px] h-[27px]" }: { className?: string }) {
  return (
    <img
      src="/icons/structured-flow.svg"
      className={className}
      alt=""
      draggable={false}
    />
  );
}

function RocketIcon({ className = "w-[27px] h-[27px]" }: { className?: string }) {
  return (
    <img
      src="/icons/keep-momentum.svg"
      className={className}
      alt=""
      draggable={false}
    />
  );
}

type Feature = {
  title: string;
  subtitle: string;
  color: string; // border + icon
  bg20: string;  // 20% fill
  Icon: (p: { className?: string }) => JSX.Element;
};

function InfiniteRoomsIntroCard() {
  const features: Feature[] = [
    {
      title: "Always Open",
      subtitle: "24/7 Access",
      color: "#5286F6",
      bg20: "#5286F633",
      Icon: ClockIcon,
    },
    {
      title: "Stay accountable",
      subtitle: "With others",
      color: "#65D46C",
      bg20: "#65D46C33",
      Icon: EyeIcon,
    },
    {
      title: "Structured Flow",
      subtitle: "Built-in Workflow",
      color: "#F65252",
      bg20: "#F6525233",
      Icon: WorkflowIcon,
    },
    {
      title: "Keep momentum",
      subtitle: "Day & Night",
      color: "#5286F6",
      bg20: "#5286F633",
      Icon: RocketIcon,
    },
  ];

  return (
    <div className="w-full flex justify-center">
      <div className="w-full max-w-[980px]">
        {/* px=32 py=24, gap=32, radius усилен */}
        <div className="border border-[#DBD8D8] rounded-[24px] bg-white px-8 py-6 flex flex-col gap-8">
          {/* title row: icon padding 16/16, icon 20, gap 10 */}
          <div className="flex items-center justify-center gap-[10px]">
            <div className="p-4 rounded-[20px] bg-[#111827] text-white inline-flex items-center justify-center">
              <InfinityIcon className="w-5 h-5" />
            </div>

            <h2 className="font-inter font-semibold text-[24px] text-brandBlack">
              24/7 Infinite Rooms
            </h2>
          </div>

          {/* body text: 16 light, 160% */}
          <p className="font-inter font-light text-[16px] leading-[160%] text-brandBlack text-center max-w-[860px] mx-auto">
            24/7 Infinite Rooms are always open, giving you a structured space to focus whenever inspiration strikes.
            Join at any time, follow the built-in workflow (Pomodoro or Deep Work), stay accountable with others,
            and keep your momentum going — day or night.
          </p>

          {/* 4 icon blocks */}
          <div className="w-full flex justify-center">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
              {features.map((f) => (
                <div key={f.title} className="flex items-center gap-4">
                  {/* p=13.5, radius 13.5, icon 27 */}
                  <div
                    className="border rounded-[13.5px] inline-flex items-center justify-center"
                    style={{
                      borderColor: f.color,
                      backgroundColor: f.bg20,
                      padding: "13.5px",
                    }}
                  >
                    <f.Icon className="w-[27px] h-[27px]" />
                  </div>

                  {/* title 14 semibold, subtitle 12 light, gap 8 */}
                  <div className="flex flex-col" style={{ gap: "8px" }}>
                    <div className="font-inter font-semibold text-[14px] text-brandBlack">
                      {f.title}
                    </div>
                    <div className="font-inter font-light text-[12px] text-brandBlack/70">
                      {f.subtitle}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* distance to switcher: 48px */}
        <div className="h-12" />
      </div>
    </div>
  );
}

export function SessionsPage() {
  const navigate = useNavigate();
  const modal = useCreateSessionModal();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const [sessions, setSessions] = useState<SessionWithRelations[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [sessionTypeTab, setSessionTypeTab] = useState<"group" | "infinite" | "body">("group");
  const [dateFilter, setDateFilter] = useState<string | null>(null);

  // Sync tab from querystring: /sessions?tab=group|infinite|body
  useEffect(() => {
    const tab = (searchParams.get("tab") || "").toLowerCase();
    if (tab === "group" || tab === "infinite" || tab === "body") {
      setSessionTypeTab(tab);
      if (DEBUG) console.log("[DEBUG Sessions] Tab from query:", tab);
    }
  }, [searchParams]);

  // ✅ ONLINE NOW: fetch live counts from DB (cheap)
  const fetchLiveCounts = useCallback(async (sessionIds: string[]) => {
    if (!sessionIds.length) return;

    try {
      const { data, error } = await supabase.rpc("get_live_counts", {
        p_session_ids: sessionIds,
        // p_ttl_seconds: 40, // optional
      });

      if (error) throw error;

      const map = new Map<string, number>();
      for (const row of data || []) {
        map.set(row.session_id, row.live_count);
      }

      setSessions((prev) =>
        prev.map((s) => ({
          ...s,
          live_count: map.get(s.id) ?? 0,
        }))
      );
    } catch (e) {
      if (DEBUG) console.warn("[DEBUG Sessions] live counts error:", e);
    }
  }, []);

  // --- LOAD SESSIONS ---
  const fetchSessions = useCallback(async () => {
    if (DEBUG) console.log("[DEBUG Sessions] Fetch sessions…");

    try {
      setIsLoading(true);

      // ✅ ВАЖНО:
      // - НЕ выбираем session_attendance (это история, даёт "максимум за всё время")
      // - выбираем schedule (fallback для старых infinite)
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
          session_format_type,
          is_silent,
          session_bookings ( user_id )
        `)
        .order("start_time", { ascending: true });

      if (error) {
        console.error("[DEBUG Sessions] Fetch error:", error);
        throw error;
      }

      const rows = (data || []) as SessionWithRelations[];

      if (DEBUG) console.log("[DEBUG Sessions] Loaded:", rows);

      // set base sessions first
      setSessions(rows);

      // then fetch live counts (online now)
      const ids = rows.map((s) => s.id).filter(Boolean);
      await fetchLiveCounts(ids);
    } catch (err) {
      console.error("[DEBUG Sessions] FAILED LOADING:", err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchLiveCounts]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // --- Refresh after modal creates session ---
  useEffect(() => {
    modal.setOnCreatedCallback(fetchSessions);
    if (DEBUG) console.log("[DEBUG Sessions] Modal callback set");
  }, [modal, fetchSessions]);

  // ✅ Poll ONLY live counts every 10s (cheap)
  const sessionIds = useMemo(() => sessions.map((s) => s.id).filter(Boolean), [sessions]);

  useEffect(() => {
    const t = window.setInterval(() => {
      fetchLiveCounts(sessionIds);
    }, 10_000);

    return () => window.clearInterval(t);
  }, [sessionIds, fetchLiveCounts]);

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
    if (!user) return navigate("/login");
    navigate(`/room/${id}`);
  };

  const book = async (id: string) => {
    if (!user) return navigate("/login");

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
          {/* ✅ Убираем большой заголовок только для infinite */}
          {sessionTypeTab !== "infinite" && (
            <h1 className="text-[24px] md:text-[28px] xl:text-[36px] font-normal leading-tight mx-auto">
              Join a focus session to stay accountable
            </h1>
          )}
        </div>

        <div className="w-full">
          {/* ✅ Infinite rooms intro block (above switcher) */}
          {sessionTypeTab === "infinite" && <InfiniteRoomsIntroCard />}

          <div className="w-full flex justify-center mb-[55px]">
            <SessionTypeSwitcher
              value={sessionTypeTab}
              onChange={(v) => {
                setSessionTypeTab(v);

                // чтобы не было "почему всё пропало" из-за старого dateFilter
                if (v === "infinite") setDateFilter(null);
              }}
            />
          </div>

          {sessionTypeTab !== "infinite" && (
            <div className="mb-6 w-full">
              <SessionsDateFilter
                value={dateFilter}
                onChange={setDateFilter}
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
                  No active sessions{" "}
                  {dateFilter && sessionTypeTab !== "infinite" ? "for this date" : "available"}
                </p>

                {user && (
                  <button
                    onClick={() => modal.open()}
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
