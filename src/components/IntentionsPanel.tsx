// src/components/IntentionsPanel.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  CheckCircle,
  Circle,
  ExternalLink,
  Flame,
  ListPlus,
  Lock,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type RoomTheme = "dark" | "light";
type IntentionVisibility = "public" | "private";

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
  visibility?: IntentionVisibility | string | null;
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
  sessionId?: string;
  theme?: RoomTheme;
  timerText?: string;
  timerTextClassName?: string;
};

type ProfileMini = {
  id: string;
  full_name?: string;
  avatar_url?: string;
};

type DocPiPWindow = Window & { document: Document; close: () => void };

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (opts?: { width?: number; height?: number }) => Promise<DocPiPWindow>;
    };
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const OVERLAY_FONT_FAMILY =
  'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';

const PANEL_INTENTIONS_TABLE = "panel_intentions";
const SESSION_INTENTIONS_TABLE = "intentions";
const INTENTION_ENCOURAGEMENTS_TABLE = "intention_encouragements";

const PANEL_INTENTIONS_FETCH_LIMIT = 120;
const SESSION_INTENTIONS_FETCH_LIMIT = 80;
const TEAM_INTENTIONS_RENDER_LIMIT = 50;
const PLAN_ITEMS_RENDER_LIMIT = 40;
const FOCUS_PLAN_ITEMS_FETCH_LIMIT = 120;
const FOCUS_PLANS_FETCH_LIMIT = 40;

const COLORS = {
  red: "#F65252",
  blue: "#5286F6",
  green: "#65D46C",
  dark: "#2F2F2F",
  panel: "#EEEEEE",
  border: "#CAC3C3",
  text: "#111111",
  muted: "#6B6B6B",
  faint: "#A8A8A8",
};

function safeTrim(x: unknown) {
  return String(x || "").trim();
}

