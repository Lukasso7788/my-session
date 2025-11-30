import { useEffect, useState } from "react";
import { Plus, CheckCircle, Circle, Trash2, Target, MessageSquare } from "lucide-react";
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

  // Load user
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  // Load intentions
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

    if (error) {
      console.error("❌ Error loading intentions:", error);
      setLoading(false);
      return;
    }

    setIntentions(data || []);
    setLoading(false);
  };

  // Realtime
  useEffect(() => {
    if (!sessionId) return;
    loadIntentions();

    const channel = supabase.channel("intentions_realtime");

    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "intentions" }, () => loadIntentions());
    channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "intentions" }, () => loadIntentions());
    channel.on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "intentions" },
      (payload: any) => {
        setIntentions((prev) => prev.filter((i) => i.id !== payload?.old?.id));
      }
    );

    channel.subscribe();

    return () => supabase.removeChannel(channel);
  }, [sessionId]);

  const handleAddIntention = async () => {
    if (!newIntention.trim() || !user) return;

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
    await supabase.from("intentions").update({ completed: !intention.completed }).eq("id", intention.id);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("intentions").delete().eq("id", id);
  };

  const getAvatar = (profile?: any) =>
    profile?.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || "User")}`;

  return (
    <div className="flex flex-col w-full h-full bg-[#1F2937] text-[#F3F4F6] font-inter">

      {/* === TABS HEADER === */}
      <div className="px-4 pt-4">
        <div className="flex gap-6 pb-0">

          {/* Intentions tab */}
          <button
            onClick={() => setActiveTab("intentions")}
            className={`flex items-center gap-2 px-12 py-8 text-[20px] font-medium transition 
            ${activeTab === "intentions"
                ? "text-[#4C9FFF] border-b-2 border-[#4C9FFF] bg-[#4C9FFF]/5"
                : "text-[#9CA3AF]"
              }`}
          >
            <Target size={24} className="" />
            Intentions
          </button>

          {/* Chat tab */}
          <button
            onClick={() => setActiveTab("chat")}
            className={`flex items-center gap-2 px-12 py-8 text-[20px] font-medium transition
            ${activeTab === "chat"
                ? "text-[#4C9FFF] border-b-2 border-[#4C9FFF] bg-[#4C9FFF]/5"
                : "text-[#9CA3AF]"
              }`}
          >
            <MessageSquare size={24} />
            Chat
          </button>
        </div>
      </div>

      {/* === Divider #1 === */}
      <div className="h-px w-full bg-[#404651] my-5" />

      {/* === BODY === */}
      <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">

        {/* CHAT TAB */}
        {activeTab === "chat" && (
          <div className="text-[#9CA3AF] italic">
            (Chat coming soon)
          </div>
        )}

        {/* INTENTIONS TAB */}
        {activeTab === "intentions" && (
          <>

            {/* === MY INTENTIONS SECTION === */}
            <div className="flex flex-col gap-5 mb-5">

              <h3 className="text-[14px] font-medium text-[#F3F4F6]">
                My intentions
              </h3>

              {!user ? (
                <p className="text-sm text-[#9CA3AF] italic">Please log in to add intentions</p>
              ) : (
                <div className="flex flex-col gap-4">

                  {/* Input + button container */}
                  <div className="flex gap-2 items-center">

                    <input
                      type="text"
                      value={newIntention}
                      onChange={(e) => setNewIntention(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddIntention()}
                      placeholder="Add an intention"
                      className="flex-1 px-4 py-[14px] rounded-[8px] bg-[#374151] border border-[#454F5E]
                      text-[14px] text-[#F3F4F6] placeholder-[#9CA3AF] focus:outline-none"
                    />

                    <button
                      onClick={handleAddIntention}
                      className="px-8 py-[10px] bg-[#4C9FFF] hover:bg-[#3B89E8] rounded-[8px] flex items-center justify-center"
                    >
                      <span className="text-white text-[32px] leading-none font-light">+</span>
                    </button>

                  </div>

                  {/* My intentions list */}
                  <div className="flex flex-col gap-4 mt-3">

                    {loading ? (
                      <p className="text-sm text-[#9CA3AF] italic">Loading…</p>
                    ) : (
                      intentions
                        .filter((i) => i.user_id === user?.id)
                        .map((intention) => (
                          <div
                            key={intention.id}
                            className={`flex items-center justify-between p-3 rounded-[8px] group cursor-pointer transition 
                            ${intention.completed
                                ? "bg-[rgba(0,255,55,0.05)]"
                                : "hover:bg-[rgba(55,65,81,0.20)]"}`}
                            onClick={() => toggleCompleted(intention)}
                          >
                            <div className="flex items-start gap-3">
                              {intention.completed ? (
                                <CheckCircle size={18} className="text-[#00FF37] mt-[2px]" />
                              ) : (
                                <Circle size={18} className="text-[#9CA3AF] mt-[2px]" />
                              )}

                              <span className={`text-sm ${intention.completed
                                ? "text-[#F3F4F6]/75 line-through"
                                : "text-[#F3F4F6]"
                                }`}
                              >
                                {intention.text}
                              </span>
                            </div>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(intention.id);
                              }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[#9CA3AF] hover:text-red-500"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))
                    )}

                  </div>
                </div>
              )}
            </div>

            {/* === Divider #2 === */}
            <div className="h-px w-full bg-[#404651] my-5" />

            {/* === TEAM INTENTIONS === */}
            <div className="flex flex-col gap-5 mt-5">

              <h3 className="text-[14px] font-medium text-[#F3F4F6]">
                Team intentions
              </h3>

              {loading ? (
                <p className="text-sm text-[#9CA3AF] italic">Loading…</p>
              ) : intentions.length === 0 ? (
                <p className="text-sm text-[#9CA3AF] italic">No team intentions</p>
              ) : (
                <div className="flex flex-col gap-3">

                  {intentions.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-start gap-3 p-3 rounded-lg transition 
                      ${item.completed
                          ? "bg-[rgba(0,255,55,0.05)]"
                          : "hover:bg-[rgba(55,65,81,0.20)]"}`
                      }
                    >
                      <img
                        src={getAvatar(item.profiles)}
                        className="w-8 h-8 rounded-full object-cover mt-1"
                      />

                      <div className="flex-1">
                        <p className="text-sm font-medium text-[#F3F4F6]">
                          {item.user_id === user?.id ? "You" : item.profiles?.full_name || "Participant"}
                        </p>
                        <p className={`text-sm ${item.completed
                          ? "text-[#F3F4F6]/75 line-through"
                          : "text-[#F3F4F6]/80"}`}
                        >
                          {item.text}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </>
        )}
      </div>
    </div>
  );
}
