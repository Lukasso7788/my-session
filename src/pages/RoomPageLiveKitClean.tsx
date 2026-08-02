// src/pages/RoomPageLiveKitClean.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ConnectionState,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import {
  DisconnectButton,
  ParticipantTile,
  RoomAudioRenderer,
  RoomContext,
  StartAudio,
  useConnectionState,
  useTrackToggle,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";

import {
  Mic,
  MicOff,
  Sparkles,
  Video,
  VideoOff,
  X,
} from "lucide-react";

import { supabase } from "../lib/supabase";
import {
  createPersonColorBackgroundProcessor,
} from "./livekit/PersonColorCorrectionProcessor";

type SessionRow = {
  id: string;
  title: string | null;
  host_id: string | null;
};

type TokenResponse = {
  token?: string;
  url?: string;
  assignedServerId?: string | null;
  error?: string;
  message?: string;
};

type EffectMode = "off" | "blur" | "ocean" | "forest";
type MediaSource = Track.Source.Microphone | Track.Source.Camera;

const DEFAULT_CORRECTION = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 0,
};

function safeIdentity(value: string) {
  return (
    String(value || "guest")
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "")
      .slice(0, 120) || "guest"
  );
}

function makeTabId() {
  try {
    return crypto.randomUUID().slice(0, 12);
  } catch {
    return Math.random().toString(36).slice(2, 14);
  }
}

