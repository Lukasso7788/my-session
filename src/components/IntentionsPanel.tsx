import { useEffect, useState } from "react";
import { Plus, CheckCircle, Circle, Trash2 } from "lucide-react";
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
  const [activeTab, setActiveTab] = useState<"intentions" | "chat">(
    "intentions"
  );

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

  useEffect(() => {
    if (!sessionId) return;

    loadIntentions();

    const channel = supabase.channel("intentions_realtime");

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "intentions" },
      (payload) => {
        if (payload.new?.session_id === sessionId) loadIntentions();
      }
    );

    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "intentions" },
      (payload) => {
        if (payload.new?.session_id === sessionId) loadIntentions();
      }
    );

    channel.on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "intentions" },
      (payload: any) => {
        const id = payload?.old?.id;
        setIntentions((prev) => prev.filter((i) => i.id !== id));
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

      {/* ============================= */}
      {/*   TITLE + TABS CONTAINER      */}
      {/* ============================= */}

      <div className="px-4 pt-5 pb-3 flex flex-col gap-4">

        {/* === Title === */}
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-medium text-[#F3F4F6]">
            Intentions / Chat
          </h2>
        </div>

        {/* === Tabs Switcher === */}
        <div className="flex gap-6 pb-2">
          <button
            onClick={() => setActiveTab("intentions")}
            className={`text-[16px] font-medium pb-2 transition ${activeTab === "intentions"
                ? "text-[#4C9FFF] border-b-2 border-[#4C9FFF]"
                : "text-[#9CA3AF] hover:text-[#4C9FFF]"
              }`}
          >
            Intentions
          </button>

          <button
            onClick={() => setActiveTab("chat")}
            className={`text-[16px] font-medium pb-2 transition ${activeTab === "chat"
                ? "text-[#4C9FFF] border-b-2 border-[#4C9FFF]"
                : "text-[#9CA3AF] hover:text-[#4C9FFF]"
              }`}
          >
            Chat
          </button>
        </div>

        {/* Divider */}
        <div className="border-b border-[#404651]" />
      </div>

      {/* ============================= */}
      {/*          BODY CONTENT         */}
      {/* ============================= */}

      <div className="flex-1 overflow-y-auto px-4 pt-5 pb-10 custom-scrollbar">

        {/* CHAT TAB */}
        {activeTab === "chat" && (
          <div className="text-[#9CA3AF] italic">Chat coming soon...</div>
        )}

        {/* INTENTIONS TAB */}
        {activeTab === "intentions" && (
          <>

            {/* MY INTENTIONS — container */}
            <div className="flex flex-col gap-5 mb-5">

              <h3 className="text-[14px] font-medium text-[#F3F4F6]">
                My intentions
              </h3>

              {/* Input + button */}
              <div className="flex items-center gap-2">
                <input
                  value={newIntention}
                  onChange={(e) => setNewIntention(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddIntention()}
                  placeholder="Add an intention"
                  className="flex-1 bg-[#2A3440] text-[#F3F4F6] placeholder-[#9CA3AF] border border-[#3B4757]
                  rounded-xl px-3 py-2 text-[14px] font-light focus:outline-none"
                />

                <button
                  onClick={handleAddIntention}
                  className="p-2 rounded-xl bg-[#4C9FFF] hover:bg-[#3B89E8] transition"
                >
                  <Plus size={24} />
                </button>
              </div>

              {/* USER intentions */}
              <div className="flex flex-col gap-3 mt-1">
                {intentions
                  .filter((i) => i.user_id === user?.id)
                  .map((intent) => (
                    <div
                      key={intent.id}
                      className={`flex items-center justify-between p-3 rounded-xl cursor-pointer group transition
                      ${intent.completed
                          ? "bg-[rgba(0,255,55,0.05)]"
                          : "hover:bg-[rgba(255,255,255,0.06)]"
                        }`}
                      onClick={() => toggleCompleted(intent)}
                    >
                      <div className="flex items-start gap-3">
                        {intent.completed ? (
                          <CheckCircle
                            size={20}
                            className="text-[#00FF37] mt-0.5"
                          />
                        ) : (
                          <Circle
                            size={20}
                            className="text-[#9CA3AF] mt-0.5"
                          />
                        )}

                        <span
                          className={`text-[14px] ${intent.completed
                              ? "text-[#F3F4F6]/60 line-through"
                              : "text-[#F3F4F6]/80"
                            }`}
                        >
                          {intent.text}
                        </span>
                      </div>

                      <button
                        className="opacity-0 group-hover:opacity-100 transition text-[#9CA3AF] hover:text-red-500"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(intent.id);
                        }}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
              </div>
            </div>

            {/* TEAM INTENTIONS */}
            <div className="flex flex-col gap-5 mt-5">

              <h3 className="text-[14px] font-medium text-[#F3F4F6]">
                Team intentions
              </h3>

              <div className="flex flex-col gap-3">
                {intentions.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-start gap-3 p-3 rounded-xl transition
                    ${item.completed
                        ? "bg-[rgba(0,255,55,0.05)]"
                        : "hover:bg-[rgba(255,255,255,0.06)]"
                      }`}
                  >
                    <img
                      src={getAvatar(item.profiles)}
                      className="w-8 h-8 rounded-full object-cover"
                    />

                    <div className="flex-1 mt-0.5">
                      <p className="text-[14px] font-medium text-[#F3F4F6]">
                        {item.user_id === user?.id
                          ? "You"
                          : item.profiles?.full_name || "Participant"}
                      </p>

                      <p
                        className={`text-[14px] ${item.completed
                            ? "text-[#F3F4F6]/60 line-through"
                            : "text-[#F3F4F6]/80"
                          }`}
                      >
                        {item.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

            </div>

          </>
        )}
      </div>
    </div>
  );
}
