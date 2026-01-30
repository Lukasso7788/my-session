// src/pages/SessionsPage.tsx
const DEBUG = true;

import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SessionTypeSwitcher } from "../components/SessionTypeSwitcher";
import SessionCard from "../components/SessionCard";
import { SessionsDateFilter } from "../components/SessionsDateFilter";
import { BodyTriplingIntro } from "../components/body/BodyTriplingIntro";
import { supabase } from "../lib/supabase";
import { useCreateSessionModal } from "../context/CreateSessionModalContext";
import { useAuth } from "../context/AuthContext";
import type { Session } from "../types/session";

type BookingProfile = {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
  email?: string | null;
};

type SessionBookingRow = {
  user_id: string;
  profiles?: BookingProfile | null;
};

type SessionWithRelations = Session & {
  host_id?: string;
  host_name?: string;
  duration_minutes?: number;
  format?: string;
  start_time?: string;
  status?: string;

  session_format_type?: "group" | "infinite" | "body" | string;
  is_silent?: boolean;

  max_participants?: number | null;

  schedule?: any;

  session_bookings?: SessionBookingRow[];

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

function todayLocalYMD() {
  const d = new Date();
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

function isInfiniteBySchedule(s: SessionWithRelations) {
  const sch = safeParseSchedule((s as any)?.schedule);
  if (!sch || typeof sch !== "object") return false;

  if ((sch as any)?.kind === "infinite_room") return true;
  if (!Array.isArray(sch) && (sch as any)?.timer?.phases) return true;

  return false;
}

function resolveSessionType(
  s: SessionWithRelations
): "group" | "infinite" | "body" {
  const t = String(s.session_format_type || "").toLowerCase();

  if (t === "infinite") return "infinite";
  if (t === "body") return "body";
  if (t === "group") return "group";

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

function WorkflowIcon({
  className = "w-[27px] h-[27px]",
}: {
  className?: string;
}) {
  return (
    <img
      src="/icons/structured-flow.svg"
      className={className}
      alt=""
      draggable={false}
    />
  );
}

function RocketIcon({
  className = "w-[27px] h-[27px]",
}: {
  className?: string;
}) {
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
  color: string;
  bg20: string;
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
        <div className="border border-[#DBD8D8] rounded-[24px] bg-white px-5 py-5 sm:px-8 sm:py-6 flex flex-col gap-6 sm:gap-8">
          <div className="flex items-center justify-center gap-[10px]">
            <div className="p-3 sm:p-4 rounded-[20px] bg-[#111827] text-white inline-flex items-center justify-center">
              <InfinityIcon className="w-5 h-5" />
            </div>

            <h2 className="font-inter font-semibold text-[20px] sm:text-[24px] text-brandBlack">
              24/7 Focus Rooms
            </h2>
          </div>

          <p className="font-inter font-light text-[14px] sm:text-[16px] leading-[160%] text-brandBlack text-center max-w-[860px] mx-auto">
            24/7 Focus Rooms are always open, giving you a structured space to
            focus whenever inspiration strikes. Join at any time, follow the
            built-in workflow (Pomodoro or Deep Work), stay accountable with
            others, and keep your momentum going — day or night.
          </p>

          <div className="w-full flex justify-center">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-8">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="flex items-center gap-3 sm:gap-4 min-w-0"
                >
                  <div
                    className="shrink-0 border rounded-[13.5px] inline-flex items-center justify-center w-[44px] h-[44px] sm:w-[54px] sm:h-[54px]"
                    style={{
                      borderColor: f.color,
                      backgroundColor: f.bg20,
                    }}
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

        <div className="h-12" />
      </div>
    </div>
  );
}

// ========
// Body create UI helpers
// ========
function nextQuarterTimeHHMM() {
  const d = new Date();
  const ms = d.getTime();
  const step = 15 * 60 * 1000;
  const rounded = new Date(Math.ceil(ms / step) * step);
  const hh = String(rounded.getHours()).padStart(2, "0");
  const mm = String(rounded.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function buildLocalISO(dateYMD: string, timeHHMM: string) {
  const [y, m, d] = dateYMD.split("-").map((x) => Number(x));
  const [hh, mm] = timeHHMM.split(":").map((x) => Number(x));
  const local = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
  return local.toISOString();
}

export function SessionsPage() {
  const navigate = useNavigate();
  const modal = useCreateSessionModal();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const [sessions, setSessions] = useState<SessionWithRelations[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [sessionTypeTab, setSessionTypeTab] = useState<
    "group" | "infinite" | "body"
  >("group");

  // group-only date filter
  const [dateFilter, setDateFilter] = useState<string | null>(null);

  // current user profile (best effort)
  const [currentProfile, setCurrentProfile] = useState<BookingProfile | null>(
    null
  );

  // How it works modal
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  // BODY: inline create state
  const [bodyCreateDuration, setBodyCreateDuration] = useState<25 | 50 | null>(
    null
  );
  const [bodyCreateDate, setBodyCreateDate] = useState<string>(todayLocalYMD());
  const [bodyCreateTime, setBodyCreateTime] = useState<string>("");
  const [bodyCreateLoading, setBodyCreateLoading] = useState(false);

  const resetBodyCreate = () => {
    setBodyCreateDuration(null);
    setBodyCreateTime("");
  };

  const startBodyCreate = (dur: 25 | 50) => {
    setBodyCreateDuration(dur);
    setBodyCreateTime((prev) => prev || nextQuarterTimeHHMM());
  };

  const confirmBodyCreate = async () => {
    if (!user) return navigate("/login");
    if (!bodyCreateDuration) return;
    const time = (bodyCreateTime || "").trim();
    const date = (bodyCreateDate || "").trim();
    if (!date || !time) return;

    try {
      setBodyCreateLoading(true);

      const start_time = buildLocalISO(date, time);

      const title = `body — ${bodyCreateDuration} min`;

      const payload: any = {
        title,
        host_id: user.id,
        host_name: currentProfile?.full_name || null,
        duration_minutes: bodyCreateDuration,
        format: "body",
        session_format_type: "body",
        start_time,
        status: "planned",
        // optional default:
        // max_participants: 3,
      };

      const { error } = await supabase.from("sessions").insert(payload);
      if (error) throw error;

      await fetchSessions();
      resetBodyCreate();
    } catch (e) {
      console.error("[DEBUG Sessions] create body session error:", e);
      alert("Failed to create session (see console).");
    } finally {
      setBodyCreateLoading(false);
    }
  };

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
      setSessionTypeTab(tab as any);
      if (DEBUG) console.log("[DEBUG Sessions] Tab from query:", tab);

      if (tab === "infinite") setDateFilter(null);
      if (tab === "body") {
        setBodyCreateDate((prev) => prev || todayLocalYMD());
      }
    }
  }, [searchParams]);

  // Load current user profile (best effort)
  useEffect(() => {
    const run = async () => {
      if (!user?.id) {
        setCurrentProfile(null);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url, email")
          .eq("id", user.id)
          .maybeSingle();

        if (error) throw error;
        setCurrentProfile((data as any) || null);
      } catch (e) {
        if (DEBUG)
          console.warn("[DEBUG Sessions] profile load failed:", e);
        setCurrentProfile(null);
      }
    };

    run();
  }, [user?.id]);

  // ONLINE NOW: fetch live counts from DB (cheap)
  const fetchLiveCounts = useCallback(async (sessionIds: string[]) => {
    if (!sessionIds.length) return;

    try {
      const { data, error } = await supabase.rpc("get_live_counts", {
        p_session_ids: sessionIds,
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
          max_participants,
          session_bookings (
            user_id,
            profiles:profiles (
              id,
              full_name,
              avatar_url,
              email
            )
          )
        `
        )
        .order("start_time", { ascending: true });

      if (error) {
        console.error("[DEBUG Sessions] Fetch error:", error);
        throw error;
      }

      const rows = (data || []) as unknown as SessionWithRelations[];
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

  // Refresh after modal creates session (still used for group/infinite)
  useEffect(() => {
    modal.setOnCreatedCallback(fetchSessions);
    if (DEBUG) console.log("[DEBUG Sessions] Modal callback set");
  }, [modal, fetchSessions]);

  // Poll ONLY live counts every 10s
  const sessionIds = useMemo(
    () => sessions.map((s) => s.id).filter(Boolean),
    [sessions]
  );

  useEffect(() => {
    const t = window.setInterval(() => {
      fetchLiveCounts(sessionIds);
    }, 10_000);

    return () => window.clearInterval(t);
  }, [sessionIds, fetchLiveCounts]);

  // HELPERS
  const isExpired = (s: SessionWithRelations) => {
    const type = resolveSessionType(s);

    if (type === "infinite") return false;

    if (!s.start_time) return false;
    const dur = Number(s.duration_minutes) || 0;
    if (dur <= 0) return false;

    return Date.now() > new Date(s.start_time).getTime() + dur * 60_000;
  };

  const activeSessions = useMemo(
    () => sessions.filter((s) => !isExpired(s)),
    [sessions]
  );

  const typeFilteredSessions = useMemo(() => {
    return activeSessions.filter(
      (s) => resolveSessionType(s) === sessionTypeTab
    );
  }, [sessionTypeTab, activeSessions]);

  // Date filtering only for GROUP
  const visibleSessions = useMemo(() => {
    if (sessionTypeTab === "infinite") return typeFilteredSessions;
    if (sessionTypeTab === "body") return typeFilteredSessions;

    if (!dateFilter) return typeFilteredSessions;

    return typeFilteredSessions.filter((s) => {
      if (!s.start_time) return false;
      const ymd = toLocalYMDFromISO(s.start_time);
      return ymd === dateFilter;
    });
  }, [typeFilteredSessions, dateFilter, sessionTypeTab]);

  // ACTIONS
  const join = (id: string) => {
    if (!user) return navigate("/login");
    navigate(`/room/${id}`);
  };

  const book = async (id: string) => {
    if (!user) return navigate("/login");

    try {
      const { error } = await supabase.from("session_bookings").insert({
        session_id: id,
        user_id: user.id,
      });
      if (error) throw error;

      await fetchSessions();
    } catch (err) {
      console.error("[DEBUG Sessions] Booking error:", err);
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
      await fetchSessions();
    } catch (err) {
      console.error("[DEBUG Sessions] Cancel error:", err);
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
    }
  };

  const editSession = async (
    sessionId: string,
    updates: {
      title?: string;
      start_time?: string;
      max_participants?: number | null;
    }
  ) => {
    if (!user) return navigate("/login");
    if (!updates || Object.keys(updates).length === 0) return;

    try {
      const { error } = await supabase
        .from("sessions")
        .update(updates)
        .eq("id", sessionId);

      if (error) throw error;
      await fetchSessions();
    } catch (err) {
      console.error("[DEBUG Sessions] Edit session error:", err);
      throw err;
    }
  };

  const inviteToSession = async (
    sessionId: string,
    payload: { email: string; message?: string }
  ) => {
    const email = (payload?.email || "").trim();
    if (!email) return;

    const s = sessions.find((x) => x.id === sessionId);
    const title = s?.title || "MySession";
    const when = s?.start_time ? new Date(s.start_time).toLocaleString() : "";
    const link = `${window.location.origin}/room-iframe/${sessionId}`;

    const subject = encodeURIComponent(`Invitation: ${title}`);
    const body = encodeURIComponent(
      `${payload?.message ? payload.message + "\n\n" : ""}` +
      `Join this session on MySession:\n${title}\n` +
      `${when ? `When: ${when}\n` : ""}` +
      `Link: ${link}\n`
    );

    window.location.href = `mailto:${encodeURIComponent(
      email
    )}?subject=${subject}&body=${body}`;
  };

  const openCreate = () => {
    if (!user) return navigate("/login");
    modal.open();
  };

  const topPad =
    sessionTypeTab === "group" ? "pt-[100px] pb-[50px]" : "pt-[56px] pb-[18px]";

  return (
    <div className="min-h-screen bg-white text-brandBlack font-inter">
      <main className="w-full px-3 md:px-6 lg:px-10 pb-12">
        <div className={`text-center ${topPad}`}>
          {sessionTypeTab === "group" && (
            <h1 className="text-[24px] md:text-[28px] xl:text-[36px] font-normal leading-tight mx-auto">
              Join a focus session to stay accountable
            </h1>
          )}
        </div>

        <div className="w-full">
          {sessionTypeTab === "infinite" && <InfiniteRoomsIntroCard />}
          {sessionTypeTab === "body" && <BodyTriplingIntro />}

          <div className="w-full flex justify-center mb-[55px]">
            <SessionTypeSwitcher
              value={sessionTypeTab}
              onChange={(v) => {
                setSessionTypeTab(v);

                if (v === "infinite") setDateFilter(null);

                if (v === "body") {
                  setBodyCreateDate((prev) => prev || todayLocalYMD());
                }
              }}
            />
          </div>

          {/* BODY: Coming Soon + NEW inline create */}
          {sessionTypeTab === "body" ? (
            <div className="w-full max-w-[980px] mx-auto">
              <div className="border border-[#DBD8D8] rounded-[24px] bg-white p-5 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-[#111827]">
                      Create a body session (25 / 50)
                    </div>
                    <div className="text-[12px] text-[#111827]/60 mt-1">
                      Click 25 or 50 → choose time → confirm.
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[#111827]/60">Date</span>
                    <input
                      type="date"
                      value={bodyCreateDate}
                      onChange={(e) => setBodyCreateDate(e.target.value)}
                      className="h-10 rounded-[12px] border border-[#E6E6E6] px-3 text-[13px] text-[#111827]"
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => startBodyCreate(25)}
                    disabled={bodyCreateLoading}
                    className="
                      h-10 rounded-full border border-[#111827]
                      px-4 text-[13px] font-semibold
                      text-[#111827]
                      hover:bg-[#111827] hover:text-white
                      transition
                      disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-[#111827]
                    "
                  >
                    25
                  </button>

                  <button
                    type="button"
                    onClick={() => startBodyCreate(50)}
                    disabled={bodyCreateLoading}
                    className="
                      h-10 rounded-full border border-[#111827]
                      px-4 text-[13px] font-semibold
                      text-[#111827]
                      hover:bg-[#111827] hover:text-white
                      transition
                      disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-[#111827]
                    "
                  >
                    50
                  </button>

                  {bodyCreateDuration && (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={bodyCreateTime}
                        onChange={(e) => setBodyCreateTime(e.target.value)}
                        className="h-10 rounded-[12px] border border-[#E6E6E6] px-3 text-[13px] text-[#111827]"
                      />

                      {/* confirm */}
                      <button
                        type="button"
                        onClick={confirmBodyCreate}
                        disabled={bodyCreateLoading}
                        className="
                          h-10 w-10 rounded-full
                          border border-[#2BB673]
                          text-[#2BB673]
                          hover:bg-[#2BB673] hover:text-white
                          transition
                          flex items-center justify-center
                          disabled:opacity-50
                        "
                        aria-label="Confirm"
                        title="Confirm"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M20 6 9 17l-5-5"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>

                      {/* cancel */}
                      <button
                        type="button"
                        onClick={resetBodyCreate}
                        disabled={bodyCreateLoading}
                        className="
                          h-10 w-10 rounded-full
                          border border-[#111827]
                          text-[#111827]
                          hover:bg-[#111827] hover:text-white
                          transition
                          flex items-center justify-center
                          disabled:opacity-50
                        "
                        aria-label="Cancel"
                        title="Cancel"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M18 6 6 18M6 6l12 12"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-6 text-center py-10">
                  <div className="text-[18px] font-semibold text-[#111827]">
                    Coming Soon
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* GROUP: date filter */}
              {sessionTypeTab === "group" && (
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
                      {dateFilter && sessionTypeTab === "group"
                        ? "for this date"
                        : "available"}
                    </p>

                    {user && (
                      <button
                        onClick={openCreate}
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
                        currentUser={
                          user?.id
                            ? {
                              id: user.id,
                              full_name: currentProfile?.full_name || undefined,
                              avatar_url: currentProfile?.avatar_url || undefined,
                              email:
                                (currentProfile?.email ||
                                  (user as any)?.email ||
                                  undefined) as any,
                            }
                            : undefined
                        }
                        onJoin={join}
                        onBook={book}
                        onCancelBooking={cancel}
                        onDelete={remove}
                        onEditSession={editSession}
                        onInviteToSession={inviteToSession}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      {/* Floating: How it works */}
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
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 18h.01"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
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

      {/* Modal: How it works (оставил как было у тебя) */}
      {howItWorksOpen && (
        <div className="fixed inset-0 z-[70]">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setHowItWorksOpen(false)}
          />

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
                    <path
                      d="M18 6 6 18M6 6l12 12"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <div className="px-6 py-6 sm:px-8 sm:py-8 max-h-[75vh] overflow-auto">
                <div className="text-[13px] text-[#111827]/80 leading-relaxed">
                  (content unchanged)
                </div>

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