function svgBackground(colors: [string, string, string]) {
  const [a, b, c] = colors;

  return (
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${a}" />
            <stop offset="0.55" stop-color="${b}" />
            <stop offset="1" stop-color="${c}" />
          </linearGradient>
        </defs>
        <rect width="1280" height="720" fill="url(#g)" />
      </svg>
    `)
  );
}

const OCEAN_BG = svgBackground(["#0f172a", "#075985", "#0891b2"]);
const FOREST_BG = svgBackground(["#111827", "#14532d", "#4d7c0f"]);

function connectionLabel(state: ConnectionState) {
  if (state === ConnectionState.Connected) return "Connected";
  if (state === ConnectionState.Connecting) return "Connecting";
  if (state === ConnectionState.Reconnecting) return "Reconnecting";
  if (state === ConnectionState.Disconnected) return "Disconnected";
  return String(state || "Unknown");
}

function connectionBadgeClass(state: ConnectionState) {
  if (state === ConnectionState.Connected) {
    return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
  }

  if (
    state === ConnectionState.Connecting ||
    state === ConnectionState.Reconnecting
  ) {
    return "border-amber-400/20 bg-amber-400/10 text-amber-200";
  }

  return "border-red-400/20 bg-red-400/10 text-red-200";
}

function getTrackKey(trackRef: any, index: number) {
  const participantIdentity = String(
    trackRef?.participant?.identity || "participant",
  );

  const source = String(trackRef?.source || "camera");
  const publicationSid = String(
    trackRef?.publication?.trackSid ||
      trackRef?.publication?.sid ||
      "",
  );

  return `${participantIdentity}-${source}-${publicationSid || index}`;
}

function CleanVideoGrid() {
  const tracks = useTracks([
    {
      source: Track.Source.Camera,
      withPlaceholder: true,
    },
  ]);

  const gridClass = useMemo(() => {
    if (tracks.length <= 1) {
      return "grid-cols-1 place-items-center";
    }

    if (tracks.length === 2) {
      return "grid-cols-1 md:grid-cols-2";
    }

    if (tracks.length <= 4) {
      return "grid-cols-1 sm:grid-cols-2";
    }

    return "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";
  }, [tracks.length]);

  if (tracks.length === 0) {
    return (
      <div className="flex aspect-video w-full max-w-5xl items-center justify-center rounded-[20px] border border-white/10 bg-[#171717] px-4 text-center text-sm text-white/45 sm:rounded-[22px]">
        Waiting for participants…
      </div>
    );
  }

  return (
    <div
      className={`grid h-full min-h-0 w-full content-center gap-2.5 overflow-y-auto p-0.5 sm:gap-3 ${gridClass}`}
    >
      {tracks.map((trackRef, index) => (
        <div
          key={getTrackKey(trackRef, index)}
          className={[
            "aspect-video w-full min-w-0 overflow-hidden rounded-[18px] border border-white/10 bg-[#171717] shadow-[0_8px_28px_rgba(0,0,0,0.22)] sm:rounded-[22px]",
            tracks.length === 1
              ? "max-h-full max-w-[min(100%,calc((100dvh-170px)*16/9))]"
              : "",
          ].join(" ")}
        >
          <ParticipantTile
            trackRef={trackRef}
            className="!h-full !w-full !overflow-hidden !rounded-[inherit] !border-0 !bg-[#171717]"
            style={{
              width: "100%",
              height: "100%",
              aspectRatio: "16 / 9",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function MediaToggleButton({
  room,
  source,
}: {
  room: Room;
  source: MediaSource;
}) {
  const {
    buttonProps,
    enabled,
    pending,
  } = useTrackToggle({
    source,
    room,
  });

  const isMicrophone = source === Track.Source.Microphone;
  const label = isMicrophone
    ? enabled
      ? "Mute microphone"
      : "Unmute microphone"
    : enabled
      ? "Turn camera off"
      : "Turn camera on";

  return (
    <button
      {...buttonProps}
      type="button"
      aria-label={label}
      title={label}
      disabled={pending || buttonProps.disabled}
      className={[
        "inline-flex h-11 w-11 min-w-11 items-center justify-center rounded-[14px] border p-0 shadow-none transition",
        enabled
          ? "border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1]"
          : "border-red-400/20 bg-[#F65252] text-white hover:bg-[#E64545]",
        pending ? "cursor-wait opacity-60" : "",
      ].join(" ")}
    >
      {isMicrophone ? (
        enabled ? (
          <Mic className="h-5 w-5" aria-hidden="true" />
        ) : (
          <MicOff className="h-5 w-5" aria-hidden="true" />
        )
      ) : enabled ? (
        <Video className="h-5 w-5" aria-hidden="true" />
      ) : (
        <VideoOff className="h-5 w-5" aria-hidden="true" />
      )}
    </button>
  );
}

function CleanControls({
  room,
  effectMode,
  effectBusy,
  effectError,
  onApplyEffect,
}: {
  room: Room;
  effectMode: EffectMode;
  effectBusy: boolean;
  effectError: string;
  onApplyEffect: (mode: EffectMode) => Promise<void>;
}) {
  const state = useConnectionState(room);

  return (
    <footer className="shrink-0 border-t border-white/10 bg-[#141414]/95 px-2.5 py-2.5 backdrop-blur-xl sm:px-3 sm:py-3">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-center">
        <MediaToggleButton
          room={room}
          source={Track.Source.Microphone}
        />

        <MediaToggleButton
          room={room}
          source={Track.Source.Camera}
        />

        <div className="relative min-w-0 sm:w-auto">
          <select
            value={effectMode}
            onChange={(event) =>
              void onApplyEffect(event.target.value as EffectMode)
            }
            disabled={effectBusy}
            className="h-11 w-full min-w-0 appearance-none truncate rounded-[14px] border border-[#D6D6D6] bg-[#F5F5F5] pl-9 pr-8 text-[13px] font-semibold text-[#2F2F2F] outline-none transition hover:bg-white focus:border-[#A8A8A8] disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[190px] sm:text-sm"
            aria-label="Camera background effect"
            title="Camera background effect"
          >
            <option
              value="off"
              style={{
                color: "#2F2F2F",
                backgroundColor: "#FFFFFF",
              }}
            >
              Background off
            </option>

            <option
              value="blur"
              style={{
                color: "#2F2F2F",
                backgroundColor: "#FFFFFF",
              }}
            >
              Background blur
            </option>

            <option
              value="ocean"
              style={{
                color: "#2F2F2F",
                backgroundColor: "#FFFFFF",
              }}
            >
              Ocean background
            </option>

            <option
              value="forest"
              style={{
                color: "#2F2F2F",
                backgroundColor: "#FFFFFF",
              }}
            >
              Forest background
            </option>
          </select>

          <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#2F2F2F]/70" />

          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#2F2F2F]/60"
          >
            <path
              d="m6 8 4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        </div>

        <DisconnectButton
          stopTracks
          className="!inline-flex !h-11 !min-w-11 !items-center !justify-center !gap-2 !rounded-[14px] !border-0 !bg-[#F65252] !px-3 !text-sm !font-bold !text-white !shadow-none transition hover:!bg-[#E64545] sm:!px-4"
          aria-label="Leave room"
          title="Leave room"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Leave</span>
        </DisconnectButton>

        <div
          className={`col-span-4 justify-self-center rounded-full border px-3 py-1.5 text-xs font-medium sm:col-auto ${connectionBadgeClass(
            state,
          )}`}
        >
          {connectionLabel(state)}
        </div>
      </div>

      {effectError ? (
        <div className="mx-auto mt-2 max-w-3xl px-2 text-center text-xs text-red-300">
          {effectError}
        </div>
      ) : null}
    </footer>
  );
}

function ConnectedRoom({
  room,
  title,
  navigateBack,
}: {
  room: Room;
  title: string;
  navigateBack: () => void;
}) {
  const [effectMode, setEffectMode] = useState<EffectMode>("off");
  const [effectBusy, setEffectBusy] = useState(false);
  const [effectError, setEffectError] = useState("");
  const activeProcessorTrackRef = useRef<LocalVideoTrack | null>(null);

  useEffect(() => {
    const onDisconnected = () => {
      navigateBack();
    };

    room.on(RoomEvent.Disconnected, onDisconnected);

    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [navigateBack, room]);

  const getLocalCameraTrack = useCallback(() => {
    const publication = Array.from(
      room.localParticipant.videoTrackPublications.values(),
    ).find((item) => item.source === Track.Source.Camera);

    return publication?.track instanceof LocalVideoTrack
      ? publication.track
      : null;
  }, [room]);

  const applyEffect = useCallback(
    async (mode: EffectMode) => {
      setEffectBusy(true);
      setEffectError("");

      try {
        const cameraTrack = getLocalCameraTrack();

        if (!cameraTrack) {
          throw new Error("Turn on your camera before applying an effect.");
        }

        if (
          activeProcessorTrackRef.current &&
          activeProcessorTrackRef.current !== cameraTrack
        ) {
          try {
            await activeProcessorTrackRef.current.stopProcessor(true);
          } catch {
            // Best-effort cleanup of an old camera track.
          }
        }

        if (mode === "off") {
          await cameraTrack.stopProcessor(true);
          activeProcessorTrackRef.current = null;
          setEffectMode("off");
          return;
        }

        const processor = createPersonColorBackgroundProcessor({
          mode:
            mode === "blur"
              ? {
                  mode: "background-blur",
                  blurRadius: 16,
                }
              : {
                  mode: "virtual-background",
                  imagePath: mode === "forest" ? FOREST_BG : OCEAN_BG,
                },
          correction: DEFAULT_CORRECTION,
        });

        await cameraTrack.setProcessor(processor, true);
        activeProcessorTrackRef.current = cameraTrack;
        setEffectMode(mode);
      } catch (effectApplyError) {
        const message =
          effectApplyError instanceof Error
            ? effectApplyError.message
            : "This background effect is not supported on this device.";

        setEffectError(message);
        setEffectMode("off");
      } finally {
        setEffectBusy(false);
      }
    },
    [getLocalCameraTrack],
  );

  useEffect(() => {
    return () => {
      const track = activeProcessorTrackRef.current;
      activeProcessorTrackRef.current = null;

      if (track) {
        void track.stopProcessor(true).catch(() => {});
      }
    };
  }, []);

  return (
    <RoomContext.Provider value={room}>
      <div
        data-lk-theme="default"
        className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#101010] text-white"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#141414] px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold text-white sm:text-sm">
              {title}
            </div>

            <div className="mt-0.5 truncate text-[11px] text-white/45 sm:text-xs">
              Clean LiveKit video room
            </div>
          </div>

          <div className="hidden shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/55 sm:block">
            Video + audio only
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden p-2 sm:p-4">
          <div className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-[20px] border border-white/10 bg-[#151515] p-1.5 sm:rounded-[26px] sm:p-3">
            <CleanVideoGrid />
          </div>
        </main>

        <RoomAudioRenderer />
        <StartAudio label="Enable room audio" />

        <CleanControls
          room={room}
          effectMode={effectMode}
          effectBusy={effectBusy}
          effectError={effectError}
          onApplyEffect={applyEffect}
        />
      </div>
    </RoomContext.Provider>
  );
}

export default function RoomPageLiveKitClean() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [room] = useState(
    () =>
      new Room({
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: false,
        videoCaptureDefaults: {
          resolution: {
            width: 1280,
            height: 720,
            frameRate: 24,
          },
        },
        publishDefaults: {
          simulcast: true,
          videoCodec: "vp8",
          red: true,
          dtx: true,
        },
      }),
  );

  const [session, setSession] = useState<SessionRow | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");

  const tabIdRef = useRef(makeTabId());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      // The clean room does not disconnect merely because the tab becomes hidden.
      // This cleanup runs only when this React page is actually unmounted.
      void room.disconnect(true);
    };
  }, [room]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const sessionId = String(id || "").trim();

        if (!sessionId) {
          throw new Error("Missing session id.");
        }

        const [
          { data: sessionRow, error: sessionError },
          authResult,
        ] = await Promise.all([
          supabase
            .from("sessions")
            .select("id,title,host_id")
            .eq("id", sessionId)
            .single(),
          supabase.auth.getSession(),
        ]);

        if (sessionError || !sessionRow?.id) {
          throw new Error("Session not found.");
        }

        const user = authResult.data.session?.user ?? null;

        let nextName =
          String(user?.user_metadata?.full_name || "").trim() ||
          String(user?.email || "").split("@")[0] ||
          "Guest";

        if (user?.id) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", user.id)
            .maybeSingle();

          nextName =
            String(profile?.full_name || nextName).trim() ||
            "User";
        }

        if (!cancelled) {
          setSession(sessionRow as SessionRow);
          setDisplayName(nextName);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load the room.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const join = useCallback(async () => {
    if (!session || joining || joined) return;

    setJoining(true);
    setError("");

    try {
      const { data: authData } = await supabase.auth.getSession();

      const authSession = authData.session;
      const userId = String(authSession?.user?.id || "").trim();
      const accessToken = String(
        authSession?.access_token || "",
      ).trim();

      const baseUserId = safeIdentity(
        userId || displayName || "guest",
      );

      const identity = safeIdentity(
        `${baseUserId}--clean-${tabIdRef.current}`,
      );

      const roomName = safeIdentity(
        `session-${session.id}`,
      );

      const tokenEndpoint = String(
        import.meta.env.VITE_LIVEKIT_TOKEN_ENDPOINT ||
          "/api/livekit/token",
      ).trim();

      const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken
            ? {
                Authorization: `Bearer ${accessToken}`,
              }
            : {}),
        },
        body: JSON.stringify({
          roomName,
          identity,
          name: displayName.trim() || "Guest",
          isHost: Boolean(
            userId && session.host_id === userId,
          ),
          sessionId: session.id,
          isModerator: false,
          baseUserId,
          tabId: tabIdRef.current,
        }),
      });

      const payload =
        (await response
          .json()
          .catch(() => ({}))) as TokenResponse;

      if (
        !response.ok ||
        !payload.token ||
        !payload.url
      ) {
        throw new Error(
          payload.message ||
            payload.error ||
            "The LiveKit token endpoint did not return a token and server URL.",
        );
      }

      await room.connect(
        payload.url,
        payload.token,
        {
          autoSubscribe: true,
          maxRetries: 3,
        },
      );

      await Promise.allSettled([
        room.localParticipant.setMicrophoneEnabled(true),
        room.localParticipant.setCameraEnabled(true, {
          resolution: {
            width: 1280,
            height: 720,
            frameRate: 24,
          },
        }),
      ]);

      if (mountedRef.current) {
        setJoined(true);
      }
    } catch (joinError) {
      try {
        await room.disconnect();
      } catch {
        // Best-effort cleanup after a failed initial join.
      }

      if (mountedRef.current) {
        setError(
          joinError instanceof Error
            ? joinError.message
            : "Could not join the room.",
        );

        setJoined(false);
      }
    } finally {
      if (mountedRef.current) {
        setJoining(false);
      }
    }
  }, [
    displayName,
    joined,
    joining,
    room,
    session,
  ]);

  const navigateBack = useCallback(() => {
    navigate("/sessions");
  }, [navigate]);

  if (joined && session) {
    return (
      <ConnectedRoom
        room={room}
        title={session.title || "MySession room"}
        navigateBack={navigateBack}
      />
    );
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#101010] px-3 py-6 text-white sm:px-4 sm:py-8">
      <div className="w-full max-w-md rounded-[22px] border border-white/10 bg-[#181818] p-4 shadow-2xl sm:rounded-[28px] sm:p-6">
        <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-white/55">
          Clean LiveKit room
        </div>

        <h1 className="mt-4 text-xl font-bold tracking-tight sm:text-2xl">
          {loading
            ? "Loading room…"
            : session?.title || "Video room"}
        </h1>

        <p className="mt-2 text-sm leading-6 text-white/55">
          This version contains only LiveKit video, audio,
          device controls and optional camera effects. It has
          no chat, tasks, attendance heartbeat, Supabase
          presence or custom reconnect logic.
        </p>

        <label className="mt-5 block">
          <span className="mb-2 block text-xs font-semibold text-white/65">
            Display name
          </span>

          <input
            value={displayName}
            onChange={(event) =>
              setDisplayName(event.target.value)
            }
            disabled={loading || joining}
            className="h-12 w-full rounded-[14px] border border-white/10 bg-white/[0.05] px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25 sm:rounded-[16px]"
            placeholder="Your name"
          />
        </label>

        {error ? (
          <div className="mt-4 rounded-[14px] border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200 sm:rounded-[16px]">
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void join()}
          disabled={
            loading ||
            joining ||
            !session ||
            !displayName.trim()
          }
          className="mt-5 h-12 w-full rounded-[14px] bg-[#2F2F2F] text-sm font-bold text-white transition hover:bg-[#3A3A3A] disabled:cursor-not-allowed disabled:opacity-50 sm:rounded-[16px]"
        >
          {joining ? "Joining…" : "Join clean room"}
        </button>

        <button
          type="button"
          onClick={() => navigate("/sessions")}
          className="mt-3 h-11 w-full rounded-[14px] border border-white/10 bg-transparent text-sm font-semibold text-white/65 transition hover:bg-white/[0.05] sm:rounded-[16px]"
        >
          Back to sessions
        </button>
      </div>
    </div>
  );
}
