import { useEffect, useState } from "react";
import { Plus, CheckCircle, Circle, Trash2, ClipboardList, MessageSquare } from "lucide-react";
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

    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }

    setIntentions(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!sessionId) return;

    loadIntentions();

    const channel = supabase.channel("intentions_realtime");

    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "intentions" }, () =>
      loadIntentions()
    );
    channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "intentions" }, () =>
      loadIntentions()
    );
    channel.on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "intentions" },
      (payload: any) => {
        setIntentions((prev) => prev.filter((i) => i.id !== payload.old.id));
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

  const toggleCompleted = async (i: Intention) => {
    await supabase.from("intentions").update({ completed: !i.completed }).eq("id", i.id);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("intentions").delete().eq("id", id);
  };

  return (
    <div className="flex flex-col w-full h-full bg-[#1F2937] text-[#F3F4F6] font-inter">

      {/* TABS CONTAINER */}
      <div className="px-4 pt-4 flex items-center gap-8">

        {/* Intentions Tab */}
        <button
          onClick={() => setActiveTab("intentions")}
          className={`flex items-center gap-2 pb-2 text-[20px] font-medium transition ${activeTab === "intentions"
              ? "text-[#4C9FFF] border-b-2 border-[#4C9FFF]"
              : "text-[#9CA3AF] hover:text-[#4C9FFF]"
            }`}
        >
          <ClipboardList size={24} />
          Intentions
        </button>

        {/* Chat Tab */}
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex items-center gap-2 pb-2 text-[20px] font-medium transition ${activeTab === "chat"
              ? "text-[#4C9FFF] border-b-2 border-[#4C9FFF]"
              : "text-[#9CA3AF] hover:text-[#4C9FFF]"
            }`}
        >
          <MessageSquare size={24} />
          Chat
        </button>
      </div>

      {/* DIVIDER */}
      <div className="w-full h-px bg-[#404651] my-4" />

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 flex flex-col gap-5">

        {/* CHAT TAB */}
        {activeTab === "chat" && (
          <p className="text-[#9CA3AF] italic">Chat coming soon…</p>
        )}

        {/* INTENTIONS TAB */}
        {activeTab === "intentions" && (
          <>

            {/* MY INTENTIONS CONTAINER */}
            <div className="flex flex-col gap-5">

              <div className="flex flex-col gap-3">
                <h3 className="text-[14px] font-medium text-[#F3F4F6]">
                  My intentions
                </h3>

                {/* Input + Button Block */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newIntention}
                    onChange={(e) => setNewIntention(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddIntention()}
                    placeholder="Add an intention"
                    className="flex-1 px-3 py-2 rounded-lg text-[14px] bg-[#374151] border border-[#4B5563]
                     text-[#F3F4F6] placeholder-[#9CA3AF] outline-none"
                  />

                  <button
                    onClick={handleAddIntention}
                    className="p-2 bg-[#4C9FFF] hover:bg-[#3B89E8] text-white rounded-lg transition"
                  >
                    <Plus size={20} />
                  </button>
                </div>

                {/* My Intentions List */}
                <div className="flex flex-col gap-4 mt-3">
                  {intentions
                    .filter((i) => i.user_id === user?.id)
                    .map((i) => (
                      <div
                        key={i.id}
                        className={`flex items-center justify-between p-2 rounded-lg group cursor-pointer transition ${i.completed
                            ? "bg-[rgba(0,255,55,0.05)]"
                            : "hover:bg-[rgba(55,65,81,0.20)]"
                          }`}
                        onClick={() => toggleCompleted(i)}
                      >
                        <div className="flex items-start gap-2">
                          {i.completed ? (
                            <CheckCircle size={20} className="text-[#00FF37] mt-1" />
                          ) : (
                            <Circle size={20} className="text-[#9CA3AF] mt-1" />
                          )}

                          <span
                            className={`text-[14px] ${i.completed
                                ? "text-[#F3F4F6]/75 line-through"
                                : "text-[#F3F4F6]"
                              }`}
                          >
                            {i.text}
                          </span>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(i.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[#9CA3AF] hover:text-red-500"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                </div>
              </div>

              {/* TEAM INTENTIONS */}
              <div className="flex flex-col gap-3 mt-4">
                <h3 className="text-[14px] font-medium text-[#F3F4F6]">
                  Team intentions
                </h3>

                <div className="flex flex-col gap-3">
                  {intentions.map((i) => (
                    <div
                      key={i.id}
                      className={`flex items-start gap-3 p-2 rounded-lg transition ${i.completed
                          ? "bg-[rgba(0,255,55,0.05)]"
                          : "hover:bg-[rgba(55,65,81,0.20)]"
                        }`}
                    >
                      <img
                        src={
                          i.profiles?.avatar_url ||
                          `https://ui-avatars.com/api/?name=${encodeURIComponent(
                            i.profiles?.full_name || "User"
                          )}`
                        }
                        className="w-8 h-8 rounded-full object-cover"
                      />

                      <div className="flex-1">
                        <p className="text-[14px] font-medium text-[#F3F4F6]">
                          {i.user_id === user?.id
                            ? "You"
                            : i.profiles?.full_name || "Participant"}
                        </p>
                        <p
                          className={`text-[14px] ${i.completed
                              ? "text-[#F3F4F6]/75 line-through"
                              : "text-[#F3F4F6]"
                            }`}
                        >
                          {i.text}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </>
        )}
      </div>
    </div>
  );
}
