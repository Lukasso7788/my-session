import { useEffect, useState } from "react";
import { Plus, CheckCircle, Circle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useParams } from "react-router-dom";

interface Intention {
  id: string;
  text: string;
  user_id: string;
  session_id: string;
  created_at?: string;
  completed?: boolean;
}

export function IntentionsPanel() {
  const { id: sessionId } = useParams<{ id: string }>();
  const [user, setUser] = useState<any>(null);
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [newIntention, setNewIntention] = useState("");
  const [loading, setLoading] = useState(true);

  // ✅ Получаем текущего пользователя
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  // ✅ Загрузка intentions
  const loadIntentions = async () => {
    if (!sessionId) return;
    const { data, error } = await supabase
      .from("intentions")
      .select("id, text, user_id, session_id, created_at, completed")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });

    if (error) console.error("Error loading intentions:", error);
    else setIntentions(data || []);
    setLoading(false);
  };

  // ✅ Realtime подписка
  useEffect(() => {
    loadIntentions();

    const channel = supabase
      .channel("intentions_realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "intentions",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setIntentions((prev) => {
              if (prev.some((i) => i.id === payload.new.id)) return prev;
              return [payload.new as Intention, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            setIntentions((prev) =>
              prev.map((i) =>
                i.id === payload.new.id
                  ? { ...(payload.new as Intention) }
                  : i
              )
            );
          } else if (payload.eventType === "DELETE") {
            setIntentions((prev) =>
              prev.filter((i) => i.id !== payload.old.id)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  // ✅ Добавить intention
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

    if (error) console.error("Error adding intention:", error);
    setNewIntention("");
  };

  // ✅ Переключить статус
  const toggleCompleted = async (intention: Intention) => {
    const { error } = await supabase
      .from("intentions")
      .update({ completed: !intention.completed })
      .eq("id", intention.id);

    if (error) console.error("Error toggling completed:", error);
  };

  // 📸 Получить аватар или fallback
  const getAvatar = () => {
    return (
      user?.user_metadata?.avatar_url ||
      `https://ui-avatars.com/api/?name=${user?.email || "User"}`
    );
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold text-gray-900">Intentions</h2>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {/* 🧠 Мои intentions */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-2">
            My Intentions
          </h3>

          {!user ? (
            <p className="text-sm text-gray-500 italic">
              Please log in to add intentions
            </p>
          ) : (
            <>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={newIntention}
                  onChange={(e) => setNewIntention(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddIntention()}
                  placeholder="Add an intention..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleAddIntention}
                  className="p-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  <Plus size={18} />
                </button>
              </div>

              {loading ? (
                <p className="text-sm text-gray-500 italic">Loading...</p>
              ) : intentions.filter((i) => i.user_id === user.id).length ===
                0 ? (
                <p className="text-sm text-gray-500 italic">
                  No intentions yet
                </p>
              ) : (
                intentions
                  .filter((i) => i.user_id === user.id)
                  .map((intention) => (
                    <div
                      key={intention.id}
                      onClick={() => toggleCompleted(intention)}
                      className="flex items-start gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer"
                    >
                      {intention.completed ? (
                        <CheckCircle
                          size={18}
                          className="text-green-500 mt-0.5 flex-shrink-0"
                        />
                      ) : (
                        <Circle
                          size={18}
                          className="text-gray-400 mt-0.5 flex-shrink-0"
                        />
                      )}
                      <span
                        className={`text-sm ${
                          intention.completed
                            ? "text-gray-400 line-through"
                            : "text-gray-900"
                        }`}
                      >
                        {intention.text}
                      </span>
                    </div>
                  ))
              )}
            </>
          )}
        </div>

        {/* 👥 Командные intentions */}
        <div className="border-t pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            Team Intentions
          </h3>
          {loading ? (
            <p className="text-sm text-gray-500 italic">Loading...</p>
          ) : (
            <div className="space-y-3">
              {intentions.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-start gap-3 p-3 rounded-lg ${
                    item.completed ? "bg-green-50" : "bg-gray-50"
                  }`}
                >
                  <img
                    src={getAvatar()}
                    alt="avatar"
                    className="w-8 h-8 rounded-full border border-gray-300 object-cover"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {item.user_id === user?.id ? "You" : item.user_id}
                    </p>
                    <p
                      className={`text-sm ${
                        item.completed
                          ? "text-gray-400 line-through"
                          : "text-gray-600"
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
      </div>
    </div>
  );
}