// src/pages/RoomPageLiveKitClean.tsx

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ConnectionState,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import {
  CarouselLayout,
  Chat,
  DisconnectButton,
  GridLayout,
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
  PictureInPicture,
  Sparkles,
  Video,
  VideoOff,
  X,
} from "lucide-react";

import { supabase } from "../lib/supabase";
import {
  createPersonColorBackgroundProcessor,
} from "./livekit/PersonColorCorrectionProcessor";


type PiPVideoElement = HTMLVideoElement & {
  disablePictureInPicture?: boolean;
  requestPictureInPicture?: () => Promise<unknown>;
  webkitSupportsPresentationMode?: (mode: "picture-in-picture") => boolean;
  webkitSetPresentationMode?: (mode: "picture-in-picture") => void;
  webkitPresentationMode?: string;
  autoPictureInPicture?: boolean;
  requestVideoFrameCallback?: (
    callback: (now: DOMHighResTimeStamp, metadata: unknown) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

type PiPDocument = Document & {
  pictureInPictureEnabled?: boolean;
  pictureInPictureElement?: Element | null;
};

type ExtendedMediaSession = {
  setActionHandler?: (
    action: string,
    handler: (() => void | Promise<void>) | null,
  ) => void;
};

type CanvasCaptureTrack = MediaStreamTrack & {
  requestFrame?: () => void;
};

type CaptureStreamCanvas = HTMLCanvasElement & {
  captureStream?: (frameRate?: number) => MediaStream;
};

const PIP_CANVAS_WIDTH = 960;
const PIP_CANVAS_HEIGHT = 540;
const PIP_COLLAGE_FPS = 8;
const PIP_SNAPSHOT_REFRESH_MS = 500;

type CachedVideoFrame = {
  canvas: HTMLCanvasElement;
  updatedAt: number;
};

const pipVideoFrameCache = new WeakMap<HTMLVideoElement, CachedVideoFrame>();

function getRoomVideoElements(): PiPVideoElement[] {
  return Array.from(
    document.querySelectorAll<HTMLVideoElement>(
      ".clean-livekit-tile video, .clean-livekit-tile .lk-participant-media-video",
    ),
  ) as PiPVideoElement[];
}

function isVideoCurrentlyRenderable(video: HTMLVideoElement): boolean {
  const stream = video.srcObject;

  return (
    !video.ended &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0 &&
    stream instanceof MediaStream &&
    stream.getVideoTracks().some((track) => track.readyState === "live")
  );
}

function getRenderableRoomVideos(): PiPVideoElement[] {
  return getRoomVideoElements().filter(isVideoCurrentlyRenderable);
}

function updateCachedVideoFrame(video: HTMLVideoElement): void {
  if (!isVideoCurrentlyRenderable(video)) return;

  let cached = pipVideoFrameCache.get(video);
  if (!cached) {
    cached = {
      canvas: document.createElement("canvas"),
      updatedAt: 0,
    };
    pipVideoFrameCache.set(video, cached);
  }

  if (
    cached.canvas.width !== video.videoWidth ||
    cached.canvas.height !== video.videoHeight
  ) {
    cached.canvas.width = video.videoWidth;
    cached.canvas.height = video.videoHeight;
  }

  const context = cached.canvas.getContext("2d", { alpha: false });
  if (!context) return;

  try {
    context.drawImage(video, 0, 0, cached.canvas.width, cached.canvas.height);
    cached.updatedAt = Date.now();
  } catch {
    // Keep the previous valid cached frame.
  }
}

function getCachedVideoFrame(
  video: HTMLVideoElement,
): HTMLCanvasElement | null {
  return pipVideoFrameCache.get(video)?.canvas ?? null;
}

function isTabletOrMobileRuntime(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const touchPoints = navigator.maxTouchPoints || 0;
  const shortSide = Math.min(window.screen.width, window.screen.height);

  return (
    /android|iphone|ipad|ipod|mobile|tablet/.test(userAgent) ||
    (touchPoints > 1 && shortSide >= 600)
  );
}

function drawContainedSource(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (sourceWidth <= 0 || sourceHeight <= 0) return;

  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;

  context.drawImage(source, drawX, drawY, drawWidth, drawHeight);
}

function drawPiPCollage(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return;

  if (canvas.width !== PIP_CANVAS_WIDTH) canvas.width = PIP_CANVAS_WIDTH;
  if (canvas.height !== PIP_CANVAS_HEIGHT) canvas.height = PIP_CANVAS_HEIGHT;

  context.fillStyle = "#0d0d0d";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const videos = getRoomVideoElements();
  if (videos.length === 0) {
    context.fillStyle = "rgba(255,255,255,0.72)";
    context.font = "600 30px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      "Waiting for participant video…",
      canvas.width / 2,
      canvas.height / 2,
    );
    return;
  }

  const count = videos.length;
  const columns = Math.ceil(Math.sqrt(count * (16 / 9)));
  const rows = Math.ceil(count / columns);
  const gap = 8;
  const cellWidth = (canvas.width - gap * (columns + 1)) / columns;
  const cellHeight = (canvas.height - gap * (rows + 1)) / rows;

  videos.forEach((video, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = gap + column * (cellWidth + gap);
    const y = gap + row * (cellHeight + gap);

    context.fillStyle = "#171717";
    context.fillRect(x, y, cellWidth, cellHeight);

    if (isVideoCurrentlyRenderable(video)) {
      updateCachedVideoFrame(video);

      try {
        drawContainedSource(
          context,
          video,
          video.videoWidth,
          video.videoHeight,
          x,
          y,
          cellWidth,
          cellHeight,
        );
      } catch {
        // Fall through to the cached frame below.
        const cached = getCachedVideoFrame(video);
        if (cached) {
          drawContainedSource(
            context,
            cached,
            cached.width,
            cached.height,
            x,
            y,
            cellWidth,
            cellHeight,
          );
        }
      }
    } else {
      const cached = getCachedVideoFrame(video);

      if (cached) {
        drawContainedSource(
          context,
          cached,
          cached.width,
          cached.height,
          x,
          y,
          cellWidth,
          cellHeight,
        );
      } else {
        context.fillStyle = "rgba(255,255,255,0.5)";
        context.font = "500 22px system-ui, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("Video paused", x + cellWidth / 2, y + cellHeight / 2);
      }
    }

    context.strokeStyle = "rgba(255,255,255,0.16)";
    context.lineWidth = 2;
    context.strokeRect(x, y, cellWidth, cellHeight);
  });
}

async function waitForDecodedPiPFrame(
  video: PiPVideoElement,
  timeoutMs = 1800,
): Promise<boolean> {
  if (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  ) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let frameCallbackHandle: number | null = null;

    const finish = (ready: boolean): void => {
      if (settled) return;
      settled = true;

      window.clearTimeout(timeoutId);
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("resize", handleResize);

      if (
        frameCallbackHandle !== null &&
        typeof video.cancelVideoFrameCallback === "function"
      ) {
        video.cancelVideoFrameCallback(frameCallbackHandle);
      }

      resolve(ready);
    };

    const checkReady = (): void => {
      finish(
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0 &&
          video.videoHeight > 0,
      );
    };

    const handleLoadedData = (): void => checkReady();
    const handlePlaying = (): void => checkReady();
    const handleResize = (): void => checkReady();

    const timeoutId = window.setTimeout(() => finish(false), timeoutMs);

    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("resize", handleResize);

    if (typeof video.requestVideoFrameCallback === "function") {
      frameCallbackHandle = video.requestVideoFrameCallback(() => {
        checkReady();
      });
    }

    checkReady();
  });
}

