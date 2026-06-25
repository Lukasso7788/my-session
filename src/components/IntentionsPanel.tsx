// src/components/IntentionsPanel.tsx

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { ReactNode, MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle,
  Circle,
  Trash2,
  Pencil,
  X,
  Check,
  ExternalLink,
  ListPlus,
  RefreshCw,
  Search,
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DocPiPWindow = Window & { document: Document; close: () => void };

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (opts?: { width?: number; height?: number }) => Promise<DocPiPWindow>;
    };
  }
}

const OVERLAY_FONT_FAMILY =
  'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';

const PANEL_INTENTIONS_TABLE = "panel_intentions";
const SESSION_INTENTIONS_TABLE = "intentions";

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


function PanelSmartIcon({
  name,
  theme,
  className = "w-4 h-4",
  alt,
}: {
  name: "focus-plan" | "pip-intentions" | "pin";
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
    ? "bg-[#ECEFF3] hover:bg-[#E2E6EC] text-black/70"
    : "bg-[#2F2F2F] hover:bg-[#3A3A3A] text-white/80";

  return (
    <button
      title={title}
      onClick={onClick}
      className={"w-9 h-9 rounded-xl flex items-center justify-center transition " + base + " " + className}
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
        'style, link[rel="stylesheet"], link[rel="preconnect"], link[rel="preload"]'
      )
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
    doc.body.style.background = isLight ? "#ffffff" : "#2F2F2F";
    doc.body.style.fontFamily = OVERLAY_FONT_FAMILY;
  } catch { }
}

function safeTrim(x: unknown) {
  return String(x || "").trim();
}

function normalizeTextForMatch(x: unknown) {
  return String(x || "").replace(/\s+/g, " ").trim().toLowerCase();
}

