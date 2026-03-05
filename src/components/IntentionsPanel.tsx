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
  Pin,
  PinOff,
  ExternalLink,
  ListPlus,
  RefreshCw,
  Search,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useParams } from "react-router-dom";

type RoomTheme = "dark" | "light";

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

interface IntentionFeedRow {
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
}

type IntentionsPanelProps = {
  sessionId?: string; // should be UUID ideally
  theme?: RoomTheme;

  // ✅ Timer from top-bar (recommended)
  timerText?: string;

  // ✅ IMPORTANT:
  timerTextClassName?: string;
};

// UUID matcher (so we can safely detect slug vs uuid)
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---- Document Picture-in-Picture typings (Chromium) ----
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
    ? "bg-black/5 hover:bg-black/10 text-black/70"
    : "bg-[#111827] hover:bg-[#1f2937] text-white/80";

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

// ✅ Same timer icon approach as RoomPageIFrame Icon("timer")
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
      const clone = n.cloneNode(true) as any;
      to.head.appendChild(clone);
    });
  } catch {
    // ignore
  }
}

function applyOverlayBaseStyles(doc: Document, isLight: boolean) {
  try {
    doc.documentElement.style.height = "100%";
    doc.body.style.height = "100%";
    doc.body.style.margin = "0";
    doc.body.style.background = isLight ? "#ffffff" : "#060B14";
    doc.body.style.fontFamily = OVERLAY_FONT_FAMILY;
  } catch {
    // ignore
  }
}

// best-effort safe remove channel across supabase versions
function safeRemoveRealtimeChannel(ch: any) {
  if (!ch) return;
  try {
    if (typeof ch.unsubscribe === "function") {
      void ch.unsubscribe();
      return;
    }
  } catch { }

  const sb: any = supabase as any;

  try {
    if (typeof sb.removeChannel === "function") {
      void sb.removeChannel(ch);
      return;
    }
  } catch { }

  try {
    if (typeof sb.removeSubscription === "function") {
      void sb.removeSubscription(ch);
      return;
    }
  } catch { }

  try {
    if (sb.realtime && typeof sb.realtime.removeChannel === "function") {
      void sb.realtime.removeChannel(ch);
      return;
    }
  } catch { }
}

// ✅ ensure team visibility: keep a shadow row in `intentions` (best-effort)
async function ensureSessionIntentionRow(args: { userId: string; sessionId: string; text: string; completed?: boolean }) {
  const userId = String(args.userId || "").trim();
  const sessionId = String(args.sessionId || "").trim();
  const text = String(args.text || "").trim();
  if (!userId || !sessionId || !UUID_RE.test(sessionId) || !text) return;

  try {
    const { data: existing } = await supabase
      .from("intentions")
      .select("id")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .eq("text", text)
      .limit(1);

    if (!existing || existing.length === 0) {
      await supabase.from("intentions").insert([{ user_id: userId, session_id: sessionId, text, completed: !!args.completed }]);
    } else {
      // optional sync completed
      if (typeof args.completed === "boolean") {
        await supabase
          .from("intentions")
          .update({ completed: !!args.completed })
          .eq("user_id", userId)
          .eq("session_id", sessionId)
          .eq("text", text);
      }
    }
  } catch {
    // ignore
  }
}

async function syncIntentionCompleted(userId: string, sessionId: string, text: string, completed: boolean) {
  const uid = String(userId || "").trim();
  const sid = String(sessionId || "").trim();
  const t = String(text || "").trim();
  if (!uid || !sid || !UUID_RE.test(sid) || !t) return;

  try {
    await supabase
      .from("intentions")
      .update({ completed: !!completed })
      .eq("user_id", uid)
      .eq("session_id", sid)
      .eq("text", t);
  } catch { }
}

async function syncIntentionText(userId: string, sessionId: string, oldText: string, newText: string) {
  const uid = String(userId || "").trim();
  const sid = String(sessionId || "").trim();
  const o = String(oldText || "").trim();
  const n = String(newText || "").trim();
  if (!uid || !sid || !UUID_RE.test(sid) || !o || !n) return;

  try {
    await supabase
      .from("intentions")
      .update({ text: n })
      .eq("user_id", uid)
      .eq("session_id", sid)
      .eq("text", o);
  } catch { }
}