function isPiPStageReady(video: PiPVideoElement | null): boolean {
  if (!video) return false;

  const stream = video.srcObject;
  const track =
    stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;

  return (
    video.dataset.pipReady === "true" &&
    !video.paused &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0 &&
    track?.readyState === "live" &&
    track.muted === false
  );
}

async function enterPictureInPicture(
  video: PiPVideoElement | null,
  options: { skipPlay?: boolean; requireReady?: boolean } = {},
): Promise<boolean> {
  if (!video) return false;

  video.disablePictureInPicture = false;
  video.autoPictureInPicture = true;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("autoplay", "");
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("autopictureinpicture", "");
  video.removeAttribute("disablepictureinpicture");

  try {
    if (options.requireReady && !isPiPStageReady(video)) {
      return false;
    }

    if (!options.skipPlay) {
      await video.play();
    } else if (video.paused) {
      return false;
    }

    const pipDocument = document as PiPDocument;
    if (
      pipDocument.pictureInPictureEnabled === true &&
      !pipDocument.pictureInPictureElement &&
      typeof video.requestPictureInPicture === "function"
    ) {
      await video.requestPictureInPicture();
      return true;
    }

    if (
      video.webkitSupportsPresentationMode?.("picture-in-picture") &&
      video.webkitSetPresentationMode
    ) {
      video.webkitSetPresentationMode("picture-in-picture");
      return true;
    }
  } catch (error) {
    console.warn("[clean-room-pip] Unable to enter PiP", error);
  }

  return false;
}

