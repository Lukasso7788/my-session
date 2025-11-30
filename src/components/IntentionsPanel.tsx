import { useEffect, useState } from "react";
import { Plus, CheckCircle, Circle, Trash2, Target, MessageCircle } from "lucide-react";
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

export function IntentionsPanel() {
  const { id: sessionId } = useParams<{ id: string }>();
  const [user, setUser] = useState<any>(null);
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [newIntention, setNewIntention] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"intentions" | "chat">("intentions");

  // USER
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  // LOAD
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

    if (!error) setIntentions(data || []);
    setLoading(false);
  };

  // REALTIME
  useEffect(() => {
    if (!sessionId) return;
    loadIntentions();

    const channel = supabase.channel("intentions_realtime");

    channel.on("postgres_changes",
      { event: "INSERT", schema: "public", table: "intentions" },
      (payload) => payload.new?.session_id === sessionId && loadIntentions()
    );

    channel.on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "intentions" },
      (payload) => payload.new?.session_id === sessionId && loadIntentions()
    );

    channel.on("postgres_changes",
      { event: "DELETE", schema: "public", table: "intentions" },
      (payload: any) => {
        const deletedId = payload?.old?.id;
        setIntentions((prev) => prev.filter((i) => i.id !== deletedId));
      }
    );

    channel.subscribe();
    return () => supabase.removeChannel(channel);
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
    await supabase
      .from("intentions")
      .update({ completed: !intention.completed })
      .eq("id", intention.id);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("intentions").delete().eq("id", id);
  };

  const getAvatar = (profile?: any) =>
    profile?.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(
      profile?.full_name || "User"
    )}`;

  return (
    <div className="flex flex-col w-full h-full bg-[#1F2937] text-[#F3F4F6] font-inter">

      {/* TABS */}
      <div className="px-4 pt-4">
        <div className="flex gap-4 pb-0">
          <button
            onClick={() => setActiveTab("intentions")}
            className={`
              flex items-center gap-2 px-3 py-2
              text-[20px] font-medium rounded-none
              transition 
              ${activeTab === "intentions"
                ? "text-[#4C9FFF] bg-[#4C9FFF]/5 border-b-2 border-[#4C9FFF]"
                : "text-[#9CA3AF] hover:text-[#4C9FFF]"
              }
            `}
          >
            <Target size={24} />
            Intentions
          </button>

          <button
            onClick={() => setActiveTab("chat")}
            className={`
              flex items-center gap-2 px-3 py-2
              text-[20px] font-medium rounded-none
              transition
              ${activeTab === "chat"
                ? "text-[#4C9FFF] bg-[#4C9FFF]/5 border-b-2 border-[#4C9FFF]"
                : "text-[#9CA3AF] hover:text-[#4C9FFF]"
              }
            `}
          >
            <MessageCircle size={24} />
            Chat
          </button>
        </div>
      </div>

      <div className="h-px bg-[#404651] mt-3"></div>

      {/* CONTENT */}
      <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">

        {/* CHAT */}
        {activeTab === "chat" && (
          <div className="text-[#9CA3AF] italic">(Chat coming soon)</div>
        )}

        {/* INTENTIONS */}
        {activeTab === "intentions" && (
          <>

            {/* My Intentions */}
            <div className="mb-5">

              <h3 className="text-[14px] font-medium text-[#F3F4F6] mb-3">
                My intentions
              </h3>

              <div className="mb-[16px]">

                <div className="flex items-center gap-2 mb-[12px]">

                  {/* INPUT — updated */}
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

                  {/* BUTTON "+" — updated */}
                  <button
                    onClick={handleAddIntention}
                    className="
                      flex items-center justify-center
                      bg-[#4C9FFF] hover:bg-[#3B89E8]
                      text-white
                      rounded-[8px]
                      px-[8px] py-[10px]
                      leading-none
                      text-[32px] font-light
                      transition
                    "
                  >
                    +
                  </button>
                </div>

                <div className="flex flex-col gap-2">
                  {loading ? (
                    <p className="text-sm text-[#9CA3AF] italic">Loading...</p>
                  ) : intentions
                    .filter((i) => i.user_id === user?.id)
                    .map((intention) => (
                      <div
                        key={intention.id}
                        className={`
                            flex items-center justify-between p-2 rounded 
                            group cursor-pointer transition
                            ${intention.completed
                            ? "bg-[rgba(0,255,55,0.05)]"
                            : "hover:bg-[rgba(55,65,81,0.20)]"
                          }
                          `}
                        onClick={() => toggleCompleted(intention)}
                      >
                        <div className="flex items-start gap-2">
                          {intention.completed ? (
                            <CheckCircle size={18} className="text-[#00FF37] mt-0.5" />
                          ) : (
                            <Circle size={18} className="text-[#9CA3AF] mt-0.5" />
                          )}
                          <span
                            className={`
                                text-sm
                                ${intention.completed
                                ? "text-[#F3F4F6]/75 line-through"
                                : "text-[#F3F4F6]/75"
                              }
                              `}
                          >
                            {intention.text}
                          </span>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(intention.id);
                          }}
                          className="
                              opacity-0 group-hover:opacity-100 
                              transition-opacity p-1 
                              text-[#9CA3AF] hover:text-red-500
                            "
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="h-px bg-[#404651] my-[20px]"></div>

            {/* Team intentions */}
            <h3 className="text-[14px] font-medium text-[#F3F4F6] mb-[12px]">
              Team intentions
            </h3>

            {loading ? (
              <p className="text-sm text-[#9CA3AF] italic">Loading...</p>
            ) : intentions.length === 0 ? (
              <p className="text-sm text-[#9CA3AF] italic">No team intentions</p>
            ) : (
              <div className="flex flex-col gap-[12px]">
                {intentions.map((item) => (
                  <div
                    key={item.id}
                    className={`
                      flex items-start gap-3 p-2 rounded-lg transition
                      ${item.completed
                        ? "bg-[rgba(0,255,55,0.05)]"
                        : "hover:bg-[rgba(55,65,81,0.20)]"
                      }
                    `}
                  >
                    {/* Avatar — updated to 40x40 */}
                    <img
                      src={getAvatar(item.profiles)}
                      className="w-10 h-10 rounded-full object-cover"
                    />

                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#F3F4F6]">
                        {item.user_id === user?.id
                          ? "You"
                          : item.profiles?.full_name || "Participant"}
                      </p>

                      <p
                        className={`
                          text-sm 
                          ${item.completed
                            ? "text-[#F3F4F6]/75 line-through"
                            : "text-[#F3F4F6]/80"
                          }
                        `}
                      >
                        {item.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