async function deleteIntentionRow(userId: string, sessionId: string, text: string) {
  const uid = String(userId || "").trim();
  const sid = String(sessionId || "").trim();
  const t = String(text || "").trim();
  if (!uid || !sid || !UUID_RE.test(sid) || !t) return;

  try {
    await supabase
      .from("intentions")
      .delete()
      .eq("user_id", uid)
      .eq("session_id", sid)
      .eq("text", t);
  } catch { }
}

export function IntentionsPanel({
  sessionId: sessionIdProp,
  theme = "dark",
  timerText: timerTextProp,
  timerTextClassName,
}: IntentionsPanelProps) {
  const { id: idOrSlugFromUrl } = useParams<{ id: string }>();
  const rawSessionId = (sessionIdProp || idOrSlugFromUrl || "").trim();

  const isLight = theme === "light";

  const [user, setUser] = useState<any>(null);

  // ✅ resolved UUID (so realtime filter + queries always match DB)
  const [sessionId, setSessionId] = useState<string | null>(null);

  // ✅ My intentions are now focus_plan_items for this session
  const [myItems, setMyItems] = useState<FocusPlanItem[]>([]);
  const [myLoading, setMyLoading] = useState(true);

  // ✅ Team feed still uses intentions (for visibility)
  const [teamFeed, setTeamFeed] = useState<IntentionFeedRow[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);

  const [newIntention, setNewIntention] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");

  // avoid overlapping loads + stale updates
  const myLoadSeqRef = useRef(0);
  const teamLoadSeqRef = useRef(0);

  // ✅ timer label shown in the panel header
  const [timerText, setTimerText] = useState<string>("--:--");

  // ✅ overlay state (PiP / Popout)
  const overlayRef = useRef<{ win: any; container: HTMLElement; kind: "pip" | "window" } | null>(
    null
  );
  const [overlayOpen, setOverlayOpen] = useState(false);

  // =========================
  // ✅ Import from Plans (modal) state — now from DB (focus_plans + focus_plan_items)
  // =========================
  const [importModalOpen, setImportModalOpen] = useState(false);

  const [plans, setPlans] = useState<FocusPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [planItems, setPlanItems] = useState<FocusPlanItem[]>([]);
  const [planItemsLoading, setPlanItemsLoading] = useState(false);

  const [planSearch, setPlanSearch] = useState("");
  const [importingItemId, setImportingItemId] = useState<string | null>(null);

  // default plan for “Add” inside room
  const defaultPlanIdRef = useRef<string>("");

  // tokens
  const titleText = isLight ? "text-black/85" : "text-white/85";
  const mutedText = isLight ? "text-black/50" : "text-white/45";
  const divider = isLight ? "bg-black/10" : "bg-white/5";

  const panelBg = isLight ? "bg-white" : "bg-[#060B14]";
  const headerBg = isLight ? "bg-white/95" : "bg-[#060B14]/95";
  const headerBorder = isLight ? "border-black/10" : "border-white/10";

  const inputCls = isLight
    ? `
      bg-white border border-black/10 rounded-xl
      px-3 py-3 text-[13px] text-black/85 placeholder:text-black/35
      outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
      font-inter
    `
    : `
      bg-[#0B1220]/70 border border-white/10 rounded-xl
      px-3 py-3 text-[13px] text-white/85 placeholder:text-white/35
      outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
      font-inter
    `;

  const myCardCls = isLight
    ? "group rounded-xl border border-black/10 px-3 py-2.5 bg-white/70 hover:bg-white transition cursor-pointer"
    : "group rounded-xl border border-white/5 px-3 py-2.5 bg-[#0B1220]/55 hover:bg-[#0B1220]/75 transition cursor-pointer";

  const teamCardCls = isLight
    ? "rounded-xl border border-black/10 px-3 py-2.5 bg-white/70 hover:bg-white transition"
    : "rounded-xl border border-white/5 px-3 py-2.5 bg-[#0B1220]/55 hover:bg-[#0B1220]/75 transition";

  const ghostBtn = isLight
    ? "border border-black/10 bg-black/0 hover:bg-black/5 text-black/75"
    : "border border-white/10 bg-white/0 hover:bg-white/5 text-white/80";

  const primaryBtn = "bg-emerald-500 hover:bg-emerald-600 text-[#02140B] font-semibold";

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  // ✅ timer: prefer prop (this is what makes it match top bar 1:1)
  useEffect(() => {
    const t = typeof timerTextProp === "string" ? timerTextProp.trim() : "";
    if (t) setTimerText(t);
  }, [timerTextProp]);

  // ✅ fallback: if prop is NOT provided, listen to window event
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
        if (v) {
          const vv = v.trim();
          if (!vv) return;
          setTimerText((prev) => (prev === vv ? prev : vv));
        }
      } catch {
        // ignore
      }
    }, 1000);

    return () => {
      window.removeEventListener("mysession:timer", onTimer as any);
      window.clearInterval(id);
    };
  }, [timerTextProp]);

  // ✅ Resolve session UUID from prop/url (supports slug)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const raw = String(rawSessionId || "").trim();
      if (!raw) {
        if (!cancelled) setSessionId(null);
        return;
      }

      // already UUID
      if (UUID_RE.test(raw)) {
        if (!cancelled) setSessionId(raw);
        return;
      }

      // treat as slug → resolve sessions.id
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
    profile?.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || "User")}`;

  // =========================
  // ✅ Load plans (DB) + choose default plan for adding
  // =========================
  const loadPlans = useCallback(async () => {
    if (!user?.id) {
      setPlans([]);
      setSelectedPlanId("");
      defaultPlanIdRef.current = "";
      return;
    }

    setPlansLoading(true);
    try {
      const { data, error } = await supabase
        .from("focus_plans")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (error || !Array.isArray(data)) {
        setPlans([]);
        setSelectedPlanId("");
        defaultPlanIdRef.current = "";
        return;
      }

      const rows = data as FocusPlan[];
      setPlans(rows);

      const first = rows[0]?.id ? String(rows[0].id) : "";
      if (!selectedPlanId) setSelectedPlanId(first);
      if (!defaultPlanIdRef.current) defaultPlanIdRef.current = first;
      if (defaultPlanIdRef.current && !rows.some((p) => String(p.id) === String(defaultPlanIdRef.current))) {
        defaultPlanIdRef.current = first;
      }
    } catch {
      setPlans([]);
      setSelectedPlanId("");
      defaultPlanIdRef.current = "";
    } finally {
      setPlansLoading(false);
    }
  }, [user?.id, selectedPlanId]);

  const ensureDefaultPlan = useCallback(async (): Promise<string> => {
    if (!user?.id) return "";

    // already have one
    if (defaultPlanIdRef.current) return defaultPlanIdRef.current;

    // load first
    await loadPlans();
    if (defaultPlanIdRef.current) return defaultPlanIdRef.current;

    // none → create
    try {
      const { data, error } = await supabase
        .from("focus_plans")
        .insert({ user_id: user.id, title: "My plan" })
        .select("*")
        .single();

      if (!error && data?.id) {
        defaultPlanIdRef.current = String((data as any).id);
        setPlans((prev) => [data as any, ...prev]);
        if (!selectedPlanId) setSelectedPlanId(String((data as any).id));
        return defaultPlanIdRef.current;
      }
    } catch { }

    return "";
  }, [user?.id, loadPlans, selectedPlanId]);

  useEffect(() => {
    if (!user?.id) return;
    void loadPlans();
  }, [user?.id, loadPlans]);

  // load plan items for selected plan (DB)
  const loadPlanItems = useCallback(async (planId?: string) => {
    const pid = String(planId || selectedPlanId || "").trim();
    if (!user?.id || !pid) {
      setPlanItems([]);
      return;
    }

    setPlanItemsLoading(true);
    try {
      const { data, error } = await supabase
        .from("focus_plan_items")
        .select("*")
        .eq("user_id", user.id)
        .eq("plan_id", pid)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });

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
  }, [user?.id, selectedPlanId]);

  useEffect(() => {
    if (!importModalOpen) return;
    if (!selectedPlanId) return;
    void loadPlanItems(selectedPlanId);
  }, [importModalOpen, selectedPlanId, loadPlanItems]);

  // =========================
  // ✅ My items in this session (focus_plan_items)
  // =========================
  const loadMyItems = useCallback(async (sid?: string | null) => {
    const s = String(sid || sessionId || "").trim();
    if (!user?.id || !s) return;

    const seq = ++myLoadSeqRef.current;
    setMyLoading(true);

    try {
      const { data, error } = await supabase
        .from("focus_plan_items")
        .select("*")
        .eq("user_id", user.id)
        .eq("session_id", s)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });

      if (seq !== myLoadSeqRef.current) return;

      if (!error) setMyItems((data as any) || []);
      else setMyItems([]);
    } finally {
      if (seq === myLoadSeqRef.current) setMyLoading(false);
    }
  }, [user?.id, sessionId]);

  // realtime for my items in this session
  useEffect(() => {
    if (!user?.id) return;
    if (!sessionId) return;

    void loadMyItems(sessionId);

    const ch = supabase
      .channel(`focus-plan-items-session:${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "focus_plan_items", filter: `session_id=eq.${sessionId}` },
        (payload: any) => {
          const uidNew = String(payload?.new?.user_id || payload?.old?.user_id || "");
          if (uidNew && uidNew !== String(user.id)) return;
          void loadMyItems(sessionId);
        }
      )
      .subscribe();

    return () => {
      safeRemoveRealtimeChannel(ch);
    };
  }, [user?.id, sessionId, loadMyItems]);

  // =========================
  // ✅ Team feed (intentions table)
  // =========================
  const loadTeamFeed = useCallback(async (sid?: string | null) => {
    const s = String(sid || sessionId || "").trim();
    if (!s) return;

    const seq = ++teamLoadSeqRef.current;
    setTeamLoading(true);

    try {
      const { data, error } = await supabase
        .from("intentions")
        .select(
          `id, text, user_id, session_id, created_at, completed,
           profiles ( full_name, avatar_url )`
        )
        .eq("session_id", s)
        .order("created_at", { ascending: false });

      if (seq !== teamLoadSeqRef.current) return;

      if (!error) setTeamFeed((data as any) || []);
      else setTeamFeed([]);
    } finally {
      if (seq === teamLoadSeqRef.current) setTeamLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    void loadTeamFeed(sessionId);

    const channel = supabase
      .channel(`intentions_realtime_${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "intentions",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload: any) => {
          if (payload?.eventType === "DELETE") {
            const deletedId = payload?.old?.id;
            if (deletedId) setTeamFeed((prev) => prev.filter((i) => i.id !== deletedId));
            else void loadTeamFeed(sessionId);
            return;
          }
          void loadTeamFeed(sessionId);
        }
      )
      .subscribe();

    return () => {
      safeRemoveRealtimeChannel(channel);
    };
  }, [sessionId, loadTeamFeed]);

  // quick lookups
  const myTextSet = useMemo(() => {
    const set = new Set<string>();
    for (const it of myItems) {
      const t = String(it?.text || "").trim().toLowerCase();
      if (t) set.add(t);
    }
    return set;
  }, [myItems]);

  const myCompletedByText = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const it of myItems) {
      const k = String(it?.text || "").trim().toLowerCase();
      if (!k) continue;
      m.set(k, !!it.completed);
    }
    return m;
  }, [myItems]);

  // =========================
  // ✅ Import modal actions (DB)
  // =========================
  const importPlanItemToThisSession = useCallback(
    async (item: FocusPlanItem) => {
      if (!user?.id || !sessionId) return;

      const text = String(item?.text || "").trim();
      if (!text) return;

      // if already in current session by id/session_id or by text, do nothing
      const already =
        String(item.session_id || "").trim() === sessionId ||
        myTextSet.has(text.toLowerCase());

      if (already) return;

      setImportingItemId(item.id);

      try {
        // set session_id on plan item (source of truth)
        const { error } = await supabase
          .from("focus_plan_items")
          .update({ session_id: sessionId })
          .eq("id", item.id)
          .eq("user_id", user.id);

        if (error) return;

        // ensure team-visible intention row
        await ensureSessionIntentionRow({
          userId: user.id,
          sessionId,
          text,
          completed: !!item.completed,
        });

        // refresh both
        await loadMyItems(sessionId);
        if (selectedPlanId) await loadPlanItems(selectedPlanId);
      } finally {
        setImportingItemId(null);
      }
    },
    [user?.id, sessionId, myTextSet, loadMyItems, selectedPlanId, loadPlanItems]
  );

  // =========================
  // ✅ My intentions CRUD (focus_plan_items)
  // =========================
  const handleAddIntention = async () => {
    if (!newIntention.trim() || !user?.id || !sessionId) return;

    const text = newIntention.trim();
    setNewIntention("");

    // already present by text → ignore
    if (myTextSet.has(text.toLowerCase())) return;

    const planId = await ensureDefaultPlan();
    if (!planId) return;

    // optimistic
    const optimisticId = `optimistic-${Date.now()}`;
    setMyItems((prev) => [
      {
        id: optimisticId as any,
        plan_id: planId,
        user_id: user.id,
        text,
        target_date: null,
        session_id: sessionId,
        completed: false,
        sort_order: 0,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);

    try {
      const { data, error } = await supabase
        .from("focus_plan_items")
        .insert([
          {
            user_id: user.id,
            plan_id: planId,
            text,
            target_date: null,
            session_id: sessionId,
            completed: false,
            sort_order: 0,
          },
        ])
        .select("*")
        .single();

      if (error || !data) {
        setMyItems((prev) => prev.filter((x) => x.id !== optimisticId));
        return;
      }

      // replace optimistic
      setMyItems((prev) => [data as any, ...prev.filter((x) => x.id !== optimisticId)]);

      // team visibility
      await ensureSessionIntentionRow({ userId: user.id, sessionId, text, completed: false });
      await loadTeamFeed(sessionId);
    } catch {
      setMyItems((prev) => prev.filter((x) => x.id !== optimisticId));
    }
  };

  const toggleCompleted = async (item: FocusPlanItem) => {
    if (editingId === item.id) return;
    if (!user?.id || !sessionId) return;

    const next = !Boolean(item.completed);

    setMyItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, completed: next } : i)));

    const { error } = await supabase
      .from("focus_plan_items")
      .update({ completed: next })
      .eq("id", item.id)
      .eq("user_id", user.id);

    if (error) {
      setMyItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, completed: !next } : i)));
      return;
    }

    // best-effort sync into team feed row(s)
    const text = String(item.text || "").trim();
    if (text) {
      await ensureSessionIntentionRow({ userId: user.id, sessionId, text, completed: next });
      await syncIntentionCompleted(user.id, sessionId, text, next);
      await loadTeamFeed(sessionId);
    }
  };

  // ✅ "delete" in room = detach from session (keep item in plan)
  const handleRemoveFromSession = async (it: FocusPlanItem) => {
    if (!user?.id || !sessionId) return;

    const prev = myItems;
    setMyItems((curr) => curr.filter((x) => x.id !== it.id));

    const text = String(it.text || "").trim();

    const { error } = await supabase
      .from("focus_plan_items")
      .update({ session_id: null })
      .eq("id", it.id)
      .eq("user_id", user.id);

    if (error) {
      setMyItems(prev);
      return;
    }

    if (text) {
      await deleteIntentionRow(user.id, sessionId, text);
      await loadTeamFeed(sessionId);
    }
  };

  const startEdit = (it: FocusPlanItem) => {
    setEditingId(it.id);
    setEditingText(it.text || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (!user?.id || !sessionId) return;

    const text = editingText.trim();
    if (!text) return;

    const cur = myItems.find((x) => x.id === editingId);
    const oldText = String(cur?.text || "").trim();

    setMyItems((prev) => prev.map((i) => (i.id === editingId ? { ...i, text } : i)));

    const { error } = await supabase
      .from("focus_plan_items")
      .update({ text })
      .eq("id", editingId)
      .eq("user_id", user.id);

    if (error) {
      setMyItems((prev) => prev.map((i) => (i.id === editingId ? { ...i, text: oldText } : i)));
      return;
    }

    // best-effort sync shadow intention row
    if (oldText && oldText !== text) {
      await syncIntentionText(user.id, sessionId, oldText, text);
    }
    await ensureSessionIntentionRow({ userId: user.id, sessionId, text, completed: !!cur?.completed });
    await loadTeamFeed(sessionId);

    setEditingId(null);
    setEditingText("");
  };

  // =========================
  // ✅ Pin / Overlay functions
  // =========================
  const closeOverlay = useCallback(() => {
    const o = overlayRef.current;
    overlayRef.current = null;
    setOverlayOpen(false);

    try {
      o?.win?.close?.();
    } catch {
      // ignore
    }
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
    } catch {
      // ignore
    }
  }, [closeOverlay, isLight]);

  useEffect(() => {
    return () => {
      try {
        closeOverlay();
      } catch {
        // ignore
      }
    };
  }, [closeOverlay]);

  // =========================
  // ✅ Import modal helpers
  // =========================
  const getPortalDocument = useCallback((): Document => {
    const o = overlayRef.current;
    const doc = o?.win?.document;
    return doc || document;
  }, []);

  const openImportModal = useCallback(() => {
    setImportModalOpen(true);
    void loadPlans();
  }, [loadPlans]);

  const closeImportModal = useCallback(() => {
    setImportModalOpen(false);
  }, []);

  // ESC to close import modal (works in normal and pip/window)
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

  // =========================
  // UI states for session id
  // =========================
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

  const timerPillCls = isLight
    ? "bg-black/5 border border-black/10 text-black/80"
    : "bg-white/5 border border-white/10 text-white/80";

  const headerTitle = isLight ? "text-black/85" : "text-white/85";

  // ✅ Timer typography
  const timerTextCls = `tabular-nums text-[12px] ${timerTextClassName || ""} font-inter font-normal`.trim();

  // =========================
  // ✅ Import modal UI
  // =========================
  const planItemsVisible = useMemo(() => {
    const q = String(planSearch || "").trim().toLowerCase();
    const base = (planItems || []).filter((it) => String(it?.text || "").trim().length > 0);
    if (!q) return base;
    return base.filter((it) => String(it.text || "").toLowerCase().includes(q));
  }, [planItems, planSearch]);

  const selectedPlan = useMemo(() => {
    if (!selectedPlanId) return null;
    return plans.find((p) => String(p.id) === String(selectedPlanId)) || null;
  }, [plans, selectedPlanId]);

  const ImportModal = importModalOpen
    ? (() => {
      const modalDoc = getPortalDocument();

      const backdropBg = isLight ? "bg-black/40" : "bg-black/55";
      const modalBg = isLight ? "bg-white" : "bg-[#060B14]";
      const modalBorder = isLight ? "border-black/10" : "border-white/10";
      const modalTitle = isLight ? "text-black/85" : "text-white/85";
      const modalSub = isLight ? "text-black/50" : "text-white/45";
      const rowBg = isLight ? "bg-white/70 hover:bg-white" : "bg-[#0B1220]/55 hover:bg-[#0B1220]/75";
      const rowBorder = isLight ? "border-black/10" : "border-white/10";

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
              "w-[min(680px,calc(100vw-24px))] max-h-[min(78vh,720px)] rounded-2xl border shadow-xl overflow-hidden",
              modalBg,
              modalBorder,
            ].join(" ")}
            style={{ fontFamily: OVERLAY_FONT_FAMILY }}
          >
            {/* header */}
            <div className={["px-4 py-3 border-b", modalBorder].join(" ")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={["text-[13px] font-semibold", modalTitle].join(" ")}>
                    Import from my plans
                  </div>
                  <div className={["text-[11px] mt-0.5", modalSub].join(" ")}>
                    Adds plan items into this session (as focus_plan_items), and syncs team feed.
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    className={"h-9 px-3 rounded-xl text-[12px] font-semibold transition inline-flex items-center gap-2 " + ghostBtn}
                    onClick={() => loadPlans()}
                    title="Refresh plans"
                    disabled={plansLoading}
                    style={{ opacity: plansLoading ? 0.7 : 1 }}
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

            {/* body */}
            <div className="p-4 overflow-y-auto custom-scrollbar" style={{ maxHeight: "calc(78vh - 56px)" }}>
              {plansLoading ? (
                <div className={"text-[12px] italic " + mutedText}>Loading plans…</div>
              ) : plans.length === 0 ? (
                <div className={"text-[12px] italic " + mutedText}>
                  No plans found. Create a plan in Focus plan page.
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
                          ? "w-full h-11 px-3 rounded-xl border border-black/10 bg-white text-[13px] font-semibold text-black/85 outline-none focus:ring-1 focus:ring-emerald-500"
                          : "w-full h-11 px-3 rounded-xl border border-white/10 bg-[#0B1220]/70 text-[13px] font-semibold text-white/85 outline-none focus:ring-1 focus:ring-emerald-500"
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
                          isLight ? "border-black/10 bg-white" : "border-white/10 bg-[#0B1220]/70",
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

                  {!selectedPlan ? (
                    <div className={"text-[12px] italic " + mutedText}>Select a plan.</div>
                  ) : planItemsLoading ? (
                    <div className={"text-[12px] italic " + mutedText}>Loading items…</div>
                  ) : planItemsVisible.length === 0 ? (
                    <div className={"text-[12px] italic " + mutedText}>No items match your filter.</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {planItemsVisible.slice(0, 30).map((it) => {
                        const text = String(it.text || "").trim();
                        const alreadyInSession =
                          String(it.session_id || "").trim() === sessionId ||
                          myTextSet.has(text.toLowerCase());

                        return (
                          <div
                            key={it.id}
                            className={["rounded-xl border px-3 py-2.5 transition", rowBg, rowBorder].join(" ")}
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

                                <div className={"mt-1 text-[11px] " + mutedText}>
                                  {alreadyInSession ? "Already in this session" : "Plan item"}
                                </div>
                              </div>

                              {alreadyInSession ? (
                                <div className="shrink-0">
                                  <div
                                    className={[
                                      "h-10 px-3 rounded-xl text-[12px] font-semibold inline-flex items-center gap-2",
                                      isLight
                                        ? "bg-black/5 text-black/60 border border-black/10"
                                        : "bg-white/5 text-white/70 border border-white/10",
                                    ].join(" ")}
                                    title="Already in this session"
                                  >
                                    <Check size={16} />
                                    Added
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => importPlanItemToThisSession(it)}
                                  disabled={importingItemId === it.id}
                                  className={[
                                    "shrink-0 h-10 px-3 rounded-xl text-[12px] font-semibold transition inline-flex items-center gap-2",
                                    importingItemId === it.id ? "opacity-70" : "opacity-100",
                                    primaryBtn,
                                  ].join(" ")}
                                  title="Import into this session"
                                >
                                  <ListPlus size={16} />
                                  {importingItemId === it.id ? "Import..." : "Import"}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {planItemsVisible.length > 30 ? (
                        <div className={"text-[11px] italic mt-1 " + mutedText}>
                          Showing first 30 items (filter to find more).
                        </div>
                      ) : null}
                    </div>
                  )}

                  <div className={"mt-4 text-[11px] " + mutedText}>
                    Tip: full editing stays in Focus plan; here you only link items to this room.
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
    <div className={"h-full flex flex-col min-h-0 font-inter " + panelBg}>
      {/* Header */}
      <div className={"px-4 pt-4 pb-3 shrink-0 border-b " + headerBorder + " " + headerBg}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className={"font-inter font-semibold text-[13px] " + headerTitle}>Intentions</div>
            <div className={"text-[11px] font-inter " + mutedText}>Now synced with Focus plan items</div>
          </div>

          <div className="flex items-center gap-2 shrink-0 font-inter">
            {/* ✅ Timer pill */}
            <div className={"inline-flex items-center gap-2 px-3 py-2 rounded-xl " + timerPillCls} title="Timer">
              <TimerSmartIcon theme={theme} className="w-4 h-4 opacity-80" />
              <span className={timerTextCls + " leading-none"} style={{ fontFamily: OVERLAY_FONT_FAMILY }}>
                {timerText || "--:--"}
              </span>
            </div>

            {/* ✅ Import icon (opens modal) */}
            <IconButton
              theme={theme}
              title="Import from my plans"
              onClick={(e) => {
                e.preventDefault();
                openImportModal();
              }}
            >
              <ListPlus size={16} />
            </IconButton>

            {!overlayOpen ? (
              <IconButton
                theme={theme}
                title="Pin (always on top if supported)"
                onClick={(e) => {
                  e.preventDefault();
                  openOverlay();
                }}
              >
                <Pin size={16} />
              </IconButton>
            ) : (
              <IconButton
                theme={theme}
                title="Unpin"
                onClick={(e) => {
                  e.preventDefault();
                  closeOverlay();
                }}
              >
                <PinOff size={16} />
              </IconButton>
            )}

            <IconButton
              theme={theme}
              title="Open Focus plan"
              onClick={(e) => {
                e.preventDefault();
                const sid = (rawSessionId || sessionId || "").trim();
                if (!sid) return;
                window.open(`/focus-plan?sessionId=${encodeURIComponent(sid)}`, "_blank", "noopener,noreferrer");
              }}
            >
              <ExternalLink size={16} />
            </IconButton>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-4 pt-4 min-h-0 flex-1 overflow-y-auto custom-scrollbar font-inter">
        <div className="mb-5">
          <div className={titleText + " font-inter font-semibold text-[13px] mb-3"}>My intentions</div>

          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={newIntention}
              onChange={(e) => setNewIntention(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddIntention()}
              placeholder="Add an intention... (creates focus_plan_item)"
              className={"flex-1 " + inputCls}
            />

            <button
              onClick={handleAddIntention}
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

          {myLoading ? (
            <div className={"text-[12px] italic font-inter " + mutedText}>Loading...</div>
          ) : myItems.length === 0 ? (
            <div className={"text-[12px] italic font-inter " + mutedText}>No intentions yet</div>
          ) : (
            <div className="flex flex-col gap-2">
              {myItems.map((it) => {
                const isEditing = editingId === it.id;

                const circleCls = isLight ? "text-black/40" : "text-white/45";
                const textDoneCls = isLight ? "text-black/45 line-through" : "text-white/50 line-through";
                const textActiveCls = isLight ? "text-black/80" : "text-white/80";

                const editInputCls = isLight
                  ? `
                    w-full bg-white border border-black/10 rounded-xl
                    px-3 py-2 text-[13px] text-black/85
                    outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
                    font-inter
                  `
                  : `
                    w-full bg-[#0B1220]/80 border border-white/10 rounded-xl
                    px-3 py-2 text-[13px] text-white/85
                    outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
                    font-inter
                  `;

                return (
                  <div key={it.id} onClick={() => toggleCompleted(it)} className={myCardCls + " font-inter"}>
                    <div className="flex items-center gap-2">
                      <div className="shrink-0">
                        {it.completed ? <CheckCircle size={18} className="text-emerald-500" /> : <Circle size={18} className={circleCls} />}
                      </div>

                      <div className="flex-1 min-w-0">
                        {!isEditing ? (
                          <div className={"text-[13px] break-words leading-5 font-inter " + (it.completed ? textDoneCls : textActiveCls)}>
                            {it.text}
                          </div>
                        ) : (
                          <input
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                            className={editInputCls}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
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
                                  startEdit(it);
                                }}
                              >
                                <Pencil size={16} />
                              </IconButton>
                            </div>

                            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <IconButton
                                theme={theme}
                                title="Remove from this session (keeps it in Focus plan)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleRemoveFromSession(it);
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
                                saveEdit();
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

        {teamLoading ? (
          <div className={"text-[12px] italic font-inter " + mutedText}>Loading...</div>
        ) : teamFeed.length === 0 ? (
          <div className={"text-[12px] italic font-inter " + mutedText}>No team intentions</div>
        ) : (
          <div className="flex flex-col gap-2">
            {teamFeed.map((item) => {
              const isMine = item.user_id === user?.id;
              const nameCls = isLight ? "text-black/85" : "text-white/85";
              const bodyActive = isLight ? "text-black/75" : "text-white/75";
              const bodyDone = isLight ? "text-black/45 line-through" : "text-white/50 line-through";
              const circleCls = isLight ? "text-black/30" : "text-white/30";

              // ✅ for my own rows, reflect focus_plan_items completion as source of truth
              const completedForRender = isMine
                ? !!myCompletedByText.get(String(item.text || "").trim().toLowerCase())
                : !!item.completed;

              return (
                <div key={item.id} className={teamCardCls + " font-inter"}>
                  <div className="flex items-center gap-3">
                    <img src={getAvatar(item.profiles)} className="w-9 h-9 rounded-full object-cover" alt="" />

                    <div className="flex-1 min-w-0">
                      <div className={"text-[13px] font-medium truncate font-inter " + nameCls}>
                        {isMine ? "You" : item.profiles?.full_name || "Participant"}
                      </div>

                      <div className={"text-[13px] break-words leading-5 font-inter " + (completedForRender ? bodyDone : bodyActive)}>
                        {item.text}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {completedForRender ? <CheckCircle size={16} className="text-emerald-500" /> : <Circle size={16} className={circleCls} />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ✅ Modal */}
      {ImportModal}
    </div>
  );

  return (
    <>
      {overlayOpen && overlayRef.current?.container ? createPortal(PanelUI, overlayRef.current.container) : null}

      {!overlayOpen ? (
        PanelUI
      ) : (
        <div className={"h-full flex items-center justify-center font-inter " + panelBg}>
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
                ${isLight ? "border-black/15 text-black/80 hover:bg-black/5" : "border-white/10 text-white/80 hover:bg-white/5"}
                transition inline-flex items-center gap-2 text-[13px] font-semibold font-inter
              `}
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