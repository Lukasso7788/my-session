// src/components/IntentionsPanel.tsx

import { useEffect, useMemo, useState } from "react";
import { CheckCircle, Circle, Trash2, Pencil, X, Check } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useParams } from "react-router-dom";

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
  sessionId?: string; // можно передать явно, иначе возьмём из URL
};

export function IntentionsPanel({ sessionId: sessionIdProp }: IntentionsPanelProps) {
  const { id: sessionIdFromUrl } = useParams<{ id: string }>();
  const sessionId = sessionIdProp || sessionIdFromUrl;

  const [user, setUser] = useState<any>(null);
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [newIntention, setNewIntention] = useState("");
  const [loading, setLoading] = useState(true);

  // EDIT STATE
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");

  // USER
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  // LOAD INTENTIONS
  const loadIntentions = async () => {
    if (!sessionId) return;

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

  // REALTIME
  useEffect(() => {
    if (!sessionId) return;

    loadIntentions();

    // важно: уникальный канал на сессию, чтобы не ловить события со всех комнат
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
    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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
    // если сейчас редактируем этот пункт — клик по строке не должен менять completed
    if (editingId === intention.id) return;

    await supabase
      .from("intentions")
      .update({ completed: !intention.completed })
      .eq("id", intention.id);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("intentions").delete().eq("id", id);
  };

  // EDIT HANDLERS
  const startEdit = (intention: Intention) => {
    setEditingId(intention.id);
    setEditingText(intention.text || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const saveEdit = async () => {
    if (!editingId) return;

    const text = editingText.trim();
    if (!text) return; // пустое не сохраняем

    await supabase.from("intentions").update({ text }).eq("id", editingId);

    setEditingId(null);
    setEditingText("");
  };

  const getAvatar = (profile?: any) =>
    profile?.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || "User")}`;

  const myIntentions = useMemo(
    () => intentions.filter((i) => i.user_id === user?.id),
    [intentions, user?.id]
  );

  // оставляем как у тебя: team список включает всех (включая "You"), с аватарами
  const teamIntentions = useMemo(() => intentions, [intentions]);

  return (
    <div className="flex flex-col w-full h-full bg-[#1F2937] text-[#F3F4F6] font-inter min-h-0">
      {/* HEADER (без tabs) */}
      <div className="px-4 pt-4">
        <div className="text-[16px] font-semibold text-white/90">Intentions</div>
      </div>

      <div className="h-px bg-[#404651] mt-3"></div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 custom-scrollbar">
        {/* MY INTENTIONS */}
        <div className="mb-5">
          <h3 className="text-[14px] font-medium text-[#F3F4F6] mb-3">My intentions</h3>

          <div className="mb-[16px]">
            <div className="flex items-center gap-2 mb-[12px]">
              <input
                type="text"
                value={newIntention}
                onChange={(e) => setNewIntention(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddIntention()}
                placeholder="Add an intention"
                className="
                  flex-1
                  bg-[#374151] border border-[#404651]
                  rounded-[8px]
                  px-[12px] py-[14px]
                  text-[14px] text-[#F3F4F6]
                  placeholder-[#9CA3AF]
                  focus:outline-none focus:ring-1 focus:ring-[#4C9FFF]
                "
              />

              <button
                onClick={handleAddIntention}
                className="
                  flex items-center justify-center
                  bg-[#4C9FFF] hover:bg-[#3B89E8]
                  text-white
                  rounded-[8px]
                  px-[8px] py-[10px]
                  transition
                  leading-none
                  text-[32px] font-light
                "
                title="Add"
              >
                +
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              {loading ? (
                <p className="text-sm text-[#9CA3AF] italic">Loading...</p>
              ) : myIntentions.length === 0 ? (
                <p className="text-sm text-[#9CA3AF] italic">No intentions</p>
              ) : (
                myIntentions.map((intention) => {
                  const isMine = intention.user_id === user?.id;
                  const isEditing = editingId === intention.id;

                  return (
                    <div
                      key={intention.id}
                      className={`flex items-center justify-between p-2 rounded group cursor-pointer transition
                        ${intention.completed
                          ? "bg-[rgba(0,255,55,0.05)]"
                          : "hover:bg-[rgba(55,65,81,0.20)]"
                        }
                      `}
                      onClick={() => toggleCompleted(intention)}
                    >
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        {intention.completed ? (
                          <CheckCircle size={18} className="text-[#00FF37] mt-0.5 shrink-0" />
                        ) : (
                          <Circle size={18} className="text-[#9CA3AF] mt-0.5 shrink-0" />
                        )}

                        {/* TEXT / EDIT INPUT */}
                        {!isEditing ? (
                          <span
                            className={`text-sm break-words ${intention.completed
                                ? "text-[#F3F4F6]/75 line-through"
                                : "text-[#F3F4F6]/75"
                              }`}
                          >
                            {intention.text}
                          </span>
                        ) : (
                          <input
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                            className="
                              flex-1
                              bg-[#111827]/40 border border-white/10
                              rounded-lg px-3 py-2
                              text-[14px] text-white/90
                              outline-none focus:ring-1 focus:ring-[#4C9FFF]
                            "
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </div>

                      {/* ACTIONS: edit/save/cancel/delete */}
                      {isMine && (
                        <div className="flex items-center gap-1 pl-2">
                          {!isEditing ? (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEdit(intention);
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[#9CA3AF] hover:text-white"
                                title="Edit"
                              >
                                <Pencil size={16} />
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(intention.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[#9CA3AF] hover:text-red-500"
                                title="Delete"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  saveEdit();
                                }}
                                className="p-1 text-[#9CA3AF] hover:text-[#00FF37]"
                                title="Save"
                              >
                                <Check size={18} />
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cancelEdit();
                                }}
                                className="p-1 text-[#9CA3AF] hover:text-white"
                                title="Cancel"
                              >
                                <X size={18} />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="h-px bg-[#404651] my-[20px]"></div>

        {/* TEAM INTENTIONS (с аватарами — НЕ УДАЛЯЮ) */}
        <h3 className="text-[14px] font-medium text-[#F3F4F6] mb-[12px]">Team intentions</h3>

        {loading ? (
          <p className="text-sm text-[#9CA3AF] italic">Loading...</p>
        ) : teamIntentions.length === 0 ? (
          <p className="text-sm text-[#9CA3AF] italic">No team intentions</p>
        ) : (
          <div className="flex flex-col gap-[6px]">
            {teamIntentions.map((item) => {
              const isMine = item.user_id === user?.id;

              return (
                <div
                  key={item.id}
                  className={`
                    flex items-start gap-3 p-2 rounded-lg transition group
                    ${item.completed
                      ? "bg-[rgba(0,255,55,0.05)]"
                      : "hover:bg-[rgba(55,65,81,0.20)]"
                    }
                  `}
                >
                  <img
                    src={getAvatar(item.profiles)}
                    className="w-10 h-10 rounded-full object-cover"
                    alt=""
                  />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#F3F4F6] truncate">
                      {isMine ? "You" : item.profiles?.full_name || "Participant"}
                    </p>

                    <p
                      className={`text-sm break-words ${item.completed ? "text-[#F3F4F6]/75 line-through" : "text-[#F3F4F6]/80"
                        }`}
                    >
                      {item.text}
                    </p>
                  </div>

                  {/* (опционально) можно добавить edit/delete и в team list для своих.
                      Сейчас оставил только в My intentions, чтобы не было дубля UI. */}
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
