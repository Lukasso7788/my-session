// src/pages/SessionsPage.tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { SessionTypeSwitcher } from "../components/SessionTypeSwitcher";
import SessionCard from "../components/SessionCard";
import Header from "../components/Header";
import { supabase } from "../lib/supabase";
import type { Session } from "../types/session";
import { useCreateSessionModal } from "../hooks/useCreateSessionModal";

type SessionWithRelations = Session & {
  host_id?: string;
  host_name?: string;
  duration_minutes: number;
  format?: string;
  start_time?: string;
  status?: string;
  session_bookings?: { user_id: string }[];
  session_attendance?: { id: string; session_id: string; user_id: string }[];
};

// -----------------------
// UI: Infinite rooms intro
// -----------------------
function InfinityIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8.2 15.4c-1.6 0-3-1.3-3-3s1.4-3 3-3c2.5 0 4.4 5.2 7.6 5.2 1.6 0 3-1.3 3-3s-1.4-3-3-3c-2.5 0-4.4 5.2-7.6 5.2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon({ className = "w-[27px] h-[27px]" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 7v5l3 2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function EyeIcon({ className = "w-[27px] h-[27px]" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function WorkflowIcon({ className = "w-[27px] h-[27px]" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 7h8M8 12h8M8 17h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function RocketIcon({ className = "w-[27px] h-[27px]" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 4c-3.8 1-6.7 4-7.9 7.8L5 16l4.2-1.1C13 13.7 16 10.8 17 7c.3-1.2.4-2.1.4-3-.9 0-1.8.1-3 .4Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M10 14l-1 5 2.2-2.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M13.2 10.8a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z"
        fill="currentColor"
      />
    </svg>
  );
}

type Feature = {
  title: string;
  subtitle: string;
  color: string;   // border + icon
  bg20: string;    // 20% fill
  Icon: (p: { className?: string }) => JSX.Element;
};

function InfiniteRoomsIntroCard() {
  const features: Feature[] = [
    {
      title: "Always Open",
      subtitle: "24/7 Access",
      color: "#5286F6",
      bg20: "#5286F633",
      Icon: ClockIcon,
    },
    {
      title: "Stay accountable",
      subtitle: "With others",
      color: "#65D46C",
      bg20: "#65D46C33",
      Icon: EyeIcon,
    },
    {
      title: "Structured Flow",
      subtitle: "Built-in Workflow",
      color: "#F65252",
      bg20: "#F6525233",
      Icon: WorkflowIcon,
    },
    {
      title: "Keep momentum",
      subtitle: "Day & Night",
      color: "#5286F6",
      bg20: "#5286F633",
      Icon: RocketIcon,
    },
  ];

  return (
    <div className="w-full">
      {/* Descriptive block (BR=12, px=32 py=24, gap=32) */}
      <div className="border border-[#DBD8D8] rounded-xl bg-white px-8 py-6 flex flex-col gap-8">
        {/* Title row: icon padding 16, icon 20, gap 10 */}
        <div className="flex items-center justify-center gap-[10px]">
          <div className="p-4 rounded-[20px] bg-[#111827] text-white inline-flex items-center justify-center">
            <InfinityIcon className="w-5 h-5" />
          </div>

          <h2 className="font-inter font-semibold text-[24px] text-brandBlack">
            24/7 Infinite Rooms
          </h2>
        </div>

        {/* Body text: Inter Light 16, line-height 160% */}
        <p className="font-inter font-light text-[16px] leading-[160%] text-brandBlack text-center max-w-[860px] mx-auto">
          24/7 Infinite Rooms are always open, giving you a structured space to focus whenever inspiration strikes.
          Join at any time, follow the built-in workflow (Pomodoro or Deep Work), stay accountable with others,
          and keep your momentum going — day or night.
        </p>

        {/* Feature icons row */}
        <div className="w-full flex justify-center">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((f) => (
              <div key={f.title} className="flex items-center gap-4">
                {/* Icon block: p=13.5, icon 27x27, BR=13.5, fill 20% */}
                <div
                  className="border rounded-[13.5px] inline-flex items-center justify-center"
                  style={{
                    borderColor: f.color,
                    backgroundColor: f.bg20,
                    padding: "13.5px",
                  }}
                >
                  <div style={{ color: f.color }}>
                    <f.Icon className="w-[27px] h-[27px]" />
                  </div>
                </div>

                {/* Text: title 14 semi-bold, subtitle 12 light, gap 12 */}
                <div className="flex flex-col" style={{ gap: "12px" }}>
                  <div className="font-inter font-semibold text-[14px] text-brandBlack">
                    {f.title}
                  </div>
                  <div className="font-inter font-light text-[12px] text-brandBlack/70">
                    {f.subtitle}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Distance to session type switcher: 48px */}
      <div className="h-12" />
    </div>
  );
}

export default function SessionsPage() {
  const navigate = useNavigate();
  const modal = useCreateSessionModal();

  const [sessions, setSessions] = useState<SessionWithRelations[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  const [sessionTypeTab, setSessionTypeTab] = useState<
    "group" | "infinite" | "body"
  >("group");

  // Restore auth
  useEffect(() => {
    const getCurrentSession = async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data?.session?.user ?? null);
    };
    getCurrentSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => setUser(session?.user ?? null)
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  // Load sessions
  const fetchSessions = useCallback(async () => {
    try {
      setIsLoading(true);

      const { data, error } = await supabase
        .from("sessions")
        .select(`
          id,
          title,
          host_id,
          host_name,
          duration_minutes,
          format,
          start_time,
          status,
          session_bookings ( user_id ),
          session_attendance ( id, session_id, user_id )
        `)
        .order("start_time", { ascending: true });

      if (error) throw error;

      setSessions((data || []) as SessionWithRelations[]);
      localStorage.setItem("sessions", JSON.stringify(data || []));
    } catch (error) {
      console.error("Error fetching sessions:", error);

      const saved = localStorage.getItem("sessions");
      if (saved) setSessions(JSON.parse(saved));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Realtime attendance
  useEffect(() => {
    const channel = supabase
      .channel("session-attendance")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_attendance" },
        (payload) => {
          setSessions((prev) => {
            const sessionId =
              // @ts-ignore
              payload.new?.session_id || payload.old?.session_id;
            if (!sessionId) return prev;

            return prev.map((s) => {
              if (s.id !== sessionId) return s;

              let attendance = s.session_attendance || [];

              if (payload.eventType === "INSERT") {
                // @ts-ignore
                attendance = [...attendance, payload.new];
              } else if (payload.eventType === "DELETE") {
                const delId = payload.old.id;
                attendance = attendance.filter((a) => a.id !== delId);
              } else if (payload.eventType === "UPDATE") {
                // @ts-ignore
                const newRow = payload.new;
                attendance = attendance.map((a) =>
                  a.id === newRow.id ? newRow : a
                );
              }

              return { ...s, session_attendance: attendance };
            });
          });
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  // Filter expired
  const isExpired = (s: SessionWithRelations) => {
    if (!s.start_time) return false;
    const end =
      new Date(s.start_time).getTime() + s.duration_minutes * 60 * 1000;
    return Date.now() > end;
  };

  // Heuristic tab matching (so infinite tab actually shows your pomodoro/deepwork rooms)
  const isInfiniteSession = (s: SessionWithRelations) => {
    const hay = `${s.title || ""} ${s.format || ""} ${s.status || ""}`.toLowerCase();
    if (hay.includes("infinite")) return true;
    if (hay.includes("pomodoro")) return true;
    if (hay.includes("deep work") || hay.includes("deepwork")) return true;
    if (hay.includes("sprint")) return true;
    if (/\d+\s*\/\s*\d+/.test(hay)) return true; // 25/5, 50/5/5 etc
    return false;
  };

  const isBodyTripSession = (s: SessionWithRelations) => {
    const hay = `${s.title || ""} ${s.format || ""} ${s.status || ""}`.toLowerCase();
    return hay.includes("body") || hay.includes("trip") || hay.includes("doubl");
  };

  const visibleSessions = useMemo(() => {
    const active = sessions.filter((s) => !isExpired(s));

    let filtered: SessionWithRelations[] = [];
    if (sessionTypeTab === "group") {
      filtered = active.filter((s) => !isInfiniteSession(s) && !isBodyTripSession(s));
    } else if (sessionTypeTab === "infinite") {
      filtered = active.filter((s) => isInfiniteSession(s));
    } else {
      filtered = active.filter((s) => isBodyTripSession(s));
    }

    // If heuristic didn't match anything yet, show active so page isn't empty while you wire DB flags.
    return filtered.length ? filtered : active;
  }, [sessions, sessionTypeTab]);

  return (
    <div className="min-h-screen bg-white text-brandBlack font-inter">
      <Header />

      <main className="w-full px-8 pb-12">
        <div className="pt-[100px]">
          {/* Infinite rooms: show the descriptive block like on screenshot */}
          {sessionTypeTab === "infinite" ? (
            <div className="max-w-[980px] mx-auto">
              <InfiniteRoomsIntroCard />
            </div>
          ) : (
            <div className="pb-[50px] text-center">
              <h1 className="text-[24px] md:text-[28px] xl:text-[36px]">
                Join a group focus session to stay accountable
              </h1>
            </div>
          )}
        </div>

        <div className="w-full">
          <div className="flex justify-center mb-[55px]">
            <SessionTypeSwitcher value={sessionTypeTab} onChange={setSessionTypeTab} />
          </div>

          <div className="max-w-[980px] mx-auto">
            {isLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brandBlack mx-auto" />
              </div>
            ) : visibleSessions.length === 0 ? (
              <div className="p-2 text-center">
                <p className="text-sm text-slate-600 mb-4">
                  No active sessions available
                </p>
                {user && (
                  <button onClick={() => modal.open()} className="text-sm underline">
                    Create the first session
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {visibleSessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    userId={user?.id}
                    onJoin={(id) =>
                      user ? navigate(`/room/${id}`) : navigate("/login")
                    }
                    onBook={async (id) => {
                      if (!user) return navigate("/login");
                      await supabase.from("session_bookings").insert({
                        session_id: id,
                        user_id: user.id,
                      });
                      fetchSessions();
                    }}
                    onCancelBooking={async (id) => {
                      if (!user) return navigate("/login");
                      await supabase
                        .from("session_bookings")
                        .delete()
                        .eq("session_id", id)
                        .eq("user_id", user.id);
                      fetchSessions();
                    }}
                    onDelete={async (id) => {
                      if (!user) return navigate("/login");
                      await supabase.from("sessions").delete().eq("id", id);
                      setSessions((p) => p.filter((s) => s.id !== id));
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
