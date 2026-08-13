import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, CalendarPlus, Camera, CheckCircle2, ChevronDown, Clock3, Copy, Link2, Loader2, Mic, Shuffle, UsersRound } from "lucide-react";
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

type ScheduledOneOnOne = {
  id: string;
  startTime: string;
  hostId: string;
  hostName: string;
  hostAvatarUrl: string;
  bookedUserIds: string[];
};

type MatchedPair = {
  sessionId: string;
  partnerUserId?: string;
  partnerDisplayName?: string;
  partnerAvatarUrl?: string;
  partnerInRoom: boolean;
};

const DURATIONS = [25, 50, 75] as const;

function toLocalDateTimeInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatScheduledDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (candidate: Date, reference: Date) => candidate.toDateString() === reference.toDateString();
  const dayLabel = sameDay(date, today)
    ? "Today"
    : sameDay(date, tomorrow)
      ? "Tomorrow"
      : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  const timeLabel = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  return `${dayLabel} · ${timeLabel}`;
}

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

type OneOnOnePageProps = {
  embedded?: boolean;
};

export default function OneOnOnePage({ embedded = false }: OneOnOnePageProps) {
  const navigate = useNavigate();
  const matchingPath = embedded ? "/sessions?tab=one-on-one" : "/one-on-one";
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
  const [cameraPreviewOpen, setCameraPreviewOpen] = useState(false);
  const [cameraPreviewError, setCameraPreviewError] = useState("");
  const [mediaDevices, setMediaDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraDeviceId, setCameraDeviceId] = useState("");
  const [microphoneDeviceId, setMicrophoneDeviceId] = useState("");
  const [scheduledSessions, setScheduledSessions] = useState<ScheduledOneOnOne[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(true);
  const [scheduleDateTime, setScheduleDateTime] = useState(() => {
    const date = new Date(Date.now() + 60 * 60_000);
    date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  });
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [bookingBusyId, setBookingBusyId] = useState("");
  const [cancellingBookingId, setCancellingBookingId] = useState("");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
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

  const stopPreview = useCallback(() => {
    previewStreamRef.current?.getTracks().forEach((track) => track.stop());
    previewStreamRef.current = null;
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
  }, []);

  const startPreview = useCallback(async (nextCameraId?: string, nextMicrophoneId?: string) => {
    setCameraPreviewError("");
    stopPreview();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: nextCameraId || cameraDeviceId
          ? { deviceId: { exact: nextCameraId || cameraDeviceId } }
          : { facingMode: "user" },
        audio: nextMicrophoneId || microphoneDeviceId
          ? { deviceId: { exact: nextMicrophoneId || microphoneDeviceId } }
          : true,
      });
      previewStreamRef.current = stream;
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
        await previewVideoRef.current.play().catch(() => undefined);
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMediaDevices(devices);
      const cameraTrackId = stream.getVideoTracks()[0]?.getSettings().deviceId || "";
      const microphoneTrackId = stream.getAudioTracks()[0]?.getSettings().deviceId || "";
      if (cameraTrackId) setCameraDeviceId(cameraTrackId);
      if (microphoneTrackId) setMicrophoneDeviceId(microphoneTrackId);
    } catch (error) {
      setCameraPreviewError(error instanceof Error ? error.message : "Camera preview is unavailable.");
    }
  }, [cameraDeviceId, microphoneDeviceId, stopPreview]);

  useEffect(() => {
    if (!cameraPreviewOpen) {
      stopPreview();
      return;
    }
    void startPreview();
    return stopPreview;
  }, [cameraPreviewOpen, startPreview, stopPreview]);

  const loadScheduledSessions = useCallback(async () => {
    setScheduledLoading(true);
    try {
      const { data: sessionRows, error: sessionError } = await supabase
        .from("sessions")
        .select("id,start_time,host_id,host_name")
        .like("description", "one-on-one:scheduled:%")
        .gte("start_time", new Date().toISOString())
        .order("start_time", { ascending: true })
        .limit(8);
      if (sessionError) throw sessionError;

      const rows = sessionRows || [];
      const sessionIds = rows.map((row) => String(row.id));
      const hostIds = [...new Set(rows.map((row) => String(row.host_id || "")).filter(Boolean))];
      const [{ data: bookings }, { data: profiles }] = await Promise.all([
        sessionIds.length
          ? supabase.from("session_bookings").select("session_id,user_id").in("session_id", sessionIds)
          : Promise.resolve({ data: [] as Array<{ session_id: string; user_id: string | null }> }),
        hostIds.length
          ? supabase.from("profiles").select("id,full_name,avatar_url").in("id", hostIds)
          : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; avatar_url: string | null }> }),
      ]);
      const profileById = new Map((profiles || []).map((profile) => [String(profile.id), profile]));
      const bookedBySession = new Map<string, string[]>();
      for (const booking of bookings || []) {
        const sessionId = String(booking.session_id || "");
        const userId = String(booking.user_id || "");
        if (!sessionId || !userId) continue;
        bookedBySession.set(sessionId, [...(bookedBySession.get(sessionId) || []), userId]);
      }
      setScheduledSessions(rows.map((row) => {
        const hostId = String(row.host_id || "");
        const profile = profileById.get(hostId);
        return {
          id: String(row.id),
          startTime: String(row.start_time || ""),
          hostId,
          hostName: String(profile?.full_name || row.host_name || "Focus partner"),
          hostAvatarUrl: String(profile?.avatar_url || ""),
          bookedUserIds: bookedBySession.get(String(row.id)) || [],
        };
      }));
    } catch (error) {
      console.error("[one-on-one] scheduled sessions load failed", error);
    } finally {
      setScheduledLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadScheduledSessions();
    const channel = supabase
      .channel("one-on-one-scheduled-slots")
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => void loadScheduledSessions())
      .on("postgres_changes", { event: "*", schema: "public", table: "session_bookings" }, () => void loadScheduledSessions())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadScheduledSessions]);

  const createScheduledSession = useCallback(async () => {
    setErrorText("");
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(matchingPath)}`);
      return;
    }
    const start = new Date(scheduleDateTime);
    if (!Number.isFinite(start.getTime()) || start.getTime() < Date.now() + 5 * 60_000) {
      setErrorText("Choose a time at least five minutes from now.");
      return;
    }
    setScheduleBusy(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const accessToken = auth.session?.access_token;
      if (!accessToken) throw new Error("Your sign-in expired. Please sign in again.");
      const response = await fetch("/api/livekit/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          action: "create_one_on_one_session",
          durationMinutes: 50,
          scheduledAt: start.toISOString(),
          matchKey: randomTicket(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.sessionId) {
        throw new Error(String(payload?.details || payload?.error || "Could not schedule your 1:1 session."));
      }
      await loadScheduledSessions();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Could not schedule your 1:1 session.");
    } finally {
      setScheduleBusy(false);
    }
  }, [loadScheduledSessions, matchingPath, navigate, scheduleDateTime, user]);

  const bookScheduledSession = useCallback(async (session: ScheduledOneOnOne) => {
    setErrorText("");
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(matchingPath)}`);
      return;
    }
    if (session.bookedUserIds.includes(user.id)) {
      navigate(`/room-livekit/${session.id}?mode=one-on-one`);
      return;
    }
    if (session.bookedUserIds.length >= 2) return;
    setBookingBusyId(session.id);
    try {
      const { error } = await supabase.from("session_bookings").insert({ session_id: session.id, user_id: user.id });
      if (error) throw error;
      await loadScheduledSessions();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Could not book this 1:1 session.");
    } finally {
      setBookingBusyId("");
    }
  }, [loadScheduledSessions, matchingPath, navigate, user]);

  const cancelScheduledSession = useCallback(async (session: ScheduledOneOnOne) => {
    setErrorText("");
    if (!user || cancellingBookingId) return;
    setCancellingBookingId(session.id);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const accessToken = auth.session?.access_token;
      if (!accessToken) throw new Error("Your sign-in expired. Please sign in again.");
      const response = await fetch("/api/livekit/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "cancel_one_on_one_session", sessionId: session.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.cancelled) {
        throw new Error(String(payload?.details || payload?.error || "Could not cancel this session."));
      }
      await loadScheduledSessions();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Could not cancel this session.");
    } finally {
      setCancellingBookingId("");
    }
  }, [cancellingBookingId, loadScheduledSessions, user]);
  const stopSearching = useCallback(async () => {
    presenceRef.current = null;
    creatingRef.current = false;
    const channel = channelRef.current;
    if (channel && channelReadyRef.current) {
      try { await channel.untrack(); } catch { /* Realtime cleanup is best-effort. */ }
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
      try { await channel.untrack(); } catch { /* Realtime cleanup is best-effort. */ }
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
    if (!authReady) return false;
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(matchingPath)}`);
      return false;
    }
    if (presenceRef.current) return true;

    const deadline = Date.now() + 6000;
    while (!channelReadyRef.current && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    const channel = channelRef.current;
    if (!channel || !channelReadyRef.current) {
      setErrorText("The matching queue is still connecting. Please try again in a moment.");
      setStatus("error");
      return false;
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
      return true;
    } catch (error) {
      presenceRef.current = null;
      setErrorText(error instanceof Error ? error.message : "Could not enter the matching queue.");
      setStatus("error");
      return false;
    }
  }, [authReady, avatarUrl, displayName, duration, matchingPath, navigate, user]);
  const createInviteRoom = useCallback(async (soloWindow?: Window | null) => {
    setErrorText("");
    if (!authReady) return;
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(matchingPath)}`);
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
      if (soloWindow) {
        soloWindow.opener = null;
        soloWindow.location.replace(`/room-livekit/${payload.sessionId}?mode=one-on-one`);
      }
      return true;
    } catch (error) {
      if (soloWindow && !soloWindow.closed) soloWindow.close();
      setErrorText(error instanceof Error ? error.message : "Could not create your private room.");
      return false;
    } finally {
      setInviteBusy(false);
    }
  }, [authReady, duration, matchingPath, navigate, user]);

  const startSoloWhileSearching = useCallback(() => {
    const soloWindow = window.open("about:blank", "_blank");
    if (!soloWindow) {
      setErrorText("Allow pop-ups to start a solo room while matching continues.");
      return;
    }
    void (async () => {
      const searching = await startSearching();
      if (!searching) {
        if (!soloWindow.closed) soloWindow.close();
        return;
      }
      await createInviteRoom(soloWindow);
    })();
  }, [createInviteRoom, startSearching]);

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
    <main
      className={`${embedded ? "bg-transparent" : "min-h-screen bg-[#FAFAFA]"} text-[#202124] font-inter`}
    >
      <section className={`mx-auto flex min-h-[calc(100vh-205px)] w-full max-w-[1120px] flex-col px-0 ${embedded ? "pb-8" : "px-5 py-12"}`}>
        <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.85fr)]">
          <div className="rounded-[28px] border border-[#DDD8D8] bg-white px-5 py-7 sm:px-8 sm:py-8">
            <div className="text-center">
              <div className="flex flex-wrap items-center justify-center gap-3">
                <h1 className="text-[30px] font-extrabold leading-none tracking-[-0.045em] sm:text-[38px]">
                  MySession One-on-One
                </h1>
                <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-[#2F2F2F]">
                  <img src="/icons/one-on-one-active.svg" className="h-6 w-6" alt="" />
                </span>
              </div>
              <p className="mt-2 text-[16px] font-medium text-[#334E8A]">Classical body doubling</p>
              <p className="mx-auto mt-4 max-w-[540px] text-[15px] leading-6 text-[#4F5F82]">
                We’ll match you with another focused person for a private, distraction-free session.
              </p>
            </div>

            <div className="mt-7">
              <label className="mb-2 block text-[12px] font-semibold text-[#405077]">Your name</label>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={!user || isBusy}
                placeholder={authReady && !user ? "Sign in to start matching" : "Your display name"}
                className="h-12 w-full rounded-[12px] border border-[#AEB7C9] bg-white px-4 text-[15px] outline-none transition focus:border-[#2F2F2F] focus:ring-2 focus:ring-[#2F2F2F]/10 disabled:text-black/40"
              />

              <div className="mt-3 overflow-hidden rounded-[14px] bg-[#F7F8FA]">
                <button
                  type="button"
                  onClick={() => setCameraPreviewOpen((current) => !current)}
                  className="flex min-h-[58px] w-full items-center gap-3 px-3 py-2.5 text-left"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[#E8EAEE] text-[14px] font-bold text-[#555]">
                    {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : (displayName.trim().charAt(0) || "F").toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-[#2F2F2F]">{displayName.trim() || "Focus partner"}</p>
                    <p className="mt-0.5 inline-flex items-center gap-1.5 text-[12px] text-[#279D3E]">
                      <span className="h-2 w-2 rounded-full bg-[#33C94F]" /> Ready to focus
                    </p>
                  </div>
                  <div className="hidden items-center gap-2 text-[12px] text-[#5D6680] sm:flex">
                    <Camera size={16} /> Camera check before joining
                  </div>
                  <ChevronDown size={17} className={`shrink-0 text-[#59637A] transition-transform ${cameraPreviewOpen ? "rotate-180" : ""}`} />
                </button>

                {cameraPreviewOpen ? (
                  <div className="grid gap-3 border-t border-[#E2E4E9] p-3 sm:grid-cols-[minmax(0,1.15fr)_minmax(220px,0.85fr)]">
                    <div className="relative min-h-[190px] overflow-hidden rounded-[12px] bg-[#202124]">
                      <video ref={previewVideoRef} muted playsInline autoPlay className="h-full min-h-[190px] w-full object-cover" />
                      <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white">
                        <span className="h-2 w-2 rounded-full bg-[#42D45D]" /> Camera preview
                      </span>
                      {cameraPreviewError ? (
                        <div className="absolute inset-0 grid place-items-center bg-[#202124] p-4 text-center text-[12px] leading-5 text-white/75">{cameraPreviewError}</div>
                      ) : null}
                    </div>
                    <div className="space-y-3">
                      <label className="block text-[11px] font-semibold text-[#4F5F82]">
                        <span className="mb-1 flex items-center gap-1.5"><Camera size={14} /> Camera</span>
                        <select
                          value={cameraDeviceId}
                          onChange={(event) => {
                            const next = event.target.value;
                            setCameraDeviceId(next);
                            void startPreview(next, microphoneDeviceId);
                          }}
                          className="h-10 w-full rounded-[10px] bg-white px-2.5 text-[12px] text-[#2F2F2F] outline-none"
                        >
                          {mediaDevices.filter((device) => device.kind === "videoinput").map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
                        </select>
                      </label>
                      <label className="block text-[11px] font-semibold text-[#4F5F82]">
                        <span className="mb-1 flex items-center gap-1.5"><Mic size={14} /> Microphone</span>
                        <select
                          value={microphoneDeviceId}
                          onChange={(event) => {
                            const next = event.target.value;
                            setMicrophoneDeviceId(next);
                            void startPreview(cameraDeviceId, next);
                          }}
                          className="h-10 w-full rounded-[10px] bg-white px-2.5 text-[12px] text-[#2F2F2F] outline-none"
                        >
                          {mediaDevices.filter((device) => device.kind === "audioinput").map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
                        </select>
                      </label>
                      <p className="text-[11px] leading-4 text-[#737E94]">Camera is required for 1:1 sessions. Your preview is local and stops when this panel closes.</p>
                    </div>
                  </div>
                ) : null}
              </div>

              <p className="mb-2 mt-5 text-[12px] font-semibold text-[#405077]">Choose duration</p>
              <div className="grid grid-cols-3 gap-2.5">
                {DURATIONS.map((minutes) => {
                  const unavailable = minutes !== 50;
                  const selected = !unavailable && duration === minutes;
                  return (
                    <button
                      key={minutes}
                      type="button"
                      disabled={isBusy || unavailable}
                      onClick={() => setDuration(minutes)}
                      aria-label={unavailable ? `${minutes} minute sessions are not available yet` : "Select 50 minute session"}
                      className={`grid min-h-[86px] place-items-center rounded-[14px] px-2 text-center transition ${
                        unavailable
                          ? "cursor-not-allowed bg-[#F7F7F8] text-[#BCC1CA] ring-1 ring-inset ring-[#ECEEF1]"
                          : selected
                            ? "bg-[#2F2F2F] text-white"
                            : "bg-[#F1F2F4] text-[#2F2F2F] hover:bg-[#E8EAED]"
                      }`}
                    >
                      <span className="flex flex-col items-center justify-center leading-none">
                        <span className="text-[16px] font-semibold">{minutes} min</span>
                        <span className={`mt-2 text-[11px] font-medium ${unavailable ? "text-[#C6CAD1]" : selected ? "text-white/70" : "text-[#8B93A3]"}`}>
                          {unavailable ? "Coming soon" : `${queueCounts[50] || 0} searching`}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-center text-[11px] font-medium text-[#65708A]">Only 50 minute sessions are available right now.</p>

              <button
                type="button"
                disabled={status === "creating" || status === "matched"}
                onClick={canCancel ? () => void stopSearching() : () => void startSearching()}
                className={`mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] px-5 py-3 text-[15px] font-bold transition disabled:cursor-wait disabled:opacity-70 ${isBusy ? "bg-[#F3F3F3] text-[#2F2F2F] hover:bg-[#E9E9E9]" : "bg-[#2F2F2F] text-white hover:bg-[#1F1F1F]"}`}
              >
                <Shuffle size={18} />
                {canCancel ? "Cancel matching" : status === "creating" || status === "matched" ? "Preparing room" : user ? "Match Me Now" : "Sign in to match"}
              </button>
              <button
                type="button"
                disabled={inviteBusy || status === "creating" || status === "matched"}
                onClick={startSoloWhileSearching}
                className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-[#F7F8FA] px-5 py-3 text-[14px] font-bold text-[#2F2F2F] transition hover:bg-[#ECEEF2] disabled:cursor-wait disabled:opacity-55"
              >
                {inviteBusy ? <Loader2 size={17} className="animate-spin" /> : <Shuffle size={17} />}
                {inviteBusy ? "Opening solo room…" : "Start Solo While We Search"}
              </button>
              <p className="mt-2 min-h-5 text-center text-[12px] text-[#6D7892]">{statusLabel}</p>

              <div className="my-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-[#9AA0AD]">
                <span className="h-px flex-1 bg-[#E1E3E8]" />or<span className="h-px flex-1 bg-[#E1E3E8]" />
              </div>
              <button
                type="button"
                disabled={inviteBusy || isBusy}
                onClick={() => void createInviteRoom()}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-[#F7F8FA] px-5 py-3 text-[14px] font-bold text-[#2F2F2F] transition hover:bg-[#ECEEF2] disabled:opacity-55"
              >
                <Link2 size={17} /> {inviteBusy ? "Creating private room…" : "Create private room link"}
              </button>

              {inviteLink ? (
                <div className="mt-3 rounded-[14px] bg-[#F7F8FA] p-3">
                  <p className="mb-2 text-[12px] text-[#667085]">Share this one-time link. The first person who opens it becomes your partner.</p>
                  <div className="flex gap-2">
                    <input readOnly value={inviteLink} className="min-w-0 flex-1 rounded-[10px] bg-white px-3 text-[12px] outline-none" />
                    <button type="button" onClick={() => void navigator.clipboard.writeText(inviteLink)} className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[#2F2F2F] text-white" aria-label="Copy private room link"><Copy size={16} /></button>
                  </div>
                  <button type="button" onClick={() => window.location.assign(inviteLink)} className="mt-2 w-full rounded-[10px] bg-[#EAF9EC] px-3 py-2 text-[13px] font-bold text-[#277D37]">Enter your room</button>
                </div>
              ) : null}
              {errorText ? <p className="mt-3 rounded-[12px] bg-[#FFF0F0] px-3 py-2 text-center text-[13px] text-[#B43D3D]">{errorText}</p> : null}
            </div>
          </div>

          <aside className="flex rounded-[28px] border border-[#DDD8D8] bg-white px-5 py-7 sm:px-7 sm:py-8">
            <div className="flex min-h-full w-full flex-col">
              <div className="text-center">
                <h2 className="text-[22px] font-extrabold tracking-[-0.025em] text-[#202124]">Schedule in advance</h2>
                <p className="mx-auto mt-2 max-w-[280px] text-[13px] leading-5 text-[#596889]">
                  Reserve a future 50 minute focus session for you and one partner.
                </p>
              </div>

              <div className="mt-5 rounded-[18px] bg-[#F6F7F9] p-3.5">
                <label className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-[#405077]">
                  <CalendarDays size={15} /> Date and time
                </label>
                <input
                  type="datetime-local"
                  value={scheduleDateTime}
                  min={toLocalDateTimeInput(new Date(Date.now() + 5 * 60_000))}
                  onChange={(event) => setScheduleDateTime(event.target.value)}
                  className="h-11 w-full rounded-[11px] bg-white px-3 text-[13px] text-[#2F2F2F] outline-none ring-1 ring-inset ring-[#E0E3E8] focus:ring-[#2F2F2F]"
                />
                <button
                  type="button"
                  onClick={() => void createScheduledSession()}
                  disabled={scheduleBusy}
                  className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-[11px] bg-[#2F2F2F] px-4 text-[13px] font-bold text-white transition hover:bg-[#1F1F1F] disabled:cursor-wait disabled:opacity-60"
                >
                  {scheduleBusy ? <Loader2 size={16} className="animate-spin" /> : <CalendarPlus size={16} />}
                  {scheduleBusy ? "Scheduling…" : "Create a 50 min slot"}
                </button>
              </div>

              <div className="mt-5 flex items-center justify-between">
                <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#7A8498]">Upcoming sessions</p>
                <span className="text-[11px] text-[#A0A6B1]">{scheduledSessions.length} available</span>
              </div>

              <div className="mt-2.5 space-y-2.5">
                {scheduledLoading ? (
                  <div className="flex min-h-24 items-center justify-center text-[#8A92A2]"><Loader2 size={18} className="animate-spin" /></div>
                ) : scheduledSessions.length ? scheduledSessions.slice(0, 5).map((session) => {
                  const alreadyBooked = Boolean(user && session.bookedUserIds.includes(user.id));
                  const isFull = session.bookedUserIds.length >= 2;
                  const isBooking = bookingBusyId === session.id;
                  return (
                    <div key={session.id} className="flex items-center gap-3 rounded-[15px] bg-[#F8F9FA] p-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[#E9EAED] text-[13px] font-extrabold text-[#555]">
                        {session.hostAvatarUrl ? <img src={session.hostAvatarUrl} alt="" className="h-full w-full object-cover" /> : session.hostName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-bold text-[#2F2F2F]">{session.hostName}</p>
                        <p className="mt-0.5 text-[11px] text-[#596889]">{formatScheduledDate(session.startTime)} · 50 min</p>
                        <p className="mt-0.5 text-[10px] text-[#8B93A3]">{session.bookedUserIds.length}/2 booked</p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1.5">
                        <button
                          type="button"
                          disabled={isBooking || cancellingBookingId === session.id || (isFull && !alreadyBooked)}
                          onClick={() => void bookScheduledSession(session)}
                          className={`min-w-[64px] rounded-[10px] px-3 py-2 text-[11px] font-bold transition ${alreadyBooked ? "bg-[#2F2F2F] text-white hover:bg-[#1F1F1F]" : isFull ? "cursor-not-allowed bg-[#ECEEF1] text-[#A4AAB5]" : "bg-white text-[#2F2F2F] ring-1 ring-inset ring-[#DADDE3] hover:bg-[#F0F1F3]"}`}
                        >
                          {isBooking ? "…" : alreadyBooked ? "Join" : isFull ? "Full" : "Book"}
                        </button>
                        {alreadyBooked ? (
                          <button
                            type="button"
                            disabled={cancellingBookingId === session.id}
                            onClick={() => void cancelScheduledSession(session)}
                            className="min-w-[64px] rounded-[9px] px-2 py-1.5 text-[10px] font-semibold text-[#8B4A4A] transition hover:bg-[#FCEEEE] disabled:cursor-wait disabled:opacity-55"
                          >
                            {cancellingBookingId === session.id ? "Cancelling…" : session.hostId === user?.id ? "Cancel slot" : "Cancel booking"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                }) : (
                  <div className="rounded-[15px] bg-[#F8F9FA] px-4 py-5 text-center">
                    <CalendarDays size={20} className="mx-auto text-[#8D96A7]" />
                    <p className="mt-2 text-[12px] font-semibold text-[#596889]">No scheduled 1:1 sessions yet.</p>
                    <p className="mt-1 text-[11px] text-[#9299A6]">Create the first available slot above.</p>
                  </div>
                )}
              </div>

              <div className="mt-auto pt-5">
                <div className="rounded-[16px] bg-[#EEF2FA] p-3.5">
                  <div className="flex items-start gap-3">
                    <Clock3 size={17} className="mt-0.5 shrink-0 text-[#405A94]" />
                    <p className="text-[11px] leading-5 text-[#596889]">Every scheduled room is limited to two booked people and uses the full MySession LiveKit experience.</p>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <div className="sticky bottom-0 z-30 mt-auto -mx-3 pt-5 sm:-mx-5">
          <div className="border-t border-[#E0E2E7] bg-white/95 px-5 py-4 shadow-[0_-8px_24px_rgba(31,35,48,0.04)] backdrop-blur-md">
          <div className="mb-4 flex items-center gap-4">
            <span className="h-px flex-1 bg-[#E1E3E8]" />
            <h2 className="text-[15px] font-semibold text-[#405077]">How it works</h2>
            <span className="h-px flex-1 bg-[#E1E3E8]" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [Clock3, "1. Choose duration", "Pick a time that fits your flow."],
              [UsersRound, "2. Join the queue", "We’ll find a focus partner."],
              [Shuffle, "3. Get matched", "Your private room is prepared."],
              [CheckCircle2, "4. Focus together", "Stay present and productive."],
            ].map(([Icon, title, copy]) => (
              <div key={String(title)} className="flex items-start gap-3 rounded-[14px] bg-[#F8F9FA] p-3.5">
                <Icon size={19} className="mt-0.5 shrink-0 text-[#2F2F2F]" />
                <div>
                  <p className="text-[13px] font-bold text-[#344261]">{String(title)}</p>
                  <p className="mt-1 text-[11px] leading-4 text-[#6D7892]">{String(copy)}</p>
                </div>
              </div>
            ))}
          </div>
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
