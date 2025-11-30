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

  // Load user
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

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

  // Realtime
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

    channel.on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "intentions" },
      (payload: any) => {
        const id = payload?.old?.id;
        if (id) setIntentions((prev) => prev.filter((i) => i.id !== id));
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

      {/* ================= */}
      {/* === TAB SWITCH === */}
      {/* ================= */}
      <div className="px-4 pt-4">
        <div className="flex gap-6 border-b border-[#404651] pb-2">

          {/* Intentions */}
          <button
            onClick={() => setActiveTab("intentions")}
            className={`flex items-center gap-2 pb-2 px-2 rounded-md transition 
              text-[20px] font-medium
              ${activeTab === "intentions"
                ? "text-[#4C9FFF] border-b-2 border-[#4C9FFF] bg-[#4C9FFF]/5"
                : "text-[#9CA3AF] hover:text-[#4C9FFF]"
              }`}
          >
            <Target className="w-6 h-6" />
            Intentions
          </button>

          {/* Chat */}
          <button
            onClick={() => setActiveTab("chat")}
            className={`flex items-center gap-2 pb-2 px-2 rounded-md transition
              text-[20px] font-medium
              ${activeTab === "chat"
                ? "text-[#4C9FFF] border-b-2 border-[#4C9FFF] bg-[#4C9FFF]/5"
                : "text-[#9CA3AF] hover:text-[#4C9FFF]"
              }`}
          >
            <MessageCircle className="w-6 h-6" />
            Chat
          </button>

        </div>
      </div>

      {/* divider */}
      <div className="h-px w-full bg-[#404651] mt-4"></div>

      {/* ============= BODY ============= */}
      <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">

        {/* CHAT TAB */}
        {activeTab === "chat" && (
          <div className="text-[#9CA3AF] italic">
            (Chat coming soon)
          </div>
        )}

        {/* ================================== */}
        {/* ========== INTENTIONS TAB ========= */}
        {/* ================================== */}
        {activeTab === "intentions" && (
          <>

            {/* ==== MY INTENTIONS BLOCK ==== */}
            <div className="flex flex-col gap-[20px]">

              <div className="flex flex-col gap-[12px]">

                <h3 className="text-[14px] font-medium text-[#F3F4F6]">
                  My intentions
                </h3>

                {/* Input row */}
                <div className="flex items-center gap-2">

                  <input
                    type="text"
                    value={newIntention}
                    onChange={(e) => setNewIntention(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddIntention()}
                    placeholder="Add an intention"
                    className="flex-1 px-3 py-[14px] rounded-[8px] bg-[#374151] border border-[#454F5E]
                      text-[14px] text-[#F3F4F6] placeholder-[#9CA3AF] focus:outline-none"
                  />

                  {/* "+" button */}
                  <button
                    onClick={handleAddIntention}
                    className="px-[8px] py-[10px] 
                      bg-[#4C9FFF] hover:bg-[#3B89E8] 
                      text-white rounded-md text-[32px] font-light leading-none"
                  >
                    +
                  </button>
                </div>

              </div>

              {/* ==== USER INTENTIONS LIST ==== */}
              <div className="flex flex-col gap-[16px]">

                {loading ? (
                  <p className="text-sm text-[#9CA3AF] italic">Loading…</p>
                ) : (
                  intentions
                    .filter((i) => i.user_id === user?.id)
                    .map((intention) => (
                      <div
                        key={intention.id}
                        className={`flex items-center justify-between p-2 rounded group cursor-pointer transition 
                          ${intention.completed
                            ? "bg-[rgba(0,255,55,0.05)]"
                            : "hover:bg-[rgba(55,65,81,0.20)]"
                          }`}
                        onClick={() => toggleCompleted(intention)}
                      >
                        <div className="flex items-start gap-2">
                          {intention.completed ? (
                            <CheckCircle className="text-[#00FF37] w-5 h-5 mt-0.5" />
                          ) : (
                            <Circle className="text-[#9CA3AF] w-5 h-5 mt-0.5" />
                          )}

                          <span
                            className={`text-sm 
                              ${intention.completed
                                ? "text-[#F3F4F6]/75 line-through"
                                : "text-[#F3F4F6]/75"
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
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                )}

              </div>

            </div> {/* END My intentions container */}

            {/* divider */}
            <div className="h-px w-full bg-[#404651] my-[20px]"></div>

            {/* TEAM INTENTIONS */}
            <div className="flex flex-col gap-[12px]">
              <h3 className="text-[14px] font-medium text-[#F3F4F6]">
                Team intentions
              </h3>

              {loading ? (
                <p className="text-sm text-[#9CA3AF] italic">Loading...</p>
              ) : intentions.length === 0 ? (
                <p className="text-sm text-[#9CA3AF] italic">No team intentions</p>
              ) : (
                <div className="space-y-2">
                  {intentions.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-start gap-3 p-2 rounded-lg transition 
                        ${item.completed
                          ? "bg-[rgba(0,255,55,0.05)]"
                          : "hover:bg-[rgba(55,65,81,0.20)]"
                        }`}
                    >
                      <img
                        src={getAvatar(item.profiles)}
                        className="w-8 h-8 rounded-full object-cover"
                      />

                      <div className="flex-1">
                        <p className="text-sm font-medium text-[#F3F4F6]">
                          {item.user_id === user?.id
                            ? "You"
                            : item.profiles?.full_name || "Participant"}
                        </p>
                        <p
                          className={`text-sm 
                            ${item.completed
                              ? "text-[#F3F4F6]/75 line-through"
                              : "text-[#F3F4F6]/80"
                            }`}
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
