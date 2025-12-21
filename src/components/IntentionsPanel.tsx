import { useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

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

    const channel = supabase.channel(`intentions:${sessionId}`);

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "intentions", filter: `session_id=eq.${sessionId}` },
      () => loadIntentions()
    );

    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "intentions", filter: `session_id=eq.${sessionId}` },
      () => loadIntentions()
    );

    channel.on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "intentions", filter: `session_id=eq.${sessionId}` },
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

    const { error } = await supabase.from("intentions").insert([
      {
        user_id: user.id,
        session_id: sessionId,
        text: newIntention.trim(),
        completed: false,
      },
    ]);

    if (!error) setNewIntention("");
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
    `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || "User")}`;

  const myIntentions = useMemo(
    () => intentions.filter((i) => i.user_id === user?.id),
    [intentions, user?.id]
  );

  const teamIntentions = useMemo(
    () => intentions.filter((i) => i.user_id !== user?.id),
    [intentions, user?.id]
  );

  return (
    <div className="h-full flex flex-col">
      {/* content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* My intentions */}
        <div className="mb-5">
          <div className="text-[13px] text-white/75 font-medium mb-3">My intentions</div>

          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={newIntention}
              onChange={(e) => setNewIntention(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddIntention()}
              placeholder="Add an intention"
              className="flex-1 h-11 rounded-xl bg-[#0B1220]/70 border border-white/10 px-3 text-[13px] outline-none text-white/85 placeholder:text-white/35 focus:border-emerald-400/40"
            />

            <button
              onClick={handleAddIntention}
              className="h-11 w-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-[#02140B] text-[26px] leading-none font-light flex items-center justify-center"
              title="Add"
            >
              +
            </button>
          </div>

          {loading ? (
            <div className="text-white/40 text-sm italic">Loading…</div>
          ) : myIntentions.length === 0 ? (
            <div className="text-white/40 text-sm italic">No intentions yet</div>
          ) : (
            <div className="flex flex-col gap-2">
              {myIntentions.map((i) => (
                <div
                  key={i.id}
                  onClick={() => toggleCompleted(i)}
                  className={
                    "rounded-xl px-3 py-2 border cursor-pointer transition flex items-start justify-between gap-3 " +
                    (i.completed
                      ? "bg-emerald-500/10 border-emerald-400/15"
                      : "bg-white/5 border-white/10 hover:bg-white/7")
                  }
                >
                  <div className="min-w-0">
                    <div
                      className={
                        "text-[13px] leading-snug break-words " +
                        (i.completed ? "text-white/60 line-through" : "text-white/85")
                      }
                    >
                      {i.text}
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(i.id);
                    }}
                    className="shrink-0 w-9 h-9 rounded-xl bg-white/5 hover:bg-red-500/15 text-white/55 hover:text-red-200 transition flex items-center justify-center"
                    title="Delete"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="h-px bg-white/5 my-5" />

        {/* Team intentions */}
        <div className="text-[13px] text-white/75 font-medium mb-3">Team intentions</div>

        {loading ? (
          <div className="text-white/40 text-sm italic">Loading…</div>
        ) : teamIntentions.length === 0 ? (
          <div className="text-white/40 text-sm italic">No team intentions</div>
        ) : (
          <div className="flex flex-col gap-2">
            {teamIntentions.map((item) => (
              <div
                key={item.id}
                className={
                  "rounded-xl px-3 py-2 border transition flex items-start gap-3 " +
                  (item.completed
                    ? "bg-emerald-500/10 border-emerald-400/15"
                    : "bg-white/5 border-white/10 hover:bg-white/7")
                }
              >
                <img
                  src={getAvatar(item.profiles)}
                  className="w-10 h-10 rounded-full object-cover"
                  alt=""
                />

                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-white/90 font-medium">
                    {item.profiles?.full_name || "Participant"}
                  </div>
                  <div
                    className={
                      "text-[13px] leading-snug break-words " +
                      (item.completed ? "text-white/60 line-through" : "text-white/80")
                    }
                  >
                    {item.text}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
