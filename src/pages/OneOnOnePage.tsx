import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Shuffle, UsersRound, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { RealtimeChannel, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type QueuePresence = {
  userId: string;
  displayName: string;
  duration: number;
  ticket: string;
  joinedAt: number;
  status: "searching" | "matched";
  sessionId?: string;
  partnerUserId?: string;
};

const DURATIONS = [25, 45, 60] as const;

function randomTicket() {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function flattenPresence(state: Record<string, unknown>): QueuePresence[] {
  return Object.values(state)
    .flatMap((value) => Array.isArray(value) ? value : [])
    .filter((value): value is QueuePresence => Boolean(value && typeof value === "object" && "userId" in value));
}

export default function OneOnOnePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(45);
  const [status, setStatus] = useState<"idle" | "searching" | "creating" | "matched" | "error">("idle");
  const [queueCount, setQueueCount] = useState(0);
  const [errorText, setErrorText] = useState("");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const presenceRef = useRef<QueuePresence | null>(null);
  const creatingRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const nextUser = data.session?.user || null;
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", nextUser.id)
        .maybeSingle();
      if (mounted) setDisplayName(String(profile?.full_name || nextUser.user_metadata?.full_name || nextUser.email || "Focus partner"));
    });
    return () => { mounted = false; };
  }, []);

  const stopSearching = useCallback(async () => {
    const channel = channelRef.current;
    channelRef.current = null;
    presenceRef.current = null;
    creatingRef.current = false;
    if (channel) {
      try { await channel.untrack(); } catch { }
      await supabase.removeChannel(channel);
    }
    setQueueCount(0);
    setStatus("idle");
  }, []);

  useEffect(() => () => { if (channelRef.current) void supabase.removeChannel(channelRef.current); }, []);

  const enterRoom = useCallback((sessionId: string) => {
    if (!sessionId) return;
    setStatus("matched");
    window.setTimeout(() => navigate(`/room-livekit/${sessionId}?mode=one-on-one`), 350);
  }, [navigate]);

  const createMatchedSession = useCallback(async (partner: QueuePresence, channel: RealtimeChannel) => {
    if (!user || creatingRef.current || !presenceRef.current) return;
    creatingRef.current = true;
    setStatus("creating");
    const own = presenceRef.current;
    const matchKey = [own.ticket, partner.ticket].sort().join("_");
    try {
      const { data: auth } = await supabase.auth.getSession();
      const accessToken = auth.session?.access_token;
      if (!accessToken) throw new Error("Your sign-in expired. Please sign in again.");
      const response = await fetch("/api/livekit/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "create_one_on_one_session", partnerUserId: partner.userId, durationMinutes: own.duration, matchKey }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.sessionId) throw new Error(String(payload?.error || "Could not create your 1:1 room."));
      const matchedPresence: QueuePresence = { ...own, status: "matched", sessionId: payload.sessionId, partnerUserId: partner.userId };
      presenceRef.current = matchedPresence;
      await channel.track(matchedPresence);
      await channel.send({ type: "broadcast", event: "matched", payload: { sessionId: payload.sessionId, userIds: [user.id, partner.userId] } });
      enterRoom(payload.sessionId);
    } catch (error) {
      creatingRef.current = false;
      channelRef.current = null;
      presenceRef.current = null;
      void supabase.removeChannel(channel);
      setErrorText(error instanceof Error ? error.message : "Matching failed. Please try again.");
      setStatus("error");
    }
  }, [enterRoom, user]);

  const startSearching = useCallback(async () => {
    setErrorText("");
    if (!authReady) return;
    if (!user) {
      navigate(`/login?next=${encodeURIComponent("/one-on-one")}`);
      return;
    }
    if (channelRef.current) return;

    const own: QueuePresence = {
      userId: user.id,
      displayName: displayName.trim() || "Focus partner",
      duration,
      ticket: randomTicket(),
      joinedAt: Date.now(),
      status: "searching",
    };
    presenceRef.current = own;
    setStatus("searching");

    const channel = supabase.channel(`one-on-one-matchmaking-v1-${duration}`, {
      config: { presence: { key: user.id }, broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel.on("broadcast", { event: "matched" }, ({ payload }) => {
      const userIds = Array.isArray(payload?.userIds) ? payload.userIds.map(String) : [];
      if (userIds.includes(user.id) && payload?.sessionId) enterRoom(String(payload.sessionId));
    });
    channel.on("presence", { event: "sync" }, () => {
      const all = flattenPresence(channel.presenceState() as Record<string, unknown>);
      const searching = all
        .filter((entry) => entry.status === "searching" && entry.duration === duration)
        .sort((a, b) => a.joinedAt - b.joinedAt || a.ticket.localeCompare(b.ticket));
      setQueueCount(searching.length);

      const matched = all.find((entry) => entry.status === "matched" && entry.partnerUserId === user.id && entry.sessionId);
      if (matched?.sessionId) return enterRoom(matched.sessionId);

      const ownIndex = searching.findIndex((entry) => entry.ticket === own.ticket);
      if (ownIndex < 0) return;
      const pairStart = ownIndex % 2 === 0 ? ownIndex : ownIndex - 1;
      const first = searching[pairStart];
      const second = searching[pairStart + 1];
      if (first?.ticket === own.ticket && second) void createMatchedSession(second, channel);
    });
    channel.subscribe(async (subscriptionStatus) => {
      if (subscriptionStatus === "SUBSCRIBED") await channel.track(own);
      if (subscriptionStatus === "CHANNEL_ERROR" || subscriptionStatus === "TIMED_OUT") {
        channelRef.current = null;
        presenceRef.current = null;
        creatingRef.current = false;
        void supabase.removeChannel(channel);
        setErrorText("The matching queue is temporarily unavailable. Please try again.");
        setStatus("error");
      }
    });
  }, [authReady, createMatchedSession, displayName, duration, enterRoom, navigate, user]);

  const isBusy = status === "searching" || status === "creating" || status === "matched";
  const canCancel = status === "searching";
  const statusLabel = useMemo(() => {
    if (status === "creating") return "Pair found — preparing your room…";
    if (status === "matched") return "Matched — joining your room…";
    if (status === "searching") return queueCount > 1 ? "Checking the queue for your pair…" : "Waiting for a focus partner…";
    return "One click puts you in the matching queue.";
  }, [queueCount, status]);

  return (
    <main className="min-h-screen bg-[#FAFAFA] text-[#202124] font-inter">

      <section className="mx-auto flex min-h-[calc(100vh-92px)] max-w-5xl items-center justify-center px-5 py-12">
        <div className="w-full max-w-[650px] rounded-[32px] border border-[#DDD8D8] bg-white px-6 py-8 md:px-12 md:py-11">
          <div className="mx-auto mb-7 flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#151B2B] text-white"><UsersRound size={26} /></div>
          <div className="text-center">
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.18em] text-[#6F747D]">MySession 1:1</p>
            <h1 className="text-[36px] md:text-[48px] font-extrabold tracking-[-0.055em] leading-[1.05]">Find a focus partner.</h1>
            <p className="mx-auto mt-4 max-w-lg text-[15px] md:text-[17px] leading-7 text-[#666]">Choose a duration, enter the queue, and start a private LiveKit focus room with one other person.</p>
          </div>

          <div className="mt-9 rounded-[24px] bg-[#F5F4F4] p-4 md:p-5">
            <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.14em] text-[#777]">Your name</label>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={!user || isBusy} placeholder={authReady && !user ? "Sign in to start matching" : "Your display name"} className="h-12 w-full rounded-2xl bg-white px-4 text-[15px] outline-none ring-1 ring-black/5 transition focus:ring-2 focus:ring-[#2F2F2F]/20 disabled:text-black/40" />

            <div className="mt-5 grid grid-cols-3 gap-2">
              {DURATIONS.map((minutes) => (
                <button key={minutes} type="button" disabled={isBusy} onClick={() => setDuration(minutes)} className={`h-11 rounded-2xl text-[14px] font-semibold transition ${duration === minutes ? "bg-[#2F2F2F] text-white" : "bg-white text-[#404040] hover:bg-[#EAE8E8]"}`}>
                  {minutes === 60 ? "1 hour" : `${minutes} min`}
                </button>
              ))}
            </div>

            <button type="button" disabled={status === "creating" || status === "matched"} onClick={canCancel ? () => void stopSearching() : () => void startSearching()} className={`mt-5 flex h-13 w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-[15px] font-bold transition disabled:cursor-wait disabled:opacity-70 ${isBusy ? "bg-white text-[#2F2F2F] ring-1 ring-black/10 hover:bg-[#ECEAEA]" : "bg-[#2F2F2F] text-white hover:bg-[#171717]"}`}>
              <Shuffle size={18} /> {canCancel ? "Cancel matching" : status === "creating" || status === "matched" ? "Preparing room" : user ? "Random match" : "Sign in to match"}
            </button>
            <p className="mt-3 min-h-5 text-center text-[13px] text-[#777]">{statusLabel}</p>
            {errorText ? <p className="mt-2 rounded-xl bg-[#FFF0F0] px-3 py-2 text-center text-[13px] text-[#B43D3D]">{errorText}</p> : null}
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-[#EEF3FF] p-4"><Clock3 className="mb-3 text-[#4F8CFF]" size={20} /><b className="block text-[14px]">Shared timer</b><span className="mt-1 block text-[12px] leading-5 text-[#6B7180]">The same session stages for both partners.</span></div>
            <div className="rounded-2xl bg-[#EAF9EC] p-4"><Video className="mb-3 text-[#43B95A]" size={20} /><b className="block text-[14px]">LiveKit video</b><span className="mt-1 block text-[12px] leading-5 text-[#6B7180]">The familiar MySession room and controls.</span></div>
            <div className="rounded-2xl bg-[#FFF0EF] p-4"><UsersRound className="mb-3 text-[#F65252]" size={20} /><b className="block text-[14px]">Exactly two</b><span className="mt-1 block text-[12px] leading-5 text-[#6B7180]">Your room is private and capped at two people.</span></div>
          </div>
        </div>
      </section>
    </main>
  );
}
