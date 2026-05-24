const DEBUG = true;

import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SessionTypeSwitcher } from "../components/SessionTypeSwitcher";
import SessionCard from "../components/SessionCard";
import ActiveBanModal from "../components/ActiveBanModal";
import { SessionsDateFilter } from "../components/SessionsDateFilter";
import BodyTriplingBody from "../components/body/BodyTriplingBody";
import { BodyTriplingIntro } from "../components/body/BodyTriplingIntro";
import { supabase } from "../lib/supabase";
import { getCurrentUserActiveBan, type ActiveBan } from "../lib/bans";
import { loadEntitlementState, type EntitlementState } from "../lib/entitlements";
import { useCreateSessionModal } from "../context/CreateSessionModalContext";
import { useAuth } from "../context/AuthContext";
import type { Session } from "../types/session";

type BookingProfile = {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
};

type CurrentProfile = BookingProfile & {
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
  created_at?: string;
  description?: string | null;
  custom_slug?: string | null;

  session_format_type?: "group" | "infinite" | "body" | string;
  is_silent?: boolean;

  max_participants?: number | null;
  schedule?: any;

  session_bookings?: SessionBookingRow[];

  live_count?: number;
};


type PostSessionPromptState = {
  open: boolean;
  sessionId: string;
  sessionTitle: string;
  hostId: string;
  hostName: string;
  hostAvatarUrl?: string | null;
  hostBio?: string | null;
  minutesSpent: number;
  followerCount?: number;
  sessionsCount?: number;
  joinedSince?: string | null;
};

type PostSessionSessionOption = {
  id: string;
  title?: string | null;
  start_time?: string | null;
  duration_minutes?: number | null;
  host_id?: string | null;
};

function toLocalYMDFromISO(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

function ymdFromLocalDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

function todayLocalYMD() {
  return ymdFromLocalDate(new Date());
}

function tomorrowLocalYMD() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return ymdFromLocalDate(d);
}

function fromLocalYMD(ymd: string) {
  const [y, m, d] = String(ymd || "")
    .split("-")
    .map((n) => Number(n));

  if (!y || !m || !d) return null;

  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function isAllDatesValue(value: string | null) {
  return !value || value === "all";
}

function getDateGroupMeta(ymd: string) {
  if (ymd === "__undated__") {
    return {
      label: "Scheduled",
      pretty: "Date TBD",
    };
  }

  const d = fromLocalYMD(ymd);
  if (!d) {
    return {
      label: "Scheduled",
      pretty: ymd,
    };
  }

  const today = todayLocalYMD();
  const tomorrow = tomorrowLocalYMD();

  let label = d.toLocaleDateString(undefined, { weekday: "long" });

  if (ymd === today) label = "Today";
  if (ymd === tomorrow) label = "Tomorrow";

  const pretty = d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });

  return { label, pretty };
}