function normalizeTextForMatch(x: unknown) {
  return String(x || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeVisibility(value: unknown): IntentionVisibility {
  return String(value || "public").toLowerCase() === "private" ? "private" : "public";
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

function applyOverlayBaseStyles(doc: Document) {
  try {
    doc.documentElement.style.height = "100%";
    doc.body.style.height = "100%";
    doc.body.style.margin = "0";
    doc.body.style.background = COLORS.panel;
    doc.body.style.fontFamily = OVERLAY_FONT_FAMILY;
    doc.body.style.colorScheme = "light";
  } catch { }
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

function AssetIcon({
  src,
  fallback,
  className = "w-4 h-4",
  alt = "",
}: {
  src: string;
  fallback: ReactNode;
  className?: string;
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return <img src={src} alt={alt} draggable={false} className={className} onError={() => setFailed(true)} />;
}

function HeaderIconButton({
  title,
  color,
  onClick,
  children,
}: {
  title: string;
  color: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="w-[32px] h-[32px] rounded-[11px] border flex items-center justify-center transition hover:bg-white active:scale-[0.98]"
      style={{ borderColor: color, color, background: "rgba(255,255,255,0.35)" }}
    >
      {children}
    </button>
  );
}

function SmallIconButton({
  title,
  onClick,
  children,
  className = "",
}: {
  title: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={
        "w-8 h-8 rounded-xl flex items-center justify-center text-black/55 hover:text-black hover:bg-black/[0.04] transition " +
        className
      }
    >
      {children}
    </button>
  );
}

export function IntentionsPanel({
  sessionId: sessionIdProp,
  timerText: timerTextProp,
  timerTextClassName,
}: IntentionsPanelProps) {
  const { id: idOrSlugFromUrl } = useParams<{ id: string }>();
  const rawSessionId = (sessionIdProp || idOrSlugFromUrl || "").trim();

  const [user, setUser] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [panelIntentions, setPanelIntentions] = useState<PanelIntention[]>([]);
  const [panelLoading, setPanelLoading] = useState(true);

  const [sessionIntentions, setSessionIntentions] = useState<SessionIntention[]>([]);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [newIntention, setNewIntention] = useState("");
  const [newIntentionVisibility, setNewIntentionVisibility] = useState<IntentionVisibility>("public");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");

  const [fireCounts, setFireCounts] = useState<Record<string, number>>({});
  const [myFireIds, setMyFireIds] = useState<Set<string>>(() => new Set());
  const [fireBusyId, setFireBusyId] = useState<string | null>(null);

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
        const { data, error } = await supabase.from("sessions").select("id").eq("custom_slug", slug).single();

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
        .select("id,user_id,text,focus_plan_item_id,completed,visibility,created_at,updated_at")
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

  const loadFireState = useCallback(
    async (intentionIds: string[]) => {
      const ids = [...new Set(intentionIds.map((x) => String(x || "").trim()).filter(Boolean))];
      if (!ids.length) {
        setFireCounts({});
        setMyFireIds(new Set());
        return;
      }

      try {
        const { data, error } = await supabase
          .from(INTENTION_ENCOURAGEMENTS_TABLE)
          .select("intention_id,user_id,emoji")
          .in("intention_id", ids)
          .eq("emoji", "🔥");

        if (error || !Array.isArray(data)) return;

        const nextCounts: Record<string, number> = {};
        const nextMine = new Set<string>();
        for (const row of data as any[]) {
          const intentionId = String(row?.intention_id || "");
          if (!intentionId) continue;
          nextCounts[intentionId] = (nextCounts[intentionId] || 0) + 1;
          if (user?.id && String(row?.user_id || "") === String(user.id)) nextMine.add(intentionId);
        }

        setFireCounts(nextCounts);
        setMyFireIds(nextMine);
      } catch { }
    },
    [user?.id]
  );

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
        void loadFireState(merged.map((x) => x.id));
      } finally {
        if (seq === loadSeqRef.current) setSessionLoading(false);
      }
    },
    [sessionId, loadFireState]
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

    const intentionsChannel = supabase
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

    const fireChannel = supabase
      .channel(`intention_encouragements_${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: INTENTION_ENCOURAGEMENTS_TABLE },
        () => void loadFireState(sessionIntentions.map((x) => x.id))
      )
      .subscribe();

    return () => {
      if (sessionReloadTimerRef.current) {
        window.clearTimeout(sessionReloadTimerRef.current);
        sessionReloadTimerRef.current = null;
      }
      supabase.removeChannel(intentionsChannel);
      supabase.removeChannel(fireChannel);
    };
  }, [sessionId, loadSessionIntentions, scheduleSessionIntentionsReload, loadFireState, sessionIntentions]);

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
        (matchText ? findOwnSessionIntentionLocal(matchText) : null) || findOwnSessionIntentionLocal(nextText);

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

  const publishPanelIntentionIfNeeded = useCallback(
    async (it: Pick<PanelIntention, "text" | "completed" | "visibility">, matchText?: string) => {
      if (normalizeVisibility(it.visibility) === "private") {
        await deleteOwnSessionIntentionByText(matchText || it.text);
        return;
      }

      await upsertOwnSessionIntention({
        matchText: matchText || it.text,
        text: it.text,
        completed: Boolean(it.completed),
      });
    },
    [deleteOwnSessionIntentionByText, upsertOwnSessionIntention]
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

  const renderedPlanItems = useMemo(() => filteredPlanItems.slice(0, PLAN_ITEMS_RENDER_LIMIT), [filteredPlanItems]);

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
              .update({ focus_plan_item_id: item.id, visibility: "public" })
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
      visibility: newIntentionVisibility,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setPanelIntentions((prev) => [optimistic, ...prev].slice(0, PANEL_INTENTIONS_FETCH_LIMIT));

    try {
      const { data, error } = await supabase
        .from(PANEL_INTENTIONS_TABLE)
        .insert({ user_id: user.id, text, completed: false, visibility: newIntentionVisibility } as any)
        .select("id,user_id,text,focus_plan_item_id,completed,visibility,created_at,updated_at")
        .single();

      if (error || !data) {
        setPanelIntentions((prev) => prev.filter((x) => x.id !== optimisticId));
        return;
      }

      const inserted = data as PanelIntention;
      setPanelIntentions((prev) =>
        [inserted, ...prev.filter((x) => x.id !== optimisticId)].slice(0, PANEL_INTENTIONS_FETCH_LIMIT)
      );

      void publishPanelIntentionIfNeeded(inserted);
    } catch {
      setPanelIntentions((prev) => prev.filter((x) => x.id !== optimisticId));
    }
  };

  const togglePanelCompleted = async (it: PanelIntention) => {
    if (!user?.id) return;
    if (editingId === it.id) return;

    const next = !Boolean(it.completed);
    const nextItem = { ...it, completed: next };

    setPanelIntentions((prev) => prev.map((x) => (x.id === it.id ? nextItem : x)));

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

      void publishPanelIntentionIfNeeded(nextItem);
    } catch {
      setPanelIntentions((prev) => prev.map((x) => (x.id === it.id ? { ...x, completed: !next } : x)));
    }
  };

  const togglePanelVisibility = async (it: PanelIntention) => {
    if (!user?.id) return;
    if (editingId === it.id) return;

    const current = normalizeVisibility(it.visibility);
    const next: IntentionVisibility = current === "public" ? "private" : "public";
    const nextItem = { ...it, visibility: next };

    setPanelIntentions((prev) => prev.map((x) => (x.id === it.id ? nextItem : x)));

    try {
      const { error } = await supabase
        .from(PANEL_INTENTIONS_TABLE)
        .update({ visibility: next })
        .eq("id", it.id)
        .eq("user_id", user.id);

      if (error) throw error;

      void publishPanelIntentionIfNeeded(nextItem);
    } catch {
      setPanelIntentions((prev) => prev.map((x) => (x.id === it.id ? it : x)));
    }
  };

  const deletePanelIntention = async (id: string) => {
    if (!user?.id) return;

    const prev = panelIntentions;
    const target = panelIntentions.find((x) => x.id === id) || null;
    setPanelIntentions((p) => p.filter((x) => x.id !== id));

    try {
      const { error } = await supabase.from(PANEL_INTENTIONS_TABLE).delete().eq("id", id).eq("user_id", user.id);
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
    const prevVisibility = normalizeVisibility(prevItem?.visibility);

    const nextItem = prevItem
      ? { ...prevItem, text, completed: prevCompleted, visibility: prevVisibility }
      : null;

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

      if (nextItem) void publishPanelIntentionIfNeeded(nextItem, prevText);
    } catch {
      setPanelIntentions(prev);
    }
  };

  const toggleFire = async (item: SessionIntention) => {
    if (!user?.id) return;
    const intentionId = String(item.id || "").trim();
    if (!intentionId || fireBusyId === intentionId) return;

    const already = myFireIds.has(intentionId);
    setFireBusyId(intentionId);

    const prevCounts = fireCounts;
    const prevMine = myFireIds;

    setFireCounts((prev) => ({ ...prev, [intentionId]: Math.max(0, (prev[intentionId] || 0) + (already ? -1 : 1)) }));
    setMyFireIds((prev) => {
      const next = new Set(prev);
      if (already) next.delete(intentionId);
      else next.add(intentionId);
      return next;
    });

    try {
      if (already) {
        const { error } = await supabase
          .from(INTENTION_ENCOURAGEMENTS_TABLE)
          .delete()
          .eq("intention_id", intentionId)
          .eq("user_id", user.id)
          .eq("emoji", "🔥");
        if (error) throw error;
      } else {
        const { error } = await supabase.from(INTENTION_ENCOURAGEMENTS_TABLE).upsert(
          {
            intention_id: intentionId,
            user_id: user.id,
            emoji: "🔥",
          },
          { onConflict: "intention_id,user_id,emoji", ignoreDuplicates: true }
        );
        if (error) throw error;
      }
    } catch {
      setFireCounts(prevCounts);
      setMyFireIds(prevMine);
    } finally {
      setFireBusyId(null);
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
        applyOverlayBaseStyles(pipWin.document);
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
      applyOverlayBaseStyles(w.document);
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
  }, [closeOverlay]);

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

  const teamIntentions = useMemo(() => sessionIntentions.slice(0, TEAM_INTENTIONS_RENDER_LIMIT), [sessionIntentions]);

  const timerTextCls = `tabular-nums text-[13px] ${timerTextClassName || ""} font-inter font-normal`.trim();

  const ImportModal = importModalOpen
    ? (() => {
      const modalDoc = getPortalDocument();

      return createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/35 font-inter"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeImportModal();
          }}
        >
          <div
            className="w-[min(760px,calc(100vw-24px))] max-h-[min(760px,calc(100vh-24px))] overflow-hidden rounded-[24px] border bg-[#EEEEEE] shadow-2xl"
            style={{ borderColor: COLORS.border }}
          >
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b" style={{ borderColor: COLORS.border }}>
              <div className="min-w-0">
                <div className="text-[17px] font-bold text-black">Attach from Focus plan</div>
                <div className="text-[12px] text-black/50 mt-1">
                  Pick existing focus-plan items and add them to this room intention panel.
                </div>
              </div>

              <button
                type="button"
                onClick={closeImportModal}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-black/60 hover:bg-black/5 transition"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] min-h-[420px] max-h-[calc(100vh-130px)]">
              <div className="border-r p-4 overflow-auto" style={{ borderColor: COLORS.border }}>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="text-[12px] font-bold text-black">Plans</div>
                  <button
                    type="button"
                    onClick={() => void loadPlans()}
                    className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-black/5 text-black/60"
                    title="Refresh plans"
                  >
                    <RefreshCw size={15} className={plansLoading ? "animate-spin" : ""} />
                  </button>
                </div>

                {plansLoading ? (
                  <div className="text-[12px] italic text-black/45">Loading...</div>
                ) : plans.length === 0 ? (
                  <div className="text-[12px] italic text-black/45">No focus plans yet.</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {plans.map((plan) => {
                      const active = selectedPlanId === plan.id;
                      return (
                        <button
                          type="button"
                          key={plan.id}
                          onClick={() => setSelectedPlanId(plan.id)}
                          className={
                            "text-left rounded-2xl border px-3 py-2 transition " +
                            (active ? "bg-white text-black" : "bg-transparent hover:bg-white/60 text-black/70")
                          }
                          style={{ borderColor: active ? COLORS.dark : COLORS.border }}
                        >
                          <div className="text-[13px] font-semibold truncate">{plan.title || "Untitled plan"}</div>
                          <div className="text-[11px] text-black/45 mt-0.5 truncate">
                            Updated {plan.updated_at ? new Date(plan.updated_at).toLocaleDateString() : "recently"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {lastPlansLoadedAt ? (
                  <div className="mt-4 text-[11px] text-black/35">
                    Loaded {new Date(lastPlansLoadedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                ) : null}
              </div>

              <div className="p-4 overflow-auto">
                <div className="flex items-center gap-2 mb-3">
                  <div className="relative flex-1">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/35" />
                    <input
                      value={planSearch}
                      onChange={(e) => setPlanSearch(e.target.value)}
                      placeholder="Search plan items"
                      className="w-full h-10 rounded-2xl border bg-white pl-9 pr-3 text-[13px] text-black outline-none focus:border-[#5286F6]"
                      style={{ borderColor: COLORS.border }}
                    />
                  </div>
                </div>

                {planItemsLoading ? (
                  <div className="text-[12px] italic text-black/45">Loading items...</div>
                ) : renderedPlanItems.length === 0 ? (
                  <div className="text-[12px] italic text-black/45">No matching items.</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {renderedPlanItems.map((item) => {
                      const norm = normalizeTextForMatch(item.text);
                      const already = panelTextSet.has(norm);
                      const busy = importingItemId === item.id;

                      return (
                        <div
                          key={item.id}
                          className="rounded-2xl border bg-white/60 px-3 py-3 flex items-start gap-3"
                          style={{ borderColor: COLORS.border }}
                        >
                          <div className="pt-0.5">
                            {item.completed ? (
                              <CheckCircle size={18} style={{ color: COLORS.green }} />
                            ) : (
                              <Circle size={18} className="text-black/30" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className={(item.completed ? "line-through text-black/35" : "text-black/80") + " text-[13px] leading-5"}>
                              {item.text}
                            </div>
                            {item.target_date ? (
                              <div className="mt-1 text-[11px] text-black/40">Target: {item.target_date}</div>
                            ) : null}
                          </div>

                          <button
                            type="button"
                            disabled={already || busy}
                            onClick={() => void importPlanItemToPanel(item)}
                            className={
                              "h-9 px-3 rounded-xl text-[12px] font-semibold transition " +
                              (already
                                ? "bg-black/5 text-black/35 cursor-default"
                                : "bg-[#2F2F2F] text-white hover:opacity-90")
                            }
                          >
                            {already ? "Added" : busy ? "Adding..." : "Add"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        modalDoc.body
      );
    })()
    : null;

  const renderEmptyState = (text: string) => (
    <div className="h-full flex items-center justify-center font-inter bg-[#EEEEEE] text-black/45">
      <div className="text-[12px] italic font-inter">{text}</div>
    </div>
  );

  if (!rawSessionId) return renderEmptyState("No session id");
  if (!sessionId) return renderEmptyState("Resolving session...");

  const PanelUI = (
    <div
      className="h-full w-full overflow-auto font-inter text-black bg-[#EEEEEE]"
      style={{ colorScheme: "light", fontFamily: OVERLAY_FONT_FAMILY }}
      onPointerDown={stopRoomBubbling}
      onMouseDown={stopRoomBubbling}
      onClick={stopRoomBubbling}
    >
      <div className="px-4 pt-9 pb-8 min-h-full">
        <h2 className="text-[16px] font-bold text-black leading-none mb-9">Intentions</h2>

        <div className="rounded-xl border bg-[#EEEEEE] px-3 py-2 mb-9" style={{ borderColor: COLORS.border }}>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold leading-tight text-black">Intentions</div>
              <div className="text-[12px] leading-[16px] text-black mt-0.5 max-w-[150px]">
                Keep it visible while you work
              </div>
            </div>

            <div
              className="h-[32px] min-w-[80px] rounded-xl border bg-[#EEEEEE] px-3 flex items-center justify-center gap-2 text-black"
              style={{ borderColor: COLORS.border }}
              title="Room timer"
            >
              <AssetIcon
                src="/icons/timer-light.svg"
                fallback={<span className="text-[16px] leading-none">⌛</span>}
                className="w-4 h-4"
                alt="Timer"
              />
              <span className={timerTextCls}>{timerText}</span>
            </div>

            <HeaderIconButton title="Attach from Focus plan" color={COLORS.blue} onClick={openImportModal}>
              <AssetIcon
                src="/icons/intentions-import-blue.svg"
                fallback={<ListPlus size={17} />}
                className="w-[17px] h-[17px]"
                alt="Attach"
              />
            </HeaderIconButton>

            <HeaderIconButton title={overlayOpen ? "Unpin" : "Pin / floating window"} color={COLORS.red} onClick={overlayOpen ? closeOverlay : openOverlay}>
              <AssetIcon
                src="/icons/intentions-pin-red.svg"
                fallback={overlayOpen ? <PinOff size={17} /> : <Pin size={17} />}
                className="w-[17px] h-[17px]"
                alt="Pin"
              />
            </HeaderIconButton>

            <HeaderIconButton title="Open floating window" color={COLORS.green} onClick={openOverlay}>
              <AssetIcon
                src="/icons/intentions-popout-green.svg"
                fallback={<ExternalLink size={17} />}
                className="w-[17px] h-[17px]"
                alt="Open"
              />
            </HeaderIconButton>
          </div>
        </div>

        <div className="text-[14px] font-bold text-black mb-8">My Intentions</div>

        <div className="flex items-center gap-2 mb-8">
          <input
            type="text"
            value={newIntention}
            onChange={(e) => setNewIntention(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddPanelIntention()}
            placeholder="Add an intention"
            className="h-[45px] flex-1 rounded-xl border bg-[#EEEEEE] px-4 text-[14px] text-black placeholder:text-black outline-none focus:border-[#5286F6]"
            style={{ borderColor: COLORS.border }}
          />

          <button
            type="button"
            onClick={() => setNewIntentionVisibility((prev) => (prev === "public" ? "private" : "public"))}
            className="h-[45px] w-[45px] rounded-xl border bg-[#EEEEEE] flex items-center justify-center transition hover:bg-white"
            style={{ borderColor: COLORS.border, color: newIntentionVisibility === "public" ? COLORS.green : COLORS.dark }}
            title={newIntentionVisibility === "public" ? "New intention is public" : "New intention is private"}
          >
            {newIntentionVisibility === "public" ? <Unlock size={17} /> : <Lock size={17} />}
          </button>

          <button
            onClick={handleAddPanelIntention}
            className="h-[45px] px-5 rounded-xl bg-[#2F2F2F] hover:opacity-90 text-white font-normal text-[14px] transition"
            type="button"
            title="Add"
          >
            Add
          </button>
        </div>

        {panelLoading ? (
          <div className="text-[12px] italic text-black/45 mb-8">Loading...</div>
        ) : panelIntentions.length === 0 ? (
          <div className="text-[12px] italic text-black/45 mb-8">No intentions yet. Add one or attach from Focus plan.</div>
        ) : (
          <div className="flex flex-col gap-2 mb-9">
            {panelIntentions.map((i) => {
              const isEditing = editingId === i.id;
              const visibility = normalizeVisibility(i.visibility);
              const isPrivate = visibility === "private";

              return (
                <div
                  key={i.id}
                  className="group rounded-xl border bg-[#EEEEEE] px-4 py-2.5 transition hover:bg-white/50"
                  style={{ borderColor: COLORS.border }}
                  onClick={() => void togglePanelCompleted(i)}
                >
                  <div className="flex items-center gap-3">
                    <div className="shrink-0">
                      {i.completed ? (
                        <CheckCircle size={20} style={{ color: COLORS.green }} />
                      ) : (
                        <Circle size={20} style={{ color: COLORS.border }} />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      {!isEditing ? (
                        <div className={(i.completed ? "text-black/35 line-through" : "text-black") + " text-[13px] leading-5 break-words"}>
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
                          className="w-full h-9 rounded-xl border bg-white px-3 text-[13px] text-black outline-none focus:border-[#5286F6]"
                          style={{ borderColor: COLORS.border }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                    </div>

                    <button
                      type="button"
                      title={isPrivate ? "Private: only you can see it" : "Public: visible to the room"}
                      onClick={(e) => {
                        e.stopPropagation();
                        void togglePanelVisibility(i);
                      }}
                      className="w-8 h-8 rounded-xl flex items-center justify-center transition hover:bg-black/[0.04]"
                      style={{ color: isPrivate ? COLORS.dark : COLORS.green }}
                    >
                      {isPrivate ? <Lock size={15} /> : <Unlock size={15} />}
                    </button>

                    {!isEditing ? (
                      <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                        <SmallIconButton
                          title="Edit"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(i.id, i.text);
                          }}
                        >
                          <Pencil size={15} />
                        </SmallIconButton>
                        <SmallIconButton
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            void deletePanelIntention(i.id);
                          }}
                          className="hover:text-[#F65252]"
                        >
                          <Trash2 size={15} />
                        </SmallIconButton>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 shrink-0">
                        <SmallIconButton
                          title="Save"
                          onClick={(e) => {
                            e.stopPropagation();
                            void saveEdit();
                          }}
                          className="hover:text-[#65D46C]"
                        >
                          <Check size={17} />
                        </SmallIconButton>
                        <SmallIconButton
                          title="Cancel"
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelEdit();
                          }}
                        >
                          <X size={17} />
                        </SmallIconButton>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="text-[14px] font-bold text-black mb-4">Team intentions</div>

        {sessionLoading ? (
          <div className="text-[12px] italic text-black/45">Loading...</div>
        ) : teamIntentions.length === 0 ? (
          <div className="text-[12px] italic text-black/45">No public team intentions</div>
        ) : (
          <div className="flex flex-col gap-4">
            {teamIntentions.map((item) => {
              const isDone = Boolean(item.completed);
              const count = fireCounts[item.id] || 0;
              const mine = myFireIds.has(item.id);

              return (
                <div
                  key={item.id}
                  className="relative rounded-xl border bg-[#EEEEEE] px-4 py-2.5 pr-[58px]"
                  style={{ borderColor: COLORS.border }}
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={getAvatar(item.profiles)}
                      className={(isDone ? "opacity-35" : "") + " w-9 h-9 rounded-full object-cover shrink-0"}
                      alt=""
                    />

                    <div className="flex-1 min-w-0">
                      <div className={(isDone ? "text-black/30 line-through" : "text-black") + " text-[13px] font-bold truncate"}>
                        {item.profiles?.full_name || "Participant"}
                      </div>
                      <div className={(isDone ? "text-black/30 line-through" : "text-black") + " text-[13px] leading-5 break-words"}>
                        {item.text}
                      </div>
                    </div>

                    <div
                      className="shrink-0 h-[29px] px-3 rounded-full border flex items-center justify-center text-[12px] bg-[#EEEEEE]"
                      style={{
                        borderColor: isDone ? COLORS.green : COLORS.blue,
                        color: isDone ? COLORS.green : COLORS.blue,
                      }}
                    >
                      {isDone ? "Completed" : "In progress"}
                    </div>
                  </div>

                  <button
                    type="button"
                    title={mine ? "Remove encouragement" : "Send encouragement"}
                    onClick={() => void toggleFire(item)}
                    disabled={!user?.id || fireBusyId === item.id}
                    className="absolute right-2 top-1/2 -translate-y-1/2 translate-x-[11px] w-9 h-9 rounded-full flex items-center justify-center transition hover:scale-105 active:scale-95 disabled:opacity-60"
                    style={{ background: "transparent" }}
                  >
                    <span className="relative inline-flex items-center justify-center text-[24px] leading-none">
                      🔥
                      {count > 0 ? (
                        <span className="absolute -right-[6px] -bottom-[5px] min-w-[15px] h-[15px] px-[3px] rounded-full bg-[#2F2F2F] text-white text-[9px] leading-[15px] text-center border border-[#EEEEEE]">
                          {count > 99 ? "99+" : count}
                        </span>
                      ) : null}
                    </span>
                  </button>
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
          className="h-full flex items-center justify-center font-inter bg-[#EEEEEE] text-black"
          onPointerDown={stopRoomBubbling}
          onMouseDown={stopRoomBubbling}
          onClick={stopRoomBubbling}
        >
          <div className="text-center font-inter px-6">
            <div className="text-[12px] font-bold text-black">Pinned</div>
            <div className="text-[12px] italic mt-1 text-black/45">Intentions are opened in a floating window.</div>
            <button
              type="button"
              onClick={closeOverlay}
              className="mt-4 px-4 py-2 rounded-xl border transition inline-flex items-center gap-2 text-[13px] font-semibold font-inter text-black hover:bg-black/5"
              style={{ borderColor: COLORS.border }}
            >
              <PinOff size={16} />
              Unpin
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default IntentionsPanel;