function usePiPCollage(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  stageRef: React.RefObject<PiPVideoElement | null>,
): () => Promise<PiPVideoElement | null> {
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const snapshotIntervalRef = useRef<number | null>(null);

  const pushCollageFrame = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    drawPiPCollage(canvas);

    const captureTrack = streamRef.current?.getVideoTracks()[0] as
      | CanvasCaptureTrack
      | undefined;
    captureTrack?.requestFrame?.();
  }, [canvasRef]);

  const ensureCollageStream = useCallback(async (): Promise<PiPVideoElement | null> => {
    const canvas = canvasRef.current as CaptureStreamCanvas | null;
    const stage = stageRef.current;

    if (!canvas || !stage || typeof canvas.captureStream !== "function") {
      return null;
    }

    // Paint an actual frame before captureStream is created. Mobile browsers
    // otherwise sometimes expose a live track whose first PiP frame is blank.
    pushCollageFrame();

    const existingTrack = streamRef.current?.getVideoTracks()[0];
    if (!existingTrack || existingTrack.readyState !== "live") {
      streamRef.current?.getTracks().forEach((track) => track.stop());

      // 0 FPS lets us explicitly push frames with requestFrame where supported.
      // Browsers that ignore requestFrame still receive the visible render loop.
      stage.dataset.pipReady = "false";
      streamRef.current = canvas.captureStream(PIP_COLLAGE_FPS);
      stage.srcObject = streamRef.current;
    }

    stage.disablePictureInPicture = false;
    stage.autoPictureInPicture = true;
    stage.autoplay = true;
    stage.muted = true;
    stage.playsInline = true;
    stage.setAttribute("autoplay", "");
    stage.setAttribute("muted", "");
    stage.setAttribute("playsinline", "");
    stage.setAttribute("autopictureinpicture", "");
    stage.removeAttribute("disablepictureinpicture");

    stage.dataset.pipReady = "false";
    pushCollageFrame();
    await stage.play().catch(() => undefined);

    // Confirm that the stage has produced an actual decoded video frame. A live
    // captureStream track alone is not sufficient on mobile Chrome and can still
    // produce an empty white PiP surface.
    const decoded = await waitForDecodedPiPFrame(stage);
    pushCollageFrame();

    if (decoded) {
      stage.dataset.pipReady = "true";

      try {
        // Poster is a non-white fallback if Android briefly stalls the stream
        // while moving the already-playing video into PiP.
        stage.poster = canvas.toDataURL("image/jpeg", 0.82);
      } catch {
        // Ignore poster generation failures.
      }
    }

    return decoded ? stage : null;
  }, [canvasRef, pushCollageFrame, stageRef]);

  useEffect(() => {
    let cancelled = false;

    void ensureCollageStream().then(() => {
      if (cancelled) return;
      pushCollageFrame();
    });

    const animate = (): void => {
      pushCollageFrame();
      animationFrameRef.current = window.requestAnimationFrame(animate);
    };

    animationFrameRef.current = window.requestAnimationFrame(animate);

    // Fallback for browsers that heavily reduce requestAnimationFrame frequency.
    intervalRef.current = window.setInterval(
      pushCollageFrame,
      Math.max(125, Math.round(1000 / PIP_COLLAGE_FPS)),
    );

    snapshotIntervalRef.current = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      getRoomVideoElements().forEach(updateCachedVideoFrame);
    }, PIP_SNAPSHOT_REFRESH_MS);

    const handleVisibilityChange = (): void => {
      // Push one final complete frame synchronously before the browser freezes
      // canvas timers in the background.
      pushCollageFrame();

      const stage = stageRef.current;
      if (stage) void stage.play().catch(() => undefined);

      if (document.visibilityState === "visible") {
        getRenderableRoomVideos().forEach((video) => {
          void video.play().catch(() => undefined);
        });
      }
    };

    const handlePageFreeze = (): void => {
      pushCollageFrame();
      const stage = stageRef.current;
      if (stage) void stage.play().catch(() => undefined);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageFreeze);
    document.addEventListener("freeze", handlePageFreeze as EventListener);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageFreeze);
      document.removeEventListener("freeze", handlePageFreeze as EventListener);

      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
      }
      if (snapshotIntervalRef.current !== null) {
        window.clearInterval(snapshotIntervalRef.current);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (stageRef.current) {
        stageRef.current.dataset.pipReady = "false";
        stageRef.current.srcObject = null;
      }
    };
  }, [ensureCollageStream, pushCollageFrame, stageRef]);

  return ensureCollageStream;
}