function formatPostSessionTime(iso?: string | null) {
  const value = String(iso || "").trim();
  if (!value) return "Time TBD";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time TBD";

  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getFocusRatingTone(value: number) {
  const n = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

  if (n >= 80) return "Great focus";
  if (n >= 55) return "Solid focus";
  if (n >= 25) return "Some focus";
  return "Low focus";
}

function formatJoinedSince(iso?: string | null) {
  const value = String(iso || "").trim();
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString(undefined, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

function getInitialLetter(name: string) {
  const value = String(name || "").trim();
  return (value[0] || "H").toUpperCase();
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

function SessionsDateGroupHeader({
  ymd,
  count,
}: {
  ymd: string;
  count: number;
}) {
  const meta = getDateGroupMeta(ymd);

  return (
    <div className="flex items-center gap-3 mb-4 md:mb-5">
      <div className="inline-flex items-center gap-2 rounded-full border border-[#DBD8D8] bg-[#F8F8F8] px-4 py-2">
        <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-[#606060]">
          {meta.label}
        </span>
        <span className="text-[#BDBDBD]">•</span>
        <span className="text-[13px] font-semibold text-brandBlack">
          {meta.pretty}
        </span>
      </div>

      <div className="hidden sm:block h-px flex-1 bg-[#EAEAEA]" />

      <div className="hidden md:inline-flex items-center rounded-full border border-[#EAEAEA] bg-white px-3 py-1 text-[12px] text-[#606060]">
        {count} {count === 1 ? "session" : "sessions"}
      </div>
    </div>
  );
}

function combineLocalDateTimeToISO(dateYMD: string, timeHHMM: string) {
  const d = new Date(`${dateYMD}T${timeHHMM}:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function buildBodySchedule(duration: 25 | 50) {
  const kind = duration === 25 ? "pomodoro" : "deep_work";

  return {
    kind: "body_session",
    preset: kind,
    timer: {
      phases: [{ name: "focus", minutes: duration, mode: kind }],
    },
  };
}


type SupportMySessionModalProps = {
  open: boolean;
  onClose: () => void;
  onSupport: () => void;
};

function SupportMySessionModal({
  open,
  onClose,
  onSupport,
}: SupportMySessionModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center px-4 py-6">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div
        className="
          relative w-full max-w-[460px]
          rounded-[28px]
          bg-white
          p-6 sm:p-7
          text-[#2F2F2F]
          shadow-[0_24px_80px_rgba(0,0,0,0.28)]
        "
        role="dialog"
        aria-modal="true"
        aria-label="Support MySession"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 text-[#8A8A8A] transition hover:text-[#2F2F2F]"
          aria-label="Close"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 6L18 18M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div className="pr-8">
          <div className="inline-flex rounded-full bg-[#F2F2F2] px-3 py-1 text-[12px] font-semibold text-[#555555]">
            Support the project
          </div>

          <h2 className="mt-4 text-[24px] font-bold leading-tight text-[#2F2F2F]">
            Help keep MySession running
          </h2>
        </div>

        <p className="mt-4 text-[15px] leading-6 text-[#666666]">
          MySession is maintained by Yaroslav and supported by people who use it regularly.
        </p>

        <p className="mt-3 text-[15px] leading-6 text-[#666666]">
          If this platform helps you focus, please consider subscribing. Your support helps cover hosting, video infrastructure, maintenance, and continued development.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onSupport}
            className="flex-1 rounded-full bg-[#2F2F2F] px-5 py-3.5 text-[15px] font-semibold text-white transition hover:opacity-90"
          >
            Support MySession
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#CAC3C3] bg-white px-5 py-3.5 text-[15px] font-semibold text-[#2F2F2F] transition hover:bg-[#F8F8F8]"
          >
            Maybe later
          </button>
        </div>
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
  const [activeBan, setActiveBan] = useState<ActiveBan | null>(null);
  const [banChecking, setBanChecking] = useState(false);

  const [sessionTypeTab, setSessionTypeTab] = useState<
    "group" | "infinite" | "body"
  >("group");

  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [currentProfile, setCurrentProfile] = useState<CurrentProfile | null>(
    null
  );
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  const [entitlementState, setEntitlementState] = useState<EntitlementState | null>(null);
  const [supportModalOpen, setSupportModalOpen] = useState(false);

  const [postSessionPrompt, setPostSessionPrompt] =
    useState<PostSessionPromptState>({
      open: false,
      sessionId: "",
      sessionTitle: "",
      hostId: "",
      hostName: "Host",
      hostAvatarUrl: "",
      hostBio: "",
      minutesSpent: 0,
      followerCount: 0,
      sessionsCount: 0,
      joinedSince: null,
    });

  const [postSessionRating, setPostSessionRating] = useState(0);
  const [postSessionFeedback, setPostSessionFeedback] = useState("");
  const [postSessionTechFeedback, setPostSessionTechFeedback] = useState("");
  const [postSessionSubmitting, setPostSessionSubmitting] = useState(false);
  const [postSessionSubmitted, setPostSessionSubmitted] = useState(false);

  const [postSessionFollowing, setPostSessionFollowing] = useState(false);
  const [postSessionFollowBusy, setPostSessionFollowBusy] = useState(false);

  const [postSessionNextSessions, setPostSessionNextSessions] = useState<
    PostSessionSessionOption[]
  >([]);
  const [postSessionBookingBusyId, setPostSessionBookingBusyId] = useState("");

  const checkSessionsPageBan = useCallback(async () => {
    if (!user?.id) {
      setActiveBan(null);
      return;
    }

    try {
      setBanChecking(true);
      const ban = await getCurrentUserActiveBan();
      setActiveBan(ban);
    } catch (e) {
      if (DEBUG) console.warn("[sessions-ban] active ban check failed:", e);
      setActiveBan(null);
    } finally {
      setBanChecking(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void checkSessionsPageBan();
  }, [checkSessionsPageBan]);

  useEffect(() => {
    if (!user?.id) {
      setEntitlementState(null);
      setSupportModalOpen(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const state = await loadEntitlementState();
        if (!cancelled) setEntitlementState(state);
      } catch (e) {
        if (DEBUG) console.warn("[sessions-support] entitlement load failed:", e);
        if (!cancelled) setEntitlementState(null);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    if (!entitlementState?.isLoggedIn) return;
    if (entitlementState.isUnlimited) return;

    const sessionsUsed = Number(entitlementState.usage?.sessions_count || 0);
    if (sessionsUsed < 5) return;

    const key = "mysession_support_modal_dismissed_at";
    const lastDismissed = Number(localStorage.getItem(key) || 0);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    if (lastDismissed && Date.now() - lastDismissed < sevenDaysMs) return;

    const timer = window.setTimeout(() => {
      setSupportModalOpen(true);
    }, 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [user?.id, entitlementState]);

  useEffect(() => {
    const onRefresh = () => {
      void checkSessionsPageBan();
    };

    window.addEventListener("mysession-ban-refresh", onRefresh);
    return () => window.removeEventListener("mysession-ban-refresh", onRefresh);
  }, [checkSessionsPageBan]);

  const showBanModal = useCallback(() => {
    if (activeBan) {
      return true;
    }

    void checkSessionsPageBan();
    return false;
  }, [activeBan, checkSessionsPageBan]);

  useEffect(() => {
    if (!howItWorksOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHowItWorksOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [howItWorksOpen]);

  const closePostSessionPrompt = useCallback(() => {
    setPostSessionPrompt({
      open: false,
      sessionId: "",
      sessionTitle: "",
      hostId: "",
      hostName: "Host",
      hostAvatarUrl: "",
      hostBio: "",
      minutesSpent: 0,
      followerCount: 0,
      sessionsCount: 0,
      joinedSince: null,
    });

    setPostSessionRating(0);
    setPostSessionFeedback("");
    setPostSessionTechFeedback("");
    setPostSessionSubmitting(false);
    setPostSessionSubmitted(false);
    setPostSessionFollowing(false);
    setPostSessionFollowBusy(false);
    setPostSessionNextSessions([]);
    setPostSessionBookingBusyId("");

    const clean = new URLSearchParams(searchParams);
    clean.delete("postSession");
    clean.delete("sessionId");
    clean.delete("sessionTitle");
    clean.delete("hostId");
    clean.delete("hostName");
    clean.delete("minutes");

    const nextQuery = clean.toString();
    navigate(nextQuery ? `/sessions?${nextQuery}` : "/sessions", {
      replace: true,
    });
  }, [navigate, searchParams]);

  useEffect(() => {
    const tab = (searchParams.get("tab") || "").toLowerCase();

    if (tab === "group" || tab === "infinite" || tab === "body") {
      setSessionTypeTab(tab as "group" | "infinite" | "body");

      if (DEBUG) console.log("[DEBUG Sessions] Tab from query:", tab);

      if (tab === "body") setDateFilter((prev) => prev || todayLocalYMD());
      if (tab === "infinite") setDateFilter(null);
    }
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get("postSession") !== "1") return;
    if (!user?.id) return;

    const sessionId = String(searchParams.get("sessionId") || "").trim();
    const sessionTitle = String(searchParams.get("sessionTitle") || "").trim();
    const hostId = String(searchParams.get("hostId") || "").trim();
    const hostName = String(searchParams.get("hostName") || "").trim();
    const minutesSpent = Math.max(0, Number(searchParams.get("minutes") || 0) || 0);

    if (!sessionId) return;

    let cancelled = false;

    const run = async () => {
      let finalTitle = sessionTitle || "Session";
      let finalHostId = hostId;
      let finalHostName = hostName || "Host";
      let finalHostAvatarUrl = "";
      let finalHostBio = "";
      let finalFollowerCount = 0;
      let finalSessionsCount = 0;
      let finalJoinedSince: string | null = null;

      try {
        const { data, error } = await supabase
          .from("sessions")
          .select(
            `
            id,
            title,
            host_id,
            host_name,
            created_at,
            host_profile:profiles!sessions_host_id_fkey (
              id,
              full_name,
              avatar_url,
              bio,
              created_at
            )
          `
          )
          .eq("id", sessionId)
          .maybeSingle();

        if (error) throw error;

        const row = data as any;

        if (row?.title) finalTitle = String(row.title);
        if (row?.host_id) finalHostId = String(row.host_id);

        const hp = row?.host_profile;
        if (hp?.full_name) finalHostName = String(hp.full_name);
        else if (row?.host_name) finalHostName = String(row.host_name);

        if (hp?.avatar_url) finalHostAvatarUrl = String(hp.avatar_url);
        if (hp?.bio) finalHostBio = String(hp.bio);
        if (hp?.created_at) finalJoinedSince = String(hp.created_at);

        if (finalHostId) {
          const { count: followersCount } = await supabase
            .from("host_followers")
            .select("*", { count: "exact", head: true })
            .eq("host_user_id", finalHostId);

          finalFollowerCount = Number(followersCount || 0);

          const { count: hostedCount } = await supabase
            .from("sessions")
            .select("*", { count: "exact", head: true })
            .eq("host_id", finalHostId);

          finalSessionsCount = Number(hostedCount || 0);
        }
      } catch (e) {
        if (DEBUG) console.warn("[post-session] session/host load failed:", e);
      }

      if (!cancelled) {
        setPostSessionPrompt({
          open: true,
          sessionId,
          sessionTitle: finalTitle,
          hostId: finalHostId,
          hostName: finalHostName,
          hostAvatarUrl: finalHostAvatarUrl,
          hostBio: finalHostBio,
          minutesSpent,
          followerCount: finalFollowerCount,
          sessionsCount: finalSessionsCount,
          joinedSince: finalJoinedSince,
        });
      }

      if (finalHostId && !cancelled) {
        try {
          const { data: followRow } = await supabase
            .from("host_followers")
            .select("host_user_id")
            .eq("host_user_id", finalHostId)
            .eq("follower_user_id", user.id)
            .maybeSingle();

          if (!cancelled) setPostSessionFollowing(!!followRow);
        } catch (e) {
          if (DEBUG) console.warn("[post-session] follow state load failed:", e);
        }

        try {
          const { data: nextRows, error: nextErr } = await supabase
            .from("sessions")
            .select("id, title, start_time, duration_minutes, host_id")
            .eq("host_id", finalHostId)
            .gte("start_time", new Date().toISOString())
            .order("start_time", { ascending: true })
            .limit(3);

          if (nextErr) throw nextErr;

          const filtered = ((nextRows || []) as any[]).filter(
            (sessionRow) => String(sessionRow.id) !== sessionId
          );

          if (!cancelled) setPostSessionNextSessions(filtered);
        } catch (e) {
          if (DEBUG) console.warn("[post-session] next sessions load failed:", e);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [searchParams, user?.id]);

  useEffect(() => {
    if (sessionTypeTab === "body" && !dateFilter) {
      setDateFilter(todayLocalYMD());
    }
  }, [sessionTypeTab, dateFilter]);

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

        setCurrentProfile((data as CurrentProfile) || null);
      } catch (e) {
        if (DEBUG) console.warn("[DEBUG Sessions] profile load failed:", e);
        setCurrentProfile(null);
      }
    };

    void run();
  }, [user?.id]);

  const fetchLiveCounts = useCallback(async (sessionIds: string[]) => {
    const ids = (sessionIds || []).filter(
      (x): x is string => typeof x === "string" && x.length > 0
    );

    if (!ids.length) return;

    try {
      const { data, error } = await supabase.rpc("get_live_counts", {
        p_session_ids: ids,
        p_ttl_seconds: 90,
      });

      if (error) throw error;

      const map = new Map<string, number>();

      for (const row of (data || []) as any[]) {
        if (row?.session_id) {
          map.set(String(row.session_id), Number(row.live_count) || 0);
        }
      }

      if (DEBUG) {
        console.log(
          "[DEBUG Sessions] live_count map:",
          Object.fromEntries(map.entries())
        );
      }

      setSessions((prev) =>
        prev.map((s) => ({
          ...s,
          live_count: map.get(String(s.id)) ?? s.live_count ?? 0,
        }))
      );
    } catch (e) {
      if (DEBUG) console.warn("[DEBUG Sessions] live counts error:", e);
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    if (DEBUG) console.log("[DEBUG Sessions] Fetch sessions…");

    try {
      setIsLoading(true);

      /**
       * Public-safe query.
       *
       * Do NOT nested-select session_bookings/profiles/email here.
       * If anon RLS blocks any nested relation, the whole session list can fail.
       */
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
          created_at,
          description,
          custom_slug,
          schedule,
          session_format_type,
          is_silent,
          max_participants
        `
        )
        .order("start_time", { ascending: true });

      if (error) throw error;

      const rows = (data || []) as unknown as SessionWithRelations[];

      if (DEBUG) console.log("[DEBUG Sessions] Loaded public sessions:", rows);

      const ids = rows
        .map((s) => String((s as any).id || ""))
        .filter((x) => x.length > 0);

      /**
       * Optional enrichment.
       *
       * If anon RLS blocks session_bookings/profiles, we do NOT fail the page.
       * Session cards still render; booked avatars/count just won't be enriched.
       */
      let bookingsBySessionId = new Map<string, SessionBookingRow[]>();

      if (ids.length) {
        try {
          const { data: bookingsData, error: bookingsError } = await supabase
            .from("public_session_bookings")
            .select("session_id, user_id, full_name, avatar_url")
            .in("session_id", ids);

          if (bookingsError) throw bookingsError;

          for (const row of (bookingsData || []) as any[]) {
            const sid = String(row?.session_id || "");
            if (!sid) continue;

            const prev = bookingsBySessionId.get(sid) || [];

            prev.push({
              user_id: String(row?.user_id || ""),
              profiles: {
                id: String(row?.user_id || ""),
                full_name: row?.full_name || null,
                avatar_url: row?.avatar_url || null,
              },
            });

            bookingsBySessionId.set(sid, prev);
          }
        } catch (bookingsErr) {
          if (DEBUG) {
            console.warn(
              "[DEBUG Sessions] Optional bookings load failed. Public sessions will still render:",
              bookingsErr
            );
          }

          bookingsBySessionId = new Map();
        }
      }

      const hydratedRows = rows.map((s) => ({
        ...s,
        session_bookings: bookingsBySessionId.get(String(s.id)) || [],
      }));

      setSessions(hydratedRows);

      await fetchLiveCounts(ids);
    } catch (err) {
      console.error("[DEBUG Sessions] FAILED LOADING:", err);
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, [fetchLiveCounts]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    modal.setOnCreatedCallback(fetchSessions);

    if (DEBUG) console.log("[DEBUG Sessions] Modal callback set");
  }, [modal, fetchSessions]);

  const sessionIds = useMemo(
    () =>
      sessions
        .map((s) => String((s as any).id || ""))
        .filter((x) => x.length > 0),
    [sessions]
  );

  useEffect(() => {
    if (!sessionIds.length) return;

    const run = () => {
      if (document.visibilityState !== "visible") return;
      void fetchLiveCounts(sessionIds);
    };

    const t = window.setInterval(run, 60_000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        run();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [sessionIds, fetchLiveCounts]);

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

  const isAllDatesMode =
    sessionTypeTab === "group" && isAllDatesValue(dateFilter);

  const visibleSessions = useMemo(() => {
    if (sessionTypeTab === "infinite") return typeFilteredSessions;
    if (isAllDatesValue(dateFilter)) return typeFilteredSessions;

    return typeFilteredSessions.filter((s) => {
      if (!s.start_time) return false;

      const ymd = toLocalYMDFromISO(s.start_time);
      return ymd === dateFilter;
    });
  }, [typeFilteredSessions, dateFilter, sessionTypeTab]);

  const groupedVisibleSessions = useMemo(() => {
    if (!isAllDatesMode) return [];

    const map = new Map<string, SessionWithRelations[]>();

    for (const s of visibleSessions) {
      const key = s.start_time
        ? toLocalYMDFromISO(s.start_time) || "__undated__"
        : "__undated__";

      const prev = map.get(key) || [];
      prev.push(s);
      map.set(key, prev);
    }

    return Array.from(map.entries()).map(([ymd, items]) => ({
      ymd,
      sessions: items,
    }));
  }, [visibleSessions, isAllDatesMode]);

  const join = (id: string) => {
    const next = `/room-livekit/${id}`;

    if (showBanModal()) return;

    if (!user) {
      // RoomPageLiveKit now has in-room auth, so guests should go directly to the room.
      return navigate(next);
    }

    navigate(next);
  };

  const book = async (id: string) => {
    if (showBanModal()) return;

    if (!user) {
      return navigate(`/login?next=${encodeURIComponent("/sessions")}`);
    }

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
    if (!user) {
      return navigate(`/login?next=${encodeURIComponent("/sessions")}`);
    }

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
    if (!user) {
      return navigate(`/login?next=${encodeURIComponent("/sessions")}`);
    }

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
      description?: string | null;
      schedule?: any;
      stages_json?: any;
      duration_minutes?: number | null;
    }
  ) => {
    if (!user) {
      return navigate(`/login?next=${encodeURIComponent("/sessions")}`);
    }

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
    const link = `${window.location.origin}/room-livekit/${sessionId}`;

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
    if (showBanModal()) return;

    if (!user) {
      return navigate(`/login?next=${encodeURIComponent("/sessions")}`);
    }

    modal.open();
  };

  const createBodySession = async (payload: {
    duration: 25 | 50;
    dateYMD: string;
    timeHHMM: string;
  }) => {
    if (showBanModal()) return;

    if (!user?.id) {
      return navigate(`/login?next=${encodeURIComponent("/sessions?tab=body")}`);
    }

    const iso = combineLocalDateTimeToISO(payload.dateYMD, payload.timeHHMM);
    if (!iso) throw new Error("Invalid date/time");

    const hostName =
      (currentProfile?.full_name || "").trim() ||
      (currentProfile?.email || "").trim() ||
      ((user as any)?.email || "").trim() ||
      "Host";

    const title = payload.duration === 25 ? "25min session" : "50min session";

    const { error } = await supabase.from("sessions").insert({
      title,
      host_id: user.id,
      host_name: hostName,
      duration_minutes: payload.duration,
      format: "body",
      session_format_type: "body",
      start_time: iso,
      status: "planned",
      is_silent: false,
      max_participants: 3,
      schedule: buildBodySchedule(payload.duration),
    });

    if (error) {
      console.error("[DEBUG Sessions] create body session error:", error);
      throw error;
    }

    await fetchSessions();
  };

  const submitPostSessionFeedback = useCallback(async () => {
    if (!user?.id) {
      return navigate(`/login?next=${encodeURIComponent("/sessions")}`);
    }

    if (!postSessionPrompt.sessionId) return;

    setPostSessionSubmitting(true);

    try {
      const general = String(postSessionFeedback || "").trim();
      const tech = String(postSessionTechFeedback || "").trim();

      const combinedFeedback = [
        general ? `Session feedback:\n${general}` : "",
        tech ? `Technical feedback:\n${tech}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const payload = {
        session_id: postSessionPrompt.sessionId,
        user_id: user.id,
        host_id: postSessionPrompt.hostId || null,
        rating: Math.max(0, Math.min(100, Math.round(Number(postSessionRating) || 0))),
        feedback_text: combinedFeedback,
        minutes_in_room: Math.max(0, Number(postSessionPrompt.minutesSpent || 0)),
      };

      const { error } = await supabase.from("session_feedback").insert(payload);

      if (error) throw error;

      setPostSessionSubmitted(true);
    } catch (e) {
      console.error("[post-session] submit failed:", e);
      alert("Failed to submit feedback. Please try again.");
    } finally {
      setPostSessionSubmitting(false);
    }
  }, [
    navigate,
    user?.id,
    postSessionPrompt,
    postSessionRating,
    postSessionFeedback,
    postSessionTechFeedback,
  ]);

  const togglePostSessionFollowHost = useCallback(async () => {
    if (!user?.id) {
      return navigate(`/login?next=${encodeURIComponent("/sessions")}`);
    }

    const hostId = String(postSessionPrompt.hostId || "").trim();
    if (!hostId || hostId === user.id) return;

    setPostSessionFollowBusy(true);

    try {
      if (postSessionFollowing) {
        const { error } = await supabase
          .from("host_followers")
          .delete()
          .eq("host_user_id", hostId)
          .eq("follower_user_id", user.id);

        if (error) throw error;

        setPostSessionFollowing(false);
        setPostSessionPrompt((prev) => ({
          ...prev,
          followerCount: Math.max(0, Number(prev.followerCount || 0) - 1),
        }));
      } else {
        const { error } = await supabase.from("host_followers").insert({
          host_user_id: hostId,
          follower_user_id: user.id,
        });

        if (error) throw error;

        setPostSessionFollowing(true);
        setPostSessionPrompt((prev) => ({
          ...prev,
          followerCount: Number(prev.followerCount || 0) + 1,
        }));
      }
    } catch (e) {
      console.error("[post-session] follow host failed:", e);
      alert("Follow failed. Please try again.");
    } finally {
      setPostSessionFollowBusy(false);
    }
  }, [navigate, user?.id, postSessionPrompt.hostId, postSessionFollowing]);

  const bookPostSessionNextSession = useCallback(
    async (nextSessionId: string) => {
      if (!user?.id) {
        return navigate(`/login?next=${encodeURIComponent("/sessions")}`);
      }

      const sid = String(nextSessionId || "").trim();
      if (!sid) return;

      setPostSessionBookingBusyId(sid);

      try {
        const { error } = await supabase.from("session_bookings").insert({
          session_id: sid,
          user_id: user.id,
        });

        if (error) throw error;

        await fetchSessions();

        setPostSessionNextSessions((prev) => prev.filter((sessionRow) => sessionRow.id !== sid));
      } catch (e) {
        console.error("[post-session] book next session failed:", e);
        alert("Could not book this session. Maybe it is already booked.");
      } finally {
        setPostSessionBookingBusyId("");
      }
    },
    [navigate, user?.id, fetchSessions]
  );

  const closeSupportModal = useCallback(() => {
    localStorage.setItem(
      "mysession_support_modal_dismissed_at",
      Date.now().toString()
    );
    setSupportModalOpen(false);
  }, []);

  const goToPricingFromSupportModal = useCallback(() => {
    localStorage.setItem(
      "mysession_support_modal_dismissed_at",
      Date.now().toString()
    );
    setSupportModalOpen(false);
    navigate("/pricing");
  }, [navigate]);

  const topPad =
    sessionTypeTab === "group"
      ? "pt-[100px] pb-[50px]"
      : "pt-[56px] pb-[18px]";

  const renderSessionCard = (s: SessionWithRelations) => (
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
            email: (currentProfile?.email ||
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
  );

  return (
    <div className="min-h-screen bg-white text-brandBlack font-inter">
      {activeBan ? (
        <div className="mx-auto mt-4 max-w-[1180px] rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-800">
          Access to joining sessions is restricted while your ban is active. Click any Join/Create action to view details.
        </div>
      ) : null}

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
                  setDateFilter((prev) => prev || todayLocalYMD());
                }
              }}
            />
          </div>

          {sessionTypeTab === "body" ? (
            <div className="w-full max-w-[980px] mx-auto">
              <BodyTriplingBody
                sessions={visibleSessions}
                isLoading={isLoading}
                dateFilter={dateFilter || todayLocalYMD()}
                onDateChange={setDateFilter}
                userId={user?.id}
                onJoin={join}
                onBook={book}
                onCancelBooking={cancel}
                onCreateBodySession={createBodySession}
              />
            </div>
          ) : (
            <>
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
                      {dateFilter &&
                        !isAllDatesValue(dateFilter) &&
                        sessionTypeTab === "group"
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
                ) : isAllDatesMode ? (
                  <div className="space-y-8 md:space-y-10">
                    {groupedVisibleSessions.map((group) => (
                      <section key={group.ymd}>
                        <SessionsDateGroupHeader
                          ymd={group.ymd}
                          count={group.sessions.length}
                        />

                        <div className="space-y-3 md:space-y-6">
                          {group.sessions.map(renderSessionCard)}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3 md:space-y-6">
                    {visibleSessions.map(renderSessionCard)}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827] mb-3">
                      1) Choose a session
                    </div>
                    <ul className="text-[13px] text-[#111827]/80 leading-relaxed list-disc pl-5 space-y-2">
                      <li>
                        Pick a tab: <b>Group</b>, <b>Infinite</b> (24/7), or{" "}
                        <b>body</b>.
                      </li>
                      <li>
                        Group/body sessions are scheduled (date/time). Infinite
                        rooms are always open.
                      </li>
                      <li>
                        You can <b>Book session</b> (optional) to save it — or
                        just join.
                      </li>
                    </ul>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827] mb-3">
                      2) Join & set up
                    </div>
                    <ul className="text-[13px] text-[#111827]/80 leading-relaxed list-disc pl-5 space-y-2">
                      <li>
                        Click <b>Join session</b>.
                      </li>
                      <li>
                        Turn mic/cam on/off as you prefer. Screen-share is
                        optional.
                      </li>
                      <li>
                        You’ll see the session flow: timer/stages depending on
                        room type.
                      </li>
                    </ul>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827] mb-3">
                      3) Follow the workflow
                    </div>
                    <ul className="text-[13px] text-[#111827]/80 leading-relaxed list-disc pl-5 space-y-2">
                      <li>
                        Use stage prompts to stay aligned: check-in and
                        intentions.
                      </li>
                      <li>
                        During <b>Focus</b>, work silently or lightly co-work.
                      </li>
                      <li>
                        During <b>Break</b>, rest/reset. Then go back to focus.
                      </li>
                    </ul>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827] mb-3">
                      4) Finish & leave
                    </div>
                    <ul className="text-[13px] text-[#111827]/80 leading-relaxed list-disc pl-5 space-y-2">
                      <li>
                        Wrap up at the end or anytime in 24/7 focus rooms.
                      </li>
                      <li>
                        Quick self-reflection: what you did and what’s next.
                      </li>
                      <li>Leave the session — your work is done.</li>
                    </ul>
                  </div>
                </div>

                <div className="my-7 border-t border-[#ECECEC]" />

                <div className="flex items-center justify-between gap-4">
                  <h4 className="text-[14px] sm:text-[15px] font-semibold text-[#111827]">
                    Stages glossary
                  </h4>
                  <span className="text-[12px] text-[#111827]/60">
                    Some rooms may hide stages — e.g. silent rooms.
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827]">
                      Check-in
                    </div>
                    <p className="text-[13px] text-[#111827]/80 leading-relaxed mt-2">
                      Quick verbal sync: what are you working on, and are there
                      any blockers?
                    </p>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827]">
                      Intentions
                    </div>
                    <p className="text-[13px] text-[#111827]/80 leading-relaxed mt-2">
                      You state your goal for the next focus block. Keep it
                      specific: 1–3 concrete outcomes.
                    </p>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827]">
                      Focus
                    </div>
                    <p className="text-[13px] text-[#111827]/80 leading-relaxed mt-2">
                      The working block. Usually quiet. Your only job is to do
                      the task.
                    </p>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827]">
                      Break
                    </div>
                    <p className="text-[13px] text-[#111827]/80 leading-relaxed mt-2">
                      Rest/reset: stand up, water, stretch. Avoid doom-scrolling
                      if you can.
                    </p>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827]">
                      Custom block
                    </div>
                    <p className="text-[13px] text-[#111827]/80 leading-relaxed mt-2">
                      A flexible stage you can name anything: Reading,
                      Planning, Admin, etc.
                    </p>
                  </div>

                  <div className="rounded-[18px] border border-[#E6E6E6] p-5">
                    <div className="text-[13px] font-semibold text-[#111827]">
                      Outro / Wrap-up
                    </div>
                    <p className="text-[13px] text-[#111827]/80 leading-relaxed mt-2">
                      Quick closure: what you finished, what’s next, and one
                      takeaway.
                    </p>
                  </div>
                </div>

                <div className="mt-7 rounded-[18px] border border-[#E6E6E6] bg-[#F7F7F7] p-5">
                  <div className="text-[13px] font-semibold text-[#111827]">
                    Pro tip
                  </div>
                  <p className="text-[13px] text-[#111827]/80 leading-relaxed mt-2">
                    If you’re joining a <b>Silent</b> room: keep mic off, use
                    the stage timer as guidance, and focus. No pressure to talk.
                  </p>
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

      <SupportMySessionModal
        open={supportModalOpen}
        onClose={closeSupportModal}
        onSupport={goToPricingFromSupportModal}
      />

      <ActiveBanModal
        open={!!activeBan}
        ban={activeBan}
        onBackToSessions={() => navigate("/sessions", { replace: true })}
      />

      {postSessionPrompt.open && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px] animate-[fadeIn_180ms_ease-out]"
            onClick={closePostSessionPrompt}
          />

          <div className="relative w-full max-w-[440px] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-[28px] bg-[#F5F5F5] text-[#2F2F2F] shadow-[0_24px_80px_rgba(0,0,0,0.28)] animate-[postSessionIn_220ms_ease-out]">
            <button
              type="button"
              onClick={closePostSessionPrompt}
              className="absolute right-5 top-5 z-10 text-[#6B7280] hover:text-[#2F2F2F] transition"
              aria-label="Close"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6L18 18M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            <div className="px-6 pb-7 pt-7">
              <div className="flex flex-col items-center text-center">
                <button
                  type="button"
                  onClick={() => {
                    if (postSessionPrompt.hostId) {
                      window.open(`/profile/${postSessionPrompt.hostId}`, "_blank");
                    }
                  }}
                  disabled={!postSessionPrompt.hostId}
                  className="h-[86px] w-[86px] overflow-hidden rounded-full bg-[#D9D9D9] transition hover:scale-[1.02] disabled:cursor-default disabled:hover:scale-100"
                  title={postSessionPrompt.hostId ? "Open host profile" : undefined}
                >
                  {postSessionPrompt.hostAvatarUrl ? (
                    <img
                      src={postSessionPrompt.hostAvatarUrl}
                      alt={postSessionPrompt.hostName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[28px] font-semibold text-[#2F2F2F]">
                      {getInitialLetter(postSessionPrompt.hostName)}
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (postSessionPrompt.hostId) {
                      window.open(`/profile/${postSessionPrompt.hostId}`, "_blank");
                    }
                  }}
                  disabled={!postSessionPrompt.hostId}
                  className="mt-4 text-[19px] font-semibold leading-none text-[#2F2F2F] transition hover:opacity-70 disabled:cursor-default disabled:hover:opacity-100"
                  title={postSessionPrompt.hostId ? "Open host profile" : undefined}
                >
                  {postSessionPrompt.hostName}
                </button>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[13px] text-[#666666]">
                  <div className="flex items-center gap-1.5">
                    <img
                      src="/icons/session_count.svg"
                      alt=""
                      className="h-[14px] w-[14px]"
                      draggable={false}
                    />
                    <span>{Number(postSessionPrompt.sessionsCount || 0)} sessions</span>
                  </div>

                  <span className="text-[#B8B8B8]">|</span>

                  <div className="flex items-center gap-1.5">
                    <img
                      src="/icons/followers_profile.svg"
                      alt=""
                      className="h-[14px] w-[14px]"
                      draggable={false}
                    />
                    <span>{Number(postSessionPrompt.followerCount || 0)} Followers</span>
                  </div>

                  <span className="text-[#B8B8B8]">|</span>

                  <div className="flex items-center gap-1.5">
                    <img
                      src="/icons/date-profile.svg"
                      alt=""
                      className="h-[14px] w-[14px]"
                      draggable={false}
                    />
                    <span>Since {formatJoinedSince(postSessionPrompt.joinedSince)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-7">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[16px] font-semibold text-[#2F2F2F]">
                    Thanks for joining
                  </div>

                  <button
                    type="button"
                    onClick={() => void togglePostSessionFollowHost()}
                    disabled={postSessionFollowBusy || postSessionPrompt.hostId === user?.id}
                    className={`shrink-0 rounded-full border px-3.5 py-2 text-[12px] font-semibold transition disabled:opacity-60 ${postSessionFollowing
                      ? "border-[#2F2F2F] bg-[#2F2F2F] text-white"
                      : "border-[#CAC3C3] bg-white text-[#2F2F2F] hover:bg-[#F8F8F8]"
                      }`}
                  >
                    {postSessionFollowBusy
                      ? "Saving..."
                      : postSessionFollowing
                        ? "Following"
                        : "Follow host"}
                  </button>
                </div>

                <div className="mt-2 text-[14px] leading-[1.6] text-[#666666]">
                  You spent{" "}
                  <span className="font-semibold text-[#2F2F2F]">
                    {postSessionPrompt.minutesSpent || 0} minutes
                  </span>{" "}
                  in{" "}
                  <span className="font-semibold text-[#2F2F2F]">
                    {postSessionPrompt.sessionTitle || "this session"}
                  </span>
                  .
                </div>
              </div>

              <div className="mt-7">
                <div className="text-[16px] font-semibold text-[#2F2F2F]">
                  Current & upcoming sessions:
                </div>

                <div className="mt-3 flex flex-col gap-3">
                  {postSessionNextSessions.length > 0 ? (
                    postSessionNextSessions.slice(0, 1).map((sessionRow) => (
                      <div
                        key={sessionRow.id}
                        className="rounded-[12px] bg-[#ECECEC] px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[14px] leading-[1.35] text-[#3A3A3A]">
                              {sessionRow.title || "Focus session"}
                            </div>
                          </div>

                          <div className="shrink-0 text-right text-[13px] leading-[1.35] text-[#4B4B4B]">
                            <div className="text-[11px] uppercase tracking-[0.08em] text-[#888888]">
                              Starts
                            </div>
                            <div className="font-semibold">
                              {formatPostSessionTime(sessionRow.start_time)}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void bookPostSessionNextSession(sessionRow.id)}
                            disabled={postSessionBookingBusyId === sessionRow.id}
                            className="rounded-full bg-[#2F2F2F] px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-60"
                          >
                            {postSessionBookingBusyId === sessionRow.id ? "Booking..." : "Book next"}
                          </button>

                          <button
                            type="button"
                            onClick={() => window.open(`/room-livekit/${sessionRow.id}`, "_blank")}
                            className="rounded-full border border-[#CAC3C3] bg-white px-4 py-2 text-[13px] font-medium text-[#2F2F2F] transition hover:bg-[#F7F7F7]"
                          >
                            Open
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[12px] bg-[#ECECEC] px-4 py-4 text-[14px] text-[#666666]">
                      No upcoming sessions yet.
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[15px] font-semibold text-[#2F2F2F]">
                      Rate your focus in this session
                    </div>
                    <div className="mt-1 text-[12px] leading-[1.5] text-[#777777]">
                      Not the host, not the room — just your own focus.
                    </div>
                  </div>

                  <div className="shrink-0 rounded-full bg-[#2F2F2F] px-3 py-1.5 text-[13px] font-bold text-white">
                    {Math.max(0, Math.min(100, Math.round(Number(postSessionRating) || 0)))}%
                  </div>
                </div>

                <div className="mt-4">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.max(0, Math.min(100, Math.round(Number(postSessionRating) || 0)))}
                    onChange={(e) => {
                      const next = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
                      setPostSessionRating(next);
                    }}
                    className="w-full accent-[#2F2F2F]"
                    aria-label="Rate your focus from 0 to 100 percent"
                  />

                  <div className="mt-2 flex items-center justify-between text-[12px] text-[#777777]">
                    <span>0%</span>
                    <span className="font-semibold text-[#2F2F2F]">
                      {getFocusRatingTone(postSessionRating)}
                    </span>
                    <span>100%</span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-5 gap-2">
                  {[20, 40, 60, 80, 100].map((ratingValue) => {
                    const active =
                      Math.max(0, Math.min(100, Math.round(Number(postSessionRating) || 0))) === ratingValue;

                    return (
                      <button
                        key={ratingValue}
                        type="button"
                        onClick={() => setPostSessionRating(ratingValue)}
                        className={`h-9 rounded-full border text-[12px] font-semibold transition ${active
                          ? "border-[#2F2F2F] bg-[#2F2F2F] text-white"
                          : "border-[#CAC3C3] bg-white text-[#666666] hover:bg-[#F0F0F0]"
                          }`}
                      >
                        {ratingValue}%
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6">
                <textarea
                  value={postSessionFeedback}
                  onChange={(e) => setPostSessionFeedback(e.target.value)}
                  placeholder="Session feedback"
                  className="min-h-[88px] w-full resize-none rounded-[14px] border border-[#CAC3C3] bg-white px-4 py-3 text-[14px] text-[#2F2F2F] outline-none placeholder:text-[#999999] focus:border-[#2F2F2F]"
                />

                <textarea
                  value={postSessionTechFeedback}
                  onChange={(e) => setPostSessionTechFeedback(e.target.value)}
                  placeholder="Technical feedback (optional)"
                  className="mt-3 min-h-[88px] w-full resize-none rounded-[14px] border border-[#CAC3C3] bg-white px-4 py-3 text-[14px] text-[#2F2F2F] outline-none placeholder:text-[#999999] focus:border-[#2F2F2F]"
                />
              </div>

              <div className="mt-6 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => void submitPostSessionFeedback()}
                  disabled={postSessionSubmitting || postSessionSubmitted}
                  className="w-full rounded-full bg-[#2F2F2F] px-6 py-4 text-[18px] font-semibold text-white transition hover:opacity-95 disabled:opacity-60"
                >
                  {postSessionSubmitted
                    ? "Feedback sent"
                    : postSessionSubmitting
                      ? "Sending..."
                      : "Submit feedback"}
                </button>

                <button
                  type="button"
                  onClick={closePostSessionPrompt}
                  className="w-full rounded-full border border-[#CAC3C3] bg-white px-6 py-3 text-[14px] font-medium text-[#2F2F2F] transition hover:bg-[#F8F8F8]"
                >
                  Skip for now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SessionsPage;