async function fetchProfilesMap(userIds: string[]): Promise<Map<string, ProfileMini>> {
  const ids = [...new Set((userIds || []).map((x) => String(x || "").trim()).filter(Boolean))];
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

  const isLight = theme === "light";

  const [user, setUser] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [panelIntentions, setPanelIntentions] = useState<PanelIntention[]>([]);
  const [panelLoading, setPanelLoading] = useState(true);

  const [sessionIntentions, setSessionIntentions] = useState<SessionIntention[]>([]);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [newIntention, setNewIntention] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");

  const loadSeqRef = useRef(0);
  const panelSeqRef = useRef(0);
  const sessionReloadTimerRef = useRef<number | null>(null);

  const [timerText, setTimerText] = useState<string>("--:--");

  const overlayRef = useRef<{ win: Window | null; container: HTMLElement; kind: "pip" | "window" } | null>(null);
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

  const titleText = isLight ? "text-black/85" : "text-white/85";
  const mutedText = isLight ? "text-black/50" : "text-white/45";
  const divider = isLight ? "bg-[#E2E6EC]" : "bg-[#3A3A3A]";

  const panelBg = isLight ? "bg-[#F3F4F6]" : "bg-[#2F2F2F]";
  const headerBg = isLight ? "bg-[#F3F4F6]/95" : "bg-[#2F2F2F]/95";
  const headerBorder = isLight ? "border-[#D8DDE5]" : "border-white/10";

  const inputCls = isLight
    ? `
      bg-[#F7F8FA] border border-[#D8DDE5] rounded-xl
      px-3 py-3 text-[13px] text-black/85 placeholder:text-black/35
      outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
      font-inter
    `
    : `
      bg-[#3A3A3A]/70 border border-white/10 rounded-xl
      px-3 py-3 text-[13px] text-white/85 placeholder:text-white/35
      outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
      font-inter
    `;

  const myCardCls = isLight
    ? "group rounded-xl border border-[#D8DDE5] px-3 py-2.5 bg-[#3D3D3D]0 hover:bg-[#F7F8FA] transition cursor-pointer"
    : "group rounded-xl border border-white/5 px-3 py-2.5 bg-[#3A3A3A]/55 hover:bg-[#3A3A3A]/75 transition cursor-pointer";

  const teamCardCls = isLight
    ? "rounded-xl border border-[#D8DDE5] px-3 py-2.5 bg-[#3D3D3D]0 hover:bg-[#F7F8FA] transition"
    : "rounded-xl border border-white/5 px-3 py-2.5 bg-[#3A3A3A]/55 hover:bg-[#3A3A3A]/75 transition";

  const ghostBtn = isLight
    ? "border border-[#D8DDE5] bg-transparent hover:bg-[#E7EAF0] text-black/75"
    : "border border-white/10 bg-transparent hover:bg-[#3F3F3F] text-white/80";

  const primaryBtn = "bg-emerald-500 hover:bg-emerald-600 text-[#02140B] font-semibold";

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
        const v = localStorage.getItem("mysession_timer_text") || localStorage.getItem("timer_text") || "";
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
    profile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || "User")}`;

  const loadPanelIntentions = useCallback(async () => {
    if (!user?.id) return;

    const seq = ++panelSeqRef.current;
    setPanelLoading(true);

    try {
      const { data, error } = await supabase
        .from(PANEL_INTENTIONS_TABLE)
        .select("id,user_id,text,focus_plan_item_id,completed,created_at,updated_at")
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
        { event: "*", schema: "public", table: PANEL_INTENTIONS_TABLE, filter: `user_id=eq.${user.id}` },
        () => void loadPanelIntentions()
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
    [sessionId]
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
    [sessionId, loadSessionIntentions]
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
          const payloadSessionId = String(payload?.new?.session_id || payload?.old?.session_id || "").trim();

          if (!payloadSessionId || payloadSessionId === String(sessionId)) {
            scheduleSessionIntentionsReload(sessionId);
          }
        }
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
            normalizeTextForMatch(x.text) === norm
        ) || null
      );
    },
    [user?.id, sessionId, sessionIntentions]
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
        if (typeof completed === "boolean" && Boolean(existing.completed) !== completed) {
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
          setSessionIntentions((prev) => [data as SessionIntention, ...prev].slice(0, SESSION_INTENTIONS_FETCH_LIMIT));
        }

        void loadSessionIntentions(sessionId);
        return data?.id || null;
      } catch {
        void loadSessionIntentions(sessionId);
        return null;
      }
    },
    [user?.id, sessionId, findOwnSessionIntentionLocal, loadSessionIntentions]
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
    [user?.id, sessionId, findOwnSessionIntentionLocal, loadSessionIntentions, scheduleSessionIntentionsReload]
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
          .select("id,plan_id,user_id,text,target_date,session_id,created_at,completed,sort_order")
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
    [user?.id]
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
    const base = (planItems || []).filter((it) => safeTrim(it?.text).length > 0);
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
    [user?.id]
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
        const alreadyById = panelIntentions.some((p) => String(p.focus_plan_item_id || "") === String(item.id));
        if (!alreadyById) {
          const existingSameText = panelIntentions.find((p) => normalizeTextForMatch(p.text) === norm) || null;

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
    [user?.id, panelIntentions, loadPanelIntentions, upsertOwnSessionIntention]
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
    };

    setPanelIntentions((prev) => [optimistic, ...prev].slice(0, PANEL_INTENTIONS_FETCH_LIMIT));

    try {
      const { data, error } = await supabase
        .from(PANEL_INTENTIONS_TABLE)
        .insert({ user_id: user.id, text, completed: false } as any)
        .select("id,user_id,text,focus_plan_item_id,completed,created_at,updated_at")
        .single();

      if (error || !data) {
        setPanelIntentions((prev) => prev.filter((x) => x.id !== optimisticId));
        return;
      }

      setPanelIntentions((prev) =>
        [data as PanelIntention, ...prev.filter((x) => x.id !== optimisticId)].slice(0, PANEL_INTENTIONS_FETCH_LIMIT)
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

    setPanelIntentions((prev) => prev.map((x) => (x.id === it.id ? { ...x, completed: next } : x)));

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

      void upsertOwnSessionIntention({
        matchText: it.text,
        text: it.text,
        completed: next,
      });
    } catch {
      setPanelIntentions((prev) => prev.map((x) => (x.id === it.id ? { ...x, completed: !next } : x)));
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

      if (target?.text) {
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

    setPanelIntentions((p) => p.map((x) => (x.id === targetId ? { ...x, text } : x)));

    try {
      const { error } = await supabase
        .from(PANEL_INTENTIONS_TABLE)
        .update({ text })
        .eq("id", targetId)
        .eq("user_id", user.id);

      if (error) throw error;

      setEditingId(null);
      setEditingText("");

      void upsertOwnSessionIntention({
        matchText: prevText,
        text,
        completed: prevCompleted,
      });
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
        const pipWin = await window.documentPictureInPicture!.requestWindow({ width: 420, height: 720 });
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

      const w = window.open("", "mysession_intentions", "popup,width=420,height=720");
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

    window.addEventListener("mysession:intentions-open-pinned", onOpenPinnedIntentions);

    return () => {
      window.removeEventListener("mysession:intentions-open-pinned", onOpenPinnedIntentions);
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
      <div className={"h-full flex items-center justify-center font-inter " + panelBg}>
        <div className={"text-[12px] italic font-inter " + mutedText}>No session id</div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className={"h-full flex items-center justify-center font-inter " + panelBg}>
        <div className={"text-[12px] italic font-inter " + mutedText}>Resolving session...</div>
      </div>
    );
  }

  const timerPillCls = isLight ? "bg-[#ECEFF3] border border-[#D8DDE5] text-black/80" : "bg-[#3A3A3A] border border-white/10 text-white/80";
  const headerTitle = isLight ? "text-black/85" : "text-white/85";
  const timerTextCls = `tabular-nums text-[12px] ${timerTextClassName || ""} font-inter font-normal`.trim();

  const ImportModal = importModalOpen
    ? (() => {
      const modalDoc = getPortalDocument();

      const backdropBg = isLight ? "bg-black/40" : "bg-[#ECEFF3]5";
      const modalBg = isLight ? "bg-[#F7F8FA]" : "bg-[#2F2F2F]";
      const modalBorder = isLight ? "border-[#D8DDE5]" : "border-white/10";
      const modalTitle = isLight ? "text-black/85" : "text-white/85";
      const modalSub = isLight ? "text-black/50" : "text-white/45";
      const rowBg = isLight ? "bg-[#3D3D3D]0 hover:bg-[#F7F8FA]" : "bg-[#3A3A3A]/55 hover:bg-[#3A3A3A]/75";
      const rowBorder = isLight ? "border-[#D8DDE5]" : "border-white/10";

      return createPortal(
        <div
          className={["fixed inset-0 z-[9999] flex items-center justify-center", backdropBg, "font-inter"].join(" ")}
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
                  <div className={["text-[13px] font-semibold", modalTitle].join(" ")}>Attach to Intention Panel</div>
                  <div className={["text-[11px] mt-0.5", modalSub].join(" ")}>
                    Imports Focus plan items into your global panel intentions (visible in every session).
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    className={"h-9 px-3 rounded-xl text-[12px] font-semibold transition inline-flex items-center gap-2 " + ghostBtn}
                    onClick={() => {
                      const sid = (rawSessionId || sessionId || "").trim();
                      window.open(`/focus-plan?sessionId=${encodeURIComponent(sid)}`, "_blank", "noopener,noreferrer");
                    }}
                    title="Go to Focus Plan"
                  >
                    <ExternalLink size={14} />
                    Go to Focus Plan
                  </button>

                  <button
                    type="button"
                    className={"h-9 px-3 rounded-xl text-[12px] font-semibold transition inline-flex items-center gap-2 " + ghostBtn}
                    onClick={() => loadPlans()}
                    title="Refresh plans"
                  >
                    <RefreshCw size={14} />
                    Refresh
                  </button>

                  <button
                    type="button"
                    className={"w-9 h-9 rounded-xl border transition flex items-center justify-center " + ghostBtn}
                    onClick={closeImportModal}
                    title="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </div>

            <div className="p-4 overflow-y-auto custom-scrollbar" style={{ maxHeight: "calc(78vh - 56px)" }}>
              {plansLoading ? (
                <div className={"text-[12px] italic " + mutedText}>Loading plans…</div>
              ) : plans.length === 0 ? (
                <div className={"text-[12px] italic " + mutedText}>
                  No plans found. Create a plan in Focus plan page.
                  {lastPlansLoadedAt ? ` (checked ${new Date(lastPlansLoadedAt).toLocaleTimeString()})` : ""}
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <div className={"text-[11px] font-semibold " + mutedText}>Plan</div>

                    <select
                      value={selectedPlanId}
                      onChange={(e) => setSelectedPlanId(e.target.value)}
                      className={
                        isLight
                          ? "w-full h-11 px-3 rounded-xl border border-[#D8DDE5] bg-[#F7F8FA] text-[13px] font-semibold text-black/85 outline-none focus:ring-1 focus:ring-emerald-500"
                          : "w-full h-11 px-3 rounded-xl border border-white/10 bg-[#3A3A3A]/70 text-[13px] font-semibold text-white/85 outline-none focus:ring-1 focus:ring-emerald-500"
                      }
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>

                    <div className={"text-[11px] font-semibold " + mutedText + " mt-2"}>Search</div>
                    <div className="flex items-center gap-2">
                      <div
                        className={[
                          "h-11 w-11 rounded-xl border flex items-center justify-center",
                          isLight ? "border-[#D8DDE5] bg-[#F7F8FA]" : "border-white/10 bg-[#3A3A3A]/70",
                        ].join(" ")}
                      >
                        <Search size={16} className={isLight ? "text-black/40" : "text-white/45"} />
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
                    <div className={"text-[12px] italic " + mutedText}>Loading items…</div>
                  ) : filteredPlanItems.length === 0 ? (
                    <div className={"text-[12px] italic " + mutedText}>No items match your filter.</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {renderedPlanItems.map((it) => {
                        const text = safeTrim(it.text);
                        const inPanelById = panelIntentions.some((p) => String(p.focus_plan_item_id || "") === String(it.id));
                        const inPanelByText = panelTextSet.has(normalizeTextForMatch(text));
                        const already = inPanelById || inPanelByText;

                        return (
                          <div key={it.id} className={["rounded-xl border px-3 py-2.5 transition", rowBg, rowBorder].join(" ")}>
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

                                <div className={"mt-1 text-[11px] " + mutedText}>
                                  {already ? "Already in your panel" : "Focus plan item"}
                                  {it.target_date ? ` · Due: ${it.target_date}` : ""}
                                </div>
                              </div>

                              {already ? (
                                <div className="shrink-0">
                                  <div
                                    className={[
                                      "h-10 px-3 rounded-xl text-[12px] font-semibold inline-flex items-center gap-2",
                                      isLight ? "bg-[#ECEFF3] text-black/60 border border-[#D8DDE5]" : "bg-[#3A3A3A] text-white/70 border border-white/10",
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
                                    importingItemId === it.id ? "opacity-70" : "opacity-100",
                                    primaryBtn,
                                  ].join(" ")}
                                  title="Attach to panel"
                                >
                                  <ListPlus size={16} />
                                  {importingItemId === it.id ? "Attaching..." : "Attach"}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className={"mt-4 text-[11px] " + mutedText}>
                    Tip: this is your “always-on” intentions list. It stays the same across sessions.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        modalDoc.body
      );
    })()
    : null;

  const PanelUI = (
    <div
      className={"h-full flex flex-col min-h-0 font-inter " + panelBg}
      onPointerDown={stopRoomBubbling}
      onMouseDown={stopRoomBubbling}
      onClick={stopRoomBubbling}
    >
      <div className={"px-4 pt-4 pb-3 shrink-0 border-b " + headerBorder + " " + headerBg}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className={"font-inter font-semibold text-[13px] " + headerTitle}>Intentions</div>
            <div className={"text-[11px] font-inter " + mutedText}>Keep it visible while you work</div>
          </div>

          <div className="flex items-center gap-2 shrink-0 font-inter">
            <div className={"inline-flex items-center gap-2 px-3 py-2 rounded-xl " + timerPillCls} title="Timer">
              <TimerSmartIcon theme={theme} className="w-4 h-4 opacity-80" />
              <span className={timerTextCls + " leading-none"} style={{ fontFamily: OVERLAY_FONT_FAMILY }}>
                {timerText || "--:--"}
              </span>
            </div>

            <IconButton
              theme={theme}
              title="Attach from Focus plan to panel"
              onClick={(e) => {
                e.preventDefault();
                openImportModal();
              }}
            >
              <PanelSmartIcon name="focus-plan" theme={theme} className="w-4 h-4" alt="Focus plan" />
            </IconButton>

            {pictureInPictureSupported && onOpenPictureInPicture ? (
              <IconButton
                theme={theme}
                title={pictureInPictureOpen ? "Close Picture-in-Picture video" : "Open video Picture-in-Picture"}
                onClick={(e) => {
                  e.preventDefault();
                  onOpenPictureInPicture();
                }}
              >
                <PanelSmartIcon name="pip-intentions" theme={theme} className="w-4 h-4" alt="Picture-in-Picture" />
              </IconButton>
            ) : null}

            <IconButton
              theme={theme}
              title={overlayOpen ? "Unpin" : "Pin (always on top if supported)"}
              onClick={(e) => {
                e.preventDefault();
                if (overlayOpen) closeOverlay();
                else void openOverlay();
              }}
            >
              <PanelSmartIcon name="pin" theme={theme} className="w-4 h-4" alt="Pin" />
            </IconButton>

          </div>
        </div>
      </div>

      <div className="px-4 pb-4 pt-4 min-h-0 flex-1 overflow-y-auto custom-scrollbar font-inter">
        <div className="mb-5">
          <div className={titleText + " font-inter font-semibold text-[13px] mb-3"}>My intentions</div>

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
              className="
                h-11 px-4 rounded-xl
                bg-emerald-500 hover:bg-emerald-600
                text-[#02140B] font-semibold text-[13px]
                font-inter
              "
              type="button"
              title="Add"
            >
              Add
            </button>
          </div>

          {panelLoading ? (
            <div className={"text-[12px] italic font-inter " + mutedText}>Loading...</div>
          ) : panelIntentions.length === 0 ? (
            <div className={"text-[12px] italic font-inter " + mutedText}>
              No panel intentions yet. Attach from Focus plan or add manually.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {panelIntentions.map((i) => {
                const isEditing = editingId === i.id;

                const circleCls = isLight ? "text-black/40" : "text-white/45";
                const textDoneCls = isLight ? "text-black/45 line-through" : "text-white/50 line-through";
                const textActiveCls = isLight ? "text-black/80" : "text-white/80";

                const editInputCls = isLight
                  ? `
                    w-full bg-[#F7F8FA] border border-[#D8DDE5] rounded-xl
                    px-3 py-2 text-[13px] text-black/85
                    outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
                    font-inter
                  `
                  : `
                    w-full bg-[#3A3A3A]/80 border border-white/10 rounded-xl
                    px-3 py-2 text-[13px] text-white/85
                    outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
                    font-inter
                  `;

                return (
                  <div
                    key={i.id}
                    className={myCardCls + " font-inter"}
                    onClick={() => togglePanelCompleted(i)}
                  >
                    <div className="flex items-center gap-2">
                      <div className="shrink-0">
                        {i.completed ? <CheckCircle size={18} className="text-emerald-500" /> : <Circle size={18} className={circleCls} />}
                      </div>

                      <div className="flex-1 min-w-0">
                        {!isEditing ? (
                          <div className={"text-[13px] break-words leading-5 font-inter " + (i.completed ? textDoneCls : textActiveCls)}>
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

                      <div className="flex items-center gap-2 shrink-0">
                        {!isEditing ? (
                          <>
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <IconButton
                                theme={theme}
                                title="Edit"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEdit(i.id, i.text);
                                }}
                              >
                                <Pencil size={16} />
                              </IconButton>
                            </div>

                            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <IconButton
                                theme={theme}
                                title="Delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void deletePanelIntention(i.id);
                                }}
                                className="hover:text-red-500"
                              >
                                <Trash2 size={16} />
                              </IconButton>
                            </div>
                          </>
                        ) : (
                          <>
                            <IconButton
                              theme={theme}
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
                              theme={theme}
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

        <div className={titleText + " font-inter font-semibold text-[13px] mb-3"}>Team intentions</div>

        {sessionLoading ? (
          <div className={"text-[12px] italic font-inter " + mutedText}>Loading...</div>
        ) : teamIntentions.length === 0 ? (
          <div className={"text-[12px] italic font-inter " + mutedText}>No team intentions</div>
        ) : (
          <div className="flex flex-col gap-2">
            {teamIntentions.map((item) => {
              const nameCls = isLight ? "text-black/85" : "text-white/85";
              const bodyActive = isLight ? "text-black/75" : "text-white/75";
              const bodyDone = isLight ? "text-black/45 line-through" : "text-white/50 line-through";
              const circleCls = isLight ? "text-black/30" : "text-white/30";

              return (
                <div key={item.id} className={teamCardCls + " font-inter"}>
                  <div className="flex items-start gap-3">
                    <img src={getAvatar(item.profiles)} className="w-9 h-9 rounded-full object-cover" alt="" />

                    <div className="flex-1 min-w-0">
                      <div className={"text-[13px] font-medium truncate font-inter " + nameCls}>
                        {item.profiles?.full_name || "Participant"}
                      </div>

                      <div className={"text-[13px] break-words leading-5 font-inter " + (item.completed ? bodyDone : bodyActive)}>
                        {item.text}
                      </div>
                    </div>

                    <div className="shrink-0 mt-1">
                      {item.completed ? <CheckCircle size={16} className="text-emerald-500" /> : <Circle size={16} className={circleCls} />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {ImportModal}
    </div>
  );

  return (
    <>
      {overlayOpen && overlayRef.current?.container ? createPortal(PanelUI, overlayRef.current.container) : null}

      {!overlayOpen ? (
        PanelUI
      ) : (
        <div
          className={"h-full flex items-center justify-center font-inter " + panelBg}
          onPointerDown={stopRoomBubbling}
          onMouseDown={stopRoomBubbling}
          onClick={stopRoomBubbling}
        >
          <div className="text-center font-inter">
            <div className={"text-[12px] font-inter " + titleText}>Pinned</div>
            <div className={"text-[12px] italic mt-1 font-inter " + mutedText}>Intentions are opened in a floating window.</div>
            <button
              type="button"
              onClick={closeOverlay}
              className={`
                mt-4 px-4 py-2 rounded-xl border
                ${isLight ? "border-black/15 text-black/80 hover:bg-[#E7EAF0]" : "border-white/10 text-white/80 hover:bg-[#3F3F3F]"}
                transition inline-flex items-center gap-2 text-[13px] font-semibold font-inter
              `}
            >
              <PanelSmartIcon name="pin" theme={theme} className="w-4 h-4" alt="Pin" />
              Unpin
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default IntentionsPanel;