function useBrowserInitiatedPictureInPicture(
  preparePreferredVideo: () => Promise<PiPVideoElement | null>,
  stageRef: React.RefObject<PiPVideoElement | null>,
): void {
  useEffect(() => {
    if (!isTabletOrMobileRuntime()) return;

    const mediaSession = navigator.mediaSession as unknown as
      | ExtendedMediaSession
      | undefined;

    let preparedStage: PiPVideoElement | null = null;
    let autoPiPRequested = false;

    const prewarm = async (): Promise<void> => {
      const stage = await preparePreferredVideo();
      if (stage && isPiPStageReady(stage)) {
        preparedStage = stage;
      }
    };

    void prewarm();

    const requestBrowserPiP = async (): Promise<void> => {
      if (!isTabletOrMobileRuntime()) return;

      const stage =
        preparedStage ??
        (isPiPStageReady(stageRef.current) ? stageRef.current : null) ??
        (await preparePreferredVideo());

      if (!isPiPStageReady(stage)) return;

      preparedStage = stage;
      await enterPictureInPicture(stage, { requireReady: true });
    };

    try {
      if (navigator.mediaSession) {
        navigator.mediaSession.playbackState = "playing";
      }

      mediaSession?.setActionHandler?.(
        "enterpictureinpicture",
        requestBrowserPiP,
      );
    } catch (error) {
      console.debug(
        "[clean-room-pip] Browser auto-PiP handler unavailable",
        error,
      );
    }

    const handleVisibilityChange = (): void => {
      if (
        document.visibilityState !== "hidden" ||
        autoPiPRequested ||
        !isTabletOrMobileRuntime()
      ) {
        return;
      }

      const stage =
        preparedStage ??
        (isPiPStageReady(stageRef.current) ? stageRef.current : null);

      // Never open an undecoded stream. It is better to skip one automatic
      // attempt than to leave the user with Chrome's blank white PiP surface.
      if (!stage || !isPiPStageReady(stage)) return;

      autoPiPRequested = true;

      // The stage was fully prepared while foregrounded. Do not call play(),
      // replace srcObject or redraw the canvas after the document is hidden.
      void enterPictureInPicture(stage, {
        skipPlay: true,
        requireReady: true,
      });
    };

    const resetAutoAttempt = (): void => {
      if (document.visibilityState === "visible") {
        autoPiPRequested = false;
        void prewarm();
      }
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
      { capture: true },
    );
    window.addEventListener("pageshow", resetAutoAttempt);

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
        { capture: true },
      );
      window.removeEventListener("pageshow", resetAutoAttempt);

      try {
        if (navigator.mediaSession) {
          navigator.mediaSession.playbackState = "none";
        }
        mediaSession?.setActionHandler?.("enterpictureinpicture", null);
      } catch {
        // Ignore unsupported cleanup.
      }
    };
  }, [preparePreferredVideo, stageRef]);
}

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

const TABLET_LAYOUT_QUERY = "(max-width: 1180px)";

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

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia(query);

    const update = () => {
      setMatches(media.matches);
    };

    update();
    media.addEventListener("change", update);

    return () => {
      media.removeEventListener("change", update);
    };
  }, [query]);

  return matches;
}

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

