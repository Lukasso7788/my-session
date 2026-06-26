// src/components/IntentionsPanel.tsx

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { ReactNode, MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle,
  Circle,
  Pencil,
  Trash2,
  X,
  Check,
  ExternalLink,
  ListPlus,
  RefreshCw,
  Search,
  Lock,
  Unlock,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useParams } from "react-router-dom";

type RoomTheme = "dark" | "light";

type SessionIntention = {
  id: string;
  text: string;
  user_id: string;
  session_id: string;
  created_at?: string;
  completed?: boolean;
  profiles?: {
    full_name?: string;
    avatar_url?: string;
  };
};

type PanelIntention = {
  id: string;
  user_id: string;
  text: string;
  focus_plan_item_id: string | null;
  completed: boolean;
  created_at: string;
  updated_at: string;
  visibility?: "public" | "private" | string | null;
};

type FocusPlan = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type FocusPlanItem = {
  id: string;
  plan_id: string;
  user_id: string;
  text: string;
  target_date: string | null;
  session_id: string | null;
  created_at: string;
  completed: boolean;
  sort_order: number;
};

type IntentionsPanelProps = {
  sessionId?: string; // uuid or slug
  theme?: RoomTheme;
  timerText?: string;
  timerTextClassName?: string;
  pictureInPictureSupported?: boolean;
  pictureInPictureOpen?: boolean;
  onOpenPictureInPicture?: () => void;
};

type ProfileMini = {
  id: string;
  full_name?: string;
  avatar_url?: string;
};

type EncouragementUser = ProfileMini & {
  emoji?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DocPiPWindow = Window & { document: Document; close: () => void };

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (opts?: {
        width?: number;
        height?: number;
      }) => Promise<DocPiPWindow>;
    };
  }
}

const OVERLAY_FONT_FAMILY =
  'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';

const PANEL_INTENTIONS_TABLE = "panel_intentions";
const SESSION_INTENTIONS_TABLE = "intentions";
const INTENTION_ENCOURAGEMENTS_TABLE = "intention_encouragements";
const ENCOURAGEMENT_EMOJI = "🤩";

/**
 * Conservative limits:
 * - enough for normal usage
 * - lighter queries + lighter render
 */
const PANEL_INTENTIONS_FETCH_LIMIT = 120;
const SESSION_INTENTIONS_FETCH_LIMIT = 80;
const TEAM_INTENTIONS_RENDER_LIMIT = 50;
const PLAN_ITEMS_RENDER_LIMIT = 40;
const FOCUS_PLAN_ITEMS_FETCH_LIMIT = 120;
const FOCUS_PLANS_FETCH_LIMIT = 40;

function normalizeIntentionVisibility(value: unknown): "public" | "private" {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (v === "private" || v === "self" || v === "hidden") return "private";
  return "public";
}

function isPanelIntentionVisibleInRoom(item?: { visibility?: unknown } | null) {
  return normalizeIntentionVisibility(item?.visibility) !== "private";
}

function isPanelIntentionPublic(item?: { visibility?: unknown } | null) {
  return normalizeIntentionVisibility(item?.visibility) === "public";
}

function getNextIntentionVisibility(value: unknown): "public" | "private" {
  const current = normalizeIntentionVisibility(value);
  return current === "public" ? "private" : "public";
}

function getVisibilityTitle(value: unknown) {
  const v = normalizeIntentionVisibility(value);
  if (v === "public")
    return "Public — visible to everyone in the room. Click to make private.";
  return "Private — visible only to you. Click to make public.";
}

function PanelSmartIcon({
  name,
  theme,
  className = "w-4 h-4",
  alt,
}: {
  name: "focus-plan" | "pip-intentions" | "pin" | "encouragement";
  theme: RoomTheme;
  className?: string;
  alt?: string;
}) {
  const themedSrc = `/icons/${name}-${theme}.svg`;
  const neutralSrc = `/icons/${name}.svg`;
  const [src, setSrc] = useState(themedSrc);

  useEffect(() => {
    setSrc(themedSrc);
  }, [themedSrc]);

  return (
    <img
      src={src}
      onError={() => {
        if (src !== neutralSrc) setSrc(neutralSrc);
      }}
      className={className}
      alt={alt || name}
      draggable={false}
    />
  );
}

function IconButton({
  title,
  onClick,
  children,
  className = "",
  theme = "dark",
}: {
  title: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
  theme?: RoomTheme;
}) {
  const isLight = theme === "light";
  const base = isLight
    ? "bg-[#E6E6E6] hover:bg-[#DCDCDC] text-black/70"
    : "bg-[#1B1B1B] hover:bg-[#242424] text-white/80";

  return (
    <button
      title={title}
      onClick={onClick}
      className={
        "w-9 h-9 rounded-xl flex items-center justify-center transition " +
        base +
        " " +
        className
      }
      type="button"
    >
      {children}
    </button>
  );
}

function TimerSmartIcon({
  theme,
  className = "w-4 h-4",
  alt = "Timer",
}: {
  theme: RoomTheme;
  className?: string;
  alt?: string;
}) {
  const themedSrc = `/icons/timer-${theme}.svg`;
  const fallbackSrc = `/icons/timer.svg`;

  const [src, setSrc] = useState(themedSrc);

  useEffect(() => {
    setSrc(themedSrc);
  }, [themedSrc]);

  return (
    <img
      src={src}
      onError={() => {
        if (src !== fallbackSrc) setSrc(fallbackSrc);
      }}
      className={className}
      alt={alt}
      draggable={false}
    />
  );
}

function copyStylesToDocument(from: Document, to: Document) {
  try {
    const nodes = Array.from(
      from.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
        'style, link[rel="stylesheet"], link[rel="preconnect"], link[rel="preload"]',
      ),
    );

    nodes.forEach((n) => {
      const clone = n.cloneNode(true) as HTMLElement;
      to.head.appendChild(clone);
    });
  } catch { }
}

function applyOverlayBaseStyles(doc: Document, isLight: boolean) {
  try {
    doc.documentElement.style.height = "100%";
    doc.body.style.height = "100%";
    doc.body.style.margin = "0";
    doc.body.style.background = isLight ? "#F3F3F3" : "#1B1B1B";
    doc.body.style.fontFamily = OVERLAY_FONT_FAMILY;
  } catch { }
}

function safeTrim(x: unknown) {
  return String(x || "").trim();
}

