// src/components/IntentionsPanel.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, Circle, Trash2, Pencil, X, Check } from "lucide-react";
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
};

// UUID matcher (so we can safely detect slug vs uuid)
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function IconButton({
  title,
  onClick,
  children,
  className = "",
  theme = "dark",
}: {
  title: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
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

export function IntentionsPanel({
  sessionId: sessionIdProp,
  theme = "dark",
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

  // tokens
  const titleText = isLight ? "text-black/85" : "text-white/85";
  const mutedText = isLight ? "text-black/50" : "text-white/45";
  const divider = isLight ? "bg-black/10" : "bg-white/5";

  const inputCls = isLight
    ? `
      bg-white border border-black/10 rounded-xl
      px-3 py-3 text-[13px] text-black/85 placeholder:text-black/35
      outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
    `
    : `
      bg-[#0B1220]/70 border border-white/10 rounded-xl
      px-3 py-3 text-[13px] text-white/85 placeholder:text-white/35
      outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
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
    `https://ui-avatars.com/api/?name=${encodeURIComponent(
      profile?.full_name || "User"
    )}`;

  const loadIntentions = async (sid?: string | null) => {
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

      // ignore stale loads
      if (seq !== loadSeqRef.current) return;

      if (!error) setIntentions((data as any) || []);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  };

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
          // DELETE: we can remove locally immediately
          if (payload?.eventType === "DELETE") {
            const deletedId = payload?.old?.id;
            if (deletedId) {
              setIntentions((prev) => prev.filter((i) => i.id !== deletedId));
            } else {
              // fallback
              loadIntentions(sessionId);
            }
            return;
          }

          // INSERT/UPDATE: reload list (simple + reliable)
          loadIntentions(sessionId);
        }
      )
      .subscribe((status) => {
        // useful for debugging if realtime silently fails
        // console.log("[intentions realtime]", sessionId, status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const myIntentions = useMemo(
    () => intentions.filter((i) => i.user_id === user?.id),
    [intentions, user?.id]
  );

  const teamIntentions = useMemo(() => intentions, [intentions]);

  const handleAddIntention = async () => {
    if (!newIntention.trim() || !user || !sessionId) return;

    const text = newIntention.trim();
    setNewIntention("");

    // optimistic: insert locally first (so UI feels instant)
    const optimisticId = `optimistic-${Date.now()}`;
    setIntentions((prev) => [
      {
        id: optimisticId,
        text,
        user_id: user.id,
        session_id: sessionId,
        completed: false,
        created_at: new Date().toISOString(),
        profiles: {
          full_name: "You",
          avatar_url: undefined,
        },
      },
      ...prev,
    ]);

    const { error } = await supabase.from("intentions").insert([
      {
        user_id: user.id,
        session_id: sessionId,
        text,
        completed: false,
      },
    ]);

    // if failed, revert optimistic
    if (error) {
      setIntentions((prev) => prev.filter((i) => i.id !== optimisticId));
      return;
    }

    // sync with DB state
    loadIntentions(sessionId);
  };

  const toggleCompleted = async (intention: Intention) => {
    if (editingId === intention.id) return;
    if (!sessionId) return;

    const next = !Boolean(intention.completed);

    // optimistic
    setIntentions((prev) =>
      prev.map((i) => (i.id === intention.id ? { ...i, completed: next } : i))
    );

    const { error } = await supabase
      .from("intentions")
      .update({ completed: next })
      .eq("id", intention.id);

    if (error) {
      // revert
      setIntentions((prev) =>
        prev.map((i) =>
          i.id === intention.id ? { ...i, completed: !next } : i
        )
      );
      return;
    }

    // optional: keep list synced (in case server-side changes exist)
    // loadIntentions(sessionId);
  };

  const handleDelete = async (id: string) => {
    if (!sessionId) return;

    // optimistic remove
    const prev = intentions;
    setIntentions((curr) => curr.filter((i) => i.id !== id));

    const { error } = await supabase.from("intentions").delete().eq("id", id);
    if (error) {
      // revert on fail
      setIntentions(prev);
      return;
    }

    // no need to reload; realtime will also propagate to others
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

    // optimistic update
    const old = intentions.find((i) => i.id === editingId)?.text || "";
    setIntentions((prev) =>
      prev.map((i) => (i.id === editingId ? { ...i, text } : i))
    );

    const { error } = await supabase
      .from("intentions")
      .update({ text })
      .eq("id", editingId);

    if (error) {
      // revert
      setIntentions((prev) =>
        prev.map((i) => (i.id === editingId ? { ...i, text: old } : i))
      );
      return;
    }

    setEditingId(null);
    setEditingText("");
  };

  // When session not resolved yet (e.g., slug resolving)
  if (!rawSessionId) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className={"text-[12px] italic " + mutedText}>No session id</div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className={"text-[12px] italic " + mutedText}>
          Resolving session...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="p-4 min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <div className="mb-5">
          <div
            className={titleText + " font-inter font-semibold text-[13px] mb-3"}
          >
            My intentions
          </div>

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
              "
              type="button"
              title="Add"
            >
              Add
            </button>
          </div>

          {loading ? (
            <div className={"text-[12px] italic " + mutedText}>Loading...</div>
          ) : myIntentions.length === 0 ? (
            <div className={"text-[12px] italic " + mutedText}>
              No intentions yet
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {myIntentions.map((i) => {
                const isEditing = editingId === i.id;

                const circleCls = isLight ? "text-black/40" : "text-white/45";
                const textDoneCls = isLight
                  ? "text-black/45 line-through"
                  : "text-white/50 line-through";
                const textActiveCls = isLight
                  ? "text-black/80"
                  : "text-white/80";

                const editInputCls = isLight
                  ? `
                    w-full bg-white border border-black/10 rounded-xl
                    px-3 py-2 text-[13px] text-black/85
                    outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
                  `
                  : `
                    w-full bg-[#0B1220]/80 border border-white/10 rounded-xl
                    px-3 py-2 text-[13px] text-white/85
                    outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
                  `;

                return (
                  <div
                    key={i.id}
                    onClick={() => toggleCompleted(i)}
                    className={myCardCls}
                  >
                    <div className="flex items-center gap-2">
                      <div className="shrink-0">
                        {i.completed ? (
                          <CheckCircle
                            size={18}
                            className="text-emerald-500"
                          />
                        ) : (
                          <Circle size={18} className={circleCls} />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {!isEditing ? (
                          <div
                            className={
                              "text-[13px] break-words leading-5 " +
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

        <div
          className={titleText + " font-inter font-semibold text-[13px] mb-3"}
        >
          Team intentions
        </div>

        {loading ? (
          <div className={"text-[12px] italic " + mutedText}>Loading...</div>
        ) : teamIntentions.length === 0 ? (
          <div className={"text-[12px] italic " + mutedText}>
            No team intentions
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {teamIntentions.map((item) => {
              const isMine = item.user_id === user?.id;
              const nameCls = isLight ? "text-black/85" : "text-white/85";
              const bodyActive = isLight ? "text-black/75" : "text-white/75";
              const bodyDone = isLight
                ? "text-black/45 line-through"
                : "text-white/50 line-through";
              const circleCls = isLight ? "text-black/30" : "text-white/30";

              return (
                <div key={item.id} className={teamCardCls}>
                  <div className="flex items-center gap-3">
                    <img
                      src={getAvatar(item.profiles)}
                      className="w-9 h-9 rounded-full object-cover"
                      alt=""
                    />

                    <div className="flex-1 min-w-0">
                      <div
                        className={"text-[13px] font-medium truncate " + nameCls}
                      >
                        {isMine ? "You" : item.profiles?.full_name || "Participant"}
                      </div>

                      <div
                        className={
                          "text-[13px] break-words leading-5 " +
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
}

export default IntentionsPanel;
