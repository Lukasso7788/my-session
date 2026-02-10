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
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useParams } from "react-router-dom";

type RoomTheme = "dark" | "light";

interface Intention {
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
  // Pass remainingTime from RoomPageIFrame: timerText={remainingTime || "--:--"}
  timerText?: string;

  // ✅ IMPORTANT:
  // Pass EXACT SAME className that you use for the timer text in RoomPageIFrame.
  // This makes timer typography 1:1 identical (except we force Inter + font-normal).
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
  // Best-effort: clone <style> and relevant <link> into target doc
  try {
    const nodes = Array.from(
      from.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
        // include stylesheet + font-related helpers (preconnect/preload)
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

  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [newIntention, setNewIntention] = useState("");
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");

  // avoid overlapping loads + stale updates
  const loadSeqRef = useRef(0);

  // ✅ timer label shown in the panel header
  const [timerText, setTimerText] = useState<string>("--:--");

  // ✅ overlay state (PiP / Popout)
  const overlayRef = useRef<{ win: any; container: HTMLElement; kind: "pip" | "window" } | null>(
    null
  );
  const [overlayOpen, setOverlayOpen] = useState(false);

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

  const loadIntentions = useCallback(
    async (sid?: string | null) => {
      const s = String(sid || sessionId || "");
      if (!s) return;

      const seq = ++loadSeqRef.current;
      setLoading(true);

      try {
        const { data, error } = await supabase
          .from("intentions")
          .select(
            `id, text, user_id, session_id, created_at, completed,
             profiles ( full_name, avatar_url )`
          )
          .eq("session_id", s)
          .order("created_at", { ascending: false });

        if (seq !== loadSeqRef.current) return;

        if (!error) setIntentions((data as any) || []);
      } finally {
        if (seq === loadSeqRef.current) setLoading(false);
      }
    },
    [sessionId]
  );

  // ✅ Initial load + realtime (proper filter by session_id)
  useEffect(() => {
    if (!sessionId) return;

    loadIntentions(sessionId);

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
            if (deletedId) setIntentions((prev) => prev.filter((i) => i.id !== deletedId));
            else loadIntentions(sessionId);
            return;
          }

          loadIntentions(sessionId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, loadIntentions]);

  const myIntentions = useMemo(
    () => intentions.filter((i) => i.user_id === user?.id),
    [intentions, user?.id]
  );

  const teamIntentions = useMemo(() => intentions, [intentions]);

  const handleAddIntention = async () => {
    if (!newIntention.trim() || !user || !sessionId) return;

    const text = newIntention.trim();
    setNewIntention("");

    const optimisticId = `optimistic-${Date.now()}`;
    setIntentions((prev) => [
      {
        id: optimisticId,
        text,
        user_id: user.id,
        session_id: sessionId,
        completed: false,
        created_at: new Date().toISOString(),
        profiles: { full_name: "You", avatar_url: undefined },
      },
      ...prev,
    ]);

    const { error } = await supabase.from("intentions").insert([
      { user_id: user.id, session_id: sessionId, text, completed: false },
    ]);

    if (error) {
      setIntentions((prev) => prev.filter((i) => i.id !== optimisticId));
      return;
    }

    loadIntentions(sessionId);
  };

  const toggleCompleted = async (intention: Intention) => {
    if (editingId === intention.id) return;
    if (!sessionId) return;

    const next = !Boolean(intention.completed);

    setIntentions((prev) =>
      prev.map((i) => (i.id === intention.id ? { ...i, completed: next } : i))
    );

    const { error } = await supabase
      .from("intentions")
      .update({ completed: next })
      .eq("id", intention.id);

    if (error) {
      setIntentions((prev) =>
        prev.map((i) => (i.id === intention.id ? { ...i, completed: !next } : i))
      );
    }
  };

  const handleDelete = async (id: string) => {
    if (!sessionId) return;

    const prev = intentions;
    setIntentions((curr) => curr.filter((i) => i.id !== id));

    const { error } = await supabase.from("intentions").delete().eq("id", id);
    if (error) setIntentions(prev);
  };

  const startEdit = (i: Intention) => {
    setEditingId(i.id);
    setEditingText(i.text || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (!sessionId) return;

    const text = editingText.trim();
    if (!text) return;

    const old = intentions.find((i) => i.id === editingId)?.text || "";
    setIntentions((prev) => prev.map((i) => (i.id === editingId ? { ...i, text } : i)));

    const { error } = await supabase.from("intentions").update({ text }).eq("id", editingId);
    if (error) {
      setIntentions((prev) =>
        prev.map((i) => (i.id === editingId ? { ...i, text: old } : i))
      );
      return;
    }

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

  // ✅ Timer typography: allow passing size/etc from RoomPageIFrame,
  // but ALWAYS force Inter + font-normal here (and keep tabular nums).
  const timerTextCls =
    `tabular-nums text-[12px] ${timerTextClassName || ""} font-inter font-normal`.trim();

  const PanelUI = (
    <div className={"h-full flex flex-col min-h-0 font-inter " + panelBg}>
      {/* Header */}
      <div className={"px-4 pt-4 pb-3 shrink-0 border-b " + headerBorder + " " + headerBg}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className={"font-inter font-semibold text-[13px] " + headerTitle}>Intentions</div>
            <div className={"text-[11px] font-inter " + mutedText}>Keep it visible while you work</div>
          </div>

          <div className="flex items-center gap-2 shrink-0 font-inter">
            {/* ✅ Timer pill */}
            <div
              className={"inline-flex items-center gap-2 px-3 py-2 rounded-xl " + timerPillCls}
              title="Timer"
            >
              <TimerSmartIcon theme={theme} className="w-4 h-4 opacity-80" />
              <span
                className={timerTextCls + " leading-none"}
                style={{ fontFamily: OVERLAY_FONT_FAMILY }}
              >
                {timerText || "--:--"}
              </span>
            </div>

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
              placeholder="Add an intention..."
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

          {loading ? (
            <div className={"text-[12px] italic font-inter " + mutedText}>Loading...</div>
          ) : myIntentions.length === 0 ? (
            <div className={"text-[12px] italic font-inter " + mutedText}>No intentions yet</div>
          ) : (
            <div className="flex flex-col gap-2">
              {myIntentions.map((i) => {
                const isEditing = editingId === i.id;

                const circleCls = isLight ? "text-black/40" : "text-white/45";
                const textDoneCls = isLight
                  ? "text-black/45 line-through"
                  : "text-white/50 line-through";
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
                  <div key={i.id} onClick={() => toggleCompleted(i)} className={myCardCls + " font-inter"}>
                    <div className="flex items-center gap-2">
                      <div className="shrink-0">
                        {i.completed ? (
                          <CheckCircle size={18} className="text-emerald-500" />
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
                                  startEdit(i);
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
                                  handleDelete(i.id);
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

        {loading ? (
          <div className={"text-[12px] italic font-inter " + mutedText}>Loading...</div>
        ) : teamIntentions.length === 0 ? (
          <div className={"text-[12px] italic font-inter " + mutedText}>No team intentions</div>
        ) : (
          <div className="flex flex-col gap-2">
            {teamIntentions.map((item) => {
              const isMine = item.user_id === user?.id;
              const nameCls = isLight ? "text-black/85" : "text-white/85";
              const bodyActive = isLight ? "text-black/75" : "text-white/75";
              const bodyDone = isLight ? "text-black/45 line-through" : "text-white/50 line-through";
              const circleCls = isLight ? "text-black/30" : "text-white/30";

              return (
                <div key={item.id} className={teamCardCls + " font-inter"}>
                  <div className="flex items-center gap-3">
                    <img
                      src={getAvatar(item.profiles)}
                      className="w-9 h-9 rounded-full object-cover"
                      alt=""
                    />

                    <div className="flex-1 min-w-0">
                      <div className={"text-[13px] font-medium truncate font-inter " + nameCls}>
                        {isMine ? "You" : item.profiles?.full_name || "Participant"}
                      </div>

                      <div
                        className={
                          "text-[13px] break-words leading-5 font-inter " +
                          (item.completed ? bodyDone : bodyActive)
                        }
                      >
                        {item.text}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {item.completed ? (
                        <CheckCircle size={16} className="text-emerald-500" />
                      ) : (
                        <Circle size={16} className={circleCls} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
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