function ChatIcon({
  className = "h-5 w-5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M7.5 18.5 3.5 21l1.15-4.62A8.5 8.5 0 1 1 7.5 18.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 10.5h8M8 14h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CleanVideoLayout() {
  const isTabletOrMobile = useMediaQuery(TABLET_LAYOUT_QUERY);

  const tracks = useTracks([
    {
      source: Track.Source.Camera,
      withPlaceholder: true,
    },
  ]);

  if (tracks.length === 0) {
    return (
      <div className="flex aspect-video w-full max-w-5xl items-center justify-center rounded-[20px] border border-white/10 bg-[#171717] px-4 text-center text-sm text-white/45 sm:rounded-[22px]">
        Waiting for participants…
      </div>
    );
  }

  if (isTabletOrMobile) {
    return (
      <CarouselLayout
        tracks={tracks}
        orientation="vertical"
        className="clean-livekit-carousel h-full min-h-0 w-full"
      >
        <ParticipantTile className="clean-livekit-tile" />
      </CarouselLayout>
    );
  }

  return (
    <GridLayout
      tracks={tracks}
      className="clean-livekit-grid h-full min-h-0 w-full"
    >
      <ParticipantTile className="clean-livekit-tile" />
    </GridLayout>
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
  chatOpen,
  pipBusy,
  pipActive,
  onToggleChat,
  onEnablePiP,
  onApplyEffect,
}: {
  room: Room;
  effectMode: EffectMode;
  effectBusy: boolean;
  effectError: string;
  chatOpen: boolean;
  pipBusy: boolean;
  pipActive: boolean;
  onToggleChat: () => void;
  onEnablePiP: () => Promise<void>;
  onApplyEffect: (mode: EffectMode) => Promise<void>;
}) {
  const state = useConnectionState(room);

  return (
    <footer className="shrink-0 border-t border-white/10 bg-[#141414]/95 px-2.5 py-2.5 backdrop-blur-xl sm:px-3 sm:py-3">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-center">
        <MediaToggleButton
          room={room}
          source={Track.Source.Microphone}
        />

        <MediaToggleButton
          room={room}
          source={Track.Source.Camera}
        />

        <button
          type="button"
          onClick={onToggleChat}
          aria-label={chatOpen ? "Close chat" : "Open chat"}
          title={chatOpen ? "Close chat" : "Open chat"}
          aria-pressed={chatOpen}
          className={[
            "inline-flex h-11 w-11 min-w-11 items-center justify-center rounded-[14px] border p-0 shadow-none transition",
            chatOpen
              ? "border-[#81DB86]/35 bg-[#81DB86]/15 text-[#B7F2BA]"
              : "border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1]",
          ].join(" ")}
        >
          <ChatIcon />
        </button>

        <button
          type="button"
          onClick={() => void onEnablePiP()}
          disabled={pipBusy}
          aria-label="Open Picture-in-Picture"
          title="Open Picture-in-Picture before switching apps"
          className={[
            "inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-[14px] border px-3 text-xs font-bold shadow-none transition",
            pipActive
              ? "border-[#81DB86]/35 bg-[#81DB86]/15 text-[#B7F2BA]"
              : "border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1]",
            pipBusy ? "cursor-wait opacity-60" : "",
          ].join(" ")}
        >
          <PictureInPicture className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">
            {pipBusy ? "Opening…" : pipActive ? "PiP active" : "Open PiP"}
          </span>
        </button>

        <div className="relative min-w-0 sm:w-auto">
          <select
            value={effectMode}
            onChange={(event) =>
              void onApplyEffect(event.target.value as EffectMode)
            }
            disabled={effectBusy}
            className="h-11 w-11 appearance-none rounded-[14px] border border-[#D6D6D6] bg-[#F5F5F5] text-transparent outline-none transition hover:bg-white focus:border-[#A8A8A8] disabled:cursor-not-allowed disabled:opacity-50"
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

          <Sparkles className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-[#2F2F2F]/75" />
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
          className={`col-span-5 justify-self-center rounded-full border px-3 py-1.5 text-xs font-medium sm:col-auto ${connectionBadgeClass(
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

function NativeLiveKitChat({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <aside className="clean-chat-panel absolute inset-2 z-40 flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-white/10 bg-[#181818] shadow-[0_24px_70px_rgba(0,0,0,0.55)] sm:inset-y-3 sm:left-auto sm:right-3 sm:w-[360px] sm:rounded-[22px] lg:static lg:h-full lg:w-[360px] lg:shrink-0">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-3.5">
        <div>
          <div className="text-sm font-bold text-white">
            Room chat
          </div>

          <div className="text-[10px] text-white/40">
            LiveKit realtime chat
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/10 bg-white/[0.05] text-white/75 transition hover:bg-white/[0.1] hover:text-white"
          aria-label="Close chat"
          title="Close chat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <Chat />
      </div>
    </aside>
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
  const [chatOpen, setChatOpen] = useState(false);
  const [pipBusy, setPiPBusy] = useState(false);
  const [pipActive, setPiPActive] = useState(false);
  const [pipMessage, setPiPMessage] = useState(
    "On phones and tablets, open Picture-in-Picture before switching apps. Desktop auto-PiP is disabled.",
  );

  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipStageRef = useRef<PiPVideoElement | null>(null);
  const preparePiPCollage = usePiPCollage(pipCanvasRef, pipStageRef);

  useBrowserInitiatedPictureInPicture(preparePiPCollage, pipStageRef);

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

  useEffect(() => {
    const stage = pipStageRef.current;
    if (!stage) return;

    const handleEnter = (): void => {
      setPiPActive(true);
      setPiPMessage(
        "Picture-in-Picture is active. It shows a live collage of everyone in the room.",
      );
    };

    const handleLeave = (): void => {
      setPiPActive(false);
      setPiPMessage(
        "On phones and tablets, open Picture-in-Picture before switching apps. Desktop auto-PiP is disabled.",
      );
    };

    const handleWebKitModeChange = (): void => {
      const active = stage.webkitPresentationMode === "picture-in-picture";
      setPiPActive(active);
      setPiPMessage(
        active
          ? "Picture-in-Picture is active. It shows a live collage of everyone in the room."
          : "On phones and tablets, open Picture-in-Picture before switching apps. Desktop auto-PiP is disabled.",
      );
    };

    stage.addEventListener("enterpictureinpicture", handleEnter);
    stage.addEventListener("leavepictureinpicture", handleLeave);
    stage.addEventListener("webkitpresentationmodechanged", handleWebKitModeChange);

    return () => {
      stage.removeEventListener("enterpictureinpicture", handleEnter);
      stage.removeEventListener("leavepictureinpicture", handleLeave);
      stage.removeEventListener("webkitpresentationmodechanged", handleWebKitModeChange);
    };
  }, []);

  const enablePiP = useCallback(async (): Promise<void> => {
    setPiPBusy(true);
    setPiPMessage("");

    try {
      const stage = await preparePiPCollage();
      if (!stage) {
        setPiPMessage(
          "Picture-in-Picture is unavailable because this browser cannot create the room collage stream.",
        );
        return;
      }

      const opened = await enterPictureInPicture(stage, { requireReady: true });
      if (opened) {
        setPiPActive(true);
        setPiPMessage(
          "Picture-in-Picture is active. It shows a live collage of everyone in the room.",
        );
      } else {
        setPiPMessage(
          "Automatic PiP was blocked. Tap Open PiP before switching to another app.",
        );
      }
    } finally {
      setPiPBusy(false);
    }
  }, [preparePiPCollage]);

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
      <style>{`
        /*
          Every participant remains inside the same 16:9 MySession frame.

          Landscape desktop/webcam feeds naturally fill the frame.

          Portrait phone/iPad feeds use object-fit: contain, so the entire
          vertical video remains visible with side letterboxing instead of
          being cropped or stretched.
        */
        .clean-livekit-tile {
          width: 100% !important;
          aspect-ratio: 16 / 9 !important;
          overflow: hidden !important;
          border-radius: 18px !important;
          border: 1px solid rgba(255,255,255,0.10) !important;
          background: #0d0d0d !important;
          box-shadow: 0 8px 28px rgba(0,0,0,0.22) !important;
        }

        .clean-livekit-tile video,
        .clean-livekit-tile .lk-participant-media-video,
        .clean-livekit-tile .lk-video-track {
          width: 100% !important;
          height: 100% !important;
          object-fit: contain !important;
          background: #0d0d0d !important;
        }

        /*
          Desktop uses LiveKit GridLayout.
        */
        .clean-livekit-grid {
          gap: 12px !important;
          padding: 2px !important;
          align-content: center !important;
        }

        /*
          Mobile and tablets use LiveKit CarouselLayout in vertical mode.
          Each item is still a 16:9 frame; portrait source video is contained.
        */
        .clean-livekit-carousel {
          padding: 2px !important;
          gap: 10px !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
        }

        .clean-livekit-carousel > * {
          width: 100% !important;
          min-width: 0 !important;
          flex: 0 0 auto !important;
        }

        .clean-chat-panel .lk-chat {
          height: 100%;
          min-height: 0;
          background: #181818;
          color: #ffffff;
        }

        .clean-chat-panel .lk-chat-messages {
          min-height: 0;
        }

        .clean-chat-panel .lk-chat-form {
          border-top: 1px solid rgba(255,255,255,0.10);
          background: #181818;
        }

        .clean-chat-panel .lk-chat-form-input {
          color: #2f2f2f;
          background: #f5f5f5;
          border-color: #d6d6d6;
          border-radius: 12px;
        }

        .clean-chat-panel .lk-chat-form-input::placeholder {
          color: rgba(47,47,47,0.55);
        }

        @media (min-width: 640px) {
          .clean-livekit-tile {
            border-radius: 22px !important;
          }
        }

        @media (max-width: 1180px) {
          .clean-livekit-carousel .clean-livekit-tile {
            max-width: min(100%, 920px) !important;
            margin-inline: auto !important;
          }
        }
      `}</style>

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
            Video + audio + chat
          </div>
        </header>

        <div className="shrink-0 border-b border-white/10 bg-[#191919] px-3 py-2 sm:px-4">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <p className="text-xs leading-5 text-white/60">{pipMessage}</p>
            <button
              type="button"
              onClick={() => void enablePiP()}
              disabled={pipBusy || pipActive}
              className="shrink-0 rounded-[10px] bg-white px-3 py-2 text-xs font-bold text-[#222] transition hover:bg-white/90 disabled:cursor-default disabled:opacity-55"
            >
              {pipBusy ? "Opening…" : pipActive ? "PiP active" : "Open PiP"}
            </button>
          </div>
        </div>

        <main className="relative min-h-0 flex-1 overflow-hidden p-2 sm:p-3 lg:flex lg:gap-3 lg:p-4">
          <div className="flex h-full min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[20px] border border-white/10 bg-[#151515] p-1.5 sm:rounded-[26px] sm:p-3">
            <CleanVideoLayout />
          </div>

          {chatOpen ? (
            <NativeLiveKitChat
              onClose={() => setChatOpen(false)}
            />
          ) : null}
        </main>

        <canvas
          ref={pipCanvasRef}
          width={PIP_CANVAS_WIDTH}
          height={PIP_CANVAS_HEIGHT}
          aria-hidden="true"
          className="fixed left-[-10000px] top-0 h-[540px] w-[960px] pointer-events-none"
        />

        <video
          ref={(node) => {
            pipStageRef.current = node as PiPVideoElement | null;
          }}
          data-pip-stage="collage"
          muted
          autoPlay
          playsInline
          aria-hidden="true"
          className="fixed left-[-10000px] top-0 h-[180px] w-[320px] object-contain pointer-events-none"
        />

        <RoomAudioRenderer />
        <StartAudio label="Enable room audio" />

        <CleanControls
          room={room}
          effectMode={effectMode}
          effectBusy={effectBusy}
          effectError={effectError}
          chatOpen={chatOpen}
          pipBusy={pipBusy}
          pipActive={pipActive}
          onToggleChat={() => setChatOpen((current) => !current)}
          onEnablePiP={enablePiP}
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
        // Keep subscribed video flowing while PiP/background mode is active.
        // Adaptive stream pauses tracks whose attached elements are considered hidden.
        adaptiveStream: false,
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
          This version contains LiveKit video, audio, native
          realtime chat, device controls and optional camera
          effects. It has no attendance heartbeat, Supabase
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
