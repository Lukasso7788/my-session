// src/components/IntentionsPanel.tsx

import { useEffect, useMemo, useState } from "react";
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
  sessionId?: string;
  theme?: RoomTheme;
};

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
      className={"w-9 h-9 rounded-xl flex items-center justify-center transition " + base + " " + className}
      type="button"
    >
      {children}
    </button>
  );
}

export function IntentionsPanel({ sessionId: sessionIdProp, theme = "dark" }: IntentionsPanelProps) {
  const { id: sessionIdFromUrl } = useParams<{ id: string }>();
  const sessionId = sessionIdProp || sessionIdFromUrl;

  const isLight = theme === "light";

  const [user, setUser] = useState<any>(null);
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [newIntention, setNewIntention] = useState("");
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");

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

  // ✅ NEW: completed styles (green tint + green-ish line-through)
  const completedCardCls = isLight
    ? "border-emerald-600/20 bg-emerald-500/10 hover:bg-emerald-500/14"
    : "border-emerald-400/15 bg-emerald-500/10 hover:bg-emerald-500/14";

  const completedTextCls = isLight
    ? "text-emerald-800/55 line-through"
    : "text-emerald-200/55 line-through";

  const activeTextCls = isLight ? "text-black/80" : "text-white/80";

  const baseMyCardCls = isLight
    ? "group rounded-xl border px-3 py-2.5 transition cursor-pointer"
    : "group rounded-xl border px-3 py-2.5 transition cursor-pointer";

  const baseTeamCardCls = isLight
    ? "rounded-xl border px-3 py-2.5 transition"
    : "rounded-xl border px-3 py-2.5 transition";

  const myCardDefault = isLight
    ? "border-black/10 bg-white/70 hover:bg-white"
    : "border-white/5 bg-[#0B1220]/55 hover:bg-[#0B1220]/75";

  const teamCardDefault = isLight
    ? "border-black/10 bg-white/70 hover:bg-white"
    : "border-white/5 bg-[#0B1220]/55 hover:bg-[#0B1220]/75";

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  const getAvatar = (profile?: any) =>
    profile?.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || "User")}`;

  const loadIntentions = async () => {
    if (!sessionId) return;

    setLoading(true);
    const { data, error } = await supabase
      .from("intentions")
      .select(
        `id, text, user_id, session_id, created_at, completed,
         profiles ( full_name, avatar_url )`
      )
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });

    if (!error) setIntentions((data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!sessionId) return;

    loadIntentions();

    const channel = supabase.channel(`intentions_realtime_${sessionId}`);

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "intentions" },
      (payload) => payload.new?.session_id === sessionId && loadIntentions()
    );

    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "intentions" },
      (payload) => payload.new?.session_id === sessionId && loadIntentions()
    );

    channel.on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "intentions" },
      (payload: any) => {
        const deletedId = payload?.old?.id;
        setIntentions((prev) => prev.filter((i) => i.id !== deletedId));
      }
    );

    channel.subscribe();
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

    await supabase.from("intentions").insert([
      {
        user_id: user.id,
        session_id: sessionId,
        text: newIntention.trim(),
        completed: false,
      },
    ]);

    setNewIntention("");
  };

  const toggleCompleted = async (intention: Intention) => {
    if (editingId === intention.id) return;

    await supabase
      .from("intentions")
      .update({ completed: !intention.completed })
      .eq("id", intention.id);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("intentions").delete().eq("id", id);
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
    const text = editingText.trim();
    if (!text) return;

    await supabase.from("intentions").update({ text }).eq("id", editingId);

    setEditingId(null);
    setEditingText("");
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="p-4 min-h-0 flex-1 overflow-y-auto custom-scrollbar">
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
            <div className={"text-[12px] italic " + mutedText}>No intentions yet</div>
          ) : (
            <div className="flex flex-col gap-2">
              {myIntentions.map((i) => {
                const isEditing = editingId === i.id;
                const isDone = !!i.completed;

                const circleCls = isLight ? "text-black/40" : "text-white/45";

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

                const cardCls =
                  baseMyCardCls +
                  " " +
                  (isDone ? completedCardCls : myCardDefault);

                return (
                  <div key={i.id} onClick={() => toggleCompleted(i)} className={cardCls}>
                    <div className="flex items-center gap-2">
                      <div className="shrink-0">
                        {isDone ? (
                          <CheckCircle size={18} className="text-emerald-500" />
                        ) : (
                          <Circle size={18} className={circleCls} />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {!isEditing ? (
                          <div
                            className={
                              "text-[13px] break-words leading-5 " +
                              (isDone ? completedTextCls : activeTextCls)
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
          <div className={"text-[12px] italic " + mutedText}>Loading...</div>
        ) : teamIntentions.length === 0 ? (
          <div className={"text-[12px] italic " + mutedText}>No team intentions</div>
        ) : (
          <div className="flex flex-col gap-2">
            {teamIntentions.map((item) => {
              const isMine = item.user_id === user?.id;
              const isDone = !!item.completed;

              const nameCls = isLight ? "text-black/85" : "text-white/85";
              const bodyActive = isLight ? "text-black/75" : "text-white/75";
              const circleCls = isLight ? "text-black/30" : "text-white/30";

              const cardCls =
                baseTeamCardCls +
                " " +
                (isDone ? completedCardCls : teamCardDefault);

              return (
                <div key={item.id} className={cardCls}>
                  <div className="flex items-center gap-3">
                    <img
                      src={getAvatar(item.profiles)}
                      className="w-9 h-9 rounded-full object-cover"
                      alt=""
                    />

                    <div className="flex-1 min-w-0">
                      <div className={"text-[13px] font-medium truncate " + nameCls}>
                        {isMine ? "You" : item.profiles?.full_name || "Participant"}
                      </div>

                      <div
                        className={
                          "text-[13px] break-words leading-5 " +
                          (isDone ? completedTextCls : bodyActive)
                        }
                      >
                        {item.text}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {isDone ? (
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