function normalizeTextForMatch(x: unknown) {
  return String(x || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function fetchProfilesMap(
  userIds: string[],
): Promise<Map<string, ProfileMini>> {
  const ids = [
    ...new Set(
      (userIds || []).map((x) => String(x || "").trim()).filter(Boolean),
    ),
  ];
  const map = new Map<string, ProfileMini>();
  if (!ids.length) return map;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", ids);

    if (error || !Array.isArray(data)) return map;

    for (const row of data) {
      const id = String((row as any)?.id || "").trim();
      if (!id) continue;
      map.set(id, {
        id,
        full_name: (row as any)?.full_name || undefined,
        avatar_url: (row as any)?.avatar_url || undefined,
      });
    }
  } catch { }

  return map;
}

export function IntentionsPanel({
  sessionId: sessionIdProp,
  theme = "dark",
  timerText: timerTextProp,
  timerTextClassName,
  pictureInPictureSupported = false,
  pictureInPictureOpen = false,
  onOpenPictureInPicture,
}: IntentionsPanelProps) {
  const { id: idOrSlugFromUrl } = useParams<{ id: string }>();
  const rawSessionId = (sessionIdProp || idOrSlugFromUrl || "").trim();

  const panelTheme: RoomTheme = "light";
  const isLight = true;

  const [user, setUser] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [panelIntentions, setPanelIntentions] = useState<PanelIntention[]>([]);
  const [panelLoading, setPanelLoading] = useState(true);

  const [sessionIntentions, setSessionIntentions] = useState<
    SessionIntention[]
  >([]);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [encouragementCounts, setEncouragementCounts] = useState<
    Record<string, number>
  >({});
  const [myEncouragedIds, setMyEncouragedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [encouragementUsersByIntention, setEncouragementUsersByIntention] =
    useState<Record<string, EncouragementUser[]>>({});
  const [encouragementModalIntentionId, setEncouragementModalIntentionId] =
    useState<string | null>(null);

  const [newIntention, setNewIntention] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");

  const loadSeqRef = useRef(0);
  const panelSeqRef = useRef(0);
  const sessionReloadTimerRef = useRef<number | null>(null);

  const [timerText, setTimerText] = useState<string>("--:--");

  const overlayRef = useRef<{
    win: Window | null;
    container: HTMLElement;
    kind: "pip" | "window";
  } | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [plans, setPlans] = useState<FocusPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [planItems, setPlanItems] = useState<FocusPlanItem[]>([]);
  const [planItemsLoading, setPlanItemsLoading] = useState(false);

  const [planSearch, setPlanSearch] = useState("");
  const [importingItemId, setImportingItemId] = useState<string | null>(null);
  const [lastPlansLoadedAt, setLastPlansLoadedAt] = useState<string>("");

  const titleText = "text-black/95";
  const mutedText = "text-black/55";
  const divider = "bg-[#D8D0D0]";

  const panelBg = "bg-[#F3F1F1] text-black";
  const headerBg = "bg-[#F7F5F5]";
  const headerBorder = "border-[#D8D0D0]";

  const inputCls = `
      h-12 bg-[#F7F5F5] border border-[#CFC6C6] rounded-[18px]
      px-4 text-[14px] text-black/85 placeholder:text-black/35
      outline-none focus:ring-1 focus:ring-[#81DB86] focus:border-[#81DB86]
      font-inter
    `;

  const myCardCls =
    "group relative rounded-[18px] border border-[#CFC6C6] px-4 py-3 bg-[#F7F5F5] hover:bg-[#ECEAEA] transition cursor-pointer";

  const teamCardCls =
    "relative rounded-[18px] border border-[#CFC6C6] px-3 py-2.5 bg-[#F7F5F5] hover:bg-[#ECEAEA] transition";

  const ghostBtn =
    "border border-[#CFC6C6] bg-transparent hover:bg-[#ECEAEA] text-black/75";

  const primaryBtn = "bg-[#252525] hover:bg-[#303030] text-white font-semibold";

  const stopRoomBubbling = useCallback((e: any) => {
    e?.stopPropagation?.();
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user || null));
  }, []);

  useEffect(() => {
    const t = typeof timerTextProp === "string" ? timerTextProp.trim() : "";
    if (t) setTimerText(t);
  }, [timerTextProp]);

  useEffect(() => {
    const t = typeof timerTextProp === "string" ? timerTextProp.trim() : "";
    if (t) return;

    const onTimer = (e: any) => {
      const v = e?.detail?.text;
      if (typeof v === "string" && v.trim()) setTimerText(v.trim());
    };

    window.addEventListener("mysession:timer", onTimer as any);

    const id = window.setInterval(() => {
      try {
        const v =
          localStorage.getItem("mysession_timer_text") ||
          localStorage.getItem("timer_text") ||
          "";
        const vv = v ? v.trim() : "";
        if (vv) setTimerText((prev) => (prev === vv ? prev : vv));
      } catch { }
    }, 1000);

    return () => {
      window.removeEventListener("mysession:timer", onTimer as any);
      window.clearInterval(id);
    };
  }, [timerTextProp]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const raw = String(rawSessionId || "").trim();
      if (!raw) {
        if (!cancelled) setSessionId(null);
        return;
      }

      if (UUID_RE.test(raw)) {
        if (!cancelled) setSessionId(raw);
        return;
      }

      const slug = raw.toLowerCase();

      try {
        const { data, error } = await supabase
          .from("sessions")
          .select("id")
          .eq("custom_slug", slug)
          .single();

        if (!cancelled) {
          if (!error && data?.id) setSessionId(String(data.id));
          else setSessionId(null);
        }
      } catch {
        if (!cancelled) setSessionId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rawSessionId]);

  const getAvatar = (profile?: any) =>
    profile?.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || "User")}`;

  const loadPanelIntentions = useCallback(async () => {
    if (!user?.id) return;

    const seq = ++panelSeqRef.current;
    setPanelLoading(true);

    try {
      const { data, error } = await supabase
        .from(PANEL_INTENTIONS_TABLE)
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(PANEL_INTENTIONS_FETCH_LIMIT);

      if (seq !== panelSeqRef.current) return;

      if (error || !Array.isArray(data)) {
        setPanelIntentions([]);
        return;
      }

      setPanelIntentions(data as PanelIntention[]);
    } finally {
      if (seq === panelSeqRef.current) setPanelLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    void loadPanelIntentions();

    const ch = supabase
      .channel(`panel_intentions_${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: PANEL_INTENTIONS_TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        () => void loadPanelIntentions(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [user?.id, loadPanelIntentions]);

  const loadSessionIntentions = useCallback(
    async (sid?: string | null) => {
      const s = String(sid || sessionId || "");
      if (!s) return;

      const seq = ++loadSeqRef.current;
      setSessionLoading(true);

      try {
        const { data, error } = await supabase
          .from(SESSION_INTENTIONS_TABLE)
          .select("id, text, user_id, session_id, created_at, completed")
          .eq("session_id", s)
          .order("created_at", { ascending: false })
          .limit(SESSION_INTENTIONS_FETCH_LIMIT);

        if (seq !== loadSeqRef.current) return;

        if (error || !Array.isArray(data)) {
          setSessionIntentions([]);
          return;
        }

        const rows = data as SessionIntention[];
        const profileMap = await fetchProfilesMap(rows.map((r) => r.user_id));

        if (seq !== loadSeqRef.current) return;

        const merged = rows.map((row) => ({
          ...row,
          profiles: profileMap.get(String(row.user_id)) || undefined,
        }));

        setSessionIntentions(merged);
      } finally {
        if (seq === loadSeqRef.current) setSessionLoading(false);
      }
    },
    [sessionId],
  );

  const scheduleSessionIntentionsReload = useCallback(
    (sid?: string | null) => {
      const targetSid = String(sid || sessionId || "");
      if (!targetSid) return;

      if (sessionReloadTimerRef.current) {
        window.clearTimeout(sessionReloadTimerRef.current);
      }

      sessionReloadTimerRef.current = window.setTimeout(() => {
        sessionReloadTimerRef.current = null;
        void loadSessionIntentions(targetSid);
      }, 120);
    },
    [sessionId, loadSessionIntentions],
  );

  useEffect(() => {
    if (!sessionId) return;

    void loadSessionIntentions(sessionId);

    const channel = supabase
      .channel(`intentions_realtime_${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: SESSION_INTENTIONS_TABLE },
        (payload: any) => {
          const payloadSessionId = String(
            payload?.new?.session_id || payload?.old?.session_id || "",
          ).trim();

          if (!payloadSessionId || payloadSessionId === String(sessionId)) {
            scheduleSessionIntentionsReload(sessionId);
          }
        },
      )
      .subscribe();

    return () => {
      if (sessionReloadTimerRef.current) {
        window.clearTimeout(sessionReloadTimerRef.current);
        sessionReloadTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [sessionId, loadSessionIntentions, scheduleSessionIntentionsReload]);

  const loadEncouragements = useCallback(async () => {
    const ids = sessionIntentions
      .map((x) => String(x.id || ""))
      .filter(Boolean);
    if (!sessionId || ids.length === 0) {
      setEncouragementCounts({});
      setMyEncouragedIds(new Set());
      setEncouragementUsersByIntention({});
      return;
    }

    try {
      let data: any[] | null = null;
      let error: any = null;

      const bySession = await supabase
        .from(INTENTION_ENCOURAGEMENTS_TABLE)
        .select("session_intention_id,user_id,emoji")
        .eq("session_id", sessionId);

      data = (bySession.data as any[]) || null;
      error = bySession.error;

      if (error) {
        const byIds = await supabase
          .from(INTENTION_ENCOURAGEMENTS_TABLE)
          .select("session_intention_id,user_id,emoji")
          .in("session_intention_id", ids);
        data = (byIds.data as any[]) || null;
        error = byIds.error;
      }

      if (error || !Array.isArray(data)) return;

      const nextCounts: Record<string, number> = {};
      const nextMine = new Set<string>();
      const allowed = new Set(ids);
      const userIds: string[] = [];

      data.forEach((row) => {
        const intentionId = String(row?.session_intention_id || "");
        const rowUserId = String(row?.user_id || "");
        if (!intentionId || !allowed.has(intentionId)) return;
        nextCounts[intentionId] = (nextCounts[intentionId] || 0) + 1;
        if (rowUserId) userIds.push(rowUserId);
        if (rowUserId === String(user?.id || "")) nextMine.add(intentionId);
      });

      const profileMap = await fetchProfilesMap(userIds);
      const nextUsersByIntention: Record<string, EncouragementUser[]> = {};

      data.forEach((row) => {
        const intentionId = String(row?.session_intention_id || "");
        const rowUserId = String(row?.user_id || "");
        if (!intentionId || !allowed.has(intentionId) || !rowUserId) return;

        const profile = profileMap.get(rowUserId);
        const list = nextUsersByIntention[intentionId] || [];

        if (!list.some((x) => x.id === rowUserId)) {
          list.push({
            id: rowUserId,
            full_name: profile?.full_name || "Participant",
            avatar_url: profile?.avatar_url,
            emoji: String(row?.emoji || ENCOURAGEMENT_EMOJI),
          });
        }

        nextUsersByIntention[intentionId] = list;
      });

      setEncouragementCounts(nextCounts);
      setMyEncouragedIds(nextMine);
      setEncouragementUsersByIntention(nextUsersByIntention);
    } catch {
      // Encouragements are optional. Never break the panel if this table is missing.
    }
  }, [sessionId, sessionIntentions, user?.id]);

  useEffect(() => {
    void loadEncouragements();
  }, [loadEncouragements]);

  useEffect(() => {
    if (!sessionId) return;

    const channel = supabase
      .channel(`intention_encouragements_${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: INTENTION_ENCOURAGEMENTS_TABLE },
        () => void loadEncouragements(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, loadEncouragements]);

  const toggleEncouragement = useCallback(
    async (intentionId: string) => {
      const id = String(intentionId || "");
      const uid = String(user?.id || "");
      if (!id || !uid || !sessionId) return;

      const had = myEncouragedIds.has(id);

      setMyEncouragedIds((prev) => {
        const next = new Set(prev);
        if (had) next.delete(id);
        else next.add(id);
        return next;
      });

      setEncouragementCounts((prev) => ({
        ...prev,
        [id]: Math.max(0, (prev[id] || 0) + (had ? -1 : 1)),
      }));

      try {
        if (had) {
          const { error } = await supabase
            .from(INTENTION_ENCOURAGEMENTS_TABLE)
            .delete()
            .eq("session_intention_id", id)
            .eq("user_id", uid);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from(INTENTION_ENCOURAGEMENTS_TABLE)
            .insert({
              session_id: sessionId,
              session_intention_id: id,
              user_id: uid,
              emoji: ENCOURAGEMENT_EMOJI,
            } as any);
          if (error) throw error;
        }
      } catch {
        void loadEncouragements();
      }
    },
    [loadEncouragements, myEncouragedIds, sessionId, user?.id],
  );

  const findOwnSessionIntentionLocal = useCallback(
    (text: string) => {
      const uid = String(user?.id || "");
      const sid = String(sessionId || "");
      const norm = normalizeTextForMatch(text);
      if (!uid || !sid || !norm) return null;

      return (
        sessionIntentions.find(
          (x) =>
            String(x.user_id) === uid &&
            String(x.session_id) === sid &&
            normalizeTextForMatch(x.text) === norm,
        ) || null
      );
    },
    [user?.id, sessionId, sessionIntentions],
  );

  const upsertOwnSessionIntention = useCallback(
    async ({
      matchText,
      text,
      completed,
    }: {
      matchText?: string;
      text: string;
      completed?: boolean;
    }) => {
      if (!user?.id || !sessionId) return null;

      const nextText = safeTrim(text);
      if (!nextText) return null;

      const existing =
        (matchText ? findOwnSessionIntentionLocal(matchText) : null) ||
        findOwnSessionIntentionLocal(nextText);

      if (existing) {
        const updates: any = {};

        if (safeTrim(existing.text) !== nextText) updates.text = nextText;
        if (
          typeof completed === "boolean" &&
          Boolean(existing.completed) !== completed
        ) {
          updates.completed = completed;
        }

        if (Object.keys(updates).length === 0) return existing.id;

        try {
          const { error } = await supabase
            .from(SESSION_INTENTIONS_TABLE)
            .update(updates)
            .eq("id", existing.id)
            .eq("user_id", user.id)
            .eq("session_id", sessionId);

          if (error) throw error;
        } catch {
          void loadSessionIntentions(sessionId);
          return null;
        }

        void loadSessionIntentions(sessionId);
        return existing.id;
      }

      try {
        const payload: any = {
          user_id: user.id,
          session_id: sessionId,
          text: nextText,
          completed: typeof completed === "boolean" ? completed : false,
        };

        const { data, error } = await supabase
          .from(SESSION_INTENTIONS_TABLE)
          .insert(payload)
          .select("id, text, user_id, session_id, created_at, completed")
          .single();

        if (error) throw error;

        if (data) {
          setSessionIntentions((prev) =>
            [data as SessionIntention, ...prev].slice(
              0,
              SESSION_INTENTIONS_FETCH_LIMIT,
            ),
          );
        }

        void loadSessionIntentions(sessionId);
        return data?.id || null;
      } catch {
        void loadSessionIntentions(sessionId);
        return null;
      }
    },
    [user?.id, sessionId, findOwnSessionIntentionLocal, loadSessionIntentions],
  );

  const deleteOwnSessionIntentionByText = useCallback(
    async (text: string) => {
      if (!user?.id || !sessionId) return;

      const existing = findOwnSessionIntentionLocal(text);
      if (!existing) return;

      setSessionIntentions((prev) => prev.filter((x) => x.id !== existing.id));

      try {
        const { error } = await supabase
          .from(SESSION_INTENTIONS_TABLE)
          .delete()
          .eq("id", existing.id)
          .eq("user_id", user.id)
          .eq("session_id", sessionId);

        if (error) throw error;
      } catch {
        void loadSessionIntentions(sessionId);
        return;
      }

      scheduleSessionIntentionsReload(sessionId);
    },
    [
      user?.id,
      sessionId,
      findOwnSessionIntentionLocal,
      loadSessionIntentions,
      scheduleSessionIntentionsReload,
    ],
  );

  const loadPlans = useCallback(async () => {
    if (!user?.id) return;

    setPlansLoading(true);
    try {
      const { data, error } = await supabase
        .from("focus_plans")
        .select("id,user_id,title,created_at,updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(FOCUS_PLANS_FETCH_LIMIT);

      if (error || !Array.isArray(data)) {
        setPlans([]);
        setSelectedPlanId("");
        return;
      }

      const list = data as FocusPlan[];
      setPlans(list);

      setSelectedPlanId((prev) => {
        if (list.length === 0) return "";
        if (prev && list.some((p) => p.id === prev)) return prev;
        return list[0].id;
      });

      setLastPlansLoadedAt(new Date().toISOString());
    } catch {
      setPlans([]);
      setSelectedPlanId("");
      setLastPlansLoadedAt(new Date().toISOString());
    } finally {
      setPlansLoading(false);
    }
  }, [user?.id]);

  const loadPlanItems = useCallback(
    async (planId: string) => {
      if (!user?.id) return;
      if (!planId) {
        setPlanItems([]);
        return;
      }

      setPlanItemsLoading(true);
      try {
        const { data, error } = await supabase
          .from("focus_plan_items")
          .select(
            "id,plan_id,user_id,text,target_date,session_id,created_at,completed,sort_order",
          )
          .eq("user_id", user.id)
          .eq("plan_id", planId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false })
          .limit(FOCUS_PLAN_ITEMS_FETCH_LIMIT);

        if (error || !Array.isArray(data)) {
          setPlanItems([]);
          return;
        }

        setPlanItems(data as FocusPlanItem[]);
      } catch {
        setPlanItems([]);
      } finally {
        setPlanItemsLoading(false);
      }
    },
    [user?.id],
  );

  useEffect(() => {
    if (!importModalOpen) return;
    if (!user?.id) return;
    void loadPlans();
  }, [importModalOpen, user?.id, loadPlans]);

  useEffect(() => {
    if (!importModalOpen) return;
    if (!selectedPlanId) {
      setPlanItems([]);
      return;
    }
    void loadPlanItems(selectedPlanId);
  }, [importModalOpen, selectedPlanId, loadPlanItems]);

  const filteredPlanItems = useMemo(() => {
    const q = normalizeTextForMatch(planSearch);
    const base = (planItems || []).filter(
      (it) => safeTrim(it?.text).length > 0,
    );
    if (!q) return base;
    return base.filter((it) => normalizeTextForMatch(it.text).includes(q));
  }, [planItems, planSearch]);

  const renderedPlanItems = useMemo(() => {
    return filteredPlanItems.slice(0, PLAN_ITEMS_RENDER_LIMIT);
  }, [filteredPlanItems]);

  const syncFocusPlanItemCompleted = useCallback(
    async (focusPlanItemId: string, nextCompleted: boolean) => {
      if (!user?.id) return;
      if (!focusPlanItemId) return;

      try {
        await supabase
          .from("focus_plan_items")
          .update({ completed: nextCompleted })
          .eq("id", focusPlanItemId)
          .eq("user_id", user.id);
      } catch { }
    },
    [user?.id],
  );

  const panelTextSet = useMemo(() => {
    const s = new Set<string>();
    for (const it of panelIntentions) {
      const t = normalizeTextForMatch(it.text);
      if (t) s.add(t);
    }
    return s;
  }, [panelIntentions]);

  const importPlanItemToPanel = useCallback(
    async (item: FocusPlanItem) => {
      if (!user?.id) return;

      const text = safeTrim(item.text);
      if (!text) return;

      const norm = normalizeTextForMatch(text);

      setImportingItemId(item.id);

      try {
        const alreadyById = panelIntentions.some(
          (p) => String(p.focus_plan_item_id || "") === String(item.id),
        );
        if (!alreadyById) {
          const existingSameText =
            panelIntentions.find(
              (p) => normalizeTextForMatch(p.text) === norm,
            ) || null;

          if (existingSameText) {
            await supabase
              .from(PANEL_INTENTIONS_TABLE)
              .update({ focus_plan_item_id: item.id })
              .eq("id", existingSameText.id)
              .eq("user_id", user.id);
          } else {
            await supabase.from(PANEL_INTENTIONS_TABLE).insert({
              user_id: user.id,
              text,
              focus_plan_item_id: item.id,
              completed: Boolean(item.completed),
              visibility: "public",
            } as any);
          }
        }

        void loadPanelIntentions();
        void upsertOwnSessionIntention({
          matchText: text,
          text,
          completed: Boolean(item.completed),
        });
      } finally {
        setImportingItemId(null);
      }
    },
    [user?.id, panelIntentions, loadPanelIntentions, upsertOwnSessionIntention],
  );

  const handleAddPanelIntention = async () => {
    if (!user?.id) return;

    const text = safeTrim(newIntention);
    if (!text) return;

    setNewIntention("");

    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: PanelIntention = {
      id: optimisticId,
      user_id: user.id,
      text,
      focus_plan_item_id: null,
      completed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      visibility: "public",
    };

    setPanelIntentions((prev) =>
      [optimistic, ...prev].slice(0, PANEL_INTENTIONS_FETCH_LIMIT),
    );

    try {
      const { data, error } = await supabase
        .from(PANEL_INTENTIONS_TABLE)
        .insert({
          user_id: user.id,
          text,
          completed: false,
          visibility: "public",
        } as any)
        .select("*")
        .single();

      if (error || !data) {
        setPanelIntentions((prev) => prev.filter((x) => x.id !== optimisticId));
        return;
      }

      setPanelIntentions((prev) =>
        [
          data as PanelIntention,
          ...prev.filter((x) => x.id !== optimisticId),
        ].slice(0, PANEL_INTENTIONS_FETCH_LIMIT),
      );
      void upsertOwnSessionIntention({ text, completed: false });
    } catch {
      setPanelIntentions((prev) => prev.filter((x) => x.id !== optimisticId));
    }
  };

  const togglePanelCompleted = async (it: PanelIntention) => {
    if (!user?.id) return;
    if (editingId === it.id) return;

    const next = !Boolean(it.completed);

    setPanelIntentions((prev) =>
      prev.map((x) => (x.id === it.id ? { ...x, completed: next } : x)),
    );

    try {
      const { error } = await supabase
        .from(PANEL_INTENTIONS_TABLE)
        .update({ completed: next })
        .eq("id", it.id)
        .eq("user_id", user.id);

      if (error) throw error;

      if (it.focus_plan_item_id) {
        void syncFocusPlanItemCompleted(String(it.focus_plan_item_id), next);
      }

      if (isPanelIntentionPublic(it)) {
        void upsertOwnSessionIntention({
          matchText: it.text,
          text: it.text,
          completed: next,
        });
      }
    } catch {
      setPanelIntentions((prev) =>
        prev.map((x) => (x.id === it.id ? { ...x, completed: !next } : x)),
      );
    }
  };

  const deletePanelIntention = async (id: string) => {
    if (!user?.id) return;

    const prev = panelIntentions;
    const target = panelIntentions.find((x) => x.id === id) || null;

    setPanelIntentions((p) => p.filter((x) => x.id !== id));

    try {
      const { error } = await supabase
        .from(PANEL_INTENTIONS_TABLE)
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);

      if (error) throw error;

      if (target?.text && normalizeIntentionVisibility(target.visibility) === "public") {
        void deleteOwnSessionIntentionByText(target.text);
      }
    } catch {
      setPanelIntentions(prev);
    }
  };

  const startEdit = (id: string, text: string) => {
    setEditingId(id);
    setEditingText(text || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const saveEdit = async () => {
    if (!user?.id) return;
    if (!editingId) return;

    const text = safeTrim(editingText);
    if (!text) return;

    const targetId = editingId;
    const prev = panelIntentions;
    const prevItem = panelIntentions.find((x) => x.id === targetId) || null;
    const prevText = prevItem?.text || text;
    const prevCompleted = Boolean(prevItem?.completed);

    setPanelIntentions((p) =>
      p.map((x) => (x.id === targetId ? { ...x, text } : x)),
    );

    try {
      const { error } = await supabase
        .from(PANEL_INTENTIONS_TABLE)
        .update({ text })
        .eq("id", targetId)
        .eq("user_id", user.id);

      if (error) throw error;

      setEditingId(null);
      setEditingText("");

      if (isPanelIntentionVisibleInRoom(prevItem)) {
        void upsertOwnSessionIntention({
          matchText: prevText,
          text,
          completed: prevCompleted,
        });
      }
    } catch {
      setPanelIntentions(prev);
    }
  };

  const togglePanelVisibility = async (it: PanelIntention) => {
    if (!user?.id) return;
    if (!it?.id) return;

    const nextVisibility = getNextIntentionVisibility(it.visibility);
    const nextVisibleInRoom = nextVisibility !== "private";
    const prev = panelIntentions;

    setPanelIntentions((items) =>
      items.map((x) =>
        x.id === it.id ? { ...x, visibility: nextVisibility } : x,
      ),
    );

    try {
      const { error } = await supabase
        .from(PANEL_INTENTIONS_TABLE)
        .update({ visibility: nextVisibility })
        .eq("id", it.id)
        .eq("user_id", user.id);

      if (error) throw error;

      if (nextVisibleInRoom) {
        void upsertOwnSessionIntention({
          matchText: it.text,
          text: it.text,
          completed: Boolean(it.completed),
        });
      } else {
        void deleteOwnSessionIntentionByText(it.text);
      }
    } catch {
      setPanelIntentions(prev);
    }
  };

  const closeOverlay = useCallback(() => {
    const o = overlayRef.current;
    overlayRef.current = null;
    setOverlayOpen(false);
    try {
      o?.win?.close?.();
    } catch { }
  }, []);

  const openOverlay = useCallback(async () => {
    if (overlayRef.current) return;

    const canPip = !!window.documentPictureInPicture?.requestWindow;

    try {
      if (canPip) {
        const pipWin = await window.documentPictureInPicture!.requestWindow({
          width: 420,
          height: 720,
        });
        pipWin.document.title = "Intentions";
        applyOverlayBaseStyles(pipWin.document, isLight);
        copyStylesToDocument(document, pipWin.document);

        const container = pipWin.document.createElement("div");
        container.style.height = "100vh";
        container.style.width = "100vw";
        container.style.fontFamily = OVERLAY_FONT_FAMILY;
        pipWin.document.body.appendChild(container);

        overlayRef.current = { win: pipWin, container, kind: "pip" };
        setOverlayOpen(true);

        pipWin.addEventListener("pagehide", closeOverlay);
        pipWin.addEventListener("beforeunload", closeOverlay);
        return;
      }

      const w = window.open(
        "",
        "mysession_intentions",
        "popup,width=420,height=720",
      );
      if (!w) return;

      w.document.title = "Intentions";
      applyOverlayBaseStyles(w.document, isLight);
      copyStylesToDocument(document, w.document);

      const container = w.document.createElement("div");
      container.style.height = "100vh";
      container.style.width = "100vw";
      container.style.fontFamily = OVERLAY_FONT_FAMILY;
      w.document.body.appendChild(container);

      overlayRef.current = { win: w, container, kind: "window" };
      setOverlayOpen(true);

      w.addEventListener("beforeunload", closeOverlay);
    } catch { }
  }, [closeOverlay, isLight]);

  useEffect(() => {
    return () => {
      try {
        if (sessionReloadTimerRef.current) {
          window.clearTimeout(sessionReloadTimerRef.current);
          sessionReloadTimerRef.current = null;
        }
        closeOverlay();
      } catch { }
    };
  }, [closeOverlay]);

  useEffect(() => {
    const onOpenPinnedIntentions = () => {
      void openOverlay();
    };

    window.addEventListener(
      "mysession:intentions-open-pinned",
      onOpenPinnedIntentions,
    );

    return () => {
      window.removeEventListener(
        "mysession:intentions-open-pinned",
        onOpenPinnedIntentions,
      );
    };
  }, [openOverlay]);

  const getPortalDocument = useCallback((): Document => {
    const o = overlayRef.current;
    const doc = o?.win?.document;
    return doc || document;
  }, []);

  const openImportModal = useCallback(() => setImportModalOpen(true), []);
  const closeImportModal = useCallback(() => setImportModalOpen(false), []);

  useEffect(() => {
    if (!importModalOpen) return;

    const doc = getPortalDocument();
    const win: any = doc?.defaultView || window;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeImportModal();
      }
    };

    win.addEventListener("keydown", onKeyDown);
    return () => win.removeEventListener("keydown", onKeyDown);
  }, [importModalOpen, closeImportModal, getPortalDocument]);

  const teamIntentions = useMemo(() => {
    return sessionIntentions.slice(0, TEAM_INTENTIONS_RENDER_LIMIT);
  }, [sessionIntentions]);

  if (!rawSessionId) {
    return (
      <div
        className={
          "h-full flex items-center justify-center font-inter " + panelBg
        }
      >
        <div className={"text-[12px] italic font-inter " + mutedText}>
          No session id
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div
        className={
          "h-full flex items-center justify-center font-inter " + panelBg
        }
      >
        <div className={"text-[12px] italic font-inter " + mutedText}>
          Resolving session...
        </div>
      </div>
    );
  }

  const timerPillCls = "bg-[#F3F1F1] border border-[#CFC6C6] text-black/80";
  const headerTitle = "text-black/90";
  const timerTextCls =
    `tabular-nums text-[12px] ${timerTextClassName || ""} font-inter font-normal`.trim();

  const ImportModal = importModalOpen
    ? (() => {
      const modalDoc = getPortalDocument();

      const backdropBg = isLight ? "bg-black/40" : "bg-[#E6E6E6]";
      const modalBg = isLight ? "bg-[#F3F3F3]" : "bg-[#1B1B1B]";
      const modalBorder = isLight ? "border-[#CFCFCF]" : "border-[#2B2B2B]";
      const modalTitle = isLight ? "text-black/85" : "text-white/85";
      const modalSub = isLight ? "text-black/50" : "text-white/45";
      const rowBg = isLight
        ? "bg-[#FAFAFA] hover:bg-[#F3F3F3]"
        : "bg-[#242424] hover:bg-[#2B2B2B]";
      const rowBorder = isLight ? "border-[#CFCFCF]" : "border-[#2B2B2B]";

      return createPortal(
        <div
          className={[
            "fixed inset-0 z-[9999] flex items-center justify-center",
            backdropBg,
            "font-inter",
          ].join(" ")}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeImportModal();
          }}
        >
          <div
            className={[
              "w-[min(760px,calc(100vw-24px))] max-h-[min(78vh,780px)] rounded-2xl border shadow-xl overflow-hidden",
              modalBg,
              modalBorder,
            ].join(" ")}
            style={{ fontFamily: OVERLAY_FONT_FAMILY }}
            onMouseDown={stopRoomBubbling}
            onPointerDown={stopRoomBubbling}
            onClick={stopRoomBubbling}
          >
            <div className={["px-4 py-3 border-b", modalBorder].join(" ")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div
                    className={["text-[13px] font-semibold", modalTitle].join(
                      " ",
                    )}
                  >
                    Attach to Intention Panel
                  </div>
                  <div className={["text-[11px] mt-0.5", modalSub].join(" ")}>
                    Imports Focus plan items into your global panel intentions
                    (visible in every session).
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    className={
                      "h-9 px-3 rounded-xl text-[12px] font-semibold transition inline-flex items-center gap-2 " +
                      ghostBtn
                    }
                    onClick={() => {
                      const sid = (rawSessionId || sessionId || "").trim();
                      window.open(
                        `/focus-plan?sessionId=${encodeURIComponent(sid)}`,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                    title="Go to Focus Plan"
                  >
                    <ExternalLink size={14} />
                    Go to Focus Plan
                  </button>

                  <button
                    type="button"
                    className={
                      "h-9 px-3 rounded-xl text-[12px] font-semibold transition inline-flex items-center gap-2 " +
                      ghostBtn
                    }
                    onClick={() => loadPlans()}
                    title="Refresh plans"
                  >
                    <RefreshCw size={14} />
                    Refresh
                  </button>

                  <button
                    type="button"
                    className={
                      "w-9 h-9 rounded-xl border transition flex items-center justify-center " +
                      ghostBtn
                    }
                    onClick={closeImportModal}
                    title="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </div>

            <div
              className="p-4 overflow-y-auto custom-scrollbar"
              style={{ maxHeight: "calc(78vh - 56px)" }}
            >
              {plansLoading ? (
                <div className={"text-[12px] italic " + mutedText}>
                  Loading plans…
                </div>
              ) : plans.length === 0 ? (
                <div className={"text-[12px] italic " + mutedText}>
                  No plans found. Create a plan in Focus plan page.
                  {lastPlansLoadedAt
                    ? ` (checked ${new Date(lastPlansLoadedAt).toLocaleTimeString()})`
                    : ""}
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <div className={"text-[11px] font-semibold " + mutedText}>
                      Plan
                    </div>

                    <select
                      value={selectedPlanId}
                      onChange={(e) => setSelectedPlanId(e.target.value)}
                      className={
                        isLight
                          ? "w-full h-11 px-3 rounded-xl border border-[#CFCFCF] bg-[#F3F3F3] text-[13px] font-semibold text-black/85 outline-none focus:ring-1 focus:ring-[#81DB86]"
                          : "w-full h-11 px-3 rounded-xl border border-[#2B2B2B] bg-[#242424] text-[13px] font-semibold text-white/85 outline-none focus:ring-1 focus:ring-[#81DB86]"
                      }
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>

                    <div
                      className={
                        "text-[11px] font-semibold " + mutedText + " mt-2"
                      }
                    >
                      Search
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className={[
                          "h-11 w-11 rounded-xl border flex items-center justify-center",
                          isLight
                            ? "border-[#CFCFCF] bg-[#F3F3F3]"
                            : "border-[#2B2B2B] bg-[#242424]",
                        ].join(" ")}
                      >
                        <Search
                          size={16}
                          className={
                            isLight ? "text-black/40" : "text-white/45"
                          }
                        />
                      </div>

                      <input
                        value={planSearch}
                        onChange={(e) => setPlanSearch(e.target.value)}
                        placeholder="Type to filter plan items..."
                        className={"flex-1 " + inputCls}
                      />
                    </div>
                  </div>

                  <div className={"h-px my-4 " + divider} />

                  {planItemsLoading ? (
                    <div className={"text-[12px] italic " + mutedText}>
                      Loading items…
                    </div>
                  ) : filteredPlanItems.length === 0 ? (
                    <div className={"text-[12px] italic " + mutedText}>
                      No items match your filter.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {renderedPlanItems.map((it) => {
                        const text = safeTrim(it.text);
                        const inPanelById = panelIntentions.some(
                          (p) =>
                            String(p.focus_plan_item_id || "") ===
                            String(it.id),
                        );
                        const inPanelByText = panelTextSet.has(
                          normalizeTextForMatch(text),
                        );
                        const already = inPanelById || inPanelByText;

                        return (
                          <div
                            key={it.id}
                            className={[
                              "rounded-xl border px-3 py-2.5 transition",
                              rowBg,
                              rowBorder,
                            ].join(" ")}
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <div
                                  className={[
                                    "text-[13px] break-words leading-5",
                                    it.completed
                                      ? isLight
                                        ? "text-black/45 line-through"
                                        : "text-white/50 line-through"
                                      : isLight
                                        ? "text-black/80"
                                        : "text-white/80",
                                  ].join(" ")}
                                >
                                  {text}
                                </div>

                                <div
                                  className={"mt-1 text-[11px] " + mutedText}
                                >
                                  {already
                                    ? "Already in your panel"
                                    : "Focus plan item"}
                                  {it.target_date
                                    ? ` · Due: ${it.target_date}`
                                    : ""}
                                </div>
                              </div>

                              {already ? (
                                <div className="shrink-0">
                                  <div
                                    className={[
                                      "h-10 px-3 rounded-xl text-[12px] font-semibold inline-flex items-center gap-2",
                                      isLight
                                        ? "bg-[#E6E6E6] text-black/60 border border-[#CFCFCF]"
                                        : "bg-[#242424] text-white/70 border border-[#2B2B2B]",
                                    ].join(" ")}
                                    title="Already attached to panel"
                                  >
                                    <Check size={16} />
                                    Attached
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => importPlanItemToPanel(it)}
                                  disabled={importingItemId === it.id}
                                  className={[
                                    "shrink-0 h-10 px-3 rounded-xl text-[12px] font-semibold transition inline-flex items-center gap-2",
                                    importingItemId === it.id
                                      ? "opacity-70"
                                      : "opacity-100",
                                    primaryBtn,
                                  ].join(" ")}
                                  title="Attach to panel"
                                >
                                  <ListPlus size={16} />
                                  {importingItemId === it.id
                                    ? "Attaching..."
                                    : "Attach"}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className={"mt-4 text-[11px] " + mutedText}>
                    Tip: this is your “always-on” intentions list. It stays
                    the same across sessions.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        modalDoc.body,
      );
    })()
    : null;

  const encouragementModalItem = encouragementModalIntentionId
    ? teamIntentions.find((x) => x.id === encouragementModalIntentionId) || null
    : null;

  const EncouragementModal = encouragementModalIntentionId
    ? createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/35 font-inter"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setEncouragementModalIntentionId(null);
        }}
      >
        <div
          className="w-[min(360px,calc(100vw-24px))] rounded-2xl border border-[#CFC6C6] bg-[#F3F1F1] shadow-xl overflow-hidden"
          onMouseDown={stopRoomBubbling}
          onPointerDown={stopRoomBubbling}
          onClick={stopRoomBubbling}
        >
          <div className="px-4 py-3 border-b border-[#D8D0D0] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-black/90">Encouragements</div>
              <div className="text-[11px] text-black/50 truncate">
                {encouragementModalItem?.text || "Team intention"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEncouragementModalIntentionId(null)}
              className="w-8 h-8 rounded-xl border border-[#CFC6C6] bg-[#ECEAEA] hover:bg-[#E3E0E0] flex items-center justify-center"
              title="Close"
            >
              <X size={15} />
            </button>
          </div>

          <div className="p-3 max-h-[360px] overflow-y-auto custom-scrollbar">
            {(encouragementUsersByIntention[encouragementModalIntentionId] || []).length === 0 ? (
              <div className="text-[12px] italic text-black/55 px-1 py-2">
                No encouragements yet.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {(encouragementUsersByIntention[encouragementModalIntentionId] || []).map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center gap-3 rounded-xl border border-[#CFC6C6] bg-[#F7F5F5] px-3 py-2"
                  >
                    <img
                      src={getAvatar(u)}
                      className="w-8 h-8 rounded-full object-cover shrink-0"
                      alt=""
                    />
                    <div className="min-w-0 flex-1 text-[13px] font-medium text-black/85 truncate">
                      {u.full_name || "Participant"}
                    </div>
                    <div className="shrink-0 h-8 min-w-8 rounded-full bg-[#E6E6E6] flex items-center justify-center px-2">
                      <PanelSmartIcon
                        name="encouragement"
                        theme={panelTheme}
                        className="w-5 h-5"
                        alt="Encouragement"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>,
      getPortalDocument().body,
    )
    : null;

  const PanelUI = (
    <div
      className={"h-full flex flex-col min-h-0 font-inter " + panelBg}
      onPointerDown={stopRoomBubbling}
      onMouseDown={stopRoomBubbling}
      onClick={stopRoomBubbling}
    >
      <div className="px-4 pt-4 pb-2 shrink-0">
        <div
          className={
            "rounded-[22px] border px-4 py-3 " + headerBorder + " " + headerBg
          }
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div
                className={"font-inter font-bold text-[16px] leading-5 " + headerTitle}
              >
                Intentions
              </div>
              <div className={"mt-1 text-[11px] leading-5 font-inter " + titleText}>
                Keep it visible while you work
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 font-inter">
              <div
                className={
                  "inline-flex items-center gap-2 px-3 py-2 rounded-xl " +
                  timerPillCls
                }
                title="Timer"
              >
                <TimerSmartIcon
                  theme={panelTheme}
                  className="w-4 h-4 opacity-80"
                />
                <span
                  className={timerTextCls + " leading-none"}
                  style={{ fontFamily: OVERLAY_FONT_FAMILY }}
                >
                  {timerText || "--:--"}
                </span>
              </div>

              <IconButton
                theme={panelTheme}
                className={
                  "border border-[#5286F6] bg-[#5286F6]/10 text-[#5286F6] hover:bg-[#5286F6]/15"
                }
                title="Attach from Focus plan to panel"
                onClick={(e) => {
                  e.preventDefault();
                  openImportModal();
                }}
              >
                <PanelSmartIcon
                  name="focus-plan"
                  theme={panelTheme}
                  className="w-4 h-4"
                  alt="Focus plan"
                />
              </IconButton>

              {pictureInPictureSupported && onOpenPictureInPicture ? (
                <IconButton
                  theme={panelTheme}
                  className="border border-[#81DB86] bg-[#81DB86]/10 text-[#2FA84F] hover:bg-[#81DB86]/15"
                  title={
                    pictureInPictureOpen
                      ? "Close Picture-in-Picture video"
                      : "Open video Picture-in-Picture"
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenPictureInPicture();
                  }}
                >
                  <PanelSmartIcon
                    name="pip-intentions"
                    theme={panelTheme}
                    className="w-4 h-4"
                    alt="Picture-in-Picture"
                  />
                </IconButton>
              ) : null}

              <IconButton
                theme={panelTheme}
                className={
                  "border border-[#F65252] bg-[#F65252]/10 text-[#F65252] hover:bg-[#F65252]/15"
                }
                title={overlayOpen ? "Unpin" : "Pin (always on top if supported)"}
                onClick={(e) => {
                  e.preventDefault();
                  if (overlayOpen) closeOverlay();
                  else void openOverlay();
                }}
              >
                <PanelSmartIcon
                  name="pin"
                  theme={panelTheme}
                  className="w-4 h-4"
                  alt="Pin"
                />
              </IconButton>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pb-4 pt-5 min-h-0 flex-1 overflow-y-auto custom-scrollbar font-inter">
        <div className="mb-5">
          <div
            className={titleText + " font-inter font-bold text-[17px] mb-5"}
          >
            My intentions
          </div>

          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={newIntention}
              onChange={(e) => setNewIntention(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddPanelIntention()}
              placeholder="Add an intention"
              className={"flex-1 " + inputCls}
            />

            <button
              onClick={handleAddPanelIntention}
              className={[
                "h-12 px-5 rounded-[18px] font-semibold text-[14px] font-inter transition",
                "bg-[#1F1F1F] hover:bg-[#2A2A2A] text-white",
              ].join(" ")}
              type="button"
              title="Add"
            >
              Add
            </button>
          </div>

          {panelLoading ? (
            <div className={"text-[12px] italic font-inter " + mutedText}>
              Loading...
            </div>
          ) : panelIntentions.length === 0 ? (
            <div className={"text-[12px] italic font-inter " + mutedText}>
              No panel intentions yet. Attach from Focus plan or add manually.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {panelIntentions.map((i) => {
                const isEditing = editingId === i.id;

                const circleCls = "text-black/40";
                const textDoneCls = "text-black/45 line-through";
                const textActiveCls = "text-black/80";

                const editInputCls = `
                    w-full bg-[#F3F3F3] border border-[#C9C9C9] rounded-xl
                    px-3 py-2 text-[13px] text-black/85
                    outline-none focus:ring-1 focus:ring-[#81DB86] focus:border-[#81DB86]
                    font-inter
                  `;

                return (
                  <div
                    key={i.id}
                    className={myCardCls + " font-inter"}
                    onClick={() => togglePanelCompleted(i)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startEdit(i.id, i.text);
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="shrink-0">
                        {i.completed ? (
                          <CheckCircle size={18} className="text-[#81DB86]" />
                        ) : (
                          <Circle size={18} className={circleCls} />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {!isEditing ? (
                          <div
                            className={
                              "text-[13px] break-words leading-5 font-inter " +
                              (i.completed ? textDoneCls : textActiveCls)
                            }
                          >
                            {i.text}
                          </div>
                        ) : (
                          <input
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                            className={editInputCls}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}

                        {i.focus_plan_item_id ? (
                          <div className={"mt-1 text-[11px] " + mutedText}>
                            Linked to Focus plan item
                          </div>
                        ) : null}
                      </div>

                      <div className="shrink-0 flex items-center gap-1.5 rounded-full bg-[#F7F5F5]">
                        {!isEditing ? (
                          <>
                            <button
                              type="button"
                              title={getVisibilityTitle(i.visibility)}
                              onClick={(e) => {
                                e.stopPropagation();
                                void togglePanelVisibility(i);
                              }}
                              className={[
                                "h-9 w-9 shrink-0 rounded-full border text-[13px] font-semibold transition inline-flex items-center justify-center",
                                normalizeIntentionVisibility(i.visibility) ===
                                  "public"
                                  ? "border-[#81DB86] bg-[#81DB86]/15 text-[#248A3D] hover:bg-[#81DB86]/25"
                                  : "border-[#CFC6C6] bg-[#F3F1F1] text-black/55 hover:bg-[#ECEAEA]",
                              ].join(" ")}
                            >
                              {normalizeIntentionVisibility(i.visibility) ===
                                "private" ? (
                                <Lock size={14} />
                              ) : (
                                <Unlock size={14} />
                              )}
                            </button>

                            <div className="max-w-0 overflow-hidden opacity-0 transition-all duration-150 group-hover:max-w-[44px] group-hover:opacity-100 focus-within:max-w-[44px] focus-within:opacity-100">
                              <IconButton
                                theme={panelTheme}
                                title="Edit"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEdit(i.id, i.text);
                                }}
                              >
                                <Pencil size={16} />
                              </IconButton>
                            </div>

                            <div className="max-w-0 overflow-hidden opacity-0 transition-all duration-150 group-hover:max-w-[44px] group-hover:opacity-100 focus-within:max-w-[44px] focus-within:opacity-100">
                              <IconButton
                                theme={panelTheme}
                                title="Delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void deletePanelIntention(i.id);
                                }}
                                className="hover:text-[#F65252]"
                              >
                                <Trash2 size={16} />
                              </IconButton>
                            </div>
                          </>
                        ) : (
                          <>
                            <IconButton
                              theme={panelTheme}
                              title="Save"
                              onClick={(e) => {
                                e.stopPropagation();
                                void saveEdit();
                              }}
                              className="hover:text-emerald-600"
                            >
                              <Check size={18} />
                            </IconButton>

                            <IconButton
                              theme={panelTheme}
                              title="Cancel"
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelEdit();
                              }}
                            >
                              <X size={18} />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={"h-px my-5 " + divider} />

        <div
          className={titleText + " font-inter font-bold text-[17px] mb-4"}
        >
          Team intentions
        </div>

        {sessionLoading ? (
          <div className={"text-[12px] italic font-inter " + mutedText}>
            Loading...
          </div>
        ) : teamIntentions.length === 0 ? (
          <div className={"text-[12px] italic font-inter " + mutedText}>
            No team intentions
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {teamIntentions.map((item) => {
              const nameCls = "text-black/90";
              const bodyActive = "text-black/85";
              const bodyDone = "text-black/35 line-through";
              const circleCls = "text-black/25";
              const encouragementCount = encouragementCounts[item.id] || 0;
              const encouragedByMe = myEncouragedIds.has(item.id);
              const statusText = item.completed ? "Completed" : "In progress";

              return (
                <div key={item.id} className={teamCardCls + " font-inter"}>
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={getAvatar(item.profiles)}
                      className="w-9 h-9 rounded-full object-cover shrink-0"
                      alt=""
                    />

                    <div className="flex-1 min-w-0">
                      <div
                        className={
                          "text-[13px] font-medium truncate font-inter " +
                          nameCls
                        }
                      >
                        {item.profiles?.full_name || "Participant"}
                      </div>

                      <div
                        className={
                          "text-[13px] truncate leading-5 font-inter " +
                          (item.completed ? bodyDone : bodyActive)
                        }
                      >
                        {item.text}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      <div
                        className={[
                          "h-8 rounded-full border px-3 text-[12px] font-medium inline-flex items-center gap-1.5",
                          item.completed
                            ? "border-[#81DB86] text-[#2FA84F] bg-[#81DB86]/10"
                            : "border-[#5286F6] text-[#5286F6] bg-[#5286F6]/10",
                        ].join(" ")}
                        title={statusText}
                      >
                        {item.completed ? (
                          <CheckCircle size={14} />
                        ) : (
                          <Circle size={14} className={circleCls} />
                        )}
                        <span>{statusText}</span>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleEncouragement(item.id);
                        }}
                        className={[
                          "h-8 min-w-8 rounded-full border px-2 inline-flex items-center justify-center transition",
                          encouragedByMe
                            ? "border-[#CFC6C6] bg-[#E6E6E6]"
                            : "border-[#CFC6C6] bg-[#F3F1F1] hover:bg-[#ECEAEA]",
                        ].join(" ")}
                        title="Send encouragement"
                        aria-label="Send encouragement"
                      >
                        <PanelSmartIcon
                          name="encouragement"
                          theme={panelTheme}
                          className="w-5 h-5"
                          alt="Encouragement"
                        />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEncouragementModalIntentionId(item.id);
                        }}
                        disabled={encouragementCount <= 0}
                        className={[
                          "h-8 min-w-8 rounded-full border px-2 text-[12px] font-semibold transition",
                          encouragementCount > 0
                            ? "border-[#CFC6C6] bg-[#F3F1F1] text-black/65 hover:bg-[#ECEAEA]"
                            : "border-[#CFC6C6] bg-[#F3F1F1] text-black/30 cursor-default",
                        ].join(" ")}
                        title={
                          encouragementCount > 0
                            ? "See who sent encouragement"
                            : "No encouragements yet"
                        }
                      >
                        {encouragementCount > 99 ? "99+" : encouragementCount}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {ImportModal}
      {EncouragementModal}
    </div>
  );

  return (
    <>
      {overlayOpen && overlayRef.current?.container
        ? createPortal(PanelUI, overlayRef.current.container)
        : null}

      {!overlayOpen ? (
        PanelUI
      ) : (
        <div
          className={
            "h-full flex items-center justify-center font-inter " + panelBg
          }
          onPointerDown={stopRoomBubbling}
          onMouseDown={stopRoomBubbling}
          onClick={stopRoomBubbling}
        >
          <div className="text-center font-inter">
            <div className={"text-[12px] font-inter " + titleText}>Pinned</div>
            <div className={"text-[12px] italic mt-1 font-inter " + mutedText}>
              Intentions are opened in a floating window.
            </div>
            <button
              type="button"
              onClick={closeOverlay}
              className={`
                mt-4 px-4 py-2 rounded-xl border
                ${"border-black/15 text-black/80 hover:bg-[#E8E8E8]"}
                transition inline-flex items-center gap-2 text-[13px] font-semibold font-inter
              `}
            >
              <PanelSmartIcon
                name="pin"
                theme={panelTheme}
                className="w-4 h-4"
                alt="Pin"
              />
              Unpin
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default IntentionsPanel;
