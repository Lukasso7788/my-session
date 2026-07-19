const DEBUG = false;

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SessionTypeSwitcher } from "../components/SessionTypeSwitcher";
import SessionCard from "../components/SessionCard";
import ActiveBanModal from "../components/ActiveBanModal";
import SupportMySessionModal from "../components/SupportMySessionModal";
import HostSessionPromptModal, { type HostPromptKind } from "../components/HostSessionPromptModal";
import CommunityPromptModal from "../components/CommunityPromptModal";
import { SessionsDateFilter } from "../components/SessionsDateFilter";
import BodyTriplingBody from "../components/body/BodyTriplingBody";
import { BodyTriplingIntro } from "../components/body/BodyTriplingIntro";
import { supabase } from "../lib/supabase";
import { getCurrentUserActiveBan, type ActiveBan } from "../lib/bans";
import { loadEntitlementState, type EntitlementState } from "../lib/entitlements";
import { PRICING } from "../lib/billing";
import { PAYWALL_ENABLED } from "../lib/flags";
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
  created_at?: string | null;
  booked_start_time?: string | null;
  booked_end_time?: string | null;
};

type BookSessionOptions = {
  booked_start_time?: string | null;
  booked_end_time?: string | null;
  booking_note?: string | null;
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
  is_private?: boolean;

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

type HostPromptStats = {
  hostedTotal: number;
  upcomingHosted: number;
};

const COMMUNITY_WHATSAPP_URL = "https://chat.whatsapp.com/JjoQhL64NOMITOi7mrG6EC";
const COMMUNITY_DISCORD_URL = "https://discord.gg/j42NkFmmEj";


const COMMUNITY_PROMPT_DISMISSED_KEY = "mysession_community_prompt_dismissed_at";
const COMMUNITY_PROMPT_JOINED_KEY = "mysession_community_prompt_joined_at";

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


const SESSIONS_BASE_TIMEOUT_MS = 12_000;
const SESSIONS_ENRICHMENT_TIMEOUT_MS = 10_000;

function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutId: number | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label}_timeout`));
    }, timeoutMs);
  });

  return Promise.race([
    Promise.resolve(promise),
    timeoutPromise,
  ]).finally(() => {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  });
}


export function SessionsPage() {
  const navigate = useNavigate();
  const modal = useCreateSessionModal();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const [sessions, setSessions] = useState<SessionWithRelations[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionsLoadError, setSessionsLoadError] = useState<string | null>(null);

  const sessionsFetchGenerationRef = useRef(0);
  const hasLoadedSessionsOnceRef = useRef(false);

  const [activeBan, setActiveBan] = useState<ActiveBan | null>(null);
  const [banChecking, setBanChecking] = useState(false);

  const [sessionTypeTab, setSessionTypeTab] = useState<
    "group" | "infinite" | "body"
  >("infinite");

  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [currentProfile, setCurrentProfile] = useState<CurrentProfile | null>(
    null
  );

  const [entitlementState, setEntitlementState] = useState<EntitlementState | null>(null);
  const [lifetimeSessionsCount, setLifetimeSessionsCount] = useState<number | null>(null);
  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const [hostPromptStats, setHostPromptStats] = useState<HostPromptStats | null>(null);
  const [hostPromptOpen, setHostPromptOpen] = useState(false);
  const [hostPromptKind, setHostPromptKind] = useState<HostPromptKind>("never_hosted");
  const [communityPromptOpen, setCommunityPromptOpen] = useState(false);

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
      setLifetimeSessionsCount(null);
      setSupportModalOpen(false);
      setHostPromptStats(null);
      setHostPromptOpen(false);
      setCommunityPromptOpen(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      const nowIso = new Date().toISOString();

      try {
        const [
          stateResult,
          lifetimeCountResult,
          hostedTotalResult,
          upcomingHostedResult,
        ] = await Promise.allSettled([
          loadEntitlementState(),
          supabase
            .from("session_attendance")
            .select("session_id", { count: "exact", head: true })
            .eq("user_id", user.id),
          supabase
            .from("sessions")
            .select("id", { count: "exact", head: true })
            .eq("host_id", user.id),
          supabase
            .from("sessions")
            .select("id", { count: "exact", head: true })
            .eq("host_id", user.id)
            .gte("start_time", nowIso),
        ]);

        if (cancelled) return;

        if (stateResult.status === "fulfilled") {
          setEntitlementState(stateResult.value);
        } else {
          if (DEBUG) {
            console.warn(
              "[sessions-support] entitlement load failed:",
              stateResult.reason
            );
          }
          setEntitlementState(null);
        }

        if (lifetimeCountResult.status === "fulfilled") {
          const { count, error } = lifetimeCountResult.value;

          if (error) {
            if (DEBUG) {
              console.warn(
                "[sessions-support] lifetime session count failed:",
                error
              );
            }
            setLifetimeSessionsCount(null);
          } else {
            setLifetimeSessionsCount(Number(count || 0));
          }
        } else {
          if (DEBUG) {
            console.warn(
              "[sessions-support] lifetime session count crashed:",
              lifetimeCountResult.reason
            );
          }
          setLifetimeSessionsCount(null);
        }

        let hostedTotal = 0;
        let upcomingHosted = 0;

        if (hostedTotalResult.status === "fulfilled") {
          const { count, error } = hostedTotalResult.value;

          if (error) {
            if (DEBUG) {
              console.warn("[sessions-host-prompt] hosted total count failed:", error);
            }
          } else {
            hostedTotal = Number(count || 0);
          }
        } else if (DEBUG) {
          console.warn(
            "[sessions-host-prompt] hosted total count crashed:",
            hostedTotalResult.reason
          );
        }

        if (upcomingHostedResult.status === "fulfilled") {
          const { count, error } = upcomingHostedResult.value;

          if (error) {
            if (DEBUG) {
              console.warn("[sessions-host-prompt] upcoming hosted count failed:", error);
            }
          } else {
            upcomingHosted = Number(count || 0);
          }
        } else if (DEBUG) {
          console.warn(
            "[sessions-host-prompt] upcoming hosted count crashed:",
            upcomingHostedResult.reason
          );
        }

        setHostPromptStats({
          hostedTotal,
          upcomingHosted,
        });
      } catch (e) {
        if (DEBUG) console.warn("[sessions-support] load failed:", e);
        if (!cancelled) {
          setEntitlementState(null);
          setLifetimeSessionsCount(null);
          setHostPromptStats(null);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!PAYWALL_ENABLED) return;
    if (!user?.id) return;
    if (!entitlementState?.isLoggedIn) return;
    if (entitlementState.isUnlimited) return;
    if (lifetimeSessionsCount === null) return;

    if (lifetimeSessionsCount <= PRICING.supportPromptAfterSessions) return;

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
  }, [user?.id, entitlementState, lifetimeSessionsCount]);

  useEffect(() => {
    if (!user?.id) return;
    if (activeBan) return;
    if (supportModalOpen) return;
    if (postSessionPrompt.open) return;

    if (!hostPromptStats) return;

    const hostedTotal = Math.max(0, Number(hostPromptStats.hostedTotal || 0));

    const upcomingHostedFromStats = Math.max(
      0,
      Number(hostPromptStats.upcomingHosted || 0)
    );

    const upcomingHostedFromLoadedSessions = sessions.filter((s) => {
      if (String(s.host_id || "") !== String(user.id)) return false;
      if (!s.start_time) return false;

      const startMs = new Date(s.start_time).getTime();
      if (Number.isNaN(startMs)) return false;

      return startMs >= Date.now();
    }).length;

    const upcomingHosted = Math.max(
      upcomingHostedFromStats,
      upcomingHostedFromLoadedSessions
    );

    // Active hosts already have supply on the schedule, so we do not nag them.
    if (upcomingHosted > 0) return;

    const kind: HostPromptKind =
      hostedTotal <= 0 ? "never_hosted" : "inactive_host";

    const key = `mysession_host_prompt_dismissed_at:${user.id}:${kind}`;
    const lastDismissed = Number(localStorage.getItem(key) || 0);
    const cooldownMs =
      kind === "never_hosted"
        ? 24 * 60 * 60 * 1000
        : 3 * 24 * 60 * 60 * 1000;

    if (lastDismissed && Date.now() - lastDismissed < cooldownMs) return;

    const timer = window.setTimeout(() => {
      setHostPromptKind(kind);
      setHostPromptOpen(true);
    }, 2200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    user?.id,
    activeBan,
    supportModalOpen,
    postSessionPrompt.open,
    hostPromptStats,
    sessions,
  ]);


  useEffect(() => {
    if (!user?.id) return;
    if (activeBan) return;
    if (supportModalOpen) return;
    if (hostPromptOpen) return;
    if (postSessionPrompt.open) return;

    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

    const joinedAt = Number(localStorage.getItem(COMMUNITY_PROMPT_JOINED_KEY) || 0);
    if (joinedAt && now - joinedAt < ninetyDaysMs) return;

    const dismissedAt = Number(
      localStorage.getItem(COMMUNITY_PROMPT_DISMISSED_KEY) || 0
    );
    if (dismissedAt && now - dismissedAt < sevenDaysMs) return;

    const timer = window.setTimeout(() => {
      setCommunityPromptOpen(true);
    }, 3600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    user?.id,
    activeBan,
    supportModalOpen,
    hostPromptOpen,
    postSessionPrompt.open,
  ]);

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
    const requestGeneration = ++sessionsFetchGenerationRef.current;
    const isCurrentRequest = () =>
      requestGeneration === sessionsFetchGenerationRef.current;

    if (DEBUG) {
      console.log("[Sessions] Fetch started:", requestGeneration);
    }

    /**
     * Only show the full-page loader on the initial load.
     *
     * Refreshes after booking/editing/creating keep the current cards visible.
     */
    if (!hasLoadedSessionsOnceRef.current) {
      setIsLoading(true);
    }

    setSessionsLoadError(null);

    try {
      /**
       * CRITICAL REQUEST.
       *
       * This is the only request allowed to block the initial SessionsPage render.
       */
      const { data, error } = await withTimeout(
        supabase
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
            custom_slug,
            session_format_type,
            is_silent,
            is_private,
            max_participants
          `
          )
          .or(
            `session_format_type.eq.infinite,start_time.gte.${new Date(
              Date.now() - 12 * 60 * 60 * 1000
            ).toISOString()}`
          )
          .order("start_time", { ascending: true })
          .limit(120),
        SESSIONS_BASE_TIMEOUT_MS,
        "sessions_base_load"
      );

      if (!isCurrentRequest()) {
        if (DEBUG) {
          console.log(
            "[Sessions] Ignoring stale base response:",
            requestGeneration
          );
        }

        return;
      }

      if (error) throw error;

      const rows = (data || []) as unknown as SessionWithRelations[];

      const ids = rows
        .map((session) => String(session.id || "").trim())
        .filter(Boolean);
      const hostIds = Array.from(
        new Set(
          rows
            .map((session) => String(session.host_id || "").trim())
            .filter(Boolean)
        )
      );

      /**
       * Render base session cards immediately.
       *
       * Slugs, bookings and live counts are intentionally not required here.
       */
      const baseRows = rows.map((session) => ({
        ...session,
        session_bookings: session.session_bookings || [],
        live_count: session.live_count ?? 0,
      }));

      setSessions(baseRows);
      hasLoadedSessionsOnceRef.current = true;
      setIsLoading(false);

      if (DEBUG) {
        console.log("[Sessions] Base sessions rendered:", baseRows.length);
      }

      if (!ids.length) return;

      /**
       * OPTIONAL ENRICHMENT 1:
       * public slugs
       *
       * Never blocks page rendering.
       */
      const loadPublicSlugs = async () => {
        try {
          const { data: slugRows, error: slugError } = await withTimeout(
            supabase
              .from("public_url_slugs")
              .select("slug, owner_id")
              .eq("owner_type", "session")
              .in("owner_id", ids),
            SESSIONS_ENRICHMENT_TIMEOUT_MS,
            "sessions_slug_enrichment"
          );

          if (!isCurrentRequest()) return;

          if (slugError) throw slugError;

          const publicSlugBySessionId = new Map<string, string>();

          for (const row of (slugRows || []) as any[]) {
            const ownerId = String(row?.owner_id || "").trim();
            const slug = String(row?.slug || "").trim();

            if (ownerId && slug) {
              publicSlugBySessionId.set(ownerId, slug);
            }
          }

          setSessions((previousSessions) =>
            previousSessions.map((session) => {
              const sessionId = String(session.id || "").trim();
              const publicSlug =
                publicSlugBySessionId.get(sessionId) || "";

              if (!publicSlug) return session;

              return {
                ...session,
                public_slug: publicSlug,
                public_url_slug: {
                  slug: publicSlug,
                },
                public_url_slugs: [
                  {
                    slug: publicSlug,
                    owner_type: "session",
                    owner_id: sessionId,
                  },
                ],
              };
            })
          );
        } catch (error) {
          if (DEBUG) {
            console.warn(
              "[Sessions] Optional slug enrichment failed:",
              error
            );
          }
        }
      };

      /**
       * OPTIONAL ENRICHMENT 2:
       * booked users / avatars
       *
       * Never blocks page rendering.
       */
      const loadPublicBookings = async () => {
        try {
          let bookingsData: any[] | null = null;

          const timedBookings = await withTimeout(
            supabase.rpc("get_public_session_bookings_with_times", {
              p_session_ids: ids,
            }),
            SESSIONS_ENRICHMENT_TIMEOUT_MS,
            "sessions_timed_bookings_enrichment"
          );

          if (!timedBookings.error) {
            bookingsData = (timedBookings.data || []) as any[];
          } else {
            const legacyBookings = await withTimeout(
              supabase
                .from("public_session_bookings")
                .select("session_id, user_id, full_name, avatar_url")
                .in("session_id", ids),
              SESSIONS_ENRICHMENT_TIMEOUT_MS,
              "sessions_bookings_enrichment"
            );

            if (legacyBookings.error) throw legacyBookings.error;
            bookingsData = (legacyBookings.data || []) as any[];
          }

          if (!isCurrentRequest()) return;

          const bookingsBySessionId = new Map<
            string,
            SessionBookingRow[]
          >();

          for (const row of (bookingsData || []) as any[]) {
            const sessionId = String(row?.session_id || "").trim();

            if (!sessionId) continue;

            const previousBookings =
              bookingsBySessionId.get(sessionId) || [];

            previousBookings.push({
              user_id: String(row?.user_id || ""),
              created_at: row?.created_at || null,
              booked_start_time: row?.booked_start_time || null,
              booked_end_time: row?.booked_end_time || null,
              profiles: {
                id: String(row?.user_id || ""),
                full_name: row?.full_name || null,
                avatar_url: row?.avatar_url || null,
              },
            });

            bookingsBySessionId.set(
              sessionId,
              previousBookings
            );
          }

          setSessions((previousSessions) =>
            previousSessions.map((session) => ({
              ...session,
              session_bookings:
                bookingsBySessionId.get(String(session.id)) || [],
            }))
          );
        } catch (error) {
          if (DEBUG) {
            console.warn(
              "[Sessions] Optional bookings enrichment failed:",
              error
            );
          }
        }
      };

      /**
       * OPTIONAL ENRICHMENT 3:
       * real host names / avatars for session cards and the details drawer.
       */
      const loadHostProfiles = async () => {
        if (!hostIds.length) return;

        try {
          const { data: profileRows, error: profilesError } = await withTimeout(
            supabase
              .from("profiles")
              .select("id, full_name, avatar_url")
              .in("id", hostIds),
            SESSIONS_ENRICHMENT_TIMEOUT_MS,
            "sessions_host_profiles_enrichment"
          );

          if (!isCurrentRequest()) return;
          if (profilesError) throw profilesError;

          const profilesById = new Map<string, any>();
          for (const profile of (profileRows || []) as any[]) {
            const profileId = String(profile?.id || "").trim();
            if (profileId) profilesById.set(profileId, profile);
          }

          setSessions((previousSessions) =>
            previousSessions.map((session) => {
              const profile = profilesById.get(String(session.host_id || ""));
              if (!profile) return session;

              return {
                ...session,
                host_name: profile.full_name || session.host_name,
                host_avatar_url: profile.avatar_url || null,
                host_profile: profile,
              };
            })
          );
        } catch (error) {
          if (DEBUG) {
            console.warn("[Sessions] Optional host profile enrichment failed:", error);
          }
        }
      };

      /**
       * Start all optional enrichment in parallel.
       *
       * IMPORTANT:
       * No await here.
       */
      void loadPublicSlugs();
      void loadPublicBookings();
      void loadHostProfiles();
      void fetchLiveCounts(ids);
    } catch (error) {
      if (!isCurrentRequest()) return;

      console.error(
        "[Sessions] Critical base session load failed:",
        error
      );

      /**
       * Keep already loaded sessions visible during a failed refresh.
       *
       * Only show an empty/error state when the first load itself fails.
       */
      if (!hasLoadedSessionsOnceRef.current) {
        setSessions([]);
      }

      setSessionsLoadError(
        "We couldn't load the sessions. Please try again."
      );

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

    const t = window.setInterval(run, 90_000);

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

  const privacyFilteredSessions = useMemo(() => {
    return activeSessions.filter((session) => {
      if (!session.is_private) return true;
      return !!user?.id && String(session.host_id || "") === String(user.id);
    });
  }, [activeSessions, user?.id]);

  const typeFilteredSessions = useMemo(() => {
    return privacyFilteredSessions.filter(
      (s) => resolveSessionType(s) === sessionTypeTab
    );
  }, [sessionTypeTab, privacyFilteredSessions]);

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

  const book = async (id: string, opts: BookSessionOptions = {}) => {
    if (showBanModal()) return;

    if (!user) {
      return navigate(`/login?next=${encodeURIComponent("/sessions")}`);
    }

    try {
      const { error } = await supabase.from("session_bookings").insert({
        session_id: id,
        user_id: user.id,
        booked_start_time: opts.booked_start_time || null,
        booked_end_time: opts.booked_end_time || null,
        booking_note: opts.booking_note || null,
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

  const closeHostPromptModal = useCallback(() => {
    if (user?.id) {
      localStorage.setItem(
        `mysession_host_prompt_dismissed_at:${user.id}:${hostPromptKind}`,
        Date.now().toString()
      );
    }

    setHostPromptOpen(false);
  }, [hostPromptKind, user?.id]);

  const openCreateFromHostPrompt = useCallback(() => {
    if (user?.id) {
      localStorage.setItem(
        `mysession_host_prompt_dismissed_at:${user.id}:${hostPromptKind}`,
        Date.now().toString()
      );
    }

    setHostPromptOpen(false);

    if (showBanModal()) return;

    if (!user) {
      navigate(`/login?next=${encodeURIComponent("/sessions")}`);
      return;
    }

    modal.open();
  }, [hostPromptKind, modal, navigate, showBanModal, user]);

  const closeCommunityPromptModal = useCallback(() => {
    localStorage.setItem(
      COMMUNITY_PROMPT_DISMISSED_KEY,
      Date.now().toString()
    );
    setCommunityPromptOpen(false);
  }, []);

  const markCommunityPromptJoined = useCallback(() => {
    localStorage.setItem(
      COMMUNITY_PROMPT_JOINED_KEY,
      Date.now().toString()
    );
    setCommunityPromptOpen(false);
  }, []);


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
      onHostTransferComplete={fetchSessions}
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

                    <p className="mt-4 text-[13px] text-[#606060]">
                      Loading sessions...
                    </p>
                  </div>
                ) : sessionsLoadError && sessions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <div className="text-[16px] font-semibold text-brandBlack">
                      Couldn't load sessions
                    </div>

                    <p className="mt-2 max-w-[420px] text-[13px] leading-relaxed text-[#606060]">
                      The connection took too long or something interrupted the request.
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        void fetchSessions();
                      }}
                      className="
                        mt-5
                        rounded-full
                        bg-[#111827]
                        px-5 py-2.5
                        text-[13px] font-semibold text-white
                        transition
                        hover:opacity-90
                      "
                    >
                      Try again
                    </button>
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



      <SupportMySessionModal
        open={supportModalOpen}
        onClose={closeSupportModal}
      />


      <HostSessionPromptModal
        open={hostPromptOpen}
        kind={hostPromptKind}
        onClose={closeHostPromptModal}
        onHostSession={openCreateFromHostPrompt}
      />

      <CommunityPromptModal
        open={communityPromptOpen}
        whatsappUrl={COMMUNITY_WHATSAPP_URL}
        discordUrl={COMMUNITY_DISCORD_URL}
        onClose={closeCommunityPromptModal}
        onJoinedCommunity={markCommunityPromptJoined}
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
