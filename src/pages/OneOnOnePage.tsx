import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Clock3, Copy, Link2, Loader2, Shuffle, UsersRound, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { RealtimeChannel, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type QueuePresence = {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  duration: number;
  ticket: string;
  joinedAt: number;
  status: "searching" | "matched";
  sessionId?: string;
  partnerUserId?: string;
  partnerDisplayName?: string;
  joinedRoom?: boolean;
};

type MatchedPair = {
  sessionId: string;
  partnerUserId?: string;
  partnerDisplayName?: string;
  partnerAvatarUrl?: string;
  partnerInRoom: boolean;
};

const DURATIONS = [25, 50, 75] as const;

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
  const [avatarUrl, setAvatarUrl] = useState("");
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(50);
  const [status, setStatus] = useState<"idle" | "searching" | "creating" | "matched" | "error">("idle");
  const [queueCounts, setQueueCounts] = useState<Record<number, number>>({ 25: 0, 50: 0, 75: 0 });
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [errorText, setErrorText] = useState("");
  const [matchedPair, setMatchedPair] = useState<MatchedPair | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const channelReadyRef = useRef(false);
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
        .select("full_name, avatar_url")
        .eq("id", nextUser.id)
        .maybeSingle();
      if (mounted) {
        setDisplayName(String(profile?.full_name || nextUser.user_metadata?.full_name || nextUser.email || "Focus partner"));
        setAvatarUrl(String(profile?.avatar_url || nextUser.user_metadata?.avatar_url || nextUser.user_metadata?.picture || "").trim());
      }
    });
    return () => { mounted = false; };
  }, []);

  const stopSearching = useCallback(async () => {
    presenceRef.current = null;
    creatingRef.current = false;
    const channel = channelRef.current;
    if (channel && channelReadyRef.current) {
      try { await channel.untrack(); } catch { }
    }
    setStatus("idle");
  }, []);

  const revealMatchedPair = useCallback((next: Omit<MatchedPair, "partnerInRoom"> & { partnerInRoom?: boolean }) => {
    if (!next.sessionId) return;
    setStatus("matched");
    setMatchedPair((current) => current?.sessionId === next.sessionId
      ? {
          ...current,
          partnerUserId: next.partnerUserId || current.partnerUserId,
          partnerDisplayName: next.partnerDisplayName || current.partnerDisplayName,
          partnerAvatarUrl: next.partnerAvatarUrl || current.partnerAvatarUrl,
          partnerInRoom: Boolean(current.partnerInRoom || next.partnerInRoom),
        }
      : { ...next, partnerInRoom: Boolean(next.partnerInRoom) });
  }, []);

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
      if (!response.ok || !payload?.sessionId) {
        throw new Error(String(payload?.details || payload?.error || "Could not create your 1:1 room."));
      }
      const matchedPresence: QueuePresence = {
        ...own,
        status: "matched",
        sessionId: payload.sessionId,
        partnerUserId: partner.userId,
        partnerDisplayName: partner.displayName,
      };
      presenceRef.current = matchedPresence;
      await channel.track(matchedPresence);
      await channel.send({
        type: "broadcast",
        event: "matched",
        payload: {
          sessionId: payload.sessionId,
          userIds: [user.id, partner.userId],
          participants: [
            { userId: user.id, displayName: own.displayName, avatarUrl: own.avatarUrl },
            { userId: partner.userId, displayName: partner.displayName, avatarUrl: partner.avatarUrl },
          ],
        },
      });
      revealMatchedPair({
        sessionId: payload.sessionId,
        partnerUserId: partner.userId,
        partnerDisplayName: partner.displayName,
        partnerAvatarUrl: partner.avatarUrl,
      });
    } catch (error) {
      creatingRef.current = false;
      presenceRef.current = null;
      try { await channel.untrack(); } catch { }
      setErrorText(error instanceof Error ? error.message : "Matching failed. Please try again.");
      setStatus("error");
    }
  }, [revealMatchedPair, user]);

  useEffect(() => {
    if (!authReady) return;
    const currentUserId = user?.id || "";
    const presenceKey = currentUserId || `observer-${randomTicket()}`;
    const channel = supabase.channel("one-on-one-matchmaking-v2", {
      config: { presence: { key: presenceKey }, broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel.on("broadcast", { event: "matched" }, ({ payload }) => {
      const userIds = Array.isArray(payload?.userIds) ? payload.userIds.map(String) : [];
      if (!currentUserId || !userIds.includes(currentUserId) || !payload?.sessionId) return;
      const participants = Array.isArray(payload?.participants) ? payload.participants : [];
      const partner = participants.find((entry: { userId?: unknown }) => String(entry?.userId || "") !== currentUserId);
      const partnerUserId = String(partner?.userId || userIds.find((id: string) => id !== currentUserId) || "");
      const own = presenceRef.current;
      if (own) {
        const matchedOwn: QueuePresence = {
          ...own,
          status: "matched",
          sessionId: String(payload.sessionId),
          partnerUserId,
          partnerDisplayName: String(partner?.displayName || "Focus partner"),
        };
        presenceRef.current = matchedOwn;
        void channel.track(matchedOwn).catch(() => undefined);
      }
      revealMatchedPair({
        sessionId: String(payload.sessionId),
        partnerUserId,
        partnerDisplayName: String(partner?.displayName || "Focus partner"),
        partnerAvatarUrl: String(partner?.avatarUrl || ""),
      });
    });
    channel.on("broadcast", { event: "joining_room" }, ({ payload }) => {
      const sessionId = String(payload?.sessionId || "");
      const joiningUserId = String(payload?.userId || "");
      if (!sessionId || !joiningUserId || joiningUserId === currentUserId) return;
      setMatchedPair((current) => current?.sessionId === sessionId
        ? { ...current, partnerInRoom: true }
        : current);
    });
    channel.on("presence", { event: "sync" }, () => {
      const all = flattenPresence(channel.presenceState() as Record<string, unknown>);
      const nextCounts: Record<number, number> = { 25: 0, 50: 0, 75: 0 };
      for (const entry of all) {
        if (entry.status === "searching" && DURATIONS.includes(entry.duration as (typeof DURATIONS)[number])) {
          nextCounts[entry.duration] = (nextCounts[entry.duration] || 0) + 1;
        }
      }
      setQueueCounts((current) => DURATIONS.every((minutes) => current[minutes] === nextCounts[minutes]) ? current : nextCounts);

      const matched = all.find((entry) => entry.status === "matched" && entry.partnerUserId === currentUserId && entry.sessionId);
      if (matched?.sessionId) {
        revealMatchedPair({
          sessionId: matched.sessionId,
          partnerUserId: matched.userId,
          partnerDisplayName: matched.displayName,
          partnerAvatarUrl: matched.avatarUrl,
          partnerInRoom: Boolean(matched.joinedRoom),
        });
        return;
      }

      const own = presenceRef.current;
      if (!own || own.status !== "searching") return;
      const searching = all
        .filter((entry) => entry.status === "searching" && entry.duration === own.duration)
        .sort((a, b) => a.joinedAt - b.joinedAt || a.ticket.localeCompare(b.ticket));
      const ownIndex = searching.findIndex((entry) => entry.ticket === own.ticket);
      if (ownIndex < 0) return;
      const pairStart = ownIndex % 2 === 0 ? ownIndex : ownIndex - 1;
      const first = searching[pairStart];
      const second = searching[pairStart + 1];
      if (first?.ticket === own.ticket && second) void createMatchedSession(second, channel);
    });
    channel.subscribe((subscriptionStatus) => {
      if (subscriptionStatus === "SUBSCRIBED") channelReadyRef.current = true;
      if (subscriptionStatus === "CHANNEL_ERROR" || subscriptionStatus === "TIMED_OUT") {
        channelReadyRef.current = false;
        if (presenceRef.current) {
          presenceRef.current = null;
          creatingRef.current = false;
          setErrorText("The matching queue is temporarily unavailable. Please try again.");
          setStatus("error");
        }
      }
    });

    return () => {
      channelReadyRef.current = false;
      if (channelRef.current === channel) channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [authReady, createMatchedSession, revealMatchedPair, user]);

  const startSearching = useCallback(async () => {
    setErrorText("");
    if (!authReady) return;
    if (!user) {
      navigate(`/login?next=${encodeURIComponent("/one-on-one")}`);
      return;
    }
    if (presenceRef.current) return;

    const deadline = Date.now() + 6000;
    while (!channelReadyRef.current && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    const channel = channelRef.current;
    if (!channel || !channelReadyRef.current) {
      setErrorText("The matching queue is still connecting. Please try again in a moment.");
      setStatus("error");
      return;
    }

    const own: QueuePresence = {
      userId: user.id,
      displayName: displayName.trim() || "Focus partner",
      avatarUrl,
      duration,
      ticket: randomTicket(),
      joinedAt: Date.now(),
      status: "searching",
    };
    presenceRef.current = own;
    creatingRef.current = false;
    setStatus("searching");
    try {
      await channel.track(own);
    } catch (error) {
      presenceRef.current = null;
      setErrorText(error instanceof Error ? error.message : "Could not enter the matching queue.");
      setStatus("error");
    }
  }, [authReady, avatarUrl, displayName, duration, navigate, user]);
  const createInviteRoom = useCallback(async () => {
    setErrorText("");
    if (!authReady) return;
    if (!user) {
      navigate(`/login?next=${encodeURIComponent("/one-on-one")}`);
      return;
    }
    setInviteBusy(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const accessToken = auth.session?.access_token;
      if (!accessToken) throw new Error("Your sign-in expired. Please sign in again.");
      const response = await fetch("/api/livekit/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "create_one_on_one_session", durationMinutes: duration, matchKey: randomTicket(), inviteOnly: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.sessionId || !payload?.inviteToken) {
        throw new Error(String(payload?.details || payload?.error || "Could not create your private room."));
      }
      const relative = `/room-livekit/${payload.sessionId}?mode=one-on-one&invite=${encodeURIComponent(payload.inviteToken)}`;
      setInviteLink(`${window.location.origin}${relative}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Could not create your private room.");
    } finally {
      setInviteBusy(false);
    }
  }, [authReady, duration, navigate, user]);

  const joinMatchedRoom = useCallback(async () => {
    if (!matchedPair?.sessionId || joinBusy) return;
    setJoinBusy(true);
    const channel = channelRef.current;
    const own = presenceRef.current;
    if (channel && channelReadyRef.current) {
      try {
        if (own) {
          const joiningPresence: QueuePresence = {
            ...own,
            status: "matched",
            sessionId: matchedPair.sessionId,
            partnerUserId: matchedPair.partnerUserId || own.partnerUserId,
            partnerDisplayName: matchedPair.partnerDisplayName || own.partnerDisplayName,
            joinedRoom: true,
          };
          presenceRef.current = joiningPresence;
          await channel.track(joiningPresence);
        }
        await channel.send({
          type: "broadcast",
          event: "joining_room",
          payload: {
            sessionId: matchedPair.sessionId,
            userId: user?.id,
            partnerUserId: matchedPair.partnerUserId,
          },
        });
      } catch {
        // Realtime status is best-effort; joining the already-created room must still work.
      }
    }
    navigate(`/room-livekit/${matchedPair.sessionId}?mode=one-on-one`);
  }, [joinBusy, matchedPair, navigate, user?.id]);

  const queueCount = queueCounts[duration] || 0;
  const isBusy = status === "searching" || status === "creating" || status === "matched";
  const canCancel = status === "searching";
  const statusLabel = useMemo(() => {
    if (status === "creating") return "Pair found — preparing your room…";
    if (status === "matched") return "Matched — ready when you are.";
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
                <button key={minutes} type="button" disabled={isBusy} onClick={() => setDuration(minutes)} className={`flex min-h-14 flex-col items-center justify-center rounded-2xl text-[14px] font-semibold transition ${duration === minutes ? "bg-[#2F2F2F] text-white" : "bg-white text-[#404040] hover:bg-[#EAE8E8]"}`}>
                  <span>{`${minutes} min`}</span>
                  <span className={`mt-0.5 text-[10px] font-medium ${duration === minutes ? "text-white/65" : "text-[#8A8A8A]"}`}>{`${queueCounts[minutes] || 0} searching`}</span>
                </button>
              ))}
            </div>

            <button type="button" disabled={status === "creating" || status === "matched"} onClick={canCancel ? () => void stopSearching() : () => void startSearching()} className={`mt-5 flex h-13 w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-[15px] font-bold transition disabled:cursor-wait disabled:opacity-70 ${isBusy ? "bg-white text-[#2F2F2F] ring-1 ring-black/10 hover:bg-[#ECEAEA]" : "bg-[#2F2F2F] text-white hover:bg-[#171717]"}`}>
              <Shuffle size={18} /> {canCancel ? "Cancel matching" : status === "creating" || status === "matched" ? "Preparing room" : user ? "Random match" : "Sign in to match"}
            </button>
            <p className="mt-3 min-h-5 text-center text-[13px] text-[#777]">{statusLabel}</p>

            <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-[#999]"><span className="h-px flex-1 bg-black/10" />or invite someone<span className="h-px flex-1 bg-black/10" /></div>
            <button type="button" disabled={inviteBusy || isBusy} onClick={() => void createInviteRoom()} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-[14px] font-bold text-[#2F2F2F] ring-1 ring-black/10 transition hover:bg-[#ECEAEA] disabled:opacity-55">
              <Link2 size={17} /> {inviteBusy ? "Creating private room…" : "Create private room link"}
            </button>
            {inviteLink ? (
              <div className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-black/10">
                <p className="mb-2 text-[12px] text-[#777]">Share this one-time link. The first person who opens it becomes your partner.</p>
                <div className="flex gap-2">
                  <input readOnly value={inviteLink} className="min-w-0 flex-1 rounded-xl bg-[#F5F4F4] px-3 text-[12px] outline-none" />
                  <button type="button" onClick={() => void navigator.clipboard.writeText(inviteLink)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2F2F2F] text-white" aria-label="Copy private room link"><Copy size={16} /></button>
                </div>
                <button type="button" onClick={() => window.location.assign(inviteLink)} className="mt-2 w-full rounded-xl bg-[#EAF9EC] px-3 py-2 text-[13px] font-bold text-[#277D37]">Enter your room</button>
              </div>
            ) : null}
            {errorText ? <p className="mt-2 rounded-xl bg-[#FFF0F0] px-3 py-2 text-center text-[13px] text-[#B43D3D]">{errorText}</p> : null}
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-[#EEF3FF] p-4"><Clock3 className="mb-3 text-[#4F8CFF]" size={20} /><b className="block text-[14px]">Shared timer</b><span className="mt-1 block text-[12px] leading-5 text-[#6B7180]">The same session stages for both partners.</span></div>
            <div className="rounded-2xl bg-[#EAF9EC] p-4"><Video className="mb-3 text-[#43B95A]" size={20} /><b className="block text-[14px]">LiveKit video</b><span className="mt-1 block text-[12px] leading-5 text-[#6B7180]">The familiar MySession room and controls.</span></div>
            <div className="rounded-2xl bg-[#FFF0EF] p-4"><UsersRound className="mb-3 text-[#F65252]" size={20} /><b className="block text-[14px]">Exactly two</b><span className="mt-1 block text-[12px] leading-5 text-[#6B7180]">Your room is private and capped at two people.</span></div>
          </div>
        </div>
      </section>

      {matchedPair ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 px-4 backdrop-blur-[2px] animate-[fadeIn_180ms_ease-out]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="one-on-one-match-title"
        >
          <div className="w-full max-w-[430px] rounded-[28px] bg-white p-6 text-[#202124] shadow-[0_24px_80px_rgba(0,0,0,0.18)] animate-[postSessionIn_280ms_cubic-bezier(0.22,1,0.36,1)] sm:p-7">
            <div className="flex items-center gap-4">
              <div className="relative h-16 w-16 shrink-0">
                <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-[20px] bg-[#F0EFEF] text-[22px] font-extrabold text-[#555] ring-1 ring-black/[0.06]">
                  {matchedPair.partnerAvatarUrl ? (
                    <img
                      src={matchedPair.partnerAvatarUrl}
                      alt={`${matchedPair.partnerDisplayName || "Focus partner"} avatar`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span aria-hidden="true">{(matchedPair.partnerDisplayName || "F").trim().charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#43B95A] text-white ring-4 ring-white">
                  <CheckCircle2 size={15} strokeWidth={2.5} />
                </span>
              </div>
              <div className="min-w-0 pt-0.5">
                <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#36A94C]">Match found</p>
                <h2 id="one-on-one-match-title" className="mt-1 text-[24px] font-extrabold leading-tight tracking-[-0.035em]">
                  You were matched with another partner.
                </h2>
                {matchedPair.partnerDisplayName ? (
                  <p className="mt-2 text-[14px] leading-6 text-[#6D6D6D]">
                    {matchedPair.partnerDisplayName} is your focus partner for this session.
                  </p>
                ) : null}
              </div>
            </div>

            <div className={`mt-6 flex items-center gap-3 rounded-2xl px-4 py-3 ${matchedPair.partnerInRoom ? "bg-[#EAF9EC]" : "bg-[#F4F3F3]"}`}>
              <span className={`relative flex h-2.5 w-2.5 shrink-0 rounded-full ${matchedPair.partnerInRoom ? "bg-[#43B95A]" : "bg-[#A7A7A7]"}`}>
                {matchedPair.partnerInRoom ? <span className="absolute inset-0 animate-ping rounded-full bg-[#43B95A]/45" /> : null}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-[#343434]">
                  {matchedPair.partnerInRoom ? "Your partner is already in the room" : "Your partner has not joined yet"}
                </p>
                <p className="mt-0.5 text-[11px] text-[#7A7A7A]">
                  {matchedPair.partnerInRoom ? "Join them when you are ready." : "You can enter now — their status will update automatically."}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void joinMatchedRoom()}
              disabled={joinBusy}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#2F2F2F] px-5 text-[14px] font-bold text-white transition hover:bg-[#1F1F1F] disabled:cursor-wait disabled:opacity-70"
            >
              {joinBusy ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />}
              {joinBusy ? "Opening room…" : "Join room"}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
