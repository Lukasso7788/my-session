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

  // ✅ fallback for older rows
  schedule?: any;

  // ✅ booking UI (+ id, чтобы UID/bookingId был стабильный для invite)
  session_bookings?: { id?: string; user_id: string }[];

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
  return <img src="/icons/infinite.svg" className={className} alt="" draggable={false} />;
}

function ClockIcon({ className = "w-[27px] h-[27px]" }: { className?: string }) {
  return <img src="/icons/always-open.svg" className={className} alt="" draggable={false} />;
}

function EyeIcon({ className = "w-[27px] h-[27px]" }: { className?: string }) {
  return <img src="/icons/stay-accountable.svg" className={className} alt="" draggable={false} />;
}

function WorkflowIcon({ className = "w-[27px] h-[27px]" }: { className?: string }) {
  return <img src="/icons/structured-flow.svg" className={className} alt="" draggable={false} />;
}

function RocketIcon({ className = "w-[27px] h-[27px]" }: { className?: string }) {
  return <img src="/icons/keep-momentum.svg" className={className} alt="" draggable={false} />;
}

type Feature = {
  title: string;
  subtitle: string;
  color: string; // border + icon
  bg20: string; // 20% fill
  Icon: (p: { className?: string }) => JSX.Element;
};

function InfiniteRoomsIntroCard() {
  const features: Feature[] = [
    { title: "Always Open", subtitle: "24/7 Access", color: "#5286F6", bg20: "#5286F633", Icon: ClockIcon },
    { title: "Stay accountable", subtitle: "With others", color: "#65D46C", bg20: "#65D46C33", Icon: EyeIcon },
    { title: "Structured Flow", subtitle: "Built-in Workflow", color: "#F65252", bg20: "#F6525233", Icon: WorkflowIcon },
    { title: "Keep momentum", subtitle: "Day & Night", color: "#5286F6", bg20: "#5286F633", Icon: RocketIcon },
  ];

  return (
    <div className="w-full flex justify-center">
      <div className="w-full max-w-[980px]">
        {/* ✅ mobile padding + spacing tightened */}
        <div className="border border-[#DBD8D8] rounded-[24px] bg-white px-5 py-5 sm:px-8 sm:py-6 flex flex-col gap-6 sm:gap-8">
          <div className="flex items-center justify-center gap-[10px]">
            {/* ✅ a bit smaller on mobile */}
            <div className="p-3 sm:p-4 rounded-[20px] bg-[#111827] text-white inline-flex items-center justify-center">
              <InfinityIcon className="w-5 h-5" />
            </div>

            <h2 className="font-inter font-semibold text-[20px] sm:text-[24px] text-brandBlack">
              24/7 Infinite Rooms
            </h2>
          </div>

          {/* ✅ text smaller on mobile */}
          <p className="font-inter font-light text-[14px] sm:text-[16px] leading-[160%] text-brandBlack text-center max-w-[860px] mx-auto">
            24/7 Infinite Rooms are always open, giving you a structured space to focus whenever inspiration strikes.
            Join at any time, follow the built-in workflow (Pomodoro or Deep Work), stay accountable with others,
            and keep your momentum going — day or night.
          </p>

          <div className="w-full flex justify-center">
            {/* ✅ gaps smaller on mobile */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-8">
              {features.map((f) => (
                <div key={f.title} className="flex items-center gap-3 sm:gap-4 min-w-0">
                  {/* ✅ HARD FIX: prevent shrink + fixed size box so icon is always visible */}
                  <div
                    className="shrink-0 border rounded-[13.5px] inline-flex items-center justify-center w-[44px] h-[44px] sm:w-[54px] sm:h-[54px]"
                    style={{ borderColor: f.color, backgroundColor: f.bg20 }}
                  >
                    <f.Icon className="w-5 h-5 sm:w-[27px] sm:h-[27px]" />
                  </div>

                  <div className="flex flex-col min-w-0 gap-1.5 sm:gap-2">
                    <div className="font-inter font-semibold text-[13px] sm:text-[14px] text-brandBlack leading-snug">
                      {f.title}
                    </div>
                    <div className="font-inter font-light text-[11px] sm:text-[12px] text-brandBlack/70 leading-snug">
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

  // ✅ NEW: How it works modal
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  // ✅ NEW: user email/name for calendar invite sending (SessionCard -> /api/send-session-invite)
  const userEmail = useMemo(() => {
    // Supabase auth user обычно содержит email тут:
    // user.email (или иногда в user.user_metadata.email)
    return (user as any)?.email || (user as any)?.user_metadata?.email || undefined;
  }, [user]);

  const userName = useMemo(() => {
    const um = (user as any)?.user_metadata || {};
    return um.full_name || um.name || um.username || undefined;
  }, [user]);

  // Close on ESC
  useEffect(() => {
    if (!howItWorksOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHowItWorksOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [howItWorksOpen]);

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
          session_bookings ( id, user_id )
        `)
        .order("start_time", { ascending: true });

      if (error) {
        console.error("[DEBUG Sessions] Fetch error:", error);
        throw error;
      }

      const rows = (data || []) as SessionWithRelations[];

      if (DEBUG) console.log("[DEBUG Sessions] Loaded:", rows);

      setSessions(rows);

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

  // ✅ Return booking id so SessionCard can use it for calendar invite UID
  const book = async (id: string) => {
    if (!user) return navigate("/login");

    try {
      const { data, error } = await supabase
        .from("session_bookings")
        .insert({
          session_id: id,
          user_id: user.id,
        })
        .select("id")
        .single();

      if (error) throw error;

      fetchSessions();
      return data; // <- SessionCard will pick up data.id
    } catch (err) {
      console.error("[DEBUG Sessions] Booking error:", err);
      throw err;
    }
  };

  const cancel = async (id: string) => {
    if (!user) return navigate("/login");

    try {
      const { error } = await supabase
        .from("session_bookings")
        .delete()
        .eq("session_id", id)
        .eq("user_id", user.id);

      if (error) throw error;

      fetchSessions();
    } catch (err) {
      console.error("[DEBUG Sessions] Cancel error:", err);
      throw err;
    }
  };

  const remove = async (id: string) => {
    if (!user) return navigate("/login");

    try {
      const { error } = await supabase.from("sessions").delete().eq("id", id);
      if (error) throw error;

      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error("[DEBUG Sessions] Delete error:", err);
      throw err;
    }
  };

  return (
    <div className="min-h-screen bg-white text-brandBlack font-inter">
      <main className="w-full px-3 md:px-6 lg:px-10 pb-12">
        {/* ✅ FIX: уменьшаем вертикальный отступ сверху ТОЛЬКО на Infinite tab */}
        <div
          className={`text-center ${sessionTypeTab === "infinite" ? "pt-[56px] pb-[18px]" : "pt-[100px] pb-[50px]"
            }`}
        >
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
              <SessionsDateFilter value={dateFilter} onChange={setDateFilter} weeksAhead={3} />
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
                  <button onClick={() => modal.open()} className="text-sm underline underline-offset-4">
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
                    userEmail={user?.email || undefined}
                    userName={user?.user_metadata?.full_name || user?.user_metadata?.name || undefined}
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

      {/* ============================
          Floating: How it works
         ============================ */}
      <button
        type="button"
        onClick={() => setHowItWorksOpen(true)}
        className="
          fixed bottom-6 right-6 z-[60]
          rounded-full border border-[#111827]
          bg-white text-[#111827]
          px-5 py-3
          shadow-[0_10px_25px_rgba(0,0,0,0.12)]
          hover:bg-[#111827] hover:text-white
          transition
          flex items-center gap-2
        "
        aria-label="How it works"
        title="How it works"
      >
        {/* inline icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M12 18h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path
            d="M9.09 9a3 3 0 1 1 4.82 2.33c-.66.49-1.41 1.08-1.41 2.17V14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10Z"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
        <span className="text-[14px] font-semibold">How it works</span>
      </button>

      {/* ============================
          Modal: How it works
         ============================ */}
      {howItWorksOpen && (
        <div className="fixed inset-0 z-[70]">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setHowItWorksOpen(false)} />

          {/* Modal panel */}
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div
              className="
                w-full max-w-[860px]
                rounded-[24px]
                bg-white
                border border-[#DBD8D8]
                shadow-[0_30px_90px_rgba(0,0,0,0.22)]
                overflow-hidden
              "
              role="dialog"
              aria-modal="true"
              aria-label="How it works"
            >
              {/* Header */}
              <div className="px-6 py-5 sm:px-8 sm:py-6 flex items-start justify-between gap-4 border-b border-[#ECECEC]">
                <div className="min-w-0">
                  <h3 className="text-[18px] sm:text-[20px] font-semibold text-[#111827]">
                    How MySession works
                  </h3>
                  <p className="text-[12px] sm:text-[13px] text-[#111827]/70 mt-1 leading-relaxed">
                    Step-by-step: create → join → follow stages → finish.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setHowItWorksOpen(false)}
                  className="
                    shrink-0
                    h-10 w-10 rounded-full
                    border border-[#111827]
                    text-[#111827]
                    hover:bg-[#111827] hover:text-white
                    transition
                    flex items-center justify-center
                  "
                  aria-label="Close"
                  title="Close"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-6 sm:px-8 sm:py-8 max-h-[75vh] overflow-auto">
                {/* Steps */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827] mb-3">1) Choose a session</div>
                    <ul className="text-[13px] text-[#111827]/80 leading-relaxed list-disc pl-5 space-y-2">
                      <li>
                        Pick a tab: <b>Group</b>, <b>Infinite</b> (24/7), or <b>Body doubling</b>.
                      </li>
                      <li>Group/Body sessions are scheduled (date/time). Infinite rooms are always open.</li>
                      <li>
                        You can <b>Book session</b> (optional) to save it — or just join.
                      </li>
                    </ul>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827] mb-3">2) Join & set up</div>
                    <ul className="text-[13px] text-[#111827]/80 leading-relaxed list-disc pl-5 space-y-2">
                      <li>
                        Click <b>Join session</b>.
                      </li>
                      <li>Turn mic/cam on/off as you prefer. Screen-share is optional.</li>
                      <li>You’ll see the session flow: timer/stages (depending on room type).</li>
                    </ul>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827] mb-3">3) Follow the workflow</div>
                    <ul className="text-[13px] text-[#111827]/80 leading-relaxed list-disc pl-5 space-y-2">
                      <li>Use stage prompts to stay aligned (check-in / intentions).</li>
                      <li>
                        During <b>Focus</b>, work silently or lightly co-work.
                      </li>
                      <li>
                        During <b>Break</b>, rest/reset. Then go back to focus.
                      </li>
                    </ul>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827] mb-3">4) Finish & leave</div>
                    <ul className="text-[13px] text-[#111827]/80 leading-relaxed list-disc pl-5 space-y-2">
                      <li>Wrap up at the end (or anytime in Infinite rooms).</li>
                      <li>Quick self-reflection: what you did / what’s next.</li>
                      <li>Leave the session — your work is done.</li>
                    </ul>
                  </div>
                </div>

                {/* Divider */}
                <div className="my-7 border-t border-[#ECECEC]" />

                {/* Stages glossary */}
                <div className="flex items-center justify-between gap-4">
                  <h4 className="text-[14px] sm:text-[15px] font-semibold text-[#111827]">
                    Stages glossary (what each block means)
                  </h4>
                  <span className="text-[12px] text-[#111827]/60">
                    (Some rooms may hide stages — e.g. silent rooms)
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827]">Check-in</div>
                    <p className="text-[13px] text-[#111827]/80 leading-relaxed mt-2">
                      Quick verbal sync: “What are you working on?” + “Any blockers?”. Short, supportive, no long stories.
                    </p>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827]">Intentions</div>
                    <p className="text-[13px] text-[#111827]/80 leading-relaxed mt-2">
                      You state your goal for the next focus block. Keep it specific: 1–3 concrete outcomes.
                    </p>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827]">Focus</div>
                    <p className="text-[13px] text-[#111827]/80 leading-relaxed mt-2">
                      The working block. Usually quiet. Your only job: do the task.
                    </p>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827]">Break</div>
                    <p className="text-[13px] text-[#111827]/80 leading-relaxed mt-2">
                      Rest/reset: stand up, water, stretch. Avoid doom-scrolling if you can.
                    </p>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827]">Custom block</div>
                    <p className="text-[13px] text-[#111827]/80 leading-relaxed mt-2">
                      A flexible stage you can name anything: “Reading”, “Planning”, “Admin”, etc. Use it however you want.
                    </p>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827]">Outro / Wrap-up</div>
                    <p className="text-[13px] text-[#111827]/80 leading-relaxed mt-2">
                      Quick closure: what you finished, what’s next, and one takeaway.
                    </p>
                  </div>
                </div>

                {/* Bottom hint */}
                <div className="mt-7 rounded-[18px] border border-[#E6E6E6] bg-[#F7F7F7] p-5">
                  <div className="text-[13px] font-semibold text-[#111827]">Pro tip</div>
                  <p className="text-[13px] text-[#111827]/80 leading-relaxed mt-2">
                    If you’re joining a <b>Silent</b> room: keep mic off, use the stage timer as guidance, and focus.
                    No pressure to talk.
                  </p>
                </div>

                {/* Footer actions */}
                <div className="mt-8 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setHowItWorksOpen(false)}
                    className="
                      rounded-full border border-[#111827]
                      px-5 py-2.5 text-[13px] font-semibold
                      text-[#111827]
                      hover:bg-[#111827] hover:text-white
                      transition
                    "
                  >
                    Got it
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SessionsPage;
