// src/pages/RoomPageLiveKit.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Room,
  RoomEvent,
  Track,
  RemoteParticipant,
  LocalVideoTrack,
  LocalAudioTrack,
  RemoteAudioTrack,
  LocalTrackPublication,
  RemoteTrackPublication,
  createLocalVideoTrack,
} from "livekit-client";

import {
  BackgroundBlur,
  VirtualBackground,
  supportsBackgroundProcessors,
  supportsModernBackgroundProcessors,
} from "@livekit/track-processors";

import { supabase } from "../lib/supabase";
import { USAGE_TRACKING_ENABLED } from "../lib/flags";
import { incrementWeeklyUsage } from "../lib/usage";
import {
  loadEntitlementState,
  isPersonalPaywallForced,
  type EntitlementState,
} from "../lib/entitlements";
import { getPaywallDecision } from "../lib/paywall";
import { getCurrentUserActiveBan, type ActiveBan } from "../lib/bans";
import PaywallModal from "../components/PaywallModal";
import ActiveBanModal from "../components/ActiveBanModal";
import BugReportModal from "../components/BugReportModal";
import { PAYWALL_ENABLED } from "../lib/flags";

import ChatPanel from "../components/ChatPanel";
import { TasksPanel } from "../components/TasksPanel";
import AIHostedRoomController from "../components/ai-host/AIHostedRoomController";
import JoinGateModal from "../components/JoinGateModal";
import { UserProfileModal } from "../components/UserProfileModal";
import RoomTopBar from "../components/RoomTopBar";
import RoomTimelineEditor, {
  type RoomTimelineBlock,
  timelineBlocksFromSchedule,
  timelineBlocksToSchedulePayload,
  getTimelineTotalMinutes,
  makeDefaultTimelineBlocks,
} from "../components/RoomTimelineEditor";
import { LiveKitBottomBar } from "./livekit/LiveKitBottomBar";
import {
  Icon,
  reactionEmoji as REACTION_EMOJI,
  type ReactionType,
  type RoomTheme,
} from "./livekit/LiveKitUI";

import { PreJoinModal } from "./livekit/PreJoinModalLiveKit";
import { RoomSettingsModalLiveKit } from "./livekit/RoomSettingsModalLiveKit";
import { VideoTile } from "./livekit/VideoTileLiveKit";
import {
  RoomAudioRenderer,
  StartAudio,
  useTrackToggle,
} from "@livekit/components-react";
import ReportParticipantModalLiveKit from "./livekit/ReportParticipantModalLiveKit";
import { buildScreenShareTiles } from "./livekit/screenShareHelpers";
import LiveKitPiPPortal from "./livekit/LiveKitPiPPortal";

import {
  useElementSize,
  GridLayoutSizing,
  P2PLayoutSizing,
  MobileFillLayoutSizing,
  MobileStackLayoutSizing,
  type MobileVideoLayoutMode,
  type VideoTileLayoutPreset,
} from "./livekit/sizing";

type FxMode = "off" | "blur" | "bg";

type HostProfile = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  bio?: string | null;
};

type SessionTemplate = {
  name?: string | null;
  title?: string | null;
  key?: string | null;
  slug?: string | null;
  type?: string | null;
  format?: string | null;
};

type SessionRow = {
  id: string;
  title: string;
  schedule: unknown;
  format?: string | null;
  start_time?: string | null;
  created_at?: string | null;
  duration_minutes?: number | null;
  ai_hosted?: boolean | null;
  host_profile?: HostProfile | null;
  session_templates?: SessionTemplate | SessionTemplate[] | null;
  session_bookings?: Array<{
    user_id: string;
    session_id?: string;
  }> | null;
  max_participants?: number | null;
  host_id?: string | null;
};

type Stage = {
  name: string;
  duration: number;
  color: string;
  type: "intro" | "intentions" | "focus" | "break" | "outro" | string;
  durationSeconds?: number;
};

type MediaDevicesResult = {
  videoInputs: MediaDeviceInfo[];
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
};

type PreJoinSettings = {
  displayName: string;
  audioInputId: string;
  videoInputId: string;
  audioOutputId: string;

  audioEnabled: boolean;
  videoEnabled: boolean;

  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
};

type TileModel = {
  id: string;
  kind?: "camera" | "screen";
  label: string;
  metadataDisplayName?: string;
  status?: string | null;
  isLocal: boolean;

  videoTrack?: Track;
  audioTrack?: LocalAudioTrack | RemoteAudioTrack;
  audioLevel?: number;

  participantIdentity?: string;
  participantUserId?: string;

  micTrackSid?: string;
  camTrackSid?: string;

  micMuted?: boolean;

  camPubExists?: boolean;
  camPubMuted?: boolean;
  camPubHasTrack?: boolean;

  remoteMicPubSid?: string;
};

type SessionRole = "moderator";
type SessionRoleAssignmentRow = {
  id?: string;
  session_id: string;
  user_id: string;
  role: SessionRole;
  granted_by?: string | null;
  created_at?: string;
};

type RightPanelTab = "participants" | "chat" | "tasks" | null;
type PiPMode = "focus" | "gallery";
type RoomMainViewMode = "video" | "accountability";

type FloatingReaction = {
  id: number;
  type: ReactionType;
  fromUserId: string;
  fromName: string;
};

type RoomSystemNotice = {
  open: boolean;
  kind: "info" | "error" | "kick";
  title: string;
  body: string;
};

type KickBroadcastPayload = {
  type?: "participant_kicked";
  targetIdentity?: string | null;
  targetUserId?: string | null;
  kickedByUserId?: string | null;
  kickedByName?: string | null;
  roomName?: string | null;
  sessionId?: string | null;
  at?: number;
};

type ColorCorrectionState = {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function safeRoomName(raw: string) {
  const base = (raw || "").toLowerCase();
  const cleaned = base.replace(/[^a-z0-9-_]/g, "");
  return cleaned || "room";
}
function safeIdentity(raw: string) {
  return (raw || "guest").toLowerCase().replace(/[^a-z0-9-_]/g, "") || "guest";
}
function normalizeTemplates(
  t: SessionTemplate | SessionTemplate[] | null | undefined,
): SessionTemplate[] {
  if (!t) return [];
  return Array.isArray(t) ? t : [t];
}
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function safeParseJson(raw: unknown): unknown | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s || s === "undefined" || s === "null") return null;
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return null;
    }
  }
  return raw;
}
function parse50505(
  raw: unknown,
): { focus: number; break: number; intentions: number } | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const m1 = s.match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/);
  const m2 = s.match(/^(\d+)\s*-\s*(\d+)\s*-\s*(\d+)$/);
  const m = m1 || m2;
  if (!m) return null;

  const focus = Number(m[1]);
  const br = Number(m[2]);
  const intentions = Number(m[3]);

  if (
    !Number.isFinite(focus) ||
    !Number.isFinite(br) ||
    !Number.isFinite(intentions)
  )
    return null;
  if (focus <= 0 || br <= 0 || intentions <= 0) return null;

  return { focus, break: br, intentions };
}
function normalizeKey(v: unknown): string {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
function inferStageTypeFromLabel(raw: string): Stage["type"] {
  const k = normalizeKey(raw);

  if (!k) return "focus";
  if (k.includes("welcome") || k.includes("intro")) return "intro";
  if (
    k.includes("outro") ||
    k.includes("farewell") ||
    k.includes("celebrat") ||
    k.includes("finish") ||
    k.includes("end")
  )
    return "outro";
  if (
    k.includes("checkin") ||
    k.includes("intention") ||
    k.includes("checkinspoken")
  )
    return "intentions";
  if (k.includes("break") || k.includes("rest") || k.includes("pause"))
    return "break";
  if (
    k.includes("focus") ||
    k.includes("work") ||
    k.includes("deepwork") ||
    k.includes("pomodoro")
  )
    return "focus";
  return "focus";
}
function isCheckInLikeLabel(raw: string): boolean {
  const k = normalizeKey(raw);
  return k.includes("checkin");
}
function normalizeInfinitePhases(
  anyPhases: unknown,
): { name: string; seconds: number }[] {
  if (!anyPhases) return [];

  const toSeconds = (raw: unknown): number => {
    if (isRecord(raw)) {
      const explicitSeconds =
        num((raw as any).seconds) ||
        num((raw as any).duration_seconds) ||
        num((raw as any).durationSeconds);
      if (explicitSeconds > 0) return explicitSeconds;

      const explicitMinutes =
        num((raw as any).minutes) ||
        num((raw as any).mins) ||
        num((raw as any).duration_minutes) ||
        num((raw as any).durationMinutes);
      if (explicitMinutes > 0) return explicitMinutes * 60;

      const n = num((raw as any).duration ?? (raw as any).value ?? raw);
      if (!Number.isFinite(n) || n <= 0) return 0;

      if (n <= 180) return n * 60;
      return n;
    }

    const n = num(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n <= 180) return n * 60;
    return n;
  };

  if (Array.isArray(anyPhases)) {
    return anyPhases
      .map((p) => {
        const name = isRecord(p)
          ? str((p as any).name || (p as any).key || (p as any).type)
          : "";
        const seconds = toSeconds(p);
        return { name, seconds };
      })
      .filter((x) => x.seconds > 0);
  }

  if (isRecord(anyPhases)) {
    return Object.entries(anyPhases)
      .map(([k, v]) => {
        const name = String(k || "");
        const seconds =
          typeof v === "number"
            ? v <= 180
              ? Number(v) * 60
              : Number(v)
            : toSeconds(v);
        return { name, seconds };
      })
      .filter((x) => x.seconds > 0);
  }

  return [];
}
function phaseToStageType(phaseName: string): Stage["type"] {
  const k = normalizeKey(phaseName);

  if (k.includes("welcome") || k.includes("intro")) return "intro";
  if (
    k.includes("outro") ||
    k.includes("farewell") ||
    k.includes("celebrat") ||
    k.includes("finish") ||
    k.includes("end")
  )
    return "outro";
  if (k.includes("checkin") || k.includes("intention")) return "intentions";
  if (k.includes("break") || k.includes("rest") || k.includes("pause"))
    return "break";
  if (
    k.includes("focus") ||
    k.includes("work") ||
    k.includes("deepwork") ||
    k.includes("pomodoro")
  )
    return "focus";
  return "focus";
}

const STAGE_COLORS: Record<string, string> = {
  intro: "#81DB86",
  intentions: "#ADD3FF",
  focus: "#5286F6",
  break: "#F65252",
  outro: "#81DB86",
};

function getTemplateFirst(
  tpl: SessionRow["session_templates"],
): SessionTemplate | null {
  if (!tpl) return null;
  return Array.isArray(tpl) ? (tpl[0] ?? null) : tpl;
}
function looksLikeUuid(v: string) {
  const s = String(v || "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    s,
  );
}
function uniqStrings(xs: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const k = String(x || "").toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}
function extractBaseUserIdFromIdentity(identity: string) {
  const s = String(identity || "")
    .trim()
    .toLowerCase();
  const m = s.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:--.*)?$/,
  );
  if (m && m[1]) return m[1];
  return s;
}
function getQueryInt(name: string, def = 0) {
  try {
    const u = new URL(window.location.href);
    const raw = u.searchParams.get(name);
    if (raw === null) return def;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.floor(n) : def;
  } catch {
    return def;
  }
}
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function isFirefoxLike() {
  if (typeof navigator === "undefined") return false;
  return /firefox|fxios/i.test(String(navigator.userAgent || ""));
}

function normalizeFxBlurStrength(raw: number, firefoxSafe = false) {
  const n = Math.max(4, Math.min(30, Math.round(Number(raw || 12))));

  // Firefox дешевле и стабильнее, если не пересоздавать processor
  // на каждый 1px движения ползунка, но max 30 должен быть достижим.
  if (firefoxSafe) {
    if (n <= 4) return 4;
    if (n >= 30) return 30;
    return Math.max(4, Math.min(30, Math.round(n / 4) * 4));
  }

  if (n <= 4) return 4;
  if (n >= 30) return 30;
  return Math.max(4, Math.min(30, Math.round(n / 2) * 2));
}

function normalizeMediaWarningMessage(raw: unknown) {
  const s = String(raw || "").trim();
  if (!s) return "A device action failed.";

  const low = s.toLowerCase();

  if (low.includes("permission denied") || low.includes("notallowederror")) {
    return "A camera or microphone permission step failed.";
  }

  return s;
}

function getPiPIconSrc(name: string, isLight: boolean) {
  const themeSuffix = isLight ? "light" : "dark";
  return `/icons/${name}-${themeSuffix}.svg`;
}

function PiPIcon({
  name,
  isLight,
  alt,
  className = "w-4 h-4",
}: {
  name: string;
  isLight: boolean;
  alt: string;
  className?: string;
}) {
  return (
    <img
      src={getPiPIconSrc(name, isLight)}
      alt={alt}
      className={className}
      draggable={false}
    />
  );
}

function canUseSetSinkId() {
  if (typeof window === "undefined") return false;
  try {
    const audio = document.createElement("audio") as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    return typeof audio.setSinkId === "function";
  } catch {
    return false;
  }
}

function supportsScreenShareCapture() {
  if (typeof navigator === "undefined") return false;
  return typeof (navigator.mediaDevices as any)?.getDisplayMedia === "function";
}

function getBrowserDetails() {
  if (typeof navigator === "undefined") {
    return { browser: "unknown", browserVersion: "", os: "unknown" };
  }

  const ua = String(navigator.userAgent || "");
  const uaLower = ua.toLowerCase();

  const matchVersion = (re: RegExp) => {
    const m = ua.match(re);
    return m?.[1] || "";
  };

  let browser = "unknown";
  let browserVersion = "";

  if (uaLower.includes("samsungbrowser")) {
    browser = "Samsung Internet";
    browserVersion = matchVersion(/SamsungBrowser\/([\d.]+)/i);
  } else if (
    uaLower.includes("edg/") ||
    uaLower.includes("edga/") ||
    uaLower.includes("edgios/")
  ) {
    browser = "Microsoft Edge";
    browserVersion =
      matchVersion(/EdgA?\/([\d.]+)/i) || matchVersion(/EdgiOS\/([\d.]+)/i);
  } else if (uaLower.includes("crios")) {
    browser = "Chrome iOS";
    browserVersion = matchVersion(/CriOS\/([\d.]+)/i);
  } else if (uaLower.includes("chrome") || uaLower.includes("chromium")) {
    browser = "Chrome";
    browserVersion = matchVersion(/(?:Chrome|Chromium)\/([\d.]+)/i);
  } else if (uaLower.includes("firefox") || uaLower.includes("fxios")) {
    browser = "Firefox";
    browserVersion = matchVersion(/(?:Firefox|FxiOS)\/([\d.]+)/i);
  } else if (uaLower.includes("safari")) {
    browser = "Safari";
    browserVersion = matchVersion(/Version\/([\d.]+)/i);
  }

  let os = "unknown";
  if (/ipad|iphone|ipod/i.test(ua)) os = "iOS/iPadOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/cros/i.test(ua)) os = "ChromeOS";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/mac os x|macintosh/i.test(ua)) os = "macOS";
  else if (/linux/i.test(ua)) os = "Linux";

  return { browser, browserVersion, os };
}

function inferDeviceTypeFromRuntime(args: {
  isMobileQuery?: boolean;
  isTabletQuery?: boolean;
}) {
  if (args.isMobileQuery) return "mobile";
  if (args.isTabletQuery) return "tablet";

  if (typeof navigator === "undefined" || typeof window === "undefined")
    return "unknown";

  const ua = String(navigator.userAgent || "").toLowerCase();
  const platform = String(
    (navigator as any).userAgentData?.platform || navigator.platform || "",
  ).toLowerCase();
  const maxTouchPoints = Number((navigator as any).maxTouchPoints || 0);
  const minSide = Math.min(
    window.screen?.width || window.innerWidth || 0,
    window.screen?.height || window.innerHeight || 0,
  );
  const maxSide = Math.max(
    window.screen?.width || window.innerWidth || 0,
    window.screen?.height || window.innerHeight || 0,
  );

  if (/ipad|tablet|playbook|silk/i.test(ua)) return "tablet";
  if (/android/i.test(ua) && !/mobile/i.test(ua)) return "tablet";
  if (platform.includes("mac") && maxTouchPoints > 1 && minSide >= 700)
    return "tablet";
  if (/mobi|iphone|ipod|android.*mobile/i.test(ua)) return "mobile";
  if (maxTouchPoints > 1 && minSide >= 700 && maxSide >= 900) return "tablet";

  return "desktop";
}

function getScreenShareDiagnosticSnapshot(room: Room | null) {
  try {
    const lp: any = room?.localParticipant;
    const localPubs: any[] = Array.from(
      (lp?.trackPublications as any)?.values?.() || [],
    );
    const remoteParticipants: any[] = Array.from(
      (room as any)?.remoteParticipants?.values?.() || [],
    );

    const localScreenPubs = localPubs.filter((pub) =>
      isScreenShareVideoPublication(pub),
    );

    let remoteScreenPublicationCount = 0;
    let remoteScreenSubscribedCount = 0;
    let remoteScreenLiveTrackCount = 0;

    remoteParticipants.forEach((participant) => {
      const pubs: any[] = Array.from(
        participant?.trackPublications?.values?.() || [],
      );
      pubs.forEach((pub) => {
        if (!isScreenShareVideoPublication(pub)) return;
        remoteScreenPublicationCount += 1;
        if (pub.isSubscribed) remoteScreenSubscribedCount += 1;
        if (isLiveScreenShareTrack(pub.track)) remoteScreenLiveTrackCount += 1;
      });
    });

    return {
      localScreenPublicationCount: localScreenPubs.length,
      localScreenLiveTrackCount: localScreenPubs.filter((pub) =>
        isLiveScreenShareTrack(pub.track),
      ).length,
      localScreenTrackReadyStates: localScreenPubs.map((pub) => {
        const track: any = pub?.track;
        const mediaTrack = track?.mediaStreamTrack || track?.mediaTrack || null;
        return {
          sid: String(pub?.trackSid || pub?.sid || track?.sid || ""),
          source: String(pub?.source || ""),
          kind: String(pub?.kind || track?.kind || ""),
          muted: !!pub?.isMuted,
          subscribed: !!pub?.isSubscribed,
          hasTrack: !!track,
          hasMediaTrack: !!mediaTrack,
          readyState: String(mediaTrack?.readyState || ""),
        };
      }),
      remoteScreenPublicationCount,
      remoteScreenSubscribedCount,
      remoteScreenLiveTrackCount,
    };
  } catch (e: any) {
    return {
      diagnosticsError: String(
        e?.message || e || "screen_share_snapshot_failed",
      ),
    };
  }
}

function getPublicationSourceName(pub: any) {
  return String(pub?.source || "").toLowerCase();
}

function isScreenShareVideoPublication(pub: any) {
  const source = getPublicationSourceName(pub);
  const kind = String(pub?.kind || pub?.track?.kind || "").toLowerCase();

  return (
    (source === String(Track.Source.ScreenShare).toLowerCase() ||
      source.includes("screen") ||
      source.includes("display")) &&
    (kind === "video" ||
      kind === String(Track.Kind.Video).toLowerCase() ||
      !kind)
  );
}

function isLiveScreenShareTrack(track: any) {
  if (!track) return false;

  const mediaTrack = track.mediaStreamTrack || track.mediaTrack || null;
  if (mediaTrack && mediaTrack.readyState && mediaTrack.readyState !== "live")
    return false;

  // Some browsers/tablets briefly publish a screen-share publication before the
  // actual MediaStreamTrack is attached. That phantom publication used to create
  // an empty "video tile" with no visible screen.
  if (!mediaTrack && !track.attachedElements?.length && !track.sid)
    return false;

  return true;
}

function getMediaStreamTrackFromLiveKitTrack(
  track: any,
): MediaStreamTrack | null {
  return (track?.mediaStreamTrack ||
    track?.mediaTrack ||
    null) as MediaStreamTrack | null;
}

async function waitForMediaTrackRenderableFrame(
  mediaTrack: MediaStreamTrack | null,
  timeoutMs = 2400,
) {
  if (!mediaTrack || mediaTrack.readyState !== "live") return false;
  if (typeof document === "undefined") return true;

  const startedAt = Date.now();
  const video = document.createElement("video");

  try {
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.style.position = "fixed";
    video.style.left = "-9999px";
    video.style.top = "-9999px";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.srcObject = new MediaStream([mediaTrack]);
    document.body.appendChild(video);

    try {
      await video.play();
    } catch {
      // Some tablet browsers only allow play after metadata. Continue polling.
    }

    while (Date.now() - startedAt < timeoutMs) {
      if (mediaTrack.readyState !== "live") return false;
      if (video.videoWidth > 0 && video.videoHeight > 0) return true;
      await delay(120);
    }

    return video.videoWidth > 0 && video.videoHeight > 0;
  } catch {
    return false;
  } finally {
    try {
      video.pause();
      video.srcObject = null;
      video.remove();
    } catch {
      // ignore cleanup failure
    }
  }
}

function getFirstLocalScreenShareMediaTrack(
  room: Room | null,
): MediaStreamTrack | null {
  try {
    const lp: any = room?.localParticipant;
    const pubs: any[] = Array.from(
      (lp?.trackPublications as any)?.values?.() || [],
    );
    const pub = pubs.find(
      (p) =>
        isScreenShareVideoPublication(p) && isLiveScreenShareTrack(p.track),
    );
    return getMediaStreamTrackFromLiveKitTrack(pub?.track);
  } catch {
    return null;
  }
}

async function waitForLocalRenderableScreenShareTrack(
  room: Room | null,
  timeoutMs = 3600,
) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (!hasLocalLiveScreenShare(room)) {
      await delay(120);
      continue;
    }

    const mediaTrack = getFirstLocalScreenShareMediaTrack(room);
    if (!mediaTrack) {
      await delay(120);
      continue;
    }

    const remaining = Math.max(250, timeoutMs - (Date.now() - started));
    const hasFrame = await waitForMediaTrackRenderableFrame(
      mediaTrack,
      Math.min(remaining, 1200),
    );
    if (hasFrame) return true;

    await delay(120);
  }

  return false;
}

function shouldPreferManualTabletScreenShare(args: {
  isMobileQuery?: boolean;
  isTabletQuery?: boolean;
}) {
  const deviceType = inferDeviceTypeFromRuntime(args);
  if (deviceType !== "tablet") return false;

  if (typeof navigator === "undefined") return true;
  const ua = String(navigator.userAgent || "").toLowerCase();

  // Android/Samsung tablets are the main problem case: LiveKit's convenience
  // toggle can create a screen-share publication before the real display track
  // is renderable, which leaves an empty second tile. Manual capture lets us
  // validate the MediaStreamTrack before publishing it into the room.
  return (
    ua.includes("android") ||
    ua.includes("samsungbrowser") ||
    args.isTabletQuery
  );
}

async function captureDisplayMediaForTablet() {
  if (!supportsScreenShareCapture()) {
    throw new Error("screen_share_not_supported");
  }

  const stream = await (navigator.mediaDevices as any).getDisplayMedia({
    audio: false,
    video: {
      frameRate: { ideal: 15, max: 20 },
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
    },
  });

  const mediaTrack = stream?.getVideoTracks?.()[0] as
    | MediaStreamTrack
    | undefined;
  if (!mediaTrack) {
    try {
      stream?.getTracks?.().forEach((track: MediaStreamTrack) => track.stop());
    } catch {
      // ignore cleanup failure
    }
    throw new Error("display_media_returned_no_video_track");
  }

  return { stream, mediaTrack };
}

function filterRenderableScreenShareTiles(tiles: TileModel[]) {
  return (tiles || []).filter((tile) => {
    if (tile.kind !== "screen") return true;
    return isLiveScreenShareTrack((tile as any).videoTrack);
  });
}

function hasLocalLiveScreenShare(room: Room | null) {
  const lp: any = room?.localParticipant;
  if (!lp) return false;

  const pubs: any[] = Array.from(
    (lp.trackPublications as any)?.values?.() || [],
  );
  return pubs.some(
    (pub) =>
      isScreenShareVideoPublication(pub) && isLiveScreenShareTrack(pub.track),
  );
}

function requestRemoteScreenShareSubscriptions(room: Room | null) {
  try {
    const participants = Array.from(
      (room as any)?.remoteParticipants?.values?.() || [],
    );

    participants.forEach((participant: any) => {
      const pubs: any[] = Array.from(
        participant?.trackPublications?.values?.() || [],
      );

      pubs.forEach((pub) => {
        if (!isScreenShareVideoPublication(pub)) return;

        // Tablet/Chrome/Safari can publish the screen-share publication first and
        // attach the real track a moment later. Explicitly requesting subscription
        // prevents our UI from getting stuck with an empty screen tile.
        if (typeof pub.setSubscribed === "function" && !pub.isSubscribed) {
          void pub.setSubscribed(true).catch(() => { });
        }
      });
    });
  } catch {
    // best effort only
  }
}

async function waitForLocalScreenShareTrack(
  room: Room | null,
  timeoutMs = 2600,
) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (hasLocalLiveScreenShare(room)) return true;
    await delay(120);
  }

  return hasLocalLiveScreenShare(room);
}

function getScreenShareErrorMessage(error: any) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || error || "").trim();

  if (
    name.includes("notallowed") ||
    name.includes("abort") ||
    message.toLowerCase().includes("permission")
  ) {
    return "Screen sharing was cancelled or blocked by the browser.";
  }

  if (name.includes("notfound") || name.includes("notreadable")) {
    return "Screen sharing could not start from this device or browser.";
  }

  return message || "Screen sharing could not start.";
}

function pickExistingDeviceId(
  wantedId: string,
  list: MediaDeviceInfo[],
  fallback = "",
) {
  const wanted = String(wantedId || "").trim();
  if (wanted && list.some((d) => d.deviceId === wanted)) return wanted;
  if (fallback && list.some((d) => d.deviceId === fallback)) return fallback;
  return list[0]?.deviceId || "";
}

type DeviceTier = "weak" | "normal" | "strong";

function detectDeviceTier(args: {
  isMobile: boolean;
  isTablet: boolean;
}): DeviceTier {
  if (typeof window === "undefined") return "normal";

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };

  const mem = Number(nav.deviceMemory || 0);
  const cores = Number(nav.hardwareConcurrency || 0);

  if (args.isMobile) return "weak";
  if (args.isTablet && (mem <= 4 || cores <= 4)) return "weak";
  if ((mem > 0 && mem <= 4) || (cores > 0 && cores <= 4)) return "weak";
  if (mem >= 8 && cores >= 8 && !args.isMobile) return "strong";

  return "normal";
}

function getCapturePresetForTier(tier: DeviceTier) {
  if (tier === "weak") {
    return {
      width: 320,
      height: 180,
      fps: 10,
    };
  }

  if (tier === "strong") {
    return {
      width: 960,
      height: 540,
      fps: 24,
    };
  }

  return {
    width: 640,
    height: 360,
    fps: 15,
  };
}

function isChromeOSLike() {
  if (typeof navigator === "undefined") return false;

  const nav = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  const ua = String(nav.userAgent || "").toLowerCase();
  const platform = String(
    nav.userAgentData?.platform || nav.platform || "",
  ).toLowerCase();

  return (
    ua.includes("cros") ||
    ua.includes("chromebook") ||
    platform.includes("cros") ||
    platform.includes("chrome os")
  );
}

function getInitials(name: string) {
  const s = String(name || "").trim();
  if (!s) return "U";
  const parts = s.split(/\s+/).filter(Boolean).slice(0, 2);
  const out = parts.map((p) => p[0]?.toUpperCase()).join("");
  return out || "U";
}

function getParticipantVolumeKey(
  tile: Pick<TileModel, "id" | "participantUserId" | "participantIdentity">,
) {
  const userId = String(tile.participantUserId || "").toLowerCase();
  if (userId && looksLikeUuid(userId)) return `user:${userId}`;

  const identity = String(tile.participantIdentity || "")
    .trim()
    .toLowerCase();
  if (identity) return `identity:${identity}`;

  return `tile:${String(tile.id || "")}`;
}

// realtime cleanup safe
function safeRemoveRealtimeChannel(ch: any) {
  if (!ch) return;

  try {
    if (typeof ch.unsubscribe === "function") {
      void ch.unsubscribe();
      return;
    }
  } catch { }

  const sb: any = supabase as any;

  try {
    if (typeof sb.removeChannel === "function") {
      void sb.removeChannel(ch);
      return;
    }
  } catch { }

  try {
    if (typeof sb.removeSubscription === "function") {
      void sb.removeSubscription(ch);
      return;
    }
  } catch { }

  try {
    if (sb.realtime && typeof sb.realtime.removeChannel === "function") {
      void sb.realtime.removeChannel(ch);
      return;
    }
  } catch { }
}

// avatars
const AVATARS_BUCKET = "avatars";
function isProbablyUrl(s: string) {
  return /^https?:\/\//i.test(String(s || "").trim());
}
function normalizeAvatarCandidate(raw: any): string {
  const s = String(raw || "").trim();
  if (!s || s === "null" || s === "undefined") return "";
  return s;
}
async function resolveAvatarUrlFromProfilesField(
  avatarUrlOrPath: string,
): Promise<string> {
  const v = normalizeAvatarCandidate(avatarUrlOrPath);
  if (!v) return "";
  if (isProbablyUrl(v)) return v;

  try {
    const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(v);
    const u = String((data as any)?.publicUrl || "").trim();
    if (u) return u;
  } catch { }

  return "";
}

// reports / kick events / sounds
const REPORTS_TABLE = "session_reports";
const KICK_EVENTS_CHANNEL_PREFIX = "mysession_lk_kick_events";

const ROOM_SOUNDS_PREF_KEY = "mysession_lk_room_sounds";
const ROOM_SOUNDS_VOLUME_PREF_KEY = "mysession_lk_room_sounds_volume";
const PREVIEW_MIRROR_PREF_KEY = "mysession_lk_preview_mirror";
const JOIN_SOUND_CANDIDATES = [
  "/sounds/jitsi/joined.mp3",
  "/sounds/joined.mp3",
  "/sounds/user_joined.mp3",
];
const LEAVE_SOUND_CANDIDATES = [
  "/sounds/jitsi/left.mp3",
  "/sounds/left.mp3",
  "/sounds/user_left.mp3",
];

function makeKickBroadcastChannelName(sessionId: string) {
  return `${KICK_EVENTS_CHANNEL_PREFIX}:${String(sessionId || "").trim()}`;
}

function normalizeIdentityKey(v: unknown) {
  return String(v || "")
    .trim()
    .toLowerCase();
}

function matchesKickPayload(args: {
  payload: KickBroadcastPayload | null | undefined;
  localIdentity: string;
  authUserId: string;
  baseUserId: string;
}) {
  const payload = args.payload;
  if (!payload) return false;

  const targetIdentity = normalizeIdentityKey(payload.targetIdentity);
  const targetUserId = normalizeIdentityKey(payload.targetUserId);

  const localIdentity = normalizeIdentityKey(args.localIdentity);
  const authUserId = normalizeIdentityKey(args.authUserId);
  const baseUserId = normalizeIdentityKey(args.baseUserId);

  if (targetIdentity && localIdentity && targetIdentity === localIdentity)
    return true;
  if (targetUserId && authUserId && targetUserId === authUserId) return true;
  if (targetUserId && baseUserId && targetUserId === baseUserId) return true;

  return false;
}

function playOneShotFromCandidates(urls: string[], volume = 0.9) {
  const list = Array.from(
    new Set((urls || []).map((u) => String(u || "").trim()).filter(Boolean)),
  );

  if (!list.length) return;

  const tryIndex = (index: number) => {
    if (index >= list.length) return;

    const a = new Audio(list[index]);
    a.preload = "auto";
    a.volume = volume;

    let advanced = false;
    const next = () => {
      if (advanced) return;
      advanced = true;
      tryIndex(index + 1);
    };

    try {
      a.addEventListener("error", next, { once: true });
    } catch { }

    a.play().catch(() => next());
  };

  tryIndex(0);
}

function buildColorCorrectionFilter(state: ColorCorrectionState) {
  const brightness = Math.max(
    50,
    Math.min(150, Math.round(state.brightness || 100)),
  );
  const contrast = Math.max(
    50,
    Math.min(150, Math.round(state.contrast || 100)),
  );
  const saturation = Math.max(
    0,
    Math.min(200, Math.round(state.saturation || 100)),
  );
  const warmth = Math.max(-100, Math.min(100, Math.round(state.warmth || 0)));

  const sepia = warmth > 0 ? Math.min(0.32, warmth / 1000 + warmth / 500) : 0;
  const hueRotate = warmth < 0 ? Math.round((Math.abs(warmth) / 100) * 16) : 0;

  return [
    `brightness(${brightness}%)`,
    `contrast(${contrast}%)`,
    `saturate(${saturation}%)`,
    `sepia(${sepia})`,
    hueRotate ? `hue-rotate(${hueRotate}deg)` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function parseParticipantMetadata(
  raw: unknown,
): Record<string, unknown> | null {
  const s = String(raw || "").trim();
  if (!s) return null;

  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getStatusFromMetadata(raw: unknown): string | null {
  const meta = parseParticipantMetadata(raw);
  if (!meta) return null;

  const status = String(meta.status || "").trim();
  return status || null;
}

function getDisplayNameFromParticipantMetadata(raw: unknown): string {
  const meta = parseParticipantMetadata(raw);
  if (!meta) return "";

  const direct = String(meta.displayName || "").trim();
  if (direct) return direct;

  const nestedProfileName = String(
    (meta.profile && typeof meta.profile === "object"
      ? (meta.profile as Record<string, unknown>).displayName
      : "") || "",
  ).trim();

  if (nestedProfileName) return nestedProfileName;

  return "";
}

const STATUS_LABELS: Record<string, string> = {
  afk: "AFK",
  break: "Break",
  skip: "Skip me",
  call: "On a call",
  eating: "Eating",
  private: "Private",
};

function getStatusLabel(status: unknown): string {
  const key = String(status || "")
    .trim()
    .toLowerCase();
  return STATUS_LABELS[key] || "";
}

function getStatusTone(status: unknown): string {
  const key = String(status || "")
    .trim()
    .toLowerCase();

  if (key === "afk") return "neutral";
  if (key === "break") return "yellow";
  if (key === "skip") return "purple";
  if (key === "call") return "blue";
  if (key === "eating") return "orange";
  if (key === "private") return "neutral";
  return "neutral";
}

// tab presence
const LK_TAB_PREFIX = "mysession_lk_tabs";
const LK_TAB_TTL_MS = 18_000;
const LK_TAB_HEARTBEAT_MS = 5_000;
const LK_MAX_TABS_DEFAULT = 20;

type TabPresence = { v: number; tabs: { id: string; ts: number }[] };

function nowMs() {
  return Date.now();
}
function randId(len = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++)
    out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function getOrCreateTabId(storageKey = "mysession_lk_tab_id") {
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing && existing.length >= 6) return existing;
  } catch { }

  let id = "";
  try {
    const c: any = crypto as any;
    if (c?.randomUUID)
      id = String(c.randomUUID())
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 12)
        .toLowerCase();
  } catch { }
  if (!id) id = randId(12);

  try {
    sessionStorage.setItem(storageKey, id);
  } catch { }

  return id;
}

function makeLiveKitPageTabId() {
  let id = "";

  try {
    const c: any = crypto as any;
    if (c?.randomUUID) {
      id = String(c.randomUUID())
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 12)
        .toLowerCase();
    }
  } catch { }

  if (!id) {
    id = `${randId(8)}${Date.now().toString(36).slice(-4)}`.slice(0, 12);
  }

  return id;
}

function readPresence(key: string): TabPresence {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { v: 1, tabs: [] };
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object") return { v: 1, tabs: [] };
    const tabs = Array.isArray((j as any).tabs) ? (j as any).tabs : [];
    const norm = tabs
      .map((t: any) => ({ id: String(t?.id || ""), ts: Number(t?.ts || 0) }))
      .filter((t: any) => !!t.id && Number.isFinite(t.ts) && t.ts > 0);
    return { v: Number((j as any).v || 1) || 1, tabs: norm };
  } catch {
    return { v: 1, tabs: [] };
  }
}
function writePresence(key: string, p: TabPresence) {
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch { }
}
function prunePresence(p: TabPresence): TabPresence {
  const t = nowMs();
  const tabs = (p.tabs || []).filter(
    (x) => t - (Number(x.ts) || 0) <= LK_TAB_TTL_MS,
  );
  return { v: p.v || 1, tabs };
}
function acquireTabSlot(key: string, tabId: string, maxTabs: number) {
  const p0 = prunePresence(readPresence(key));
  const t = nowMs();

  const tabs = [...(p0.tabs || [])];
  const idx = tabs.findIndex((x) => x.id === tabId);

  if (idx >= 0) {
    tabs[idx] = { id: tabId, ts: t };
    const p1 = { v: (p0.v || 1) + 1, tabs };
    writePresence(key, p1);
    return { ok: true, count: tabs.length, max: maxTabs };
  }

  if (tabs.length >= maxTabs) {
    const p1 = { v: (p0.v || 1) + 1, tabs };
    writePresence(key, p1);
    return { ok: false, count: tabs.length, max: maxTabs };
  }

  tabs.push({ id: tabId, ts: t });
  const p1 = { v: (p0.v || 1) + 1, tabs };
  writePresence(key, p1);
  return { ok: true, count: tabs.length, max: maxTabs };
}
function refreshTabSlot(key: string, tabId: string) {
  const p0 = prunePresence(readPresence(key));
  const t = nowMs();
  const tabs = [...(p0.tabs || [])];
  const idx = tabs.findIndex((x) => x.id === tabId);
  if (idx >= 0) tabs[idx] = { id: tabId, ts: t };
  const p1 = { v: (p0.v || 1) + 1, tabs };
  writePresence(key, p1);
}
function releaseTabSlot(key: string, tabId: string) {
  const p0 = prunePresence(readPresence(key));
  const tabs = (p0.tabs || []).filter((x) => x.id !== tabId);
  const p1 = { v: (p0.v || 1) + 1, tabs };
  writePresence(key, p1);
}
function makeTabPresenceKey(sessionId: string, baseUserId: string) {
  return `${LK_TAB_PREFIX}:${String(sessionId || "").trim()}:${String(
    baseUserId || "",
  )
    .trim()
    .toLowerCase()}`;
}

// default background
const DEFAULT_BG_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1B1B1B"/>
      <stop offset="0.5" stop-color="#0b3b6f"/>
      <stop offset="1" stop-color="#041018"/>
    </linearGradient>
    <radialGradient id="r" cx="30%" cy="30%" r="70%">
      <stop offset="0" stop-color="#38bdf8" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <rect width="1280" height="720" fill="url(#r)"/>
  <circle cx="980" cy="210" r="240" fill="#22c55e" opacity="0.08"/>
  <circle cx="420" cy="520" r="320" fill="#a78bfa" opacity="0.07"/>
</svg>
`);

function makeBgPresetDataUrl(a: string, b: string, c: string, d: string) {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/>
      <stop offset="0.5" stop-color="${b}"/>
      <stop offset="1" stop-color="${c}"/>
    </linearGradient>
    <radialGradient id="r" cx="25%" cy="25%" r="80%">
      <stop offset="0" stop-color="${d}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <rect width="1280" height="720" fill="url(#r)"/>
  <circle cx="1030" cy="170" r="230" fill="#F3F3F3" opacity="0.04"/>
  <circle cx="360" cy="520" r="310" fill="#F3F3F3" opacity="0.03"/>
</svg>
`)
  );
}

const FX_BG_PRESETS = [
  {
    id: "ocean",
    label: "Ocean",
    url: makeBgPresetDataUrl("#1F1F1F", "#123a76", "#031019", "#38bdf8"),
  },
  {
    id: "forest",
    label: "Forest",
    url: makeBgPresetDataUrl("#07160f", "#124b2c", "#040d08", "#22c55e"),
  },
  {
    id: "violet",
    label: "Violet",
    url: makeBgPresetDataUrl("#120a22", "#3b2378", "#090512", "#a78bfa"),
  },
  {
    id: "sunset",
    label: "Sunset",
    url: makeBgPresetDataUrl("#1c0d10", "#7c2d12", "#11070a", "#fb7185"),
  },
];

const LK_CAPTURE_WIDTH = 960;
const LK_CAPTURE_HEIGHT = 540;
const LK_CAPTURE_FPS = 24;

const VIDEO_TILE_LAYOUT_PRESET_KEY = "mysession_video_tile_layout_preset";
const VIDEO_TILE_LAYOUT_COLUMNS_KEY = "mysession_video_tile_layout_columns";
const VIDEO_TILE_LAYOUT_ROWS_KEY = "mysession_video_tile_layout_rows";
const MOBILE_LAYOUT_SWITCHER_VISIBLE_KEY =
  "mysession_mobile_layout_switcher_visible";
const CONNECTION_DIAGNOSTICS_TABLE = "connection_diagnostics";
const CONNECTION_DIAGNOSTICS_LOCAL_KEY =
  "mysession_connection_diagnostics_buffer_v1";
const CONNECTION_DIAGNOSTICS_LOCAL_MAX = 120;

function normalizeVideoTileLayoutPreset(raw: unknown): VideoTileLayoutPreset {
  const s = String(raw || "").trim();
  if (
    s === "one" ||
    s === "two" ||
    s === "three" ||
    s === "four" ||
    s === "five" ||
    s === "six" ||
    s === "strip"
  ) {
    return s;
  }
  return "auto";
}

function readStoredLayoutNumber(key: string) {
  if (typeof window === "undefined") return 0;
  const n = Math.round(Number(window.localStorage.getItem(key) || 0));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(6, n));
}

function getNetworkDiagnosticSnapshot() {
  if (typeof navigator === "undefined") {
    return {
      online: null,
      effectiveType: "",
      connectionType: "",
      downlink: null,
      rtt: null,
      saveData: null,
    };
  }

  const connection =
    (navigator as any).connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection ||
    null;

  return {
    online: typeof navigator.onLine === "boolean" ? navigator.onLine : null,
    effectiveType: String(connection?.effectiveType || ""),
    connectionType: String(connection?.type || ""),
    downlink: Number.isFinite(Number(connection?.downlink))
      ? Number(connection.downlink)
      : null,
    rtt: Number.isFinite(Number(connection?.rtt))
      ? Number(connection.rtt)
      : null,
    saveData:
      typeof connection?.saveData === "boolean" ? connection.saveData : null,
  };
}

function pushConnectionDiagnosticToLocalBuffer(entry: Record<string, unknown>) {
  if (typeof window === "undefined") return;

  try {
    const raw = window.localStorage.getItem(CONNECTION_DIAGNOSTICS_LOCAL_KEY);
    const prev = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(prev) ? prev : [];

    window.localStorage.setItem(
      CONNECTION_DIAGNOSTICS_LOCAL_KEY,
      JSON.stringify([...list, entry].slice(-CONNECTION_DIAGNOSTICS_LOCAL_MAX)),
    );
  } catch {
    // local diagnostics are best-effort only
  }
}

const CHAT_MSG_TABLE = "session_chat_messages";
const REACTION_TTL_MS = 2750;
const SESSION_SELECT_STR =
  "*, host_profile:profiles!sessions_host_id_fkey(id, full_name, avatar_url, bio), session_templates(*), session_bookings(user_id)";

const JOIN_EARLY_WINDOW_MINUTES = 10;
const SESSION_CLOSE_GRACE_MINUTES = 10;
const WEAK_DEVICE_PREVIEW_INIT_DELAY_MS = 450;

type ChatUnreadMessageRow = Record<string, any>;

function normalizeChatUserId(raw: unknown) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

function getChatRowSenderId(row: ChatUnreadMessageRow) {
  return normalizeChatUserId(
    row.user_id ??
    row.sender_user_id ??
    row.sender_id ??
    row.from_user_id ??
    row.author_id ??
    row.created_by,
  );
}

function getChatRowCreatedMs(row: ChatUnreadMessageRow) {
  const raw = row.created_at ?? row.inserted_at ?? row.sent_at ?? row.at;
  const ts = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ts) ? ts : Date.now();
}

function getChatRowModeText(row: ChatUnreadMessageRow) {
  return String(
    row.chat_mode ??
    row.mode ??
    row.message_mode ??
    row.message_type ??
    row.type ??
    row.kind ??
    row.scope ??
    "",
  )
    .trim()
    .toLowerCase();
}

function getChatRowRecipientId(row: ChatUnreadMessageRow) {
  // IMPORTANT:
  // Do NOT fall back to host_user_id here.
  // host_user_id is room/session metadata, not a DM recipient.
  // Falling back to host_user_id makes unrelated DMs look "addressed" to normal users.
  return normalizeChatUserId(
    row.recipient_user_id ??
    row.receiver_user_id ??
    row.to_user_id ??
    row.target_user_id ??
    row.dm_peer_user_id ??
    row.direct_peer_user_id ??
    row.peer_user_id,
  );
}

function chatRowHasDirectMarker(row: ChatUnreadMessageRow) {
  const mode = getChatRowModeText(row);

  if (
    mode.includes("direct") ||
    mode.includes("dm") ||
    mode.includes("private")
  ) {
    return true;
  }

  return !!(
    row.dm_peer_user_id ||
    row.direct_peer_user_id ||
    row.peer_user_id ||
    row.to_user_id ||
    row.recipient_user_id ||
    row.receiver_user_id ||
    row.target_user_id
  );
}

function getChatRowDirectPeerId(
  row: ChatUnreadMessageRow,
  myUserId: string,
  hostUserId: string,
) {
  const me = normalizeChatUserId(myUserId);
  const host = normalizeChatUserId(hostUserId);
  const sender = getChatRowSenderId(row);
  const recipient = getChatRowRecipientId(row);

  const explicitPeer = normalizeChatUserId(
    row.dm_peer_user_id ??
    row.direct_peer_user_id ??
    row.peer_user_id ??
    row.other_user_id,
  );

  if (!me) return "";

  // Fallback for future schemas where there is a recipient, but host is not loaded yet.
  if (!host) {
    if (recipient === me && sender && sender !== me) return sender;
    if (sender === me && recipient && recipient !== me) return recipient;
    return "";
  }

  // Host view: count only DMs where the host is one side of the conversation.
  // Peer = the non-host participant.
  if (me === host) {
    if (sender === host && recipient && recipient !== host) return recipient;
    if (recipient === host && sender && sender !== host) return sender;

    if (sender === host && explicitPeer && explicitPeer !== host)
      return explicitPeer;
    if (recipient === host && explicitPeer && explicitPeer !== host)
      return explicitPeer;

    return "";
  }

  // Normal participant view:
  // Count ONLY direct messages between this user and the session host.
  // Do not count other users' DMs with the host.
  if (sender === host && recipient === me) return host;
  if (sender === me && recipient === host) return host;

  if (sender === host && explicitPeer === me) return host;
  if (sender === me && explicitPeer === host) return host;

  return "";
}

function isChatRowDirectMessage(
  row: ChatUnreadMessageRow,
  myUserId: string,
  hostUserId: string,
) {
  // This answers only: "is this row direct-like?"
  // Whether it is addressed to the current user is decided by getChatRowDirectPeerId().
  // That way unrelated DMs are skipped, not accidentally counted as general chat.
  return chatRowHasDirectMarker(row);
}

function clampUnreadCount(n: number) {
  return Math.max(0, Math.min(99, Math.round(Number(n || 0))));
}

function formatLocalDateTime(ms: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function formatCountdown(msUntil: number) {
  const ms = Math.max(0, Number(msUntil) || 0);
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getFixedSessionTotalSecondsFromSchedule(rawSchedule: unknown): number {
  const directInfinite = parse50505(rawSchedule);
  if (directInfinite) return 0;

  let parsed: unknown = safeParseJson(rawSchedule);
  if (!parsed) return 0;

  if (isRecord(parsed)) {
    const kind = str((parsed as any).kind).toLowerCase();
    if (kind.includes("infinite")) return 0;

    if (
      isRecord((parsed as any).timer) &&
      (((parsed as any).timer as any).phases ||
        ((parsed as any).timer as any).segments)
    ) {
      return 0;
    }

    if ((parsed as any).phases || (parsed as any).segments) return 0;

    const maybeBlocks =
      (parsed as any).blocks ||
      (parsed as any).script ||
      (parsed as any).agenda ||
      (parsed as any).items ||
      (parsed as any).stages;

    if (Array.isArray(maybeBlocks)) parsed = maybeBlocks;
  }

  if (!Array.isArray(parsed)) return 0;

  return parsed.reduce((acc, b) => {
    const blk = isRecord(b) ? b : null;
    if (!blk) return acc;

    const seconds =
      num((blk as any).seconds) ||
      num((blk as any).durationSeconds) ||
      num((blk as any).duration_seconds) ||
      0;

    if (seconds > 0) return acc + seconds;

    const minutes =
      num((blk as any).minutes) ||
      num((blk as any).mins) ||
      num((blk as any).duration_minutes) ||
      num((blk as any).durationMinutes) ||
      num((blk as any).durationMin) ||
      num((blk as any).duration) ||
      0;

    return minutes > 0 ? acc + minutes * 60 : acc;
  }, 0);
}

type DocumentPiPApi = {
  window?: Window | null;
  requestWindow(options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
    preferInitialWindowPlacement?: boolean;
  }): Promise<Window>;
  addEventListener?: (type: string, listener: (event: any) => void) => void;
  removeEventListener?: (type: string, listener: (event: any) => void) => void;
};

type WindowWithDocumentPiP = Window & {
  documentPictureInPicture?: DocumentPiPApi;
};

function getRoomAuthCallbackUrl(redirectPath: string) {
  const safeRedirect =
    redirectPath &&
      redirectPath.startsWith("/") &&
      !redirectPath.startsWith("//")
      ? redirectPath
      : "/sessions";

  if (typeof window === "undefined") {
    return `https://www.mysession.club/auth/callback?redirect=${encodeURIComponent(safeRedirect)}`;
  }

  const url = new URL("/auth/callback", window.location.origin);
  url.searchParams.set("redirect", safeRedirect);
  return url.toString();
}

function RoomAuthModal({
  open,
  theme,
  sessionTitle,
  redirectPath,
  onEmailAuthSuccess,
}: {
  open: boolean;
  theme: RoomTheme;
  sessionTitle: string;
  redirectPath: string;
  onEmailAuthSuccess: () => Promise<void>;
}) {
  const isLight = theme === "light";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [oauthLoading, setOauthLoading] = useState<
    null | "google" | "discord" | "facebook"
  >(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const oauthPopupRef = useRef<Window | null>(null);
  const oauthPollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    const cleanupPopupWatch = () => {
      if (oauthPollTimerRef.current) {
        window.clearInterval(oauthPollTimerRef.current);
        oauthPollTimerRef.current = null;
      }
    };

    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      const payload = event.data as any;
      if (!payload || payload.type !== "mysession-auth-callback") return;

      cleanupPopupWatch();

      try {
        oauthPopupRef.current?.close?.();
      } catch {
        // ignore
      }

      oauthPopupRef.current = null;
      setOauthLoading(null);
      setError("");
      setMessage("Signed in. Preparing your room…");

      try {
        await onEmailAuthSuccess();
      } catch (e: any) {
        setError(
          e?.message ||
          "Signed in, but failed to refresh the room. Please reload.",
        );
      }
    };

    window.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("message", onMessage);
      cleanupPopupWatch();
      try {
        oauthPopupRef.current?.close?.();
      } catch {
        // ignore
      }
      oauthPopupRef.current = null;
    };
  }, [open, onEmailAuthSuccess]);

  if (!open) return null;

  const redirectTo = getRoomAuthCallbackUrl(redirectPath);

  const startOAuth = async (provider: "google" | "discord" | "facebook") => {
    try {
      setError("");
      setMessage("");
      setOauthLoading(provider);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          ...(provider === "discord" ? { scopes: "identify email" } : {}),
        } as any,
      });

      if (error) {
        console.log(`[room-auth] ${provider} oauth error:`, error);
        setError(error.message);
        setOauthLoading(null);
        return;
      }

      const providerUrl = String((data as any)?.url || "").trim();

      if (!providerUrl) {
        setError("Could not start social login. Please try again.");
        setOauthLoading(null);
        return;
      }

      const popupWidth = 520;
      const popupHeight = 720;
      const left =
        typeof window !== "undefined"
          ? Math.max(
            0,
            Math.round(window.screenX + (window.outerWidth - popupWidth) / 2),
          )
          : 120;
      const top =
        typeof window !== "undefined"
          ? Math.max(
            0,
            Math.round(
              window.screenY + (window.outerHeight - popupHeight) / 2,
            ),
          )
          : 80;

      const popup = window.open(
        providerUrl,
        "mysession_oauth",
        [
          `width=${popupWidth}`,
          `height=${popupHeight}`,
          `left=${left}`,
          `top=${top}`,
          "resizable=yes",
          "scrollbars=yes",
          "status=no",
          "toolbar=no",
          "menubar=no",
          "location=yes",
        ].join(","),
      );

      // Popup can be blocked by the browser. In that case, fall back to a normal redirect.
      if (!popup) {
        window.location.assign(providerUrl);
        return;
      }

      oauthPopupRef.current = popup;
      try {
        popup.focus();
      } catch {
        // ignore
      }

      setMessage(
        "Finish signing in in the popup window. This room will stay open here.",
      );

      if (oauthPollTimerRef.current) {
        window.clearInterval(oauthPollTimerRef.current);
      }

      oauthPollTimerRef.current = window.setInterval(() => {
        const closed = !oauthPopupRef.current || oauthPopupRef.current.closed;

        if (closed) {
          if (oauthPollTimerRef.current) {
            window.clearInterval(oauthPollTimerRef.current);
            oauthPollTimerRef.current = null;
          }

          oauthPopupRef.current = null;
          setOauthLoading(null);
          setMessage((prev) =>
            prev.includes("Signed in")
              ? prev
              : "Popup closed. You can try signing in again.",
          );
        }
      }, 600);
    } catch (e: any) {
      console.log("[room-auth] oauth unexpected error:", e);
      setError(e?.message || "Failed to start social login. Please try again.");
      setOauthLoading(null);
    }
  };

  const handleEmailLogin = async () => {
    const cleanEmail = email.trim();

    if (!cleanEmail || !password) {
      setError("Please enter your email and password.");
      return;
    }

    try {
      setEmailLoading(true);
      setError("");
      setMessage("");

      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        setError(error.message);
        return;
      }

      await onEmailAuthSuccess();
      setMessage("Signed in. Preparing your room…");
    } catch (e: any) {
      setError(e?.message || "Failed to sign in. Please try again.");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleEmailRegister = async () => {
    const cleanFullName = fullName.trim();
    const cleanEmail = email.trim();

    if (!cleanFullName || !cleanEmail || !password) {
      setError("Please enter your name, email, and password.");
      return;
    }

    try {
      setEmailLoading(true);
      setError("");
      setMessage("");

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: { full_name: cleanFullName },
        },
      });

      if (error) {
        setError(error.message);
        return;
      }

      if (data.user) {
        try {
          await supabase.from("profiles").upsert([
            {
              id: data.user.id,
              full_name: cleanFullName,
              avatar_url: null,
              bio: "",
            },
          ]);
        } catch (profileError) {
          console.warn(
            "[room-auth] profile upsert after signup failed:",
            profileError,
          );
        }
      }

      if (data.session) {
        await onEmailAuthSuccess();
        setMessage("Account created. Preparing your room…");
        return;
      }

      setMessage(
        "Account created. Check your email and open the newest MySession confirmation link. You’ll return to this room automatically.",
      );
    } catch (e: any) {
      setError(e?.message || "Failed to create account. Please try again.");
    } finally {
      setEmailLoading(false);
    }
  };

  const inputClass = [
    "w-full rounded-2xl border px-4 py-3 text-[14px] outline-none transition",
    isLight
      ? "border-[#CFCFCF] bg-[#F3F3F3] text-black placeholder:text-black/35 focus:ring-2 focus:ring-black/15"
      : "border-[#2B2B2B] bg-[#252525] text-white placeholder:text-white/35 focus:ring-2 focus:ring-white/20",
  ].join(" ");

  const subtleText = isLight ? "text-black/55" : "text-white/55";
  const cardClass = isLight
    ? "border-[#CFCFCF] bg-[#F3F3F3] text-black shadow-[0_24px_80px_rgba(15,23,42,0.22)]"
    : "border-[#2B2B2B] bg-[#242424] text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)]";

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-[#E6E6E6] backdrop-blur-[3px]" />
      <div
        className={`relative w-full max-w-[460px] rounded-[28px] border p-5 sm:p-6 ${cardClass}`}
      >
        <div className="mb-4">
          <div
            className={`text-[12px] font-semibold uppercase tracking-[0.16em] ${subtleText}`}
          >
            Join this session
          </div>
          <div className="mt-2 text-[24px] font-bold leading-tight">
            Sign in to enter the room
          </div>
          <div className={`mt-2 text-[14px] leading-6 ${subtleText}`}>
            You’re opening <span className="font-semibold">{sessionTitle}</span>
            . Sign in here and you’ll continue directly to pre-join.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            disabled={oauthLoading !== null || emailLoading}
            onClick={() => void startOAuth("google")}
            className={[
              "flex h-12 w-full items-center justify-center gap-3 rounded-2xl border text-[15px] font-semibold transition disabled:opacity-60",
              isLight
                ? "border-[#CFCFCF] bg-[#F3F3F3] hover:bg-black/[0.03]"
                : "border-[#2B2B2B] bg-[#252525] hover:bg-[#424242]",
            ].join(" ")}
          >
            <img
              src="https://www.svgrepo.com/show/475656/google-color.svg"
              className="h-5 w-5"
              alt=""
            />
            {oauthLoading === "google"
              ? "Opening Google…"
              : "Continue with Google"}
          </button>

          <button
            type="button"
            disabled={oauthLoading !== null || emailLoading}
            onClick={() => void startOAuth("discord")}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl bg-[#5865F2] text-[15px] font-semibold text-white transition hover:bg-[#4752C4] disabled:opacity-60"
          >
            <span
              aria-hidden="true"
              className="flex h-5 w-5 items-center justify-center rounded-md bg-[#F3F3F3] text-[13px] font-black text-[#5865F2]"
            >
              D
            </span>
            {oauthLoading === "discord"
              ? "Opening Discord…"
              : "Continue with Discord"}
          </button>

          <button
            type="button"
            disabled={oauthLoading !== null || emailLoading}
            onClick={() => void startOAuth("facebook")}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl bg-[#1877F2] text-[15px] font-semibold text-white transition hover:bg-[#0f66d3] disabled:opacity-60"
          >
            <img src="/icons/facebook.svg" className="h-5 w-5" alt="" />
            {oauthLoading === "facebook"
              ? "Opening Facebook…"
              : "Continue with Facebook"}
          </button>
        </div>

        <div className="my-5 flex items-center gap-3">
          <div
            className={`h-px flex-1 ${isLight ? "bg-[#DCDCDC]" : "bg-[#303030]"}`}
          />
          <div className={`text-[12px] ${subtleText}`}>or use email</div>
          <div
            className={`h-px flex-1 ${isLight ? "bg-[#DCDCDC]" : "bg-[#303030]"}`}
          />
        </div>

        <div
          className={`mb-3 grid grid-cols-2 rounded-2xl p-1 ${isLight ? "bg-black/[0.04]" : "bg-[#252525]"}`}
        >
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
              setMessage("");
            }}
            className={[
              "h-9 rounded-xl text-[13px] font-semibold transition",
              mode === "login"
                ? isLight
                  ? "bg-[#F3F3F3] text-black shadow-sm"
                  : "bg-[#F3F3F3] text-black"
                : subtleText,
            ].join(" ")}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError("");
              setMessage("");
            }}
            className={[
              "h-9 rounded-xl text-[13px] font-semibold transition",
              mode === "register"
                ? isLight
                  ? "bg-[#F3F3F3] text-black shadow-sm"
                  : "bg-[#F3F3F3] text-black"
                : subtleText,
            ].join(" ")}
          >
            Create account
          </button>
        </div>

        <div className="space-y-3">
          {mode === "register" ? (
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={inputClass}
              placeholder="Your name"
              autoComplete="name"
            />
          ) : null}

          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="Email address"
            type="email"
            autoComplete="email"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (mode === "login") void handleEmailLogin();
                else void handleEmailRegister();
              }
            }}
          />

          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="Password"
            type="password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (mode === "login") void handleEmailLogin();
                else void handleEmailRegister();
              }
            }}
          />

          <button
            type="button"
            disabled={emailLoading || oauthLoading !== null}
            onClick={() => {
              if (mode === "login") void handleEmailLogin();
              else void handleEmailRegister();
            }}
            className={[
              "h-12 w-full rounded-2xl text-[15px] font-semibold transition disabled:opacity-60",
              isLight
                ? "bg-black text-white hover:bg-black/85"
                : "bg-[#F3F3F3] text-black hover:bg-[#F1F1F1]/90",
            ].join(" ")}
          >
            {emailLoading
              ? mode === "login"
                ? "Signing in…"
                : "Creating account…"
              : mode === "login"
                ? "Log in and join"
                : "Create account"}
          </button>
        </div>

        {error ? (
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 text-[13px] leading-5 ${isLight
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-red-500/20 bg-red-500/10 text-red-200"
              }`}
          >
            {error}
          </div>
        ) : null}

        {message ? (
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 text-[13px] leading-5 ${isLight
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-emerald-500/20 bg-[#81DB86]/10 text-emerald-200"
              }`}
          >
            {message}
          </div>
        ) : null}

        <div className={`mt-4 text-center text-[12px] leading-5 ${subtleText}`}>
          Social login opens in a small popup. Keep this room open — it will
          continue automatically after sign-in.
        </div>
      </div>
    </div>
  );
}


type AccountabilityWallTask = {
  id: string;
  text: string;
  user_id: string;
  session_id: string;
  created_at?: string | null;
  completed?: boolean | null;
  profiles?: {
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
};


type TaskTimerState = {
  elapsed_ms: number;
  running_since_ms: number | null;
  updated_at?: string;
};

type TaskTimerMap = Record<string, TaskTimerState>;

const TASK_TIMER_EVENT = "mysession:task-timers-updated";
const TASK_TIMER_STORAGE_PREFIX = "mysession_task_timers_v1";
const TASKS_SYNC_EVENT = "mysession:tasks-synced";

function emitRoomTasksSync(detail: Record<string, unknown> = {}) {
  try {
    const payload = { ...detail, at: Date.now() };

    window.dispatchEvent(
      new CustomEvent(TASKS_SYNC_EVENT, {
        detail: payload,
      }),
    );

    window.dispatchEvent(
      new CustomEvent("mysession:tasks-updated", {
        detail: payload,
      }),
    );
  } catch {
    // best effort only
  }
}

function makeTaskTimerStorageKey(sessionId: string | null | undefined, userId: string | null | undefined) {
  const sid = String(sessionId || "global").trim() || "global";
  const uid = String(userId || "anon").trim().toLowerCase() || "anon";
  return `${TASK_TIMER_STORAGE_PREFIX}:${sid}:${uid}`;
}

function makeTaskTimerId(ownerUserId: unknown, text: unknown, fallbackId?: unknown) {
  const owner = String(ownerUserId || "")
    .trim()
    .toLowerCase();
  const normalizedText = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const textKey = normalizedText ? encodeURIComponent(normalizedText).slice(0, 240) : "";
  const fallback = String(fallbackId || "")
    .trim()
    .toLowerCase();
  return `${owner || "unknown"}:${textKey || `id:${fallback || "unknown"}`}`;
}

function sanitizeTaskTimerState(raw: unknown): TaskTimerState {
  const value = raw && typeof raw === "object" ? (raw as any) : {};
  const elapsed = Math.max(0, Math.round(Number(value.elapsed_ms || 0)));
  const runningSinceRaw = Number(value.running_since_ms || 0);
  const runningSince = Number.isFinite(runningSinceRaw) && runningSinceRaw > 0 ? runningSinceRaw : null;

  return {
    elapsed_ms: elapsed,
    running_since_ms: runningSince,
    updated_at: typeof value.updated_at === "string" ? value.updated_at : undefined,
  };
}

function readTaskTimers(storageKey: string): TaskTimerMap {
  if (!storageKey || typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const out: TaskTimerMap = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
      if (!key) return;
      out[key] = sanitizeTaskTimerState(value);
    });

    return out;
  } catch {
    return {};
  }
}

function writeTaskTimers(storageKey: string, timers: TaskTimerMap) {
  if (!storageKey || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(timers || {}));
  } catch { }
}

function getTaskTimerDisplayMs(timer: TaskTimerState | null | undefined, nowMs: number) {
  if (!timer) return 0;

  const base = Math.max(0, Math.round(Number(timer.elapsed_ms || 0)));
  const runningSince = Number(timer.running_since_ms || 0);

  if (!runningSince || !Number.isFinite(runningSince)) return base;

  return Math.max(0, base + Math.max(0, nowMs - runningSince));
}

function formatTaskTimer(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isTaskTimerRunning(timer: TaskTimerState | null | undefined) {
  return !!timer?.running_since_ms;
}

function getTilePersonKey(tile: TileModel) {
  const userId = String(tile.participantUserId || "")
    .trim()
    .toLowerCase();
  if (userId) return userId;

  const identityBase = extractBaseUserIdFromIdentity(
    String(tile.participantIdentity || ""),
  )
    .trim()
    .toLowerCase();
  if (identityBase) return identityBase;

  return String(tile.id || "").trim().toLowerCase();
}

function AccountabilityWall({
  sessionId,
  tiles,
  profilesById,
  authUserId,
  theme,
  isLight,
  onOpenTasks,
  onSwitchBackToVideo,
}: {
  sessionId?: string | null;
  tiles: TileModel[];
  profilesById: Record<string, HostProfile>;
  authUserId?: string | null;
  theme: RoomTheme;
  isLight: boolean;
  onOpenTasks: () => void;
  onSwitchBackToVideo: () => void;
}) {
  const [wallTasks, setWallTasks] = useState<AccountabilityWallTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [newWallTask, setNewWallTask] = useState("");
  const [wallTaskBusy, setWallTaskBusy] = useState<string | null>(null);
  const localTasksSyncTimerRef = useRef<number | null>(null);


  const taskTimerStorageKey = useMemo(
    () => makeTaskTimerStorageKey(sessionId || "global", authUserId || ""),
    [authUserId, sessionId],
  );
  const [taskTimers, setTaskTimers] = useState<TaskTimerMap>({});
  const [taskTimerTickMs, setTaskTimerTickMs] = useState(() => Date.now());

  useEffect(() => {
    setTaskTimers(readTaskTimers(taskTimerStorageKey));
  }, [taskTimerStorageKey]);

  useEffect(() => {
    const refresh = () => setTaskTimers(readTaskTimers(taskTimerStorageKey));

    const onTimerEvent = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      if (!detail?.storageKey || detail.storageKey === taskTimerStorageKey) refresh();
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === taskTimerStorageKey) refresh();
    };

    window.addEventListener(TASK_TIMER_EVENT, onTimerEvent as EventListener);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(TASK_TIMER_EVENT, onTimerEvent as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [taskTimerStorageKey]);

  useEffect(() => {
    const id = window.setInterval(() => setTaskTimerTickMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const persistTaskTimers = useCallback(
    (next: TaskTimerMap) => {
      setTaskTimers(next);
      writeTaskTimers(taskTimerStorageKey, next);
      try {
        window.dispatchEvent(
          new CustomEvent(TASK_TIMER_EVENT, {
            detail: { storageKey: taskTimerStorageKey, sessionId, userId: authUserId || "" },
          }),
        );
      } catch { }
    },
    [authUserId, sessionId, taskTimerStorageKey],
  );

  const updateTaskTimer = useCallback(
    (timerId: string, updater: (prev: TaskTimerState | null) => TaskTimerState | null) => {
      if (!timerId) return;

      const prevMap = readTaskTimers(taskTimerStorageKey);
      const nextValue = updater(prevMap[timerId] || null);
      const nextMap = { ...prevMap };

      if (nextValue) nextMap[timerId] = nextValue;
      else delete nextMap[timerId];

      persistTaskTimers(nextMap);
    },
    [persistTaskTimers, taskTimerStorageKey],
  );

  const toggleTaskTimer = useCallback(
    (item: AccountabilityWallTask) => {
      const uid = String(authUserId || "").trim();
      if (!uid || String(item.user_id || "").trim().toLowerCase() !== uid.toLowerCase()) return;

      const timerId = makeTaskTimerId(item.user_id, item.text, item.id);
      const now = Date.now();

      updateTaskTimer(timerId, (prev) => {
        const safePrev = sanitizeTaskTimerState(prev || {});

        if (safePrev.running_since_ms) {
          return {
            elapsed_ms: getTaskTimerDisplayMs(safePrev, now),
            running_since_ms: null,
            updated_at: new Date(now).toISOString(),
          };
        }

        return {
          elapsed_ms: safePrev.elapsed_ms,
          running_since_ms: now,
          updated_at: new Date(now).toISOString(),
        };
      });
    },
    [authUserId, updateTaskTimer],
  );

  const pauseTaskTimer = useCallback(
    (item: AccountabilityWallTask) => {
      const timerId = makeTaskTimerId(item.user_id, item.text, item.id);
      const now = Date.now();

      updateTaskTimer(timerId, (prev) => {
        const safePrev = sanitizeTaskTimerState(prev || {});
        if (!safePrev.running_since_ms) return safePrev.elapsed_ms > 0 ? safePrev : null;
        return {
          elapsed_ms: getTaskTimerDisplayMs(safePrev, now),
          running_since_ms: null,
          updated_at: new Date(now).toISOString(),
        };
      });
    },
    [updateTaskTimer],
  );

  const resetTaskTimer = useCallback(
    (item: AccountabilityWallTask) => {
      const uid = String(authUserId || "").trim();
      if (!uid || String(item.user_id || "").trim().toLowerCase() !== uid.toLowerCase()) return;
      const timerId = makeTaskTimerId(item.user_id, item.text, item.id);
      updateTaskTimer(timerId, () => null);
    },
    [authUserId, updateTaskTimer],
  );

  const loadTasks = useCallback(async () => {
    const sid = String(sessionId || "").trim();
    if (!sid) {
      setWallTasks([]);
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("intentions")
        .select("id,text,user_id,session_id,created_at,completed")
        .eq("session_id", sid)
        .order("created_at", { ascending: false })
        .limit(160);

      if (error || !Array.isArray(data)) {
        setWallTasks([]);
        return;
      }

      const rows = data as AccountabilityWallTask[];
      const userIds = Array.from(
        new Set(rows.map((r) => String(r.user_id || "").trim()).filter(Boolean)),
      );

      let profileMap = new Map<string, HostProfile>();
      if (userIds.length) {
        try {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id,full_name,avatar_url,bio")
            .in("id", userIds);

          if (Array.isArray(profiles)) {
            profileMap = new Map(
              profiles.map((p: any) => [String(p.id || "").toLowerCase(), p as HostProfile]),
            );
          }
        } catch {
          // best effort only
        }
      }

      setWallTasks(
        rows.map((row) => ({
          ...row,
          profiles: profileMap.get(String(row.user_id || "").toLowerCase()) || null,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const sid = String(sessionId || "").trim();
    if (!sid) return;

    const ch = supabase
      .channel(`accountability-wall-intentions:${sid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "intentions", filter: `session_id=eq.${sid}` },
        () => void loadTasks(),
      )
      .subscribe();

    return () => {
      safeRemoveRealtimeChannel(ch);
    };
  }, [sessionId, loadTasks]);

  useEffect(() => {
    const sid = String(sessionId || "").trim();
    if (!sid) return;

    const refreshFromTasksPanel = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      const eventSessionId = String(detail?.sessionId || "").trim();

      if (eventSessionId && eventSessionId !== sid) return;

      if (localTasksSyncTimerRef.current) {
        window.clearTimeout(localTasksSyncTimerRef.current);
      }

      localTasksSyncTimerRef.current = window.setTimeout(() => {
        localTasksSyncTimerRef.current = null;
        void loadTasks();
      }, 40);
    };

    window.addEventListener(
      TASKS_SYNC_EVENT,
      refreshFromTasksPanel as EventListener,
    );
    window.addEventListener(
      "mysession:tasks-updated",
      refreshFromTasksPanel as EventListener,
    );

    return () => {
      if (localTasksSyncTimerRef.current) {
        window.clearTimeout(localTasksSyncTimerRef.current);
        localTasksSyncTimerRef.current = null;
      }

      window.removeEventListener(
        TASKS_SYNC_EVENT,
        refreshFromTasksPanel as EventListener,
      );
      window.removeEventListener(
        "mysession:tasks-updated",
        refreshFromTasksPanel as EventListener,
      );
    };
  }, [sessionId, loadTasks]);

  const participantTiles = useMemo(() => {
    const out: TileModel[] = [];
    const seen = new Set<string>();

    for (const tile of tiles || []) {
      if (tile.kind === "screen") continue;
      const key = getTilePersonKey(tile);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(tile);
    }

    return out;
  }, [tiles]);

  const tasksByUserId = useMemo(() => {
    const map = new Map<string, AccountabilityWallTask[]>();

    for (const item of wallTasks || []) {
      const userId = String(item.user_id || "").trim().toLowerCase();
      if (!userId) continue;
      const list = map.get(userId) || [];
      list.push(item);
      map.set(userId, list);
    }

    return map;
  }, [wallTasks]);

  const cardBg = isLight
    ? "border-[#D8D0D0] bg-[#F7F5F5] text-black"
    : "border-[#2B2B2B] bg-[#1B1B1B] text-white";
  const mutedText = isLight ? "text-black/55" : "text-white/55";
  const taskIconSrc = isLight
    ? "/icons/tasks-light.svg"
    : "/icons/tasks-dark.svg";

  const syncOwnWallTaskToPanelTasks = async (args: {
    userId: string;
    text: string;
    completed?: boolean;
  }) => {
    const userId = String(args.userId || "").trim();
    const text = String(args.text || "").trim();
    if (!userId || !text) return;

    try {
      const { data: existingRows } = await supabase
        .from("panel_intentions")
        .select("id,text,user_id,completed,visibility")
        .eq("user_id", userId)
        .ilike("text", text)
        .limit(1);

      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      if (existing?.id) {
        await supabase
          .from("panel_intentions")
          .update({
            completed: typeof args.completed === "boolean" ? args.completed : Boolean(existing.completed),
            visibility: "public",
          } as any)
          .eq("id", existing.id)
          .eq("user_id", userId);
        return;
      }

      await supabase.from("panel_intentions").insert({
        user_id: userId,
        text,
        completed: typeof args.completed === "boolean" ? args.completed : false,
        visibility: "public",
      } as any);
    } catch (e) {
      console.warn("syncOwnWallTaskToPanelTasks failed:", e);
    }
  };

  const addOwnWallTask = async () => {
    const uid = String(authUserId || "").trim();
    const sid = String(sessionId || "").trim();
    const text = String(newWallTask || "").trim();

    if (!uid || !sid || !text || wallTaskBusy) return;

    const optimisticId = `wall-optimistic-${Date.now()}`;
    const optimistic: AccountabilityWallTask = {
      id: optimisticId,
      text,
      user_id: uid,
      session_id: sid,
      created_at: new Date().toISOString(),
      completed: false,
      profiles: null,
    };

    setWallTaskBusy("add");
    setNewWallTask("");
    setWallTasks((prev) => [optimistic, ...prev].slice(0, 160));

    try {
      const { data, error } = await supabase
        .from("intentions")
        .insert({
          user_id: uid,
          session_id: sid,
          text,
          completed: false,
        })
        .select("id,text,user_id,session_id,created_at,completed")
        .single();

      if (error || !data) throw error || new Error("No task returned");

      setWallTasks((prev) =>
        [data as AccountabilityWallTask, ...prev.filter((x) => x.id !== optimisticId)].slice(0, 160),
      );

      void syncOwnWallTaskToPanelTasks({
        userId: uid,
        text,
        completed: false,
      });

      emitRoomTasksSync({
        action: "insert",
        sessionId: sid,
        userId: uid,
        taskId: String((data as any)?.id || ""),
      });
    } catch (e) {
      console.warn("addOwnWallTask failed:", e);
      setWallTasks((prev) => prev.filter((x) => x.id !== optimisticId));
      void loadTasks();
    } finally {
      setWallTaskBusy(null);
    }
  };

  const toggleOwnWallTask = async (item: AccountabilityWallTask) => {
    const uid = String(authUserId || "").trim();
    const sid = String(sessionId || "").trim();
    if (!uid || !sid || String(item.user_id || "").trim().toLowerCase() !== uid.toLowerCase() || wallTaskBusy) return;

    const nextCompleted = !Boolean(item.completed);
    setWallTaskBusy(item.id);
    setWallTasks((prev) =>
      prev.map((x) => (x.id === item.id ? { ...x, completed: nextCompleted } : x)),
    );

    try {
      const { error } = await supabase
        .from("intentions")
        .update({ completed: nextCompleted })
        .eq("id", item.id)
        .eq("user_id", uid)
        .eq("session_id", sid);

      if (error) throw error;

      if (nextCompleted) {
        pauseTaskTimer(item);
      }

      void syncOwnWallTaskToPanelTasks({
        userId: uid,
        text: item.text,
        completed: nextCompleted,
      });

      emitRoomTasksSync({
        action: "update",
        sessionId: sid,
        userId: uid,
        taskId: item.id,
      });
    } catch (e) {
      console.warn("toggleOwnWallTask failed:", e);
      void loadTasks();
    } finally {
      setWallTaskBusy(null);
    }
  };

  return (
    <div className="h-full w-full min-h-0 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className={`font-inter text-[15px] font-bold ${isLight ? "text-black/85" : "text-white/90"}`}>
            Accountability Wall
          </div>
          <div className={`mt-1 font-inter text-[14px] font-normal ${mutedText}`}>
            Everyone’s current tasks, visible while you work.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenTasks}
            className={[
              "inline-flex h-9 items-center justify-center rounded-2xl px-3 font-inter text-[12px] font-normal leading-none transition",
              isLight
                ? "bg-[#242424] text-white hover:bg-[#303030]"
                : "bg-[#81DB86] text-black hover:brightness-95",
            ].join(" ")}
          >
            Add / edit tasks
          </button>

          <button
            type="button"
            onClick={onSwitchBackToVideo}
            className={[
              "inline-flex h-9 items-center justify-center gap-1.5 rounded-2xl border px-3 font-inter text-[12px] font-normal leading-none transition",
              isLight
                ? "border-[#CFC6C6] bg-[#F7F5F5] text-black/70 hover:bg-[#ECEAEA]"
                : "border-[#2B2B2B] bg-[#242424] text-white/80 hover:bg-white/[0.06]",
            ].join(" ")}
            title="Switch back to videos"
          >
            <img
              src={isLight ? "/icons/pip-intentions-light.svg" : "/icons/pip-intentions-dark.svg"}
              alt=""
              className="h-3.5 w-3.5 opacity-85"
              draggable={false}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <span>Switch back to videos</span>
          </button>
        </div>
      </div>

      {participantTiles.length === 0 ? (
        <div
          className={[
            "flex min-h-[260px] items-center justify-center rounded-[28px] border text-[14px]",
            cardBg,
          ].join(" ")}
        >
          No participants yet
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {participantTiles.map((tile) => {
            const userId = getTilePersonKey(tile);
            const profile =
              profilesById[userId] ||
              profilesById[String(tile.participantIdentity || "").toLowerCase()] ||
              null;
            const name =
              String(tile.metadataDisplayName || profile?.full_name || tile.label || "Participant").trim() ||
              "Participant";
            const avatarUrl = String(profile?.avatar_url || "").trim();
            const userTasks = (tasksByUserId.get(userId) || []).slice(0, 4);
            const activeCount = userTasks.filter((x) => !x.completed).length;
            const completedCount = userTasks.filter((x) => !!x.completed).length;
            const isLocalCard = String(userId).toLowerCase() === String(authUserId || "").toLowerCase();

            return (
              <div
                key={`accountability-${tile.id}`}
                className={[
                  "min-h-[220px] rounded-[28px] border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg",
                  cardBg,
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-2xl object-cover"
                      />
                    ) : (
                      <div
                        className={[
                          "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[16px] font-black",
                          isLight ? "bg-black/5 text-black/75" : "bg-white/10 text-white/85",
                        ].join(" ")}
                      >
                        {getInitials(name)}
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="truncate font-inter text-[15px] font-bold leading-tight">
                        {name}
                      </div>
                      <div className={`mt-1 text-[12px] ${mutedText}`}>
                        {tile.status ? getStatusLabel(tile.status) || tile.status : tile.isLocal ? "You" : "In room"}
                      </div>
                    </div>
                  </div>

                  <div
                    className={[
                      "shrink-0 rounded-2xl border px-2.5 py-1 font-inter text-[11px] font-medium",
                      activeCount > 0
                        ? "border-[#81DB86]/55 bg-[#81DB86]/10 text-[#2FA84F]"
                        : isLight
                          ? "border-black/10 bg-black/5 text-black/45"
                          : "border-white/10 bg-white/10 text-white/45",
                    ].join(" ")}
                  >
                    {activeCount > 0 ? `${activeCount} active` : completedCount > 0 ? "Done" : "No task"}
                  </div>
                </div>

                <div className="mt-5 space-y-2">
                  {isLocalCard ? (
                    <div className="mb-3 flex items-center gap-2">
                      <input
                        type="text"
                        value={newWallTask}
                        onChange={(e) => setNewWallTask(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void addOwnWallTask();
                        }}
                        placeholder="Add a task"
                        className={[
                          "h-11 min-w-0 flex-1 rounded-2xl border px-3 font-inter text-[13px] outline-none transition",
                          isLight
                            ? "border-[#CFC6C6] bg-[#F7F5F5] text-black/85 placeholder:text-black/35 focus:border-[#81DB86] focus:ring-1 focus:ring-[#81DB86]"
                            : "border-white/10 bg-white/[0.05] text-white/90 placeholder:text-white/35 focus:border-[#81DB86]/70 focus:ring-1 focus:ring-[#81DB86]/50",
                        ].join(" ")}
                      />
                      <button
                        type="button"
                        onClick={() => void addOwnWallTask()}
                        disabled={!newWallTask.trim() || !!wallTaskBusy}
                        className="h-11 rounded-2xl bg-[#81DB86] px-4 font-inter text-[13px] font-bold text-black transition hover:brightness-95 disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  ) : null}

                  {loading && !userTasks.length ? (
                    <div className={`rounded-2xl border border-dashed px-4 py-3 font-inter text-[13px] ${mutedText}`}>
                      Loading tasks…
                    </div>
                  ) : userTasks.length ? (
                    userTasks.map((item) => {
                      const timerId = makeTaskTimerId(item.user_id, item.text, item.id);
                      const timer = taskTimers[timerId] || null;
                      const elapsedMs = getTaskTimerDisplayMs(timer, taskTimerTickMs);
                      const timerRunning = isTaskTimerRunning(timer);
                      const shouldShowTimer = isLocalCard || elapsedMs > 0;

                      return (
                        <div
                          key={item.id}
                          className={[
                            "flex items-start gap-2 rounded-2xl border px-3 py-3 font-inter text-[14px] font-normal leading-5",
                            item.completed
                              ? isLight
                                ? "border-black/10 bg-black/[0.02] text-black/35"
                                : "border-white/10 bg-white/[0.04] text-white/35"
                              : isLight
                                ? "border-[#CFC6C6] bg-white text-black/85"
                                : "border-white/10 bg-white/[0.06] text-white/90",
                          ].join(" ")}
                        >
                          <button
                            type="button"
                            onClick={() => void toggleOwnWallTask(item)}
                            disabled={!isLocalCard || !!wallTaskBusy}
                            className={[
                              "mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border transition",
                              isLocalCard ? "pointer-events-auto" : "pointer-events-none",
                              item.completed
                                ? "border-[#81DB86]/70 bg-[#81DB86]/15"
                                : isLight
                                  ? "border-black/15 bg-black/[0.02]"
                                  : "border-white/15 bg-white/[0.04]",
                            ].join(" ")}
                            title={isLocalCard ? "Toggle task" : "Task"}
                          >
                            {item.completed ? (
                              <span className="text-[11px] leading-none text-[#2FA84F]">✓</span>
                            ) : (
                              <img src={taskIconSrc} alt="" className="h-3.5 w-3.5 opacity-55" draggable={false} />
                            )}
                          </button>

                          <div className="min-w-0 flex-1">
                            <div className={item.completed ? "line-through" : ""}>{item.text}</div>

                            {shouldShowTimer ? (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <div
                                  className={[
                                    "inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-bold tabular-nums",
                                    timerRunning
                                      ? "border-[#81DB86] bg-[#81DB86]/15 text-[#248A3D]"
                                      : isLight
                                        ? "border-[#CFC6C6] bg-[#F7F5F5] text-black/60"
                                        : "border-white/10 bg-white/[0.05] text-white/65",
                                  ].join(" ")}
                                  title="Time spent on this task"
                                >
                                  {formatTaskTimer(elapsedMs)}
                                </div>

                                {isLocalCard ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleTaskTimer(item);
                                      }}
                                      className={[
                                        "h-7 rounded-full border px-2 text-[11px] font-bold transition",
                                        timerRunning
                                          ? "border-[#F65252]/50 bg-[#F65252]/10 text-[#C73535] hover:bg-[#F65252]/15"
                                          : "border-[#81DB86] bg-[#81DB86]/15 text-[#248A3D] hover:bg-[#81DB86]/25",
                                      ].join(" ")}
                                      title={timerRunning ? "Pause timer" : "Start timer"}
                                    >
                                      {timerRunning ? "Pause" : "Start"}
                                    </button>

                                    {elapsedMs > 0 ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          resetTaskTimer(item);
                                        }}
                                        className={[
                                          "h-7 rounded-full border px-2 text-[11px] font-bold transition",
                                          isLight
                                            ? "border-[#CFC6C6] bg-[#F7F5F5] text-black/55 hover:bg-[#ECEAEA]"
                                            : "border-white/10 bg-white/[0.04] text-white/55 hover:bg-white/[0.08]",
                                        ].join(" ")}
                                        title="Reset timer"
                                      >
                                        Reset
                                      </button>
                                    ) : null}
                                  </>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <button
                      type="button"
                      onClick={isLocalCard ? undefined : onOpenTasks}
                      className={[
                        "w-full rounded-2xl border border-dashed px-4 py-4 text-left font-inter text-[14px] font-normal transition",
                        isLight
                          ? "border-black/15 text-black/45 hover:bg-black/[0.03]"
                          : "border-white/15 text-white/45 hover:bg-white/[0.05]",
                      ].join(" ")}
                    >
                      No task yet{isLocalCard ? " — add yours above" : ""}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type RoomPageLiveKitProps = {
  /**
   * Lets pretty public URLs like /yaroslav render the real room without
   * changing the browser address to /room-livekit/:id.
   */
  sessionIdOverride?: string | null;
};

export function RoomPageLiveKit({
  sessionIdOverride = null,
}: RoomPageLiveKitProps = {}) {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const effectiveSessionParam = useMemo(
    () => String(sessionIdOverride || routeId || "").trim(),
    [sessionIdOverride, routeId],
  );

  const [entitlementState, setEntitlementState] =
    useState<EntitlementState | null>(null);
  const [paywallModalOpen, setPaywallModalOpen] = useState(false);
  const [aiHostInputOpen, setAiHostInputOpen] = useState(true);
  const [videoTileLayoutPreset, setVideoTileLayoutPreset] =
    useState<VideoTileLayoutPreset>(() => {
      if (typeof window === "undefined") return "auto";
      return normalizeVideoTileLayoutPreset(
        window.localStorage.getItem(VIDEO_TILE_LAYOUT_PRESET_KEY) ||
        window.localStorage.getItem("mysession_mobile_video_layout_mode"),
      );
    });
  const [showMobileLayoutSwitcher, setShowMobileLayoutSwitcher] = useState(
    () => {
      try {
        return localStorage.getItem(MOBILE_LAYOUT_SWITCHER_VISIBLE_KEY) !== "0";
      } catch {
        return true;
      }
    },
  );
  const updateShowMobileLayoutSwitcher = useCallback((next: boolean) => {
    setShowMobileLayoutSwitcher(next);

    try {
      localStorage.setItem(
        MOBILE_LAYOUT_SWITCHER_VISIBLE_KEY,
        next ? "1" : "0",
      );
    } catch {
      // ignore
    }
  }, []);
  const [videoTileLayoutColumns, setVideoTileLayoutColumns] = useState<number>(
    () => readStoredLayoutNumber(VIDEO_TILE_LAYOUT_COLUMNS_KEY),
  );
  const [videoTileLayoutRows, setVideoTileLayoutRows] = useState<number>(() =>
    readStoredLayoutNumber(VIDEO_TILE_LAYOUT_ROWS_KEY),
  );

  const mobileVideoLayoutMode = videoTileLayoutPreset as MobileVideoLayoutMode;

  useEffect(() => {
    try {
      window.localStorage.setItem(
        VIDEO_TILE_LAYOUT_PRESET_KEY,
        videoTileLayoutPreset,
      );
      window.localStorage.setItem(
        "mysession_mobile_video_layout_mode",
        videoTileLayoutPreset,
      );
      window.localStorage.setItem(
        VIDEO_TILE_LAYOUT_COLUMNS_KEY,
        String(videoTileLayoutColumns || 0),
      );
      window.localStorage.setItem(
        VIDEO_TILE_LAYOUT_ROWS_KEY,
        String(videoTileLayoutRows || 0),
      );
    } catch {
      // ignore
    }
  }, [videoTileLayoutPreset, videoTileLayoutColumns, videoTileLayoutRows]);

  const tabId = useMemo(() => makeLiveKitPageTabId(), []);
  const devClones = useMemo(
    () => Math.max(0, Math.min(24, getQueryInt("devClones", 0))),
    [],
  );
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const state = await loadEntitlementState();
        if (!cancelled) {
          setEntitlementState(state);
        }
      } catch (e) {
        console.error("[RoomPageLiveKit] entitlement load failed:", e);
        if (!cancelled) {
          setEntitlementState(null);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  const paywallDecision = useMemo(() => {
    if (!entitlementState) return null;

    return getPaywallDecision({
      entitlement: entitlementState.entitlement,
      usage: entitlementState.usage,
    });
  }, [entitlementState]);

  const forcePaywall = isPersonalPaywallForced(entitlementState);

  const paywallBlocked = !!paywallDecision?.blocked;

  const paywallRuntimeEnabled = PAYWALL_ENABLED || forcePaywall;

  const paywallRuntimeBlocked = forcePaywall
    ? true
    : paywallRuntimeEnabled && paywallBlocked;

  useEffect(() => {
    console.log("[PAYWALL Room DEBUG]", {
      PAYWALL_ENABLED,
      paywallRuntimeEnabled,
      entitlementState,
      paywallDecision,
      paywallBlocked,
      paywallRuntimeBlocked,
    });
  }, [entitlementState, paywallDecision, paywallBlocked]);

  useEffect(() => {
    console.log("[PAYWALL RoomPageLiveKit]", {
      PAYWALL_ENABLED,
      paywallRuntimeEnabled,
      entitlementState,
      paywallDecision,
      paywallBlocked,
      paywallRuntimeBlocked,
    });
  }, [
    PAYWALL_ENABLED,
    paywallRuntimeEnabled,
    entitlementState,
    paywallDecision,
    paywallBlocked,
    paywallRuntimeBlocked,
  ]);

  // theme
  const [theme, setTheme] = useState<RoomTheme>(() => {
    try {
      const v = String(localStorage.getItem("room_theme") || "").toLowerCase();
      return v === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const isLight = theme === "light";

  useEffect(() => {
    try {
      localStorage.setItem("room_theme", theme);
    } catch { }
  }, [theme]);

  useEffect(() => {
    try {
      const root = document.documentElement;
      const body = document.body;

      const prevRootDark = root.classList.contains("dark");
      const prevBodyDark = body.classList.contains("dark");
      const prevRootTheme = root.getAttribute("data-theme");
      const prevBodyTheme = body.getAttribute("data-theme");
      const prevRootColorScheme = (root.style as any).colorScheme;
      const prevBodyColorScheme = (body.style as any).colorScheme;

      const isDark = theme === "dark";

      root.classList.toggle("dark", isDark);
      body.classList.toggle("dark", isDark);

      root.setAttribute("data-theme", theme);
      body.setAttribute("data-theme", theme);

      (root.style as any).colorScheme = theme;
      (body.style as any).colorScheme = theme;

      return () => {
        root.classList.toggle("dark", prevRootDark);
        body.classList.toggle("dark", prevBodyDark);

        if (prevRootTheme === null) root.removeAttribute("data-theme");
        else root.setAttribute("data-theme", prevRootTheme);

        if (prevBodyTheme === null) body.removeAttribute("data-theme");
        else body.setAttribute("data-theme", prevBodyTheme);

        (root.style as any).colorScheme = prevRootColorScheme || "";
        (body.style as any).colorScheme = prevBodyColorScheme || "";
      };
    } catch {
      return;
    }
  }, [theme]);

  const [isLgUp, setIsLgUp] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia("(min-width: 1024px)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsLgUp(!!mql.matches);
    try {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    } catch {
      // @ts-ignore
      mql.addListener(onChange);
      // @ts-ignore
      return () => mql.removeListener(onChange);
    }
  }, []);

  const [isMobileQuery, setIsMobileQuery] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });
  const [isTabletQuery, setIsTabletQuery] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(min-width: 768px) and (max-width: 1023px)")
      .matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const m1 = window.matchMedia("(max-width: 767px)");
    const m2 = window.matchMedia("(min-width: 768px) and (max-width: 1023px)");
    const on1 = () => setIsMobileQuery(!!m1.matches);
    const on2 = () => setIsTabletQuery(!!m2.matches);
    on1();
    on2();
    try {
      m1.addEventListener("change", on1);
      m2.addEventListener("change", on2);
      return () => {
        m1.removeEventListener("change", on1);
        m2.removeEventListener("change", on2);
      };
    } catch {
      // @ts-ignore
      m1.addListener(on1);
      // @ts-ignore
      m2.addListener(on2);
      // @ts-ignore
      return () => {
        // @ts-ignore
        m1.removeListener(on1);
        // @ts-ignore
        m2.removeListener(on2);
      };
    }
  }, []);

  // session
  const [session, setSession] = useState<SessionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionLoadError, setSessionLoadError] = useState<string>("");

  const [joinGateBookingBusy, setJoinGateBookingBusy] = useState(false);
  const [joinGateBooked, setJoinGateBooked] = useState(false);

  // auth + profile
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  useEffect(() => {
    const booked =
      !!authUserId &&
      !!(session as any)?.session_bookings?.some(
        (b: any) => String(b?.user_id || "") === String(authUserId),
      );

    setJoinGateBooked(booked);
  }, [(session as any)?.session_bookings, authUserId]);
  const [authReady, setAuthReady] = useState(false);
  const [activeBan, setActiveBan] = useState<ActiveBan | null>(null);
  const [banLoading, setBanLoading] = useState(false);
  const [authGateStatus, setAuthGateStatus] = useState<
    "checking" | "authed" | "guest"
  >("checking");
  const [userName, setUserName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const localRoomDisplayNameOverrideRef = useRef<string>("");
  const [localRoomDisplayNameVersion, setLocalRoomDisplayNameVersion] =
    useState(0);
  const applyRoomDisplayNameLocally = (nextRaw: string) => {
    const next = String(nextRaw || "").trim();
    if (!next) return;

    // 1) локальный source of truth для local tile
    localRoomDisplayNameOverrideRef.current = next;
    setLocalRoomDisplayNameVersion((v) => v + 1);

    // 2) основной state
    setDisplayName(next);

    // 3) prejoin state
    setPrejoin((prev) => ({
      ...prev,
      displayName: next,
    }));

    // 4) prejoin ref
    prejoinRef.current = {
      ...prejoinRef.current,
      displayName: next,
    };
  };

  const setMyStatus = async (status: string | null) => {
    const room = roomRef.current;
    const me = room?.localParticipant;
    if (!me) return;

    let currentMeta = {};
    try {
      currentMeta = JSON.parse(me.metadata || "{}");
    } catch { }

    const nextMeta = {
      ...currentMeta,
      status, // 👈 ВОТ ЭТО
    };

    try {
      await me.setMetadata(JSON.stringify(nextMeta));
    } catch (e) {
      console.error("setMetadata failed", e);
    }
  };

  const [localAvatarUrl, setLocalAvatarUrl] = useState<string>("");
  const accessTokenRef = useRef<string>("");
  const currentAuthUserIdRef = useRef<string | null>(null);
  const sessionJoinStartedAtRef = useRef<number | null>(null);
  const usageTrackedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const applyAuthSession = (event: string, session: any) => {
      if (!mounted) return;

      const nextAccessToken = String(session?.access_token || "").trim();
      const nextUserId = String(session?.user?.id || "").trim();

      accessTokenRef.current = nextAccessToken;

      if (nextUserId) {
        const sameUser = currentAuthUserIdRef.current === nextUserId;

        currentAuthUserIdRef.current = nextUserId;

        // Token refresh must NOT behave like a room auth transition.
        // It should update accessTokenRef only, without retriggering room/session/join state.
        if (
          sameUser &&
          (event === "TOKEN_REFRESHED" ||
            event === "USER_UPDATED" ||
            event === "INITIAL_SESSION")
        ) {
          setAuthReady((prev) => (prev ? prev : true));
          return;
        }

        setAuthUserId((prev) => (prev === nextUserId ? prev : nextUserId));
        setAuthGateStatus((prev) => (prev === "authed" ? prev : "authed"));
        setAuthReady((prev) => (prev ? prev : true));
        return;
      }

      if (event === "SIGNED_OUT") {
        currentAuthUserIdRef.current = null;
        accessTokenRef.current = "";

        setAuthUserId((prev) => (prev === null ? prev : null));
        setAuthGateStatus((prev) => (prev === "guest" ? prev : "guest"));
        setAuthReady((prev) => (prev ? prev : true));
        return;
      }

      setAuthReady((prev) => (prev ? prev : true));
    };

    void supabase.auth.getSession().then(({ data }) => {
      applyAuthSession("INITIAL_SESSION", data?.session || null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      applyAuthSession(event, session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const [selectedUser, setSelectedUser] = useState<HostProfile | null>(null);
  const [tileMenuAnchor, setTileMenuAnchor] = useState<{
    tileId: string;
    x: number;
    y: number;
    viewportWidth: number;
    viewportHeight: number;
    portalDocument: Document | null;
  } | null>(null);
  const [openTileAdminMenuId, setOpenTileAdminMenuId] = useState<string | null>(
    null,
  );
  const [screenSharePinned, setScreenSharePinned] = useState(false);
  const [pinnedScreenShareTileId, setPinnedScreenShareTileId] = useState<
    string | null
  >(null);
  const [timelineEditorOpen, setTimelineEditorOpen] = useState(false);
  const [timelineDraftBlocks, setTimelineDraftBlocks] = useState<
    RoomTimelineBlock[]
  >([]);
  const [timelineSaving, setTimelineSaving] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<TileModel | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");

  // LiveKit env + token routing state
  const defaultLivekitUrl = String(
    (import.meta as any)?.env?.VITE_LIVEKIT_URL || "",
  ).trim();
  const tokenEndpoint = String(
    (import.meta as any)?.env?.VITE_LIVEKIT_TOKEN_ENDPOINT ||
    "/api/livekit/token",
  ).trim();
  const adminEndpoint = String(
    (import.meta as any)?.env?.VITE_LIVEKIT_ADMIN_ENDPOINT ||
    "/api/livekit/admin",
  ).trim();

  const [lkServerUrl, setLkServerUrl] = useState<string>(defaultLivekitUrl);
  const [lkToken, setLkToken] = useState<string>("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string>("");
  const [assignedServerId, setAssignedServerId] = useState<string>("");

  const getFreshAccessToken = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      let token = String(data?.session?.access_token || "").trim();

      if (token) {
        accessTokenRef.current = token;
        return token;
      }

      const { data: refreshed, error: refreshError } =
        await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;

      token = String(refreshed?.session?.access_token || "").trim();
      if (token) {
        accessTokenRef.current = token;
        return token;
      }

      throw new Error("No active Supabase access token");
    } catch (e: any) {
      throw new Error(
        String(e?.message || e || "Failed to refresh auth session"),
      );
    }
  };

  const sessionId = useMemo(() => String(session?.id || ""), [session?.id]);
  const sessionTitle = useMemo(
    () => String(session?.title || "Session"),
    [session?.title],
  );

  // profile cache for remote
  const [profilesById, setProfilesById] = useState<Record<string, HostProfile>>(
    {},
  );

  // prejoin
  const [prejoinOpen, setPrejoinOpen] = useState(false);
  const [joinRequested, setJoinRequested] = useState(false);
  useEffect(() => {
    joinRequestedRef.current = joinRequested;
  }, [joinRequested]);
  const prejoinBootstrappedSessionIdRef = useRef<string>("");
  const joinFlowStartedRef = useRef(false);
  const connectingFromPrejoinRef = useRef(false);

  const [devices, setDevices] = useState<MediaDevicesResult>({
    videoInputs: [],
    audioInputs: [],
    audioOutputs: [],
  });

  const [deviceError, setDeviceError] = useState<string>("");
  const [audioOutputSupported, setAudioOutputSupported] = useState<boolean>(
    () => canUseSetSinkId(),
  );

  const deviceTier = useMemo(
    () =>
      detectDeviceTier({
        isMobile: isMobileQuery,
        isTablet: isTabletQuery,
      }),
    [isMobileQuery, isTabletQuery],
  );

  const capturePreset = useMemo(
    () => getCapturePresetForTier(deviceTier),
    [deviceTier],
  );

  const isChromeOS = useMemo(() => isChromeOSLike(), []);

  // Mobile/tablet browsers are the unstable path. ChromeOS is NOT treated as tablet here,
  // because Chromebooks should keep background upload/FX available in pre-join.
  const lowPowerMobileMode = useMemo(() => {
    return (isMobileQuery || isTabletQuery) && !isChromeOS;
  }, [isMobileQuery, isTabletQuery, isChromeOS]);

  const shouldDisableBackgroundFx = useMemo(() => {
    return isMobileQuery || isTabletQuery;
  }, [isMobileQuery, isTabletQuery]);

  const prejoinPreviewPreset = useMemo(() => {
    if (lowPowerMobileMode) {
      return {
        width: 320,
        height: 180,
        fps: 8,
      };
    }

    if (isChromeOS) {
      return {
        width: 640,
        height: 360,
        fps: 15,
      };
    }

    if (deviceTier === "weak") {
      return {
        width: 640,
        height: 360,
        fps: 12,
      };
    }

    return {
      width: capturePreset.width,
      height: capturePreset.height,
      fps: capturePreset.fps,
    };
  }, [lowPowerMobileMode, isChromeOS, deviceTier, capturePreset]);

  const [prejoin, setPrejoin] = useState<PreJoinSettings>(() => ({
    displayName: "",
    audioInputId: "",
    videoInputId: "",
    audioOutputId: "default",

    audioEnabled: false,
    videoEnabled: true,

    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }));
  const prejoinRef = useRef(prejoin);
  useEffect(() => {
    prejoinRef.current = prejoin;
  }, [prejoin]);

  useEffect(() => {
    const nm = String(displayName || userName || "").trim();
    if (!nm) return;

    setPrejoin((prev) => {
      if (String(prev.displayName || "").trim()) return prev;
      return { ...prev, displayName: nm };
    });

    if (!String(prejoinRef.current.displayName || "").trim()) {
      prejoinRef.current = {
        ...prejoinRef.current,
        displayName: nm,
      };
    }
  }, [displayName, userName]);

  const [selectedAudioOutputId, setSelectedAudioOutputId] =
    useState<string>("default");
  const [selectedAudioInputId, setSelectedAudioInputId] = useState<string>("");
  const [selectedVideoInputId, setSelectedVideoInputId] = useState<string>("");

  const [echoCancellationEnabled, setEchoCancellationEnabled] = useState(true);
  const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState(true);
  const [autoGainControlEnabled, setAutoGainControlEnabled] = useState(true);

  useEffect(() => {
    const nextEcho = true;
    const nextNoise = true;
    const nextAgc = true;

    setPrejoin((prev) => ({
      ...prev,
      echoCancellation: nextEcho,
      noiseSuppression: nextNoise,
      autoGainControl: nextAgc,
    }));

    prejoinRef.current = {
      ...prejoinRef.current,
      echoCancellation: nextEcho,
      noiseSuppression: nextNoise,
      autoGainControl: nextAgc,
    };

    setEchoCancellationEnabled(nextEcho);
    setNoiseSuppressionEnabled(nextNoise);
    setAutoGainControlEnabled(nextAgc);
  }, []);

  // pre-join prepared preview track
  const prejoinPreparedVideoTrackRef = useRef<LocalVideoTrack | null>(null);
  const [prejoinPreviewVersion, setPrejoinPreviewVersion] = useState(0);
  const prejoinPreviewInitInFlightRef = useRef(false);
  const deviceLabelsWarmupAttemptedRef = useRef(false);

  // roles
  const [moderatorUserIds, setModeratorUserIds] = useState<string[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState<string>("");
  const [roleBusyKey, setRoleBusyKey] = useState<string>("");
  const loadModeratorsInFlightRef = useRef(false);
  const lastModeratorsLoadAtRef = useRef(0);
  const lastModeratorsLoadSessionIdRef = useRef("");

  // right panel
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia("(min-width: 1024px)").matches;
  });

  const [viewportW, setViewportW] = useState<number>(() => {
    if (typeof window === "undefined") return 1440;
    return window.innerWidth || 1440;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    let raf = 0;

    const update = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        setViewportW(window.innerWidth || 1440);
      });
    };

    update();

    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  const rightPanelWidthPx = useMemo(() => {
    if (!rightPanelOpen || !isLgUp) return 0;

    if (viewportW < 1100) return 320;
    if (viewportW < 1280) return 340;
    if (viewportW < 1440) return 360;
    if (viewportW < 1680) return 390;

    return 420;
  }, [rightPanelOpen, isLgUp, viewportW]);

  const roomGridTemplateColumns = useMemo(() => {
    if (!rightPanelOpen || !isLgUp) return "minmax(0, 1fr)";
    return `minmax(0, 1fr) ${rightPanelWidthPx}px`;
  }, [rightPanelOpen, isLgUp, rightPanelWidthPx]);

  const roomUiScale = useMemo(() => {
    if (!isLgUp) return "lg";
    if (viewportW < 1280) return "md";
    return "lg";
  }, [isLgUp, viewportW]);

  const roomPanelPaddingClass = roomUiScale === "md" ? "p-3" : "p-4";

  const roomPanelHeaderClass =
    roomUiScale === "md" ? "px-2.5 py-2" : "px-3 py-2";

  const roomPanelTitleClass =
    roomUiScale === "md" ? "text-[12px]" : "text-[13px]";

  const roomPanelPillClass =
    roomUiScale === "md" ? "h-7 px-2 text-[11px]" : "h-8 px-3 text-xs";

  const roomPanelIconClass = roomUiScale === "md" ? "w-3.5 h-3.5" : "w-4 h-4";

  const [rightTab, setRightTab] = useState<RightPanelTab>("tasks");
  const [chatViewMode, setChatViewMode] = useState<"general" | "host">(
    "general",
  );
  const [hostChatPeerIds, setHostChatPeerIds] = useState<string[]>([]);
  const [selectedHostChatPeerId, setSelectedHostChatPeerId] = useState<
    string | null
  >(null);
  const [hostDmDropdownOpen, setHostDmDropdownOpen] = useState(false);
  const hostDmDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostDmDropdownOpen) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (hostDmDropdownRef.current?.contains(target)) return;
      setHostDmDropdownOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHostDmDropdownOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("touchstart", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("touchstart", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [hostDmDropdownOpen]);

  useEffect(() => {
    setHostDmDropdownOpen(false);
  }, [chatViewMode, rightTab]);
  const openRightTab = (tab: RightPanelTab) => {
    if (!tab) {
      setRightPanelOpen(false);
      setRightTab(null);
      return;
    }
    setRightTab((prev) => {
      const same = prev === tab;
      setRightPanelOpen((prevOpen) => (same ? !prevOpen : true));
      return tab;
    });
  };

  const openTileMenuAt = useCallback(
    (tileId: string, anchorEl: HTMLElement | null) => {
      if (!anchorEl) return;

      const r = anchorEl.getBoundingClientRect();
      const ownerDoc = anchorEl.ownerDocument || document;
      const ownerWin = ownerDoc.defaultView || window;

      setOpenTileAdminMenuId(tileId);
      setTileMenuAnchor({
        tileId,
        x: r.right,
        y: r.bottom,
        viewportWidth: ownerWin.innerWidth,
        viewportHeight: ownerWin.innerHeight,
        portalDocument: ownerDoc,
      });
    },
    [],
  );

  const closeTileMenu = useCallback(() => {
    setOpenTileAdminMenuId(null);
    setTileMenuAnchor(null);
  }, []);

  useEffect(() => {
    if (!openTileAdminMenuId) return;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const insideAnchor = !!target.closest(
        "[data-lk-admin-menu-anchor='true']",
      );
      const insideSurface = !!target.closest(
        "[data-lk-admin-menu-surface='true']",
      );

      if (insideAnchor || insideSurface) return;
      closeTileMenu();
    };

    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTileMenu();
    };

    const onWindowChange = () => {
      closeTileMenu();
    };

    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("touchstart", onPointerDown, true);
    document.addEventListener("keydown", onEscape, true);
    window.addEventListener("resize", onWindowChange);

    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("touchstart", onPointerDown, true);
      document.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("resize", onWindowChange);
    };
  }, [openTileAdminMenuId, closeTileMenu]);

  useEffect(() => {
    const fire = () => {
      try {
        window.dispatchEvent(new Event("resize"));
      } catch { }
    };
    requestAnimationFrame(fire);
    const t1 = window.setTimeout(fire, 60);
    const t2 = window.setTimeout(fire, 220);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [rightPanelOpen, rightTab]);

  // stages
  const [stages, setStages] = useState<Stage[]>([]);
  const [, setHoveredStage] = useState<Stage | null>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const [remainingTime, setRemainingTime] = useState<string>("");

  const [stagebarStartTime, setStagebarStartTime] = useState<string>("");
  const [stagebarCycleSeconds, setStagebarCycleSeconds] = useState<
    number | undefined
  >(undefined);

  const prevStageRef = useRef<number>(-1);
  const firstTickDoneRef = useRef<boolean>(false);
  const focusStageCycleRef = useRef<number>(0);
  const postSessionShownForSessionRef = useRef<string>("");
  const welcomeLoopRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef<boolean>(false);
  const pendingRoomAudioUnlockRef = useRef<boolean>(false);
  const audioUnlockInFlightRef = useRef(false);
  const pendingStageSoundRef = useRef<{ url: string; volume: number } | null>(
    null,
  );

  const FOCUS_GONG_SOUNDS = [
    "/sounds/focus_gong_1.mp3",
    "/sounds/focus_gong_2.mp3",
    "/sounds/focus_gong_3.mp3",
  ] as const;

  const STAGE_SOUND_MAP: Record<string, string> = {
    intentions: "/sounds/intentions.mp3",
    break: "/sounds/break_start.mp3",
    outro: "/sounds/outro.mp3",
  };

  const BREAK_END_SOUND = "/sounds/break_end.mp3";
  const WELCOME_LOOP_SOUND = "/sounds/welcome_loop.mp3";

  const [roomSoundsEnabled, setRoomSoundsEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(ROOM_SOUNDS_PREF_KEY);
      return raw === null ? true : raw === "true";
    } catch {
      return true;
    }
  });
  const roomSoundsEnabledRef = useRef(roomSoundsEnabled);

  const [roomSoundsVolume, setRoomSoundsVolume] = useState<number>(() => {
    try {
      const raw = Number(
        localStorage.getItem(ROOM_SOUNDS_VOLUME_PREF_KEY) || "90",
      );
      if (!Number.isFinite(raw)) return 90;
      return Math.max(0, Math.min(100, Math.round(raw)));
    } catch {
      return 90;
    }
  });
  const roomSoundsVolumeRef = useRef(roomSoundsVolume);

  const [previewMirrored, setPreviewMirrored] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(PREVIEW_MIRROR_PREF_KEY);
      return raw === null ? true : raw === "true";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_MIRROR_PREF_KEY, String(previewMirrored));
    } catch { }
  }, [previewMirrored]);

  useEffect(() => {
    roomSoundsEnabledRef.current = roomSoundsEnabled;
    try {
      localStorage.setItem(ROOM_SOUNDS_PREF_KEY, String(roomSoundsEnabled));
    } catch { }
  }, [roomSoundsEnabled]);

  useEffect(() => {
    roomSoundsVolumeRef.current = roomSoundsVolume;
    try {
      localStorage.setItem(
        ROOM_SOUNDS_VOLUME_PREF_KEY,
        String(roomSoundsVolume),
      );
    } catch { }
  }, [roomSoundsVolume]);

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_MIRROR_PREF_KEY, String(previewMirrored));
    } catch { }
  }, [previewMirrored]);

  const playOneShot = (url: string, volume = 1) => {
    if (!url) {
      console.warn("[room-sound] skipped: empty url");
      return;
    }

    if (!roomSoundsEnabledRef.current) {
      console.warn("[room-sound] skipped: sounds disabled", { url });
      return;
    }

    const baseVolume = Math.max(
      0,
      Math.min(1, roomSoundsVolumeRef.current / 100),
    );
    const finalVolume = Math.max(0, Math.min(1, baseVolume * volume));

    const a = new Audio(url);
    a.preload = "auto";
    a.volume = finalVolume;

    a.addEventListener(
      "error",
      () => {
        console.error("[room-sound] audio error", {
          url,
          currentSrc: a.currentSrc,
          networkState: a.networkState,
          readyState: a.readyState,
        });
      },
      { once: true },
    );

    void a.play().then(
      () => {
        console.log("[room-sound] playing", { url, finalVolume });
      },
      (err) => {
        console.error("[room-sound] play failed", { url, err });
      },
    );
  };

  const playStageSoundSafely = (url: string, volume = 1) => {
    if (!url) return;

    if (!audioUnlockedRef.current) {
      pendingStageSoundRef.current = { url, volume };
      console.log("[room-sound] queued until unlock", { url, volume });
      return;
    }

    playOneShot(url, volume);
  };

  const ensureRoomAudioPlaybackUnlocked = useCallback(
    async (reason: string) => {
      const room = roomRef.current;
      if (!room) return;

      if (audioUnlockInFlightRef.current) return;
      audioUnlockInFlightRef.current = true;

      try {
        const anyRoom = room as any;

        if (typeof anyRoom.startAudio === "function") {
          await anyRoom.startAudio();
        }

        try {
          const audioEls = Array.from(
            document.querySelectorAll("audio"),
          ) as HTMLAudioElement[];
          await Promise.allSettled(
            audioEls.map(async (el) => {
              try {
                el.muted = false;
                await el.play();
              } catch { }
            }),
          );
        } catch { }

        audioUnlockedRef.current = true;

        setRemoteAudioBlocked(false);
        setRemoteAudioBlockedReason("");
        setAudioResumeNonce((v) => v + 1);

        console.log("[lk-audio] playback unlock ok:", reason);

        const pending = pendingStageSoundRef.current;
        if (pending?.url) {
          pendingStageSoundRef.current = null;
          console.log(
            "[room-sound] replaying pending sound after unlock",
            pending,
          );
          playOneShot(pending.url, pending.volume);
        }
      } catch (e: any) {
        console.warn("[lk-audio] playback unlock failed:", reason, e);
        setRemoteAudioBlocked(true);
        setRemoteAudioBlockedReason(
          String(e?.message || e || "audio_playback_blocked"),
        );
      } finally {
        audioUnlockInFlightRef.current = false;
      }
    },
    [],
  );

  const startWelcomeLoop = () => {
    stopWelcomeLoop();
    if (!roomSoundsEnabledRef.current) return;

    const baseVolume = Math.max(
      0,
      Math.min(1, roomSoundsVolumeRef.current / 100),
    );

    const a = new Audio(WELCOME_LOOP_SOUND);
    a.loop = true;
    a.volume = Math.max(0, Math.min(1, baseVolume * 0.6));
    welcomeLoopRef.current = a;
    a.play().catch(() => { });
  };

  const stopWelcomeLoop = () => {
    try {
      if (welcomeLoopRef.current) {
        welcomeLoopRef.current.pause();
        welcomeLoopRef.current.currentTime = 0;
        welcomeLoopRef.current = null;
      }
    } catch { }
  };

  useEffect(() => {
    if (!roomSoundsEnabled) stopWelcomeLoop();
  }, [roomSoundsEnabled]);

  useEffect(() => {
    const unlock = () => {
      if (audioUnlockedRef.current) return;

      const a = new Audio();
      a.play().catch(() => { });

      audioUnlockedRef.current = true;

      const pending = pendingStageSoundRef.current;
      if (pending?.url) {
        pendingStageSoundRef.current = null;
        console.log(
          "[room-sound] replaying pending sound after user gesture",
          pending,
        );
        playOneShot(pending.url, pending.volume);
      }

      window.removeEventListener("click", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("touchstart", unlock, true);
    };

    window.addEventListener("click", unlock, true);
    window.addEventListener("keydown", unlock, true);
    window.addEventListener("touchstart", unlock, true);

    return () => {
      window.removeEventListener("click", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("touchstart", unlock, true);
    };
  }, []);

  const maxParticipants = useMemo(() => {
    const raw = num((session as any)?.max_participants);
    const v = raw > 0 ? raw : 16;
    return Math.max(2, Math.min(50, Math.round(v)));
  }, [session]);

  const isInfiniteRoom = useMemo(() => {
    const raw = session?.schedule;
    if (parse50505(raw)) return true;

    const parsed = safeParseJson(raw);
    if (!isRecord(parsed)) return false;

    const kind = str((parsed as any).kind).toLowerCase();
    if (kind === "infinite_room") return true;
    if (kind.includes("infinite")) return true;

    if (
      isRecord((parsed as any).timer) &&
      (((parsed as any).timer as any).phases ||
        ((parsed as any).timer as any).segments)
    )
      return true;
    if ((parsed as any).phases || (parsed as any).segments) return true;

    return false;
  }, [session]);

  // Timeline/stage bar must be driven only by the actual schedule/stages.
  // Do not auto-hide or stop it based on session title/format/template text like "silent".
  const isSilentRoom = false;

  useEffect(() => {
    console.log("[LK SERVER ROUTING]", {
      sessionId,
      assignedServerId,
      lkServerUrl,
      hasToken: !!lkToken,
    });
  }, [sessionId, assignedServerId, lkServerUrl, lkToken]);

  useEffect(() => {
    prejoinBootstrappedSessionIdRef.current = "";
    joinFlowStartedRef.current = false;
    connectingFromPrejoinRef.current = false;
    sessionJoinStartedAtRef.current = null;
    usageTrackedRef.current = false;
    pendingStageSoundRef.current = null;
    audioUnlockedRef.current = false;
    postSessionShownForSessionRef.current = "";
    autoClosedSessionIdRef.current = "";
    setPrejoinOpen(false);
    setJoinRequested(false);
    setLkToken("");
    setLkServerUrl(defaultLivekitUrl);
    setAssignedServerId("");
  }, [sessionId, defaultLivekitUrl]);

  const [joinNowTickMs, setJoinNowTickMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const startIso = String(session?.start_time || "").trim();
    if (!startIso) return;

    const startMs = new Date(startIso).getTime();
    if (!Number.isFinite(startMs) || startMs <= 0) return;

    const allowMs = startMs - JOIN_EARLY_WINDOW_MINUTES * 60 * 1000;

    if (Date.now() >= allowMs) return;

    const t = window.setInterval(() => setJoinNowTickMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [session?.start_time]);

  const joinGateInfo = useMemo(() => {
    const startIso = String(session?.start_time || "").trim();

    if (!startIso) {
      return {
        enabled: false,
        canJoinNow: true,
        startMs: 0,
        allowMs: 0,
        msUntilAllowed: 0,
      };
    }

    const startMs = new Date(startIso).getTime();

    if (!Number.isFinite(startMs) || startMs <= 0) {
      return {
        enabled: false,
        canJoinNow: true,
        startMs: 0,
        allowMs: 0,
        msUntilAllowed: 0,
      };
    }

    const allowMs = startMs - JOIN_EARLY_WINDOW_MINUTES * 60 * 1000;

    return {
      enabled: true,
      canJoinNow: joinNowTickMs >= allowMs,
      startMs,
      allowMs,
      msUntilAllowed: Math.max(0, allowMs - joinNowTickMs),
    };
  }, [session?.start_time, joinNowTickMs]);

  const canJoinNow = joinGateInfo.canJoinNow;
  const joinBlocked = joinGateInfo.enabled && !joinGateInfo.canJoinNow;

  const [sessionAccessTickMs, setSessionAccessTickMs] = useState<number>(() =>
    Date.now(),
  );

  useEffect(() => {
    if (!session?.id) return;

    setSessionAccessTickMs(Date.now());
    const t = window.setInterval(
      () => setSessionAccessTickMs(Date.now()),
      1000,
    );

    return () => window.clearInterval(t);
  }, [session?.id]);

  const sessionCloseInfo = useMemo(() => {
    if (!session || isInfiniteRoom) {
      return {
        enabled: false,
        ended: false,
        closed: false,
        startMs: 0,
        endMs: 0,
        closeMs: 0,
        msUntilClose: 0,
      };
    }

    const startIso = String(
      stagebarStartTime || session.start_time || session.created_at || "",
    ).trim();
    const startMs = new Date(startIso).getTime();

    if (!Number.isFinite(startMs) || startMs <= 0) {
      return {
        enabled: false,
        ended: false,
        closed: false,
        startMs: 0,
        endMs: 0,
        closeMs: 0,
        msUntilClose: 0,
      };
    }

    const stageTotalSeconds = stages.reduce((acc, s) => {
      const sec = Number(s.durationSeconds || 0);
      if (sec > 0) return acc + sec;

      const mins = Number(s.duration || 0);
      return mins > 0 ? acc + mins * 60 : acc;
    }, 0);

    const scheduleTotalSeconds = getFixedSessionTotalSecondsFromSchedule(
      session.schedule,
    );
    const fallbackDurationMinutes = Number(
      (session as any).duration_minutes || 0,
    );
    const totalMs =
      stageTotalSeconds > 0
        ? stageTotalSeconds * 1000
        : scheduleTotalSeconds > 0
          ? scheduleTotalSeconds * 1000
          : fallbackDurationMinutes > 0
            ? fallbackDurationMinutes * 60 * 1000
            : 0;

    if (!Number.isFinite(totalMs) || totalMs <= 0) {
      return {
        enabled: false,
        ended: false,
        closed: false,
        startMs,
        endMs: 0,
        closeMs: 0,
        msUntilClose: 0,
      };
    }

    const endMs = startMs + totalMs;
    const closeMs = endMs + SESSION_CLOSE_GRACE_MINUTES * 60 * 1000;

    return {
      enabled: true,
      ended: sessionAccessTickMs >= endMs,
      closed: sessionAccessTickMs >= closeMs,
      startMs,
      endMs,
      closeMs,
      msUntilClose: Math.max(0, closeMs - sessionAccessTickMs),
    };
  }, [session, stages, stagebarStartTime, isInfiniteRoom, sessionAccessTickMs]);

  const checkActiveBanForRoom = useCallback(async () => {
    if (!authUserId || !authReady) {
      setActiveBan(null);
      return;
    }

    try {
      setBanLoading(true);
      const ban = await getCurrentUserActiveBan();
      setActiveBan(ban);

      if (ban) {
        setPrejoinOpen(false);
        setJoinRequested(false);
        setLkToken("");
        setClientError("");
        setMediaWarning("");
      }
    } catch (e) {
      console.warn("[ban] active ban check failed:", e);
      setActiveBan(null);
    } finally {
      setBanLoading(false);
    }
  }, [authUserId, authReady]);

  useEffect(() => {
    void checkActiveBanForRoom();
  }, [checkActiveBanForRoom]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const rawId = String(effectiveSessionParam || "").trim();

      if (!rawId) {
        setSession(null);
        setSessionLoadError("Missing session id.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setSessionLoadError("");

      try {
        let data: any = null;
        let error: any = null;

        // Main path: normal room-livekit/:uuid.
        if (looksLikeUuid(rawId)) {
          const res = await supabase
            .from("sessions")
            .select(SESSION_SELECT_STR)
            .eq("id", rawId)
            .maybeSingle();

          data = res.data;
          error = res.error;
        } else {
          // Fallback path: if a route ever passes a slug/custom room param.
          // This prevents the room from collapsing into the useless "Back" screen.
          const res = await supabase
            .from("sessions")
            .select(SESSION_SELECT_STR)
            .eq("custom_slug", rawId)
            .maybeSingle();

          data = res.data;
          error = res.error;
        }

        if (cancelled) return;

        if (data && !error) {
          const t = normalizeTemplates((data as any)?.session_templates);
          const norm = { ...(data as any), session_templates: t };
          setSession(norm as any);
          setSessionLoadError("");
          return;
        }

        console.warn("[room-session] failed to load session", {
          id: rawId,
          authReady,
          authUserId,
          error,
        });

        setSession(null);
        setSessionLoadError(
          String(
            error?.message ||
            (authUserId
              ? "Session was not found or is not available."
              : "Sign in to load this session."),
          ),
        );
      } catch (e: any) {
        if (cancelled) return;

        console.warn("[room-session] unexpected load error", e);
        setSession(null);
        setSessionLoadError(
          String(e?.message || e || "Failed to load session."),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveSessionParam, authReady, authUserId]);

  useEffect(() => {
    if (!session) return;

    setStages([]);
    setStagebarCycleSeconds(undefined);
    setStagebarStartTime("");

    const fallbackStart = String(
      session?.start_time || session?.created_at || new Date().toISOString(),
    );

    let parsed: unknown = safeParseJson(session.schedule);

    if (!parsed) {
      const t = parse50505(session.schedule);
      if (t) {
        parsed = {
          kind: "infinite_room",
          timer: {
            phases: {
              focus: t.focus,
              break: t.break,
              intentions: t.intentions,
            },
          },
          anchor_ts:
            session?.start_time || session?.created_at || fallbackStart,
        };
      }
    }

    if (isRecord(parsed)) {
      const maybeBlocks =
        (parsed as any).blocks ||
        (parsed as any).script ||
        (parsed as any).agenda ||
        (parsed as any).items ||
        (parsed as any).stages;
      if (Array.isArray(maybeBlocks)) parsed = maybeBlocks;
    }

    if (Array.isArray(parsed)) {
      const formatted: Stage[] = parsed
        .map((b): Stage | null => {
          const blk = isRecord(b) ? b : null;
          if (!blk) return null;

          const rawName =
            str((blk as any).name) ||
            str((blk as any).title) ||
            str((blk as any).label) ||
            str((blk as any).text) ||
            str((blk as any).key) ||
            "Stage";

          const rawType = str((blk as any).type) || str((blk as any).category);
          const inferredType: Stage["type"] = rawType
            ? inferStageTypeFromLabel(rawType)
            : inferStageTypeFromLabel(rawName);

          const minutes =
            num((blk as any).minutes) ||
            num((blk as any).mins) ||
            num((blk as any).duration_minutes) ||
            num((blk as any).durationMinutes) ||
            num((blk as any).durationMin) ||
            num((blk as any).duration) ||
            0;

          const seconds =
            num((blk as any).seconds) ||
            num((blk as any).durationSeconds) ||
            num((blk as any).duration_seconds) ||
            0;

          const durationSeconds =
            seconds > 0 ? seconds : minutes > 0 ? minutes * 60 : 0;
          const displayMinutes =
            minutes > 0
              ? minutes
              : seconds > 0
                ? Math.max(1, Math.round(seconds / 60))
                : 0;

          if (durationSeconds <= 0 || displayMinutes <= 0) return null;

          const color =
            str((blk as any).color) || STAGE_COLORS[inferredType] || "#F63135";
          return {
            name: rawName,
            duration: displayMinutes,
            color,
            type: inferredType,
            durationSeconds,
          };
        })
        .filter((x): x is Stage => !!x);

      setStages(formatted);
      setStagebarStartTime(String(session.start_time || fallbackStart));
      setStagebarCycleSeconds(undefined);
    }

    const isInfiniteScheduleObject =
      isRecord(parsed) &&
      (str((parsed as any).kind)
        .toLowerCase()
        .includes("infinite") ||
        (isRecord((parsed as any).timer) &&
          (((parsed as any).timer as any).phases ||
            ((parsed as any).timer as any).segments)) ||
        !!(parsed as any).phases ||
        !!(parsed as any).segments);

    if (isInfiniteScheduleObject && isRecord(parsed)) {
      const timer = isRecord((parsed as any).timer)
        ? ((parsed as any).timer as any)
        : null;

      const phasesRaw =
        timer?.phases ??
        timer?.segments ??
        (parsed as any).phases ??
        (parsed as any).segments ??
        null;
      const phases = normalizeInfinitePhases(phasesRaw);

      const formatted: Stage[] = phases.map((p) => {
        const rawPhaseName = String(p.name || "");
        const type = phaseToStageType(rawPhaseName);

        const displayName2 =
          type === "focus"
            ? "Focus"
            : type === "intentions"
              ? isCheckInLikeLabel(rawPhaseName)
                ? "Check-in"
                : "Tasks"
              : type === "break"
                ? "Break"
                : type === "intro"
                  ? "Intro"
                  : type === "outro"
                    ? "Outro"
                    : rawPhaseName || "Stage";

        const seconds = Number(p.seconds) || 0;
        const minutes = Math.max(1, Math.round(seconds / 60));

        return {
          name: displayName2,
          duration: minutes,
          color: STAGE_COLORS[type] || "#F63135",
          type,
          durationSeconds: seconds,
        };
      });

      setStages(formatted);

      const anchor = String(
        str((parsed as any).anchor_ts) ||
        str((parsed as any).anchorTs) ||
        str(session?.start_time) ||
        fallbackStart,
      );
      setStagebarStartTime(anchor);

      const sumSeconds = phases.reduce(
        (acc, p) => acc + (Number(p.seconds) || 0),
        0,
      );
      const timerCycle =
        timer && isRecord(timer)
          ? num((timer as any).cycle_seconds) ||
          num((timer as any).cycleSeconds)
          : 0;

      let cycleSeconds =
        timerCycle ||
        num((parsed as any).cycle_seconds) ||
        num((parsed as any).cycleSeconds) ||
        0;
      if (!cycleSeconds || cycleSeconds <= 0) cycleSeconds = sumSeconds;
      if (cycleSeconds < sumSeconds) cycleSeconds = sumSeconds;

      setStagebarCycleSeconds(Math.max(1, cycleSeconds));
    }

    if (!parsed) setStagebarStartTime(fallbackStart);
  }, [session]);

  const applySessionSnapshot = React.useCallback(
    (nextSession: SessionRow | any) => {
      if (!nextSession) return;

      setSession(nextSession);

      let parsed: unknown = safeParseJson(nextSession.schedule);

      if (!parsed) {
        const t = parse50505(nextSession.schedule);
        if (t) {
          parsed = {
            kind: "infinite_room",
            timer: {
              phases: {
                focus: t.focus,
                break: t.break,
                intentions: t.intentions,
              },
            },
            anchor_ts:
              nextSession?.start_time ||
              nextSession?.created_at ||
              new Date().toISOString(),
          };
        }
      }

      setStages([]);
      setStagebarCycleSeconds(undefined);
      setStagebarStartTime("");

      const fallbackStart = String(
        nextSession?.start_time ||
        nextSession?.created_at ||
        new Date().toISOString(),
      );

      if (isRecord(parsed)) {
        const maybeBlocks =
          (parsed as any).blocks ||
          (parsed as any).script ||
          (parsed as any).agenda ||
          (parsed as any).items ||
          (parsed as any).stages;

        if (Array.isArray(maybeBlocks)) parsed = maybeBlocks;
      }

      if (Array.isArray(parsed)) {
        const formatted: Stage[] = parsed
          .map((b): Stage | null => {
            const blk = isRecord(b) ? b : null;
            if (!blk) return null;

            const rawName =
              str((blk as any).name) ||
              str((blk as any).title) ||
              str((blk as any).label) ||
              str((blk as any).text) ||
              str((blk as any).key) ||
              "Stage";

            const rawType =
              str((blk as any).type) || str((blk as any).category);
            const inferredType: Stage["type"] = rawType
              ? inferStageTypeFromLabel(rawType)
              : inferStageTypeFromLabel(rawName);

            const minutes =
              num((blk as any).minutes) ||
              num((blk as any).mins) ||
              num((blk as any).duration_minutes) ||
              num((blk as any).durationMinutes) ||
              num((blk as any).durationMin) ||
              num((blk as any).duration) ||
              0;

            const seconds =
              num((blk as any).seconds) ||
              num((blk as any).durationSeconds) ||
              num((blk as any).duration_seconds) ||
              0;

            const durationSeconds =
              seconds > 0 ? seconds : minutes > 0 ? minutes * 60 : 0;
            const displayMinutes =
              minutes > 0
                ? minutes
                : seconds > 0
                  ? Math.max(1, Math.round(seconds / 60))
                  : 0;

            if (durationSeconds <= 0 || displayMinutes <= 0) return null;

            const color =
              str((blk as any).color) ||
              STAGE_COLORS[inferredType] ||
              "#F63135";
            return {
              name: rawName,
              duration: displayMinutes,
              color,
              type: inferredType,
              durationSeconds,
            };
          })
          .filter((x): x is Stage => !!x);

        setStages(formatted);
        setStagebarStartTime(String(nextSession.start_time || fallbackStart));
        setStagebarCycleSeconds(undefined);
        return;
      }

      const isInfiniteScheduleObject =
        isRecord(parsed) &&
        (str((parsed as any).kind)
          .toLowerCase()
          .includes("infinite") ||
          (isRecord((parsed as any).timer) &&
            (((parsed as any).timer as any).phases ||
              ((parsed as any).timer as any).segments)) ||
          !!(parsed as any).phases ||
          !!(parsed as any).segments);

      if (isInfiniteScheduleObject && isRecord(parsed)) {
        const timer = isRecord((parsed as any).timer)
          ? ((parsed as any).timer as any)
          : null;

        const phasesRaw =
          timer?.phases ??
          timer?.segments ??
          (parsed as any).phases ??
          (parsed as any).segments ??
          null;
        const phases = normalizeInfinitePhases(phasesRaw);

        const formatted: Stage[] = phases.map((p) => {
          const rawPhaseName = String(p.name || "");
          const type = phaseToStageType(rawPhaseName);

          const displayName2 =
            type === "focus"
              ? "Focus"
              : type === "intentions"
                ? isCheckInLikeLabel(rawPhaseName)
                  ? "Check-in"
                  : "Tasks"
                : type === "break"
                  ? "Break"
                  : type === "intro"
                    ? "Intro"
                    : type === "outro"
                      ? "Outro"
                      : rawPhaseName || "Stage";

          const seconds = Number(p.seconds) || 0;
          const minutes = Math.max(1, Math.round(seconds / 60));

          return {
            name: displayName2,
            duration: minutes,
            color: STAGE_COLORS[type] || "#F63135",
            type,
            durationSeconds: seconds,
          };
        });

        setStages(formatted);

        const anchor = String(
          str((parsed as any).anchor_ts) ||
          str((parsed as any).anchorTs) ||
          str(nextSession?.start_time) ||
          fallbackStart,
        );
        setStagebarStartTime(anchor);

        const sumSeconds = phases.reduce(
          (acc, p) => acc + (Number(p.seconds) || 0),
          0,
        );
        const timerCycle =
          timer && isRecord(timer)
            ? num((timer as any).cycle_seconds) ||
            num((timer as any).cycleSeconds)
            : 0;

        let cycleSeconds =
          timerCycle ||
          num((parsed as any).cycle_seconds) ||
          num((parsed as any).cycleSeconds) ||
          0;

        if (!cycleSeconds || cycleSeconds <= 0) cycleSeconds = sumSeconds;
        if (cycleSeconds < sumSeconds) cycleSeconds = sumSeconds;

        setStagebarCycleSeconds(Math.max(1, cycleSeconds));
        return;
      }

      if (!parsed) setStagebarStartTime(fallbackStart);
    },
    [],
  );

  const reloadSessionSnapshot = React.useCallback(async () => {
    if (!sessionId) return;

    try {
      const { data, error } = await supabase
        .from("sessions")
        .select(SESSION_SELECT_STR)
        .eq("id", sessionId)
        .single();

      if (error) throw error;
      if (!data) return;

      const t = normalizeTemplates((data as any)?.session_templates);
      const norm = { ...(data as any), session_templates: t };

      applySessionSnapshot(norm as any);
    } catch (e) {
      console.error("reloadSessionSnapshot failed:", e);
    }
  }, [sessionId, applySessionSnapshot]);

  useEffect(() => {
    if (!sessionId) return;

    const ch = supabase
      .channel(`livekit-session-sync:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `id=eq.${sessionId}`,
        },
        () => {
          void reloadSessionSnapshot();
        },
      )
      .subscribe();

    return () => {
      safeRemoveRealtimeChannel(ch);
    };
  }, [sessionId, reloadSessionSnapshot]);

  useEffect(() => {
    if (isSilentRoom) {
      setRemainingTime("");
      setCurrentStage(0);
      firstTickDoneRef.current = false;
      prevStageRef.current = -1;
      focusStageCycleRef.current = 0;
      stopWelcomeLoop();
      return;
    }

    if (!stagebarStartTime || !stages.length) return;

    const startMs = new Date(stagebarStartTime).getTime();
    if (Number.isNaN(startMs)) return;

    const stageSeconds = stages.map((s) => {
      const sec = Number(s.durationSeconds || 0);
      if (sec > 0) return sec;
      const mins = Number(s.duration || 0);
      return mins > 0 ? mins * 60 : 0;
    });

    const sumStageSeconds = stageSeconds.reduce((acc, v) => acc + v, 0);
    const loopSeconds =
      (Number(stagebarCycleSeconds) || 0) > 0
        ? Number(stagebarCycleSeconds)
        : Math.max(1, sumStageSeconds);

    const timer = window.setInterval(() => {
      const now = Date.now();
      const diffSecRaw = (now - startMs) / 1000;
      const diffSec =
        loopSeconds > 0 && isInfiniteRoom
          ? ((diffSecRaw % loopSeconds) + loopSeconds) % loopSeconds
          : diffSecRaw;

      let total = 0;
      let active = 0;
      let found = false;

      for (let i = 0; i < stages.length; i++) {
        const dur = stageSeconds[i] || 0;
        const next = total + dur;

        if (dur <= 0) continue;

        if (diffSec < next) {
          active = i;
          const rem = next - diffSec;
          setRemainingTime(
            `${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, "0")}`,
          );
          found = true;
          break;
        }

        total = next;
        active = i;
      }

      if (!found && !isInfiniteRoom) setRemainingTime("0:00");

      setCurrentStage(active);

      const stage = stages[active];

      if (!firstTickDoneRef.current) {
        if (stage?.type === "intro") {
          startWelcomeLoop();
        } else {
          stopWelcomeLoop();
        }

        // IMPORTANT:
        // User entering the room is NOT the same thing as a stage starting.
        // So on first tick we only sync refs/state and do NOT play any stage sound.
        focusStageCycleRef.current = 0;

        prevStageRef.current = active;
        firstTickDoneRef.current = true;
        return;
      }

      if (prevStageRef.current !== active) {
        const prev = stages[prevStageRef.current];
        const prevType = prev?.type;
        const newType = stage?.type;

        if (prevType === "break" && newType !== "break") {
          void ensureRoomAudioPlaybackUnlocked("break-end");
          playStageSoundSafely(BREAK_END_SOUND);
        }

        if (newType === "intro") {
          startWelcomeLoop();
        } else {
          stopWelcomeLoop();

          if (newType) {
            const t = inferStageTypeFromLabel(String(newType));

            void ensureRoomAudioPlaybackUnlocked(`stage-change:${t}`);

            if (t === "focus") {
              const gongIndex =
                focusStageCycleRef.current % FOCUS_GONG_SOUNDS.length;
              const focusSound = FOCUS_GONG_SOUNDS[gongIndex];

              if (focusSound) {
                playStageSoundSafely(focusSound);
              }

              focusStageCycleRef.current += 1;
            } else {
              const sound = STAGE_SOUND_MAP[t];
              if (sound) {
                playStageSoundSafely(sound);
              }
            }
          }
        }

        prevStageRef.current = active;
      }

      if (stage?.type !== "intro" && welcomeLoopRef.current) stopWelcomeLoop();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [
    stagebarStartTime,
    stages,
    isSilentRoom,
    isInfiniteRoom,
    stagebarCycleSeconds,
  ]);

  const refreshRoomAuth = useCallback(async () => {
    // Room auth must never redirect logged-out users away from the room.
    // It only decides:
    // - guest  -> render room shell + in-room auth modal
    // - authed -> render prejoin / room flow
    setAuthGateStatus("checking");
    setAuthReady(false);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const activeSession = sessionData?.session || null;
      const u = activeSession?.user || null;

      if (!u) {
        setAuthUserId(null);
        accessTokenRef.current = "";
        setAuthGateStatus("guest");
        setAuthReady(true);
        return;
      }

      setAuthUserId(u.id || null);
      accessTokenRef.current = String(activeSession?.access_token || "").trim();

      setAuthGateStatus("authed");
      setAuthReady(true);
    } catch (e) {
      console.warn("[room-auth] auth check failed:", e);
      setAuthUserId(null);
      accessTokenRef.current = "";
      setAuthGateStatus("guest");
      setAuthReady(true);
    }
  }, []);

  useEffect(() => {
    void refreshRoomAuth();
  }, [refreshRoomAuth]);

  useEffect(() => {
    const onRefresh = () => {
      void refreshRoomAuth();
    };

    window.addEventListener("mysession-room-auth-refresh", onRefresh);
    return () =>
      window.removeEventListener("mysession-room-auth-refresh", onRefresh);
  }, [refreshRoomAuth]);

  useEffect(() => {
    (async () => {
      if (!authUserId) return;

      try {
        const { data } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .eq("id", authUserId)
          .maybeSingle();

        const nm = String((data as any)?.full_name || "").trim();
        const avatar = await resolveAvatarUrlFromProfilesField(
          String((data as any)?.avatar_url || ""),
        );

        if (nm) {
          setUserName(nm);
          setDisplayName((prev) => String(prev || "").trim() || nm);
          setPrejoin((prev) => {
            if (String(prev.displayName || "").trim()) return prev;
            return { ...prev, displayName: nm };
          });
          prejoinRef.current = {
            ...prejoinRef.current,
            displayName:
              String(prejoinRef.current.displayName || "").trim() || nm,
          };
        }

        if (avatar) {
          setLocalAvatarUrl(avatar);
        }
      } catch (e) {
        console.warn("self profile fetch failed", e);
      }
    })();
  }, [authUserId]);

  const openTimelineEditor = () => {
    if (!isHost) return;

    const parsedBlocks = timelineBlocksFromSchedule(session?.schedule);
    setTimelineDraftBlocks(
      parsedBlocks.length ? parsedBlocks : makeDefaultTimelineBlocks(),
    );
    setTimelineEditorOpen(true);
  };

  const closeTimelineEditor = () => {
    if (timelineSaving) return;
    setTimelineEditorOpen(false);
  };

  const saveTimelineEditor = async () => {
    if (!isHost) return;
    if (!sessionId) return;

    if (!timelineDraftBlocks.length) {
      alert("Add at least one block before saving");
      return;
    }

    setTimelineSaving(true);

    try {
      const nextSchedule = timelineBlocksToSchedulePayload(
        timelineDraftBlocks,
        {
          preserveInfinite: isInfiniteRoom,
          anchorTs:
            stagebarStartTime ||
            session?.start_time ||
            session?.created_at ||
            new Date().toISOString(),
        },
      );

      const nextDurationMinutes = getTimelineTotalMinutes(timelineDraftBlocks);

      const { data: updated, error } = await supabase
        .from("sessions")
        .update({
          schedule: nextSchedule,
          duration_minutes: nextDurationMinutes,
        })
        .eq("id", sessionId)
        .select(SESSION_SELECT_STR)
        .single();

      if (error) throw error;

      const nextSession =
        updated ||
        ({
          ...session,
          schedule: nextSchedule,
          duration_minutes: nextDurationMinutes,
        } as SessionRow);

      applySessionSnapshot(nextSession);
      setTimelineEditorOpen(false);
    } catch (e: any) {
      console.error("Timeline save error:", e);
      alert(String(e?.message || e || "Failed to save timeline"));
    } finally {
      setTimelineSaving(false);
    }
  };

  const loadBrowserDevices = useCallback(
    async (opts?: { preserveSelection?: boolean }) => {
      console.time("lk:loadBrowserDevices");

      try {
        setDeviceError("");
        setAudioOutputSupported(canUseSetSinkId());

        if (!navigator.mediaDevices?.enumerateDevices) {
          setDeviceError(
            "This browser does not support media device enumeration.",
          );
          return;
        }

        let list = await navigator.mediaDevices.enumerateDevices();

        const labelsMissing = list.some((d) => {
          if (d.kind !== "videoinput" && d.kind !== "audioinput") return false;
          return !String(d.label || "").trim();
        });

        const shouldWarmupLabels = false;

        if (shouldWarmupLabels) {
          deviceLabelsWarmupAttemptedRef.current = true;

          try {
            const warmupStream = await navigator.mediaDevices.getUserMedia({
              video: prejoinRef.current.videoEnabled
                ? {
                  width: { ideal: 160 },
                  height: { ideal: 120 },
                  frameRate: { ideal: 5, max: 5 },
                }
                : false,
              audio: false,
            });

            warmupStream.getTracks().forEach((t) => t.stop());

            list = await navigator.mediaDevices.enumerateDevices();
          } catch {
            // labels may stay empty, but device list can still be available
          }
        }

        const videoInputs = list.filter((d) => d.kind === "videoinput");
        const audioInputs = list.filter((d) => d.kind === "audioinput");
        const audioOutputs = list.filter((d) => d.kind === "audiooutput");

        setDevices({ videoInputs, audioInputs, audioOutputs });

        const nextVideoInputId = pickExistingDeviceId(
          opts?.preserveSelection
            ? selectedVideoInputId || prejoinRef.current.videoInputId
            : prejoinRef.current.videoInputId,
          videoInputs,
        );

        const nextAudioInputId = pickExistingDeviceId(
          opts?.preserveSelection
            ? selectedAudioInputId || prejoinRef.current.audioInputId
            : prejoinRef.current.audioInputId,
          audioInputs,
        );

        const nextAudioOutputId = canUseSetSinkId()
          ? pickExistingDeviceId(
            opts?.preserveSelection
              ? selectedAudioOutputId || prejoinRef.current.audioOutputId
              : prejoinRef.current.audioOutputId,
            audioOutputs,
            "default",
          ) || "default"
          : "default";

        setPrejoin((prev) => ({
          ...prev,
          videoInputId: nextVideoInputId,
          audioInputId: nextAudioInputId,
          audioOutputId: nextAudioOutputId,
        }));

        prejoinRef.current = {
          ...prejoinRef.current,
          videoInputId: nextVideoInputId,
          audioInputId: nextAudioInputId,
          audioOutputId: nextAudioOutputId,
        };

        setSelectedVideoInputId(nextVideoInputId);
        setSelectedAudioInputId(nextAudioInputId);
        setSelectedAudioOutputId(nextAudioOutputId);
      } catch (e: any) {
        console.error("loadBrowserDevices error:", e);
        setDeviceError(String(e?.message || e || "device_enumeration_failed"));
      } finally {
        console.timeEnd("lk:loadBrowserDevices");
      }
    },
    [
      selectedVideoInputId,
      selectedAudioInputId,
      selectedAudioOutputId,
      isMobileQuery,
      isTabletQuery,
    ],
  );

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;

    let timer: number | null = null;

    const onDeviceChange = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        loadBrowserDevices({ preserveSelection: true }).catch(() => { });
      }, 450);
    };

    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);

    return () => {
      if (timer) window.clearTimeout(timer);
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        onDeviceChange,
      );
    };
  }, [loadBrowserDevices]);

  // FX
  const [videoFxMode, setVideoFxMode] = useState<FxMode>("off");
  const [bgImageUrl, setBgImageUrl] = useState<string>(DEFAULT_BG_DATA_URL);
  const [fxError, setFxError] = useState<string>("");
  const [fxApplying, setFxApplying] = useState(false);
  const [fxStatusText, setFxStatusText] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [mainViewMode, setMainViewMode] =
    useState<RoomMainViewMode>("video");
  const [settingsPreviewVersion, setSettingsPreviewVersion] = useState(0);
  const [blurStrength, setBlurStrength] = useState<number>(12);
  const firefoxSafeFx = useMemo(() => isFirefoxLike(), []);
  const [connected, setConnected] = useState(false);
  const [mobileMediaRestoreOpen, setMobileMediaRestoreOpen] = useState(false);
  const [mobileMediaRestoreBusy, setMobileMediaRestoreBusy] = useState(false);
  const [mobileRestoreMode, setMobileRestoreMode] = useState<
    "restoring" | "needs_action"
  >("restoring");
  const mobileRestoreEscalationTimerRef = useRef<number | null>(null);
  const [frozenLocalVideoFrame, setFrozenLocalVideoFrame] =
    useState<string>("");

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    if (!connected) return;

    const room = roomRef.current;
    if (!room) return;

    const onParticipantMetadataChanged = () => {
      try {
        scheduleRebuildTiles();
        window.setTimeout(() => scheduleRebuildTiles(), 80);
        window.setTimeout(() => scheduleRebuildTiles(), 220);
      } catch (e) {
        console.error("metadata changed rebuild failed:", e);
      }
    };

    room.on(RoomEvent.ParticipantMetadataChanged, onParticipantMetadataChanged);

    return () => {
      room.off(
        RoomEvent.ParticipantMetadataChanged,
        onParticipantMetadataChanged,
      );
    };
  }, [connected]);

  const trackWeeklyUsageOnLeave = useCallback(async () => {
    if (!USAGE_TRACKING_ENABLED) return;
    if (usageTrackedRef.current) return;

    const userId = String(authUserId || "").trim();
    if (!userId) return;

    const startedAt = sessionJoinStartedAtRef.current;
    if (!startedAt) return;

    usageTrackedRef.current = true;

    const minutes = Math.max(1, Math.ceil((Date.now() - startedAt) / 60000));

    try {
      await incrementWeeklyUsage({
        userId,
        addMinutes: minutes,
      });

      console.log("[usage] weekly minutes saved:", {
        userId,
        sessionId,
        minutes,
      });
    } catch (e) {
      usageTrackedRef.current = false;
      console.error("[usage] incrementWeeklyUsage failed:", e);
    }
  }, [authUserId, sessionId]);

  useEffect(() => {
    return () => {
      void trackWeeklyUsageOnLeave();
    };
  }, [trackWeeklyUsageOnLeave]);

  const [remoteAudioBlocked, setRemoteAudioBlocked] = useState(false);
  const [remoteAudioBlockedReason, setRemoteAudioBlockedReason] = useState("");
  const [remoteAudioHasAnyTracks, setRemoteAudioHasAnyTracks] = useState(false);
  const [audioResumeNonce, setAudioResumeNonce] = useState(0);
  const [audioResumeBusy, setAudioResumeBusy] = useState(false);

  const [colorCorrection, setColorCorrection] = useState<ColorCorrectionState>({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    warmth: 0,
  });

  const localVideoFilterCss = useMemo(
    () => buildColorCorrectionFilter(colorCorrection),
    [colorCorrection],
  );

  const uploadedBgUrlRef = useRef<string | null>(null);
  const fxOpIdRef = useRef<number>(0);
  const lastPrejoinFxSignatureRef = useRef<string>("");
  const activeFxSignatureRef = useRef<string>("");

  const ensureFxSupportedOrThrow = () => {
    if (!supportsBackgroundProcessors())
      throw new Error(
        "Background processors are not supported in this browser/device",
      );
    try {
      supportsModernBackgroundProcessors();
    } catch { }
  };

  const makeProcessorForMode = (
    mode: FxMode,
    blur: number,
    bgUrl: string,
  ): any | null => {
    if (mode === "off") return null;

    if (mode === "blur") {
      return BackgroundBlur(
        normalizeFxBlurStrength(blur, firefoxSafeFx),
      ) as any;
    }

    return VirtualBackground(bgUrl || DEFAULT_BG_DATA_URL) as any;
  };

  const stopAnyProcessor = async (track: LocalVideoTrack) => {
    try {
      await (track as any).stopProcessor?.(true);
    } catch { }
  };

  const safeApplyProcessor = async (
    track: LocalVideoTrack,
    mode: FxMode,
    blur: number,
    bgUrl: string,
  ) => {
    ensureFxSupportedOrThrow();

    const normalizedBlur = normalizeFxBlurStrength(blur, firefoxSafeFx);
    const signature =
      mode === "off"
        ? "off"
        : mode === "blur"
          ? `blur:${normalizedBlur}`
          : `bg:${String(bgUrl || DEFAULT_BG_DATA_URL)}`;

    // Самый важный фикс: не пересоздаём processor, если реально ничего не поменялось.
    if (activeFxSignatureRef.current === signature) return;

    const opId = fxOpIdRef.current + 1;
    fxOpIdRef.current = opId;

    await stopAnyProcessor(track);
    if (fxOpIdRef.current !== opId) return;

    if (firefoxSafeFx) {
      await delay(90);
    }

    const proc = makeProcessorForMode(mode, normalizedBlur, bgUrl);

    if (!proc) {
      activeFxSignatureRef.current = "off";
      return;
    }

    await (track as any).setProcessor(proc, true);

    if (fxOpIdRef.current === opId) {
      activeFxSignatureRef.current = signature;
    }
  };

  // pre-join helpers
  const cleanupPrejoinPreparedVideoTrack = async () => {
    const t = prejoinPreparedVideoTrackRef.current as any;
    prejoinPreparedVideoTrackRef.current = null;
    lastPrejoinFxSignatureRef.current = "";
    activeFxSignatureRef.current = "";

    if (!t) return;

    try {
      await stopAnyProcessor(t);
    } catch { }

    try {
      t.stop?.();
    } catch { }

    setPrejoinPreviewVersion((v) => v + 1);
  };

  const createPrejoinPreparedVideoTrack = async (opts?: {
    force?: boolean;
  }) => {
    const pj = prejoinRef.current;
    const current = prejoinPreparedVideoTrackRef.current as any;

    if (!pj.videoEnabled) {
      if (current) {
        await cleanupPrejoinPreparedVideoTrack();
      }
      return null;
    }

    if (!opts?.force && current) {
      const currentDeviceId = String(
        current?.mediaStreamTrack?.getSettings?.().deviceId || "",
      ).trim();
      const wantedDeviceId = String(pj.videoInputId || "").trim();

      if (!wantedDeviceId || currentDeviceId === wantedDeviceId) {
        return current;
      }
    }

    await cleanupPrejoinPreparedVideoTrack();

    const isMobileOrTablet = isMobileQuery || isTabletQuery;
    const wantedVideoDeviceId = String(pj.videoInputId || "").trim();

    const buildTrack = async (args: {
      width: number;
      height: number;
      fps: number;
      useExactDeviceId: boolean;
    }) => {
      return await createLocalVideoTrack({
        deviceId:
          args.useExactDeviceId && wantedVideoDeviceId
            ? wantedVideoDeviceId
            : undefined,
        resolution: {
          width: args.width,
          height: args.height,
        },
        frameRate: args.fps,
      } as any);
    };

    try {
      let track: LocalVideoTrack | null = null;

      try {
        track = await buildTrack({
          width: prejoinPreviewPreset.width,
          height: prejoinPreviewPreset.height,
          fps: prejoinPreviewPreset.fps,
          useExactDeviceId: !isMobileOrTablet,
        });
      } catch (firstError) {
        console.warn("prejoin preview primary create failed:", firstError);

        if (!isChromeOS && !isMobileOrTablet && deviceTier !== "weak") {
          throw firstError;
        }

        track = await buildTrack({
          width: 480,
          height: 270,
          fps: 12,
          useExactDeviceId: !isMobileOrTablet,
        });
      }

      prejoinPreparedVideoTrackRef.current = track;
      setDeviceError("");
      setPrejoinPreviewVersion((v) => v + 1);
      return track;
    } catch (e: any) {
      console.warn("createPrejoinPreparedVideoTrack failed:", e);
      setDeviceError(String(e?.message || e || "camera_preview_failed"));
      return null;
    }
  };

  const applyPrejoinVideoFx = async (mode: FxMode) => {
    setFxError("");
    setFxApplying(true);
    setFxStatusText("");

    try {
      const pj = prejoinRef.current;
      if (shouldDisableBackgroundFx) {
        throw new Error(
          "Background FX are disabled on mobile/tablet devices for stability",
        );
      }
      if (!pj.videoEnabled) throw new Error("Turn camera on in pre-join first");

      let track = prejoinPreparedVideoTrackRef.current;
      if (!track) track = await createPrejoinPreparedVideoTrack();
      if (!track) throw new Error("Pre-join camera track is not ready");
      const currentTrackId = String(
        (track as any)?.mediaStreamTrack?.id || "",
      ).trim();
      if (!currentTrackId) {
        throw new Error("Pre-join camera track id is missing");
      }

      const sig = `${mode}|${blurStrength}|${bgImageUrl}|${String(
        (track as any)?.mediaStreamTrack?.id || "",
      )}`;

      if (lastPrejoinFxSignatureRef.current === sig) {
        setFxApplying(false);
        return;
      }

      await safeApplyProcessor(track, mode, blurStrength, bgImageUrl);
      lastPrejoinFxSignatureRef.current = sig;

      setVideoFxMode(mode);
      setFxStatusText(
        mode === "off"
          ? "FX disabled"
          : mode === "blur"
            ? `Blur applied (${blurStrength})`
            : "Virtual background applied",
      );
      setPrejoinPreviewVersion((v) => v + 1);
    } catch (e: any) {
      console.error("applyPrejoinVideoFx failed:", e);
      setFxError(String(e?.message || e || "prejoin_video_fx_failed"));
    } finally {
      setFxApplying(false);
    }
  };

  const initPrejoinPreview = async (opts?: {
    delayedForWeak?: boolean;
    forceTrack?: boolean;
  }) => {
    if (prejoinPreviewInitInFlightRef.current) return;
    prejoinPreviewInitInFlightRef.current = true;

    try {
      const pj = prejoinRef.current;

      if (!pj.videoEnabled) return;

      if (opts?.delayedForWeak && deviceTier === "weak" && !isChromeOS) {
        await delay(WEAK_DEVICE_PREVIEW_INIT_DELAY_MS);

        if (!prejoinOpen) return;
        if (!prejoinRef.current.videoEnabled) return;
      }

      await createPrejoinPreparedVideoTrack({ force: !!opts?.forceTrack });

      if (!shouldDisableBackgroundFx && videoFxMode !== "off") {
        await applyPrejoinVideoFx(videoFxMode);
      }
    } finally {
      prejoinPreviewInitInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (loading) return;
    if (!session) return;
    if (!sessionId) return;
    if (!authReady) return;
    if (!authUserId) return;
    if (activeBan) return;
    if (joinRequested) return;
    if (joinFlowStartedRef.current) return;
    if (prejoinBootstrappedSessionIdRef.current === sessionId) return;

    prejoinBootstrappedSessionIdRef.current = sessionId;
    setPrejoinOpen(true);
    setDeviceError("");

    let cancelled = false;

    (async () => {
      await loadBrowserDevices({ preserveSelection: true }).catch(() => { });

      if (cancelled) return;

      try {
        if (isMobileQuery || isTabletQuery) return;

        await initPrejoinPreview({
          delayedForWeak: false,
          forceTrack: false,
        });
      } catch (e) {
        console.warn("prejoin preview init failed", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    loading,
    session,
    sessionId,
    authReady,
    authUserId,
    activeBan,
    joinRequested,
    loadBrowserDevices,
    deviceTier,
  ]);

  useEffect(() => {
    if (!prejoinOpen) return;
    if (isMobileQuery || isTabletQuery) return;

    const pj = prejoinRef.current;
    if (!pj.videoEnabled) return;

    const t = window.setTimeout(async () => {
      try {
        await initPrejoinPreview({
          delayedForWeak: false,
          forceTrack: true,
        });
      } catch (e) {
        console.warn("prejoin camera switch failed", e);
      }
    }, 180);

    return () => window.clearTimeout(t);
  }, [
    prejoin.videoInputId,
    prejoinOpen,
    deviceTier,
    isMobileQuery,
    isTabletQuery,
  ]);

  useEffect(() => {
    if (!prejoinOpen) return;

    if (!prejoin.videoEnabled) {
      cleanupPrejoinPreparedVideoTrack().catch(() => { });
      return;
    }

    if (isMobileQuery || isTabletQuery) return;

    (async () => {
      try {
        await initPrejoinPreview({
          delayedForWeak: false,
          forceTrack: false,
        });
      } catch (e) {
        console.warn("prejoin video enable failed", e);
      }
    })();
  }, [
    prejoin.videoEnabled,
    prejoinOpen,
    deviceTier,
    isMobileQuery,
    isTabletQuery,
  ]);

  useEffect(() => {
    if (!settingsOpen) return;
    if (!prejoinOpen) return;
    if (!prejoinRef.current.videoEnabled) return;
    if (isMobileQuery || isTabletQuery) return;

    if (prejoinPreparedVideoTrackRef.current) {
      setSettingsPreviewVersion((v) => v + 1);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        await initPrejoinPreview({
          delayedForWeak: false,
          forceTrack: false,
        });

        if (!cancelled) {
          setSettingsPreviewVersion((v) => v + 1);
        }
      } catch (e) {
        console.warn("settings preview init failed", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    settingsOpen,
    prejoinOpen,
    prejoin.videoEnabled,
    deviceTier,
    isMobileQuery,
    isTabletQuery,
  ]);

  useEffect(() => {
    if (deviceTier !== "weak") return;
    if (videoFxMode === "off") return;

    setVideoFxMode("off");
    setFxStatusText("FX disabled automatically on weak/mobile device");

    const track = prejoinPreparedVideoTrackRef.current;
    if (track) {
      stopAnyProcessor(track).catch(() => { });
    }

    lastPrejoinFxSignatureRef.current = "";
    setPrejoinPreviewVersion((v) => v + 1);
  }, [deviceTier, videoFxMode]);

  useEffect(() => {
    if (!prejoinOpen) return;
    if (!prejoin.videoEnabled) return;
    if (shouldDisableBackgroundFx) return;
    if (videoFxMode === "off") return;
    if (!prejoinPreparedVideoTrackRef.current) return;

    applyPrejoinVideoFx(videoFxMode).catch((e) => {
      console.warn("prejoin fx refresh failed", e);
    });
  }, [
    videoFxMode,
    blurStrength,
    bgImageUrl,
    prejoinOpen,
    prejoin.videoEnabled,
    shouldDisableBackgroundFx,
  ]);

  const isHost = useMemo(() => {
    if (!authUserId) return false;
    const hostId =
      (session as any)?.host_profile?.id || (session as any)?.host_id;
    return !!hostId && String(hostId) === String(authUserId);
  }, [authUserId, session]);

  const isSelfModerator = useMemo(() => {
    if (!authUserId) return false;
    if (isHost) return true;
    return moderatorUserIds.includes(String(authUserId).toLowerCase());
  }, [authUserId, isHost, moderatorUserIds]);

  const loadModerators = useCallback(
    async (sessionId: string, opts?: { force?: boolean }) => {
      const sid = String(sessionId || "").trim();
      if (!sid) return;

      const now = Date.now();
      const sameSession = lastModeratorsLoadSessionIdRef.current === sid;

      // This used to be polled every 3 seconds and was showing up heavily in
      // Supabase PostgREST egress. Keep an initial forced load, then rely on
      // Realtime/local optimistic updates. Non-forced reloads are deduped hard.
      if (
        !opts?.force &&
        sameSession &&
        now - lastModeratorsLoadAtRef.current < 60_000
      ) {
        return;
      }

      if (loadModeratorsInFlightRef.current) return;

      loadModeratorsInFlightRef.current = true;
      lastModeratorsLoadAtRef.current = now;
      lastModeratorsLoadSessionIdRef.current = sid;

      setRolesError("");
      setRolesLoading(true);

      try {
        const { data, error } = await supabase
          .from("session_role_assignments")
          .select("user_id, role")
          .eq("session_id", sid)
          .eq("role", "moderator");

        if (error) throw error;

        const ids = uniqStrings(
          (data || []).map((r: any) => String(r?.user_id || "")),
        );
        setModeratorUserIds(ids);
      } catch (e: any) {
        console.error("loadModerators failed:", e);
        setRolesError(String(e?.message || e || "failed_to_load_roles"));
        setModeratorUserIds([]);
      } finally {
        loadModeratorsInFlightRef.current = false;
        setRolesLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!session?.id) return;
    loadModerators(String(session.id), { force: true }).catch(() => { });
  }, [session?.id, loadModerators]);

  useEffect(() => {
    if (!session?.id) return;

    const sid = String(session.id);

    const ch = supabase
      .channel(`session-role-assignments:${sid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_role_assignments",
          filter: `session_id=eq.${sid}`,
        },
        (payload: any) => {
          const eventType = String(
            payload?.eventType || payload?.type || "",
          ).toUpperCase();
          const nextRow = payload?.new || {};
          const oldRow = payload?.old || {};

          const nextRole = String(nextRow?.role || "").toLowerCase();
          const oldRole = String(oldRow?.role || "").toLowerCase();
          const nextUserId = String(nextRow?.user_id || "").toLowerCase();
          const oldUserId = String(oldRow?.user_id || "").toLowerCase();

          if (
            (eventType === "INSERT" || eventType === "UPDATE") &&
            nextRole === "moderator" &&
            looksLikeUuid(nextUserId)
          ) {
            setModeratorUserIds((prev) => uniqStrings([...prev, nextUserId]));
            return;
          }

          if (
            eventType === "DELETE" &&
            oldRole === "moderator" &&
            looksLikeUuid(oldUserId)
          ) {
            setModeratorUserIds((prev) => prev.filter((x) => x !== oldUserId));
            return;
          }

          // Fallback for unexpected payload shapes, but throttled by loadModerators.
          void loadModerators(sid);
        },
      )
      .subscribe();

    return () => {
      safeRemoveRealtimeChannel(ch);
    };
  }, [session?.id, loadModerators]);

  const grantModerator = async (userId: string) => {
    if (!session?.id) return;
    if (!authUserId) return;
    const uid = String(userId || "").toLowerCase();
    if (!looksLikeUuid(uid)) return;

    setRolesError("");
    setRoleBusyKey(`mod:${uid}:grant`);
    try {
      const payload: SessionRoleAssignmentRow = {
        session_id: session.id,
        user_id: uid,
        role: "moderator",
        granted_by: authUserId,
      };
      const { error } = await supabase
        .from("session_role_assignments")
        .insert(payload as any);
      if (error) throw error;
      setModeratorUserIds((prev) => uniqStrings([...prev, uid]));
    } catch (e: any) {
      console.error("grantModerator failed:", e);
      setRolesError(String(e?.message || e || "grant_failed"));
      alert(String(e?.message || e || "grant_failed"));
    } finally {
      setRoleBusyKey("");
    }
  };

  const revokeModerator = async (userId: string) => {
    if (!session?.id) return;
    const uid = String(userId || "").toLowerCase();
    if (!looksLikeUuid(uid)) return;

    setRolesError("");
    setRoleBusyKey(`mod:${uid}:revoke`);
    try {
      const { error } = await supabase
        .from("session_role_assignments")
        .delete()
        .eq("session_id", session.id)
        .eq("user_id", uid)
        .eq("role", "moderator");
      if (error) throw error;
      setModeratorUserIds((prev) => prev.filter((x) => x !== uid));
    } catch (e: any) {
      console.error("revokeModerator failed:", e);
      setRolesError(String(e?.message || e || "revoke_failed"));
      alert(String(e?.message || e || "revoke_failed"));
    } finally {
      setRoleBusyKey("");
    }
  };

  // identity refs
  const baseUserIdRef = useRef<string>("");
  const livekitIdentityRef = useRef<string>("");

  // tab presence
  const tabPresenceKeyRef = useRef<string>("");
  const tabPresenceAcquiredRef = useRef<boolean>(false);
  const tabPresenceHeartbeatRef = useRef<number | null>(null);
  const tabPresenceChannelRef = useRef<any>(null);

  // kick / system notice
  const [systemNotice, setSystemNotice] = useState<RoomSystemNotice>({
    open: false,
    kind: "info",
    title: "",
    body: "",
  });
  const [kickRedirecting, setKickRedirecting] = useState(false);
  const kickEventChannelRef = useRef<any>(null);
  const kickedBySignalRef = useRef(false);
  const ATT_HEARTBEAT_MS = 10_000;

  const attendanceHbTimerRef = useRef<number | null>(null);
  const attendanceActiveRef = useRef(false);
  const leaveOnceRef = useRef(false);
  const leavePromiseRef = useRef<Promise<void> | null>(null);

  // Mobile browser/app-switch recovery.
  // Switching apps / backgrounding a mobile browser tab is NOT the same as clicking Leave.
  const explicitLeaveRequestedRef = useRef(false);
  const pageHiddenAtRef = useRef<number | null>(null);
  const returningFromBackgroundRef = useRef(false);
  const connectedRef = useRef(false);
  const joinRequestedRef = useRef(false);
  const autoClosedSessionIdRef = useRef<string>("");

  const stopTabPresenceHeartbeat = () => {
    if (tabPresenceHeartbeatRef.current) {
      window.clearInterval(tabPresenceHeartbeatRef.current);
      tabPresenceHeartbeatRef.current = null;
    }
  };

  const releaseTabPresence = () => {
    stopTabPresenceHeartbeat();
    const key = tabPresenceKeyRef.current;
    if (!key) return;
    if (!tabPresenceAcquiredRef.current) return;
    tabPresenceAcquiredRef.current = false;
    try {
      releaseTabSlot(key, tabId);
    } catch { }
    try {
      if (tabPresenceChannelRef.current)
        tabPresenceChannelRef.current.close?.();
    } catch { }
    tabPresenceChannelRef.current = null;
  };

  const startTabPresenceHeartbeat = () => {
    stopTabPresenceHeartbeat();
    const key = tabPresenceKeyRef.current;
    if (!key) return;
    if (!tabPresenceAcquiredRef.current) return;

    tabPresenceHeartbeatRef.current = window.setInterval(() => {
      try {
        refreshTabSlot(key, tabId);
        try {
          tabPresenceChannelRef.current?.postMessage?.({ t: nowMs(), tabId });
        } catch { }
      } catch { }
    }, LK_TAB_HEARTBEAT_MS);
  };

  useEffect(() => {
    const markMaybeBackgrounded = () => {
      // Mobile/tablet app switching can fire pagehide without a real tab close.
      // Do NOT release tab presence and do NOT show restore immediately here:
      // if LiveKit survives, the user should return without a forced reconnect.
      pageHiddenAtRef.current = Date.now();
      returningFromBackgroundRef.current = true;

      try {
        void attendanceHeartbeat();
      } catch {
        // ignore
      }
    };

    const onBeforeUnload = () => {
      if (isMobileQuery || isTabletQuery) {
        pageHiddenAtRef.current = Date.now();
        returningFromBackgroundRef.current = true;
        return;
      }

      explicitLeaveRequestedRef.current = true;
      releaseTabPresence();
    };

    const onPageHide = () => {
      if (explicitLeaveRequestedRef.current) {
        releaseTabPresence();
        return;
      }

      markMaybeBackgrounded();
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [isMobileQuery, isTabletQuery]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (isMobileQuery || isTabletQuery) {
        pageHiddenAtRef.current = Date.now();
        returningFromBackgroundRef.current = true;
        void attendanceHeartbeat();
        return;
      }

      explicitLeaveRequestedRef.current = true;
      void leaveAttendanceOnce({ keepalive: true });
    };

    const onPageHide = () => {
      // App switching on mobile can look like pagehide. Keep attendance alive unless this was explicit leave/unload.
      if (!explicitLeaveRequestedRef.current) {
        void attendanceHeartbeat();
        return;
      }

      void leaveAttendanceOnce({ keepalive: true });
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [session?.id, authUserId]);

  const buildAuthHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const cachedAccessToken = String(accessTokenRef.current || "").trim();
    if (cachedAccessToken) {
      headers.Authorization = `Bearer ${cachedAccessToken}`;
      return headers;
    }

    try {
      const { data } = await supabase.auth.getSession();
      const fallbackAccessToken = String(
        data.session?.access_token || "",
      ).trim();

      if (fallbackAccessToken) {
        accessTokenRef.current = fallbackAccessToken;
        headers.Authorization = `Bearer ${fallbackAccessToken}`;
      }
    } catch { }

    return headers;
  };

  const startAttendanceHeartbeat = () => {
    if (attendanceHbTimerRef.current) return;

    attendanceHbTimerRef.current = window.setInterval(() => {
      void attendanceHeartbeat();
    }, ATT_HEARTBEAT_MS);
  };

  const stopAttendanceHeartbeat = () => {
    if (!attendanceHbTimerRef.current) return;
    window.clearInterval(attendanceHbTimerRef.current);
    attendanceHbTimerRef.current = null;
  };

  const attendanceJoin = async () => {
    if (!session?.id || !authUserId) return;

    const nowIso = new Date().toISOString();

    try {
      const { error } = await supabase.rpc("attendance_join", {
        p_session_id: session.id,
      });

      if (!error) {
        attendanceActiveRef.current = true;
        leaveOnceRef.current = false;
        return;
      }
    } catch { }

    try {
      const { error } = await supabase.from("session_attendance").upsert(
        {
          session_id: session.id,
          user_id: authUserId,
          joined_at: nowIso,
          left_at: null,
          last_seen_at: nowIso,
        },
        { onConflict: "session_id,user_id" },
      );

      if (!error) {
        attendanceActiveRef.current = true;
        leaveOnceRef.current = false;
      }
    } catch { }
  };

  const attendanceHeartbeat = async () => {
    if (!session?.id || !authUserId) return;
    if (!attendanceActiveRef.current) return;

    const nowIso = new Date().toISOString();

    try {
      const { error } = await supabase.rpc("attendance_heartbeat", {
        p_session_id: session.id,
      });

      if (!error) return;
    } catch { }

    try {
      await supabase
        .from("session_attendance")
        .update({
          last_seen_at: nowIso,
          left_at: null,
        })
        .eq("session_id", session.id)
        .eq("user_id", authUserId);
    } catch { }
  };

  const attendanceLeave = async () => {
    stopAttendanceHeartbeat();

    if (!session?.id || !authUserId) return;
    if (!attendanceActiveRef.current) return;

    const nowIso = new Date().toISOString();

    try {
      const { error } = await supabase.rpc("attendance_leave", {
        p_session_id: session.id,
      });

      if (!error) {
        attendanceActiveRef.current = false;
        return;
      }
    } catch { }

    try {
      await supabase
        .from("session_attendance")
        .update({
          left_at: nowIso,
          last_seen_at: nowIso,
        })
        .eq("session_id", session.id)
        .eq("user_id", authUserId);
    } catch { }

    attendanceActiveRef.current = false;
  };

  const keepaliveLeaveWrite = () => {
    try {
      if (!session?.id || !authUserId) return;
      if (!attendanceActiveRef.current) return;

      const supabaseUrl = String(
        (import.meta as any).env.VITE_SUPABASE_URL || "",
      ).trim();
      const anonKey = String(
        (import.meta as any).env.VITE_SUPABASE_ANON_KEY || "",
      ).trim();
      const token = String(accessTokenRef.current || "").trim();

      if (!supabaseUrl || !anonKey || !token) return;

      const nowIso = new Date().toISOString();
      const url =
        `${supabaseUrl}/rest/v1/session_attendance` +
        `?session_id=eq.${encodeURIComponent(session.id)}` +
        `&user_id=eq.${encodeURIComponent(authUserId)}`;

      void fetch(url, {
        method: "PATCH",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          left_at: nowIso,
          last_seen_at: nowIso,
        }),
        keepalive: true as any,
      }).catch(() => { });
    } catch { }
  };

  const leaveAttendanceOnce = (opts: { keepalive?: boolean } = {}) => {
    if (opts.keepalive) {
      keepaliveLeaveWrite();
    }

    if (leavePromiseRef.current) {
      return leavePromiseRef.current;
    }

    if (leaveOnceRef.current) {
      return Promise.resolve();
    }

    leaveOnceRef.current = true;

    const p = (async () => {
      try {
        await attendanceLeave();
      } catch { }
    })();

    leavePromiseRef.current = p;
    return p;
  };

  const tryAcquireTabGate = (sessionId: string, baseUserId: string) => {
    const maxTabs = Math.max(
      1,
      Math.min(
        20,
        Number(
          (import.meta as any)?.env?.VITE_LIVEKIT_MAX_TABS ||
          LK_MAX_TABS_DEFAULT,
        ) || LK_MAX_TABS_DEFAULT,
      ),
    );
    const key = makeTabPresenceKey(sessionId, baseUserId);

    tabPresenceKeyRef.current = key;

    try {
      if (typeof (window as any).BroadcastChannel === "function") {
        const ch = new (window as any).BroadcastChannel(key);
        tabPresenceChannelRef.current = ch;
        ch.onmessage = () => {
          try {
            const p = prunePresence(readPresence(key));
            writePresence(key, { v: (p.v || 1) + 1, tabs: p.tabs || [] });
          } catch { }
        };
      }
    } catch {
      tabPresenceChannelRef.current = null;
    }

    const res = acquireTabSlot(key, tabId, maxTabs);

    if (!res.ok) {
      tabPresenceAcquiredRef.current = false;
      try {
        if (tabPresenceChannelRef.current)
          tabPresenceChannelRef.current.close?.();
      } catch { }
      tabPresenceChannelRef.current = null;
      return { ok: false, max: res.max, count: res.count };
    }

    tabPresenceAcquiredRef.current = true;
    startTabPresenceHeartbeat();
    return { ok: true, max: res.max, count: res.count };
  };

  // ---- continue in chunk 2 ----
  const requestToken = async () => {
    if (!session) return;
    setTokenError("");
    setTokenLoading(true);

    try {
      const pj = prejoinRef.current;
      const nameToUse =
        (pj.displayName || displayName || userName || "User").trim() || "User";
      const roomName = safeRoomName(`session-${session.id}`);

      const baseUser = safeIdentity(
        (authUserId && looksLikeUuid(authUserId)
          ? authUserId
          : authUserId || nameToUse) as any,
      );
      baseUserIdRef.current = baseUser;

      const identity = safeIdentity(`${baseUser}--${tabId}`);
      livekitIdentityRef.current = identity;

      console.log("[LK TAB DEBUG]", {
        sessionId: session.id,
        baseUser,
        tabId,
        identity,
      });

      if (!tabPresenceAcquiredRef.current) {
        const g = tryAcquireTabGate(session.id, baseUser);
        if (!g.ok) {
          const msg = `Too many tabs open for this room (${g.count}/${g.max}). Close another tab and try again.`;
          setTokenError(msg);
          setTokenLoading(false);

          joinFlowStartedRef.current = false;
          connectingFromPrejoinRef.current = false;

          try {
            alert(msg);
          } catch { }

          setPrejoinOpen(true);
          setJoinRequested(false);
          return;
        }
      }

      const res = await fetch(tokenEndpoint, {
        method: "POST",
        headers: await buildAuthHeaders(),
        body: JSON.stringify({
          roomName,
          identity,
          name: nameToUse,
          isHost,
          sessionId: session.id,
          isModerator:
            !isHost && !!authUserId
              ? moderatorUserIds.includes(String(authUserId).toLowerCase())
              : false,
          baseUserId: baseUser,
          tabId,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        token?: string;
        url?: string;
        assignedServerId?: string | null;
        error?: string;
        message?: string;
        opensAt?: string | null;
        bookedCount?: number | null;
        maxParticipants?: number | null;
      };

      if (!res.ok) {
        const code = String(json?.error || "").trim();

        if (code.toUpperCase() === "USER_BANNED") {
          const banFromToken: ActiveBan = {
            id: "token-ban",
            banned_user_id: String(authUserId || baseUser || ""),
            reason: String(
              (json as any)?.reason || "You are banned from MySession.",
            ),
            starts_at: String(
              (json as any)?.starts_at || new Date().toISOString(),
            ),
            expires_at: ((json as any)?.expires_at as string | null) || null,
            revoked_at: null,
          };

          setActiveBan(banFromToken);
          setTokenError("");
          setTokenLoading(false);
          setJoinRequested(false);
          setPrejoinOpen(false);
          joinFlowStartedRef.current = false;
          connectingFromPrejoinRef.current = false;
          return;
        }

        if (
          code === "BOOKED_GRACE_WINDOW_ACTIVE" ||
          code === "ROOM_RESERVED_FOR_BOOKED_USERS"
        ) {
          const opensAtRaw = String(json?.opensAt || "").trim();
          const opensAtLabel = opensAtRaw
            ? new Date(opensAtRaw).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
            : "";

          const msg = String(
            json?.message ||
            (opensAtLabel
              ? `This session is reserved for booked participants until ${opensAtLabel}. Unclaimed seats open 3 minutes after the session starts.`
              : "This session is currently reserved for booked participants. Unclaimed seats open 3 minutes after the session starts."),
          ).trim();

          console.warn("[LK admission blocked]", json);
          setTokenError(msg);
          setMediaWarning(msg);
          setTokenLoading(false);

          joinFlowStartedRef.current = false;
          connectingFromPrejoinRef.current = false;
          setJoinRequested(false);
          setPrejoinOpen(true);
          return;
        }

        const msg = String(
          json?.message || json?.error || `Token endpoint error: ${res.status}`,
        ).trim();
        console.error(msg, json);
        setTokenError(msg);
        setTokenLoading(false);
        return;
      }

      const tok = String(json.token || "").trim();
      const nextUrl = String(json.url || defaultLivekitUrl || "").trim();
      const nextAssignedServerId = String(json.assignedServerId || "").trim();

      if (!tok) {
        setTokenError("Token endpoint returned empty token");
        setTokenLoading(false);
        return;
      }

      if (!nextUrl) {
        setTokenError("Token endpoint returned empty LiveKit URL");
        setTokenLoading(false);
        return;
      }

      setLkToken(tok);
      setLkServerUrl(nextUrl);
      setAssignedServerId(nextAssignedServerId);
      setTokenLoading(false);
    } catch (e: any) {
      console.error("requestToken exception:", e);
      setTokenError(String(e?.message || e || "token_request_failed"));
      setTokenLoading(false);

      joinFlowStartedRef.current = false;
      connectingFromPrejoinRef.current = false;
      setJoinRequested(false);
      setPrejoinOpen(true);
    }
  };

  useEffect(() => {
    (async () => {
      if (joinBlocked) return;
      if (!canJoinNow) return;
      if (!session) return;
      if (!joinRequested) return;
      if (!authReady) return;
      if (!authUserId) return;
      if (activeBan) return;
      if (lkToken) return;
      await requestToken();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session,
    joinRequested,
    authReady,
    authUserId,
    activeBan,
    isHost,
    moderatorUserIds.join("|"),
  ]);
  useEffect(() => {
    if (!lkToken) return;
    setPrejoinOpen(false);
  }, [lkToken]);

  // ---- livekit room
  const roomRef = useRef<Room | null>(null);
  const [roomState, setRoomState] = useState<Room | null>(null);
  useEffect(() => {
    if (!connected) return;
    if (!roomState) return;
    if (!pendingRoomAudioUnlockRef.current) return;

    pendingRoomAudioUnlockRef.current = false;

    window.setTimeout(() => {
      ensureRoomAudioPlaybackUnlocked("post-connect").catch(() => { });
    }, 120);
  }, [connected, roomState, ensureRoomAudioPlaybackUnlocked]);
  const [clientError, setClientError] = useState<string>("");
  const [mediaWarning, setMediaWarning] = useState<string>("");

  const getLiveKitRoomState = () => {
    const room: any = roomRef.current as any;
    return String(room?.state || "").toLowerCase();
  };

  const roomIsActuallyConnected = () => {
    return !!roomRef.current && getLiveKitRoomState() === "connected";
  };

  const roomIsRecovering = () => {
    const state = getLiveKitRoomState();
    return (
      !!roomRef.current &&
      (state === "connecting" ||
        state === "reconnecting" ||
        state === "signalreconnecting")
    );
  };

  const clearMobileRestoreEscalationTimer = () => {
    if (!mobileRestoreEscalationTimerRef.current) return;
    window.clearTimeout(mobileRestoreEscalationTimerRef.current);
    mobileRestoreEscalationTimerRef.current = null;
  };

  const openMobileRestoreState = (
    mode: "restoring" | "needs_action" = "restoring",
  ) => {
    clearMobileRestoreEscalationTimer();
    setMobileRestoreMode(mode);
    setMobileMediaRestoreOpen(true);
    setPrejoinOpen(false);

    if (mode === "restoring") {
      mobileRestoreEscalationTimerRef.current = window.setTimeout(() => {
        if (!roomIsActuallyConnected()) {
          setMobileRestoreMode("needs_action");
        }
      }, 12_000);
    }
  };

  const closeMobileRestoreState = () => {
    clearMobileRestoreEscalationTimer();
    setMobileMediaRestoreOpen(false);
    setMobileRestoreMode("restoring");
  };

  const logRoomDiagnostic = useCallback(
    async (eventType: string, payload: Record<string, unknown> = {}) => {
      try {
        const { browser, browserVersion, os } = getBrowserDetails();
        const deviceType = inferDeviceTypeFromRuntime({
          isMobileQuery,
          isTabletQuery,
        });
        const nav =
          typeof navigator !== "undefined" ? (navigator as any) : null;
        const win = typeof window !== "undefined" ? window : null;

        const screenWidth = win?.screen?.width || win?.innerWidth || null;
        const screenHeight = win?.screen?.height || win?.innerHeight || null;
        const viewportWidth = win?.innerWidth || null;
        const viewportHeight = win?.innerHeight || null;

        const screenSnapshot = getScreenShareDiagnosticSnapshot(
          roomRef.current,
        );
        const screenShareTrackCount =
          Number((screenSnapshot as any).localScreenLiveTrackCount || 0) +
          Number((screenSnapshot as any).remoteScreenLiveTrackCount || 0);

        await supabase.from("room_diagnostics").insert({
          session_id: session?.id || null,
          user_id: authUserId || null,
          event_type: eventType,

          user_agent: String(nav?.userAgent || ""),
          platform: String(nav?.userAgentData?.platform || nav?.platform || ""),
          browser,
          browser_version: browserVersion,
          os,
          device_type: deviceType,

          screen_width: typeof screenWidth === "number" ? screenWidth : null,
          screen_height: typeof screenHeight === "number" ? screenHeight : null,
          viewport_width:
            typeof viewportWidth === "number" ? viewportWidth : null,
          viewport_height:
            typeof viewportHeight === "number" ? viewportHeight : null,
          device_pixel_ratio: Number(win?.devicePixelRatio || 1),

          supports_display_media: supportsScreenShareCapture(),
          screen_share_supported: supportsScreenShareCapture(),
          supports_set_sink_id: canUseSetSinkId(),
          supports_media_devices: !!nav?.mediaDevices,

          screen_share_track_count: Number.isFinite(screenShareTrackCount)
            ? screenShareTrackCount
            : 0,
          livekit_connected: !!connectedRef.current,

          payload: {
            ...payload,
            tabId,
            routeId: routeId || null,
            effectiveSessionParam,
            isMobileQuery,
            isTabletQuery,
            isLgUp,
            connected: !!connectedRef.current,
            roomConnectionState: String((roomRef.current as any)?.state || ""),
            screenShareSnapshot: screenSnapshot,
            hardwareConcurrency: Number(nav?.hardwareConcurrency || 0) || null,
            deviceMemory: Number(nav?.deviceMemory || 0) || null,
            maxTouchPoints: Number(nav?.maxTouchPoints || 0) || null,
            language: String(nav?.language || ""),
            languages: Array.isArray(nav?.languages) ? nav.languages : [],
          },
        });
      } catch (e) {
        console.warn("[room-diagnostics] insert failed:", e);
      }
    },
    [
      session?.id,
      authUserId,
      isMobileQuery,
      isTabletQuery,
      isLgUp,
      tabId,
      routeId,
      effectiveSessionParam,
    ],
  );

  const roomJoinDiagnosticKeyRef = useRef("");

  useEffect(() => {
    if (!connected) return;
    if (!session?.id) return;
    if (!authUserId) return;

    const key = `${session.id}:${authUserId}:${tabId}:room_join`;
    if (roomJoinDiagnosticKeyRef.current === key) return;
    roomJoinDiagnosticKeyRef.current = key;

    void logRoomDiagnostic("room_join", {
      roomName: session?.id ? safeRoomName(session.id) : null,
      isHost,
      isModerator: isSelfModerator,
      lkServerUrl,
      screenShareSupported: supportsScreenShareCapture(),
    });
  }, [
    connected,
    session?.id,
    authUserId,
    tabId,
    logRoomDiagnostic,
    isHost,
    isSelfModerator,
    lkServerUrl,
  ]);

  const connectInFlightRef = useRef(false);
  const connectAttemptIdRef = useRef(0);

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenShareOn, setScreenShareOn] = useState(false);

  const writeConnectionDiagnostic = useCallback(
    async (eventType: string, payload: Record<string, unknown> = {}) => {
      const network = getNetworkDiagnosticSnapshot();
      const { browser, browserVersion, os } = getBrowserDetails();
      const deviceType = inferDeviceTypeFromRuntime({
        isMobileQuery,
        isTabletQuery,
      });
      const nav = typeof navigator !== "undefined" ? (navigator as any) : null;
      const win = typeof window !== "undefined" ? window : null;
      const roomAny: any = roomRef.current;

      const hiddenForMs = pageHiddenAtRef.current
        ? Date.now() - pageHiddenAtRef.current
        : null;

      const localEntry = {
        at: new Date().toISOString(),
        event_type: eventType,
        session_id: session?.id || null,
        user_id: authUserId || null,
        visibility_state:
          typeof document !== "undefined"
            ? document.visibilityState
            : "unknown",
        network_online: network.online,
        room_state: String(roomAny?.state || ""),
        livekit_connected: !!connectedRef.current,
        hidden_for_ms: hiddenForMs,
        payload,
      };

      pushConnectionDiagnosticToLocalBuffer(localEntry);

      try {
        await supabase.from(CONNECTION_DIAGNOSTICS_TABLE).insert({
          session_id: session?.id || null,
          user_id: authUserId || null,
          event_type: eventType,

          visibility_state:
            typeof document !== "undefined"
              ? document.visibilityState
              : "unknown",
          network_online: network.online,

          room_state: String(roomAny?.state || ""),
          livekit_connected: !!connectedRef.current,

          user_agent: String(nav?.userAgent || ""),
          platform: String(nav?.userAgentData?.platform || nav?.platform || ""),
          browser,
          browser_version: browserVersion,
          os,
          device_type: deviceType,

          screen_width:
            Number(win?.screen?.width || win?.innerWidth || 0) || null,
          screen_height:
            Number(win?.screen?.height || win?.innerHeight || 0) || null,
          viewport_width: Number(win?.innerWidth || 0) || null,
          viewport_height: Number(win?.innerHeight || 0) || null,
          device_pixel_ratio: Number(win?.devicePixelRatio || 1) || null,

          effective_connection_type: network.effectiveType || null,
          connection_type: network.connectionType || null,
          downlink: network.downlink,
          rtt: network.rtt,
          save_data: network.saveData,

          payload: {
            ...payload,
            tabId,
            routeId: routeId || null,
            effectiveSessionParam,
            isMobileQuery,
            isTabletQuery,
            isLgUp,
            hiddenForMs,
            pageHiddenAt: pageHiddenAtRef.current,
            returningFromBackground: returningFromBackgroundRef.current,
            explicitLeaveRequested: explicitLeaveRequestedRef.current,
            kickedBySignal: kickedBySignalRef.current,
            connected,
            connectedRef: connectedRef.current,
            joinRequested,
            joinRequestedRef: joinRequestedRef.current,
            roomConnectionState: String(roomAny?.state || ""),
            remoteParticipants: roomAny?.remoteParticipants?.size ?? null,
            localIdentity: roomAny?.localParticipant?.identity || "",
            micOn,
            camOn,
            hardwareConcurrency: Number(nav?.hardwareConcurrency || 0) || null,
            deviceMemory: Number(nav?.deviceMemory || 0) || null,
            maxTouchPoints: Number(nav?.maxTouchPoints || 0) || null,
            language: String(nav?.language || ""),
          },
        });
      } catch (e) {
        console.warn("[connection-diagnostics] insert failed:", e);
      }
    },
    [
      session?.id,
      authUserId,
      isMobileQuery,
      isTabletQuery,
      isLgUp,
      tabId,
      routeId,
      effectiveSessionParam,
      connected,
      joinRequested,
      micOn,
      camOn,
    ],
  );

  useEffect(() => {
    const write = (
      eventType: string,
      payload: Record<string, unknown> = {},
    ) => {
      void writeConnectionDiagnostic(eventType, payload);
    };

    const onVisibilityChange = () => {
      write(`document.visibilitychange:${document.visibilityState}`);
    };

    const onPageHide = (e: PageTransitionEvent) => {
      write("window.pagehide", { persisted: e.persisted });
    };

    const onPageShow = (e: PageTransitionEvent) => {
      write("window.pageshow", { persisted: e.persisted });
    };

    const onBeforeUnload = () => {
      write("window.beforeunload");
    };

    const onFreeze = () => {
      write("document.freeze");
    };

    const onResume = () => {
      write("document.resume");
    };

    const onOnline = () => {
      write("window.online");
    };

    const onOffline = () => {
      write("window.offline");
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("freeze", onFreeze as any);
    document.addEventListener("resume", onResume as any);

    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    write("connection_diagnostics.mounted");

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("freeze", onFreeze as any);
      document.removeEventListener("resume", onResume as any);

      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);

      write("connection_diagnostics.unmounted");
    };
  }, [writeConnectionDiagnostic]);

  const manualScreenShareRef = useRef<{
    mediaTrack: MediaStreamTrack;
    stream?: MediaStream | null;
    publication?: LocalTrackPublication | null;
  } | null>(null);
  const [remoteAudioRecoveryTick, setRemoteAudioRecoveryTick] = useState(0);
  const [pipMode, setPipMode] = useState<PiPMode>("gallery");

  function getSettingsPreviewTrack(): LocalVideoTrack | null {
    if (prejoinPreparedVideoTrackRef.current) {
      return prejoinPreparedVideoTrackRef.current;
    }

    try {
      const r = roomRef.current;
      if (!r) return null;

      const pubs = Array.from(
        r.localParticipant.videoTrackPublications.values(),
      );
      const camPub = pubs.find((p: any) => p?.source === Track.Source.Camera);

      return (camPub?.track as LocalVideoTrack | null) || null;
    } catch {
      return null;
    }
  }

  const captureLocalVideoFrame = async (): Promise<string> => {
    try {
      const track = getSettingsPreviewTrack();
      if (!track) return "";

      const video = document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.style.position = "fixed";
      video.style.left = "-99999px";
      video.style.top = "-99999px";
      video.style.width = "1px";
      video.style.height = "1px";
      video.style.opacity = "0";
      video.setAttribute("playsinline", "true");
      video.setAttribute("muted", "true");

      document.body.appendChild(video);

      try {
        const attached = (track as any)?.attach?.(video) || video;
        const targetVideo =
          attached instanceof HTMLVideoElement ? attached : video;

        try {
          await targetVideo.play();
        } catch { }

        if (!targetVideo.videoWidth || !targetVideo.videoHeight) {
          await delay(120);
        }

        const width = targetVideo.videoWidth || 640;
        const height = targetVideo.videoHeight || 360;
        if (!width || !height) return "";

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) return "";

        ctx.drawImage(targetVideo, 0, 0, width, height);
        return canvas.toDataURL("image/jpeg", 0.78);
      } finally {
        try {
          (track as any)?.detach?.(video);
        } catch { }

        try {
          video.remove();
        } catch { }
      }
    } catch (e) {
      console.warn("captureLocalVideoFrame failed:", e);
      return "";
    }
  };

  const [tiles, setTiles] = useState<TileModel[]>([]);
  const [screenShareTiles, setScreenShareTiles] = useState<TileModel[]>([]);

  useEffect(() => {
    const shouldShowMobileRestore = () => {
      if (!lowPowerMobileMode) return false;
      if (roomIsActuallyConnected()) return false;
      return joinRequestedRef.current || returningFromBackgroundRef.current;
    };

    const markHidden = () => {
      pageHiddenAtRef.current = Date.now();
      returningFromBackgroundRef.current = true;

      try {
        void attendanceHeartbeat();
      } catch {
        // ignore
      }

      // Keep camera/microphone tracks alive while the browser allows it.
      // Older code turned the camera off here, which forced a visible tile reload
      // every time the user returned from another tab/app.
      if (!lowPowerMobileMode) return;

      void captureLocalVideoFrame().then((frame) => {
        if (frame) setFrozenLocalVideoFrame(frame);
      });
    };

    const markVisible = () => {
      if (!pageHiddenAtRef.current && !returningFromBackgroundRef.current)
        return;

      if (roomIsActuallyConnected()) {
        closeMobileRestoreState();
        setMediaWarning("");
        void ensureRoomAudioPlaybackUnlocked("mobile-visible").catch(() => { });
        scheduleRebuildTiles();
        window.setTimeout(() => scheduleRebuildTiles(), 120);
        window.setTimeout(() => scheduleRebuildTiles(), 420);
        pageHiddenAtRef.current = null;
        returningFromBackgroundRef.current = false;
        return;
      }

      if (roomIsRecovering()) {
        openMobileRestoreState("restoring");
        setMediaWarning(
          "Restoring your connection… Mobile browsers may pause the room after you switch apps.",
        );
        scheduleRebuildTiles();
        window.setTimeout(() => scheduleRebuildTiles(), 120);
        return;
      }

      if (shouldShowMobileRestore()) {
        openMobileRestoreState("needs_action");
        scheduleRebuildTiles();
        window.setTimeout(() => scheduleRebuildTiles(), 120);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markHidden();
        return;
      }

      if (document.visibilityState === "visible") {
        markVisible();
      }
    };

    const onPageShow = () => markVisible();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      clearMobileRestoreEscalationTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowPowerMobileMode]);

  const [adminBusyKey, setAdminBusyKey] = useState<string>("");

  const liveHostChatOptions = useMemo(() => {
    const hostId = String(session?.host_id || "")
      .trim()
      .toLowerCase();
    const me = String(authUserId || "")
      .trim()
      .toLowerCase();

    return tiles
      .filter((tile) => {
        const uid = String(tile.participantUserId || "")
          .trim()
          .toLowerCase();
        if (!uid) return false;
        if (!looksLikeUuid(uid)) return false;
        if (uid === hostId) return false;
        if (uid === me) return false;
        return true;
      })
      .map((tile) => {
        const uid = String(tile.participantUserId || "")
          .trim()
          .toLowerCase();
        const profile = profilesById?.[uid];
        const label =
          String(profile?.full_name || "").trim() ||
          String(tile.metadataDisplayName || "").trim() ||
          String(tile.label || "").trim() ||
          "Participant";

        return {
          userId: uid,
          label,
        };
      })
      .filter(
        (item, index, arr) =>
          arr.findIndex((x) => x.userId === item.userId) === index,
      )
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [tiles, session?.host_id, authUserId, profilesById]);

  useEffect(() => {
    const hostId = String(session?.host_id || "")
      .trim()
      .toLowerCase();
    const me = String(authUserId || "")
      .trim()
      .toLowerCase();

    if (!hostId || !me) {
      setSelectedHostChatPeerId(null);
      return;
    }

    const isHost = hostId === me;

    if (!isHost) {
      setSelectedHostChatPeerId(hostId);
      return;
    }

    if (!liveHostChatOptions.length) {
      setSelectedHostChatPeerId(null);
      return;
    }

    setSelectedHostChatPeerId((prev) => {
      if (prev && liveHostChatOptions.some((x) => x.userId === prev))
        return prev;
      return liveHostChatOptions[0]?.userId || null;
    });
  }, [session?.host_id, authUserId, liveHostChatOptions]);

  // hide / pin
  const [hiddenTileIds, setHiddenTileIds] = useState<Record<string, boolean>>(
    {},
  );
  const [pinnedTileId, setPinnedTileId] = useState<string | null>(null);

  // per participant volume
  const [volumePctByParticipantKey, setVolumePctByParticipantKey] = useState<
    Record<string, number>
  >({});
  const [defaultRemoteVolumePct, setDefaultRemoteVolumePct] = useState<number>(
    () => {
      try {
        const raw = Number(
          localStorage.getItem("mysession_lk_default_remote_volume_pct") ||
          "100",
        );
        if (!Number.isFinite(raw)) return 100;
        return Math.max(0, Math.min(300, Math.round(raw)));
      } catch {
        return 125;
      }
    },
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        "mysession_lk_default_remote_volume_pct",
        String(defaultRemoteVolumePct),
      );
    } catch { }
  }, [defaultRemoteVolumePct]);

  // chat unread
  const [unreadChat, setUnreadChat] = useState<number>(0);
  const [unreadGeneralChat, setUnreadGeneralChat] = useState<number>(0);
  const [unreadDirectChatByPeerId, setUnreadDirectChatByPeerId] = useState<
    Record<string, number>
  >({});
  const generalChatVisibleRef = useRef<boolean>(false);
  const directChatVisibleRef = useRef<boolean>(false);
  const selectedHostChatPeerIdRef = useRef<string | null>(null);
  const lastGeneralChatReadAtRef = useRef<number>(0);
  const lastDirectChatReadAtByPeerRef = useRef<Record<string, number>>({});

  // reactions
  const [floatingReactions, setFloatingReactions] = useState<
    FloatingReaction[]
  >([]);
  const reactionIdRef = useRef<number>(0);
  const reactionsChannelRef = useRef<any>(null);

  // edit name modal
  const pipWindowRef = useRef<Window | null>(null);
  const [pipMountEl, setPipMountEl] = useState<HTMLElement | null>(null);
  const [pipOpen, setPipOpen] = useState(false);

  const documentPipSupported =
    typeof window !== "undefined" &&
    typeof (window as WindowWithDocumentPiP).documentPictureInPicture !==
    "undefined";

  const pipSupported = typeof window !== "undefined";

  useEffect(() => {
    setOpenTileAdminMenuId((prev) =>
      prev && tiles.some((t) => t.id === prev) ? prev : null,
    );
  }, [tiles]);

  const participantsCount = useMemo(() => {
    const r = roomRef.current;
    if (!r) return 0;
    return 1 + r.remoteParticipants.size;
  }, [roomState, tiles]);

  const micToggleHook = useTrackToggle({
    source: Track.Source.Microphone,
    room: roomState || undefined,
    captureOptions: {
      deviceId:
        selectedAudioInputId || prejoinRef.current.audioInputId || undefined,
      echoCancellation: echoCancellationEnabled,
      noiseSuppression: noiseSuppressionEnabled,
      autoGainControl: autoGainControlEnabled,
    } as any,
    onDeviceError: (error) => {
      console.error("mic toggle device error:", error);
      setMediaWarning(
        normalizeMediaWarningMessage(
          (error as any)?.message || error || "microphone_toggle_failed",
        ),
      );
    },
  });

  const camToggleHook = useTrackToggle({
    source: Track.Source.Camera,
    room: roomState || undefined,
    captureOptions: {
      deviceId:
        selectedVideoInputId || prejoinRef.current.videoInputId || undefined,
      resolution: {
        width: capturePreset.width,
        height: capturePreset.height,
      },
      frameRate: capturePreset.fps,
    } as any,
    onDeviceError: (error) => {
      console.error("camera toggle device error:", error);
      setMediaWarning(
        normalizeMediaWarningMessage(
          (error as any)?.message || error || "camera_toggle_failed",
        ),
      );
    },
  });

  const volumeStorageKey = useMemo(() => {
    return session?.id ? `mysession_lk_volume:${session.id}` : "";
  }, [session?.id]);

  useEffect(() => {
    if (!volumeStorageKey) return;
    try {
      const raw = localStorage.getItem(volumeStorageKey);
      if (!raw) {
        setVolumePctByParticipantKey({});
        return;
      }
      const parsed = JSON.parse(raw);
      setVolumePctByParticipantKey(
        parsed && typeof parsed === "object" ? parsed : {},
      );
    } catch {
      setVolumePctByParticipantKey({});
    }
  }, [volumeStorageKey]);

  useEffect(() => {
    if (!volumeStorageKey) return;
    try {
      localStorage.setItem(
        volumeStorageKey,
        JSON.stringify(volumePctByParticipantKey),
      );
    } catch { }
  }, [volumeStorageKey, volumePctByParticipantKey]);

  const resetAllParticipantVolumesToDefault = useCallback(() => {
    setVolumePctByParticipantKey({});
  }, []);

  const applyDefaultRemoteVolumePreset = useCallback((pct: number) => {
    setDefaultRemoteVolumePct(clamp(Math.round(pct), 0, 300));
  }, []);

  const roomNameForApi = useMemo(() => {
    if (!session) return "";
    return safeRoomName(`session-${session.id}`);
  }, [session]);

  const showSystemNotice = (next: Omit<RoomSystemNotice, "open">) => {
    setSystemNotice({
      open: true,
      kind: next.kind,
      title: next.title,
      body: next.body,
    });
  };

  const closeSystemNotice = () => {
    setSystemNotice((prev) => ({ ...prev, open: false }));
  };

  const handleKickedOut = async (payload?: KickBroadcastPayload | null) => {
    if (kickRedirecting) return;

    setKickRedirecting(true);
    kickedBySignalRef.current = true;

    const byName = String(payload?.kickedByName || "").trim();
    const body = byName
      ? `You were disconnected by ${byName}.`
      : "You were disconnected by a moderator.";

    await disconnectRoom({ skipNavigate: true, preserveKickNotice: true });

    setSystemNotice({
      open: true,
      kind: "kick",
      title: "You were disconnected",
      body,
    });
  };

  useEffect(() => {
    if (!session?.id) return;
    if (!authUserId) return;

    const channelName = makeKickBroadcastChannelName(session.id);

    const ch = supabase
      .channel(channelName, {
        config: { broadcast: { self: true } },
      })
      .on(
        "broadcast",
        { event: "participant_kicked" },
        async (payload: any) => {
          const p = (payload?.payload || payload || {}) as KickBroadcastPayload;

          const matched = matchesKickPayload({
            payload: p,
            localIdentity: livekitIdentityRef.current,
            authUserId: String(authUserId || ""),
            baseUserId: String(baseUserIdRef.current || ""),
          });

          if (!matched) return;
          await handleKickedOut(p);
        },
      )
      .subscribe();

    kickEventChannelRef.current = ch;

    return () => {
      if (kickEventChannelRef.current === ch)
        kickEventChannelRef.current = null;
      safeRemoveRealtimeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, authUserId, kickRedirecting]);

  useEffect(() => {
    const stateNotice = (window.history.state as any)?.usr?.livekitNotice;
    if (!stateNotice) return;
    if (stateNotice.kind !== "kick") return;

    showSystemNotice({
      kind: "kick",
      title: String(stateNotice.title || "Disconnected from room"),
      body: String(stateNotice.body || "You were removed from this room."),
    });

    try {
      const current = window.history.state || {};
      const nextUsr = { ...(current.usr || {}) };
      delete nextUsr.livekitNotice;
      window.history.replaceState({ ...current, usr: nextUsr }, "");
    } catch { }
  }, []);

  // pull profiles for anyone we see in room
  useEffect(() => {
    const ids = uniqStrings(
      tiles
        .map((t) => String(t.participantUserId || "").toLowerCase())
        .filter((x) => looksLikeUuid(x)),
    );
    if (!ids.length) return;
    const missing = ids.filter((id) => !profilesById[id]);
    if (!missing.length) return;

    (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url, bio")
          .in("id", missing);

        const rows = Array.isArray(data) ? data : [];
        const patch: Record<string, HostProfile> = {};

        for (const r of rows as any[]) {
          const pid = String(r?.id || "").toLowerCase();
          if (!pid) continue;
          const avatar = await resolveAvatarUrlFromProfilesField(
            String(r?.avatar_url || ""),
          );
          patch[pid] = {
            id: pid,
            full_name: String(r?.full_name || "").trim(),
            avatar_url: avatar || null,
            bio: r?.bio ?? null,
          };
        }

        if (Object.keys(patch).length) {
          setProfilesById((prev) => ({ ...prev, ...patch }));
        }

        window.setTimeout(() => {
          scheduleRebuildTiles();
        }, 80);
      } catch (e) {
        console.warn("profiles fetch failed", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles.map((t) => `${t.participantUserId || ""}`).join("|")]);

  // RAF-scheduled rebuild
  const rebuildRafRef = useRef<number | null>(null);
  const scheduleRebuildTiles = () => {
    if (rebuildRafRef.current) return;
    rebuildRafRef.current = window.requestAnimationFrame(() => {
      rebuildRafRef.current = null;
      rebuildTiles();
    });
  };

  const applyVolumeToRemoteParticipant = (tileId: string, pct: number) => {
    const r = roomRef.current;
    if (!r) return;
    const p = Array.from(r.remoteParticipants.values()).find(
      (rp) => rp.sid === tileId,
    );
    if (!p) return;

    try {
      const micPub = Array.from(p.audioTrackPublications.values()).find(
        (x: any) => x.source === Track.Source.Microphone,
      ) as any;
      const tr = micPub?.track as any;
      const vol = clamp(pct, 0, 300) / 100;
      if (tr?.setVolume) tr.setVolume(vol);
      else if (typeof (tr as any)?.volume === "number")
        (tr as any).volume = vol;
    } catch { }
  };

  const setParticipantVolumePct = (tile: TileModel, pct: number) => {
    const v = clamp(Math.round(pct), 0, 300);
    const key = getParticipantVolumeKey(tile);

    setVolumePctByParticipantKey((prev) => ({ ...prev, [key]: v }));
    applyVolumeToRemoteParticipant(tile.id, v);
  };

  const getLocalCameraPublication = () => {
    const r = roomRef.current;
    if (!r) return null;
    const lp = r.localParticipant;
    const pub = Array.from(lp.videoTrackPublications.values()).find(
      (p: LocalTrackPublication) => p.source === Track.Source.Camera,
    );
    return pub || null;
  };

  const getLocalCameraTrack = (): LocalVideoTrack | null => {
    const pub = getLocalCameraPublication();
    return (pub?.track as any) || null;
  };

  const getLocalMicPublication = () => {
    const r = roomRef.current;
    if (!r) return null;
    const lp = r.localParticipant;
    const pub = Array.from(lp.audioTrackPublications.values()).find(
      (p: any) => p.source === Track.Source.Microphone,
    );
    return pub || null;
  };

  const rebuildTiles = () => {
    const room = roomRef.current;
    if (!room) return;

    const next: TileModel[] = [];
    const lp = room.localParticipant;

    const localCamPub = Array.from(lp.videoTrackPublications.values()).find(
      (p) => p.source === Track.Source.Camera,
    ) as any;
    const localMicPub = Array.from(lp.audioTrackPublications.values()).find(
      (p) => p.source === Track.Source.Microphone,
    ) as any;

    const localCamTrackRaw = (localCamPub?.track as any) || undefined;
    const localAudioTrackRaw =
      localMicPub?.track instanceof LocalAudioTrack
        ? localMicPub.track
        : undefined;

    const localIdentity = String(
      lp.identity || livekitIdentityRef.current || "",
    );
    const localUserId =
      authUserId && looksLikeUuid(authUserId)
        ? String(authUserId).toLowerCase()
        : extractBaseUserIdFromIdentity(localIdentity);

    const localMicMuted = localMicPub ? !!(localMicPub as any).isMuted : true;

    const localCamPubExists = !!localCamPub;
    const localCamPubHasTrack = !!localCamPub?.track;
    const localCamPubMuted = localCamPub ? !!localCamPub.isMuted : true;

    const localCamActuallyVisible =
      localCamPubExists && localCamPubHasTrack && !localCamPubMuted;

    const localCamTrack = localCamActuallyVisible
      ? localCamTrackRaw
      : undefined;

    setMicOn((prev) => {
      const nextOn = !localMicMuted;
      return prev === nextOn ? prev : nextOn;
    });
    setCamOn((prev) => {
      const nextOn =
        localCamPubExists && localCamPubHasTrack && !localCamPubMuted;
      return prev === nextOn ? prev : nextOn;
    });

    const localParticipantMetadataDisplayName =
      getDisplayNameFromParticipantMetadata((lp as any)?.metadata);

    const localParticipantStatus = getStatusFromMetadata((lp as any)?.metadata);

    const effectiveLocalLabel =
      String(
        localRoomDisplayNameOverrideRef.current ||
        localParticipantMetadataDisplayName ||
        displayName ||
        prejoinRef.current.displayName ||
        userName ||
        "You",
      ).trim() || "You";

    next.push({
      id: "local",
      kind: "camera",
      label: effectiveLocalLabel,
      metadataDisplayName: localParticipantMetadataDisplayName || undefined,
      status: localParticipantStatus,
      isLocal: true,
      videoTrack: localCamTrack,
      audioTrack: localAudioTrackRaw,
      participantIdentity: localIdentity || undefined,
      participantUserId: localUserId || undefined,
      micMuted: localMicMuted,
      camPubExists: localCamPubExists,
      camPubHasTrack: localCamPubHasTrack,
      camPubMuted: localCamPubMuted,
    });
    room.remoteParticipants.forEach((rp: RemoteParticipant) => {
      const allVideoPubs = Array.from(
        rp.videoTrackPublications.values(),
      ) as RemoteTrackPublication[];
      const allAudioPubs = Array.from(
        rp.audioTrackPublications.values(),
      ) as RemoteTrackPublication[];

      const camPub = allVideoPubs.find(
        (p: any) => p.source === Track.Source.Camera,
      ) as any;
      const micPub = allAudioPubs.find(
        (p: any) => p.source === Track.Source.Microphone,
      ) as any;

      const remoteCamPubExists = !!camPub;
      const remoteCamPubHasTrack = !!camPub?.track;
      const remoteCamPubMuted = camPub ? !!camPub.isMuted : true;

      const remoteCamActuallyVisible =
        remoteCamPubExists && remoteCamPubHasTrack && !remoteCamPubMuted;

      const vt = remoteCamActuallyVisible
        ? (camPub?.track as any) || undefined
        : undefined;
      const remoteAudioTrack =
        micPub?.track instanceof RemoteAudioTrack ? micPub.track : undefined;

      const exactIdentity = String(rp.identity || "");
      const baseUserId = extractBaseUserIdFromIdentity(exactIdentity);
      const prof = looksLikeUuid(baseUserId)
        ? profilesById[String(baseUserId).toLowerCase()]
        : undefined;

      const nameFromProfile = String(prof?.full_name || "").trim();
      const nm =
        (nameFromProfile || rp.name || rp.identity || "Guest").trim() ||
        "Guest";

      const tileId = rp.sid;
      const remoteMicMuted = micPub ? !!(micPub as any).isMuted : true;

      const participantMetadataDisplayName =
        getDisplayNameFromParticipantMetadata((rp as any)?.metadata);

      const participantStatus = getStatusFromMetadata((rp as any)?.metadata);

      const effectiveRemoteLabel =
        participantMetadataDisplayName ||
        String(nm || "").trim() ||
        String((rp as any)?.name || "").trim() ||
        "Participant";

      next.push({
        id: tileId,
        kind: "camera",
        label: effectiveRemoteLabel,
        metadataDisplayName: participantMetadataDisplayName || undefined,
        status: participantStatus,
        isLocal: false,
        videoTrack: vt,
        audioTrack: remoteAudioTrack,
        participantIdentity: exactIdentity || undefined,
        participantUserId: baseUserId || undefined,
        micTrackSid: micPub?.trackSid,
        camTrackSid: camPub?.trackSid,
        micMuted: remoteMicMuted,
        camPubExists: remoteCamPubExists,
        camPubHasTrack: remoteCamPubHasTrack,
        camPubMuted: remoteCamPubMuted,
        remoteMicPubSid: micPub?.trackSid ? String(micPub.trackSid) : undefined,
      });

      const volumeKey = getParticipantVolumeKey({
        id: tileId,
        participantUserId: baseUserId || undefined,
        participantIdentity: exactIdentity || undefined,
      });

      const pct = Number(
        volumePctByParticipantKey[volumeKey] ?? 100,
      );
      if (Number.isFinite(pct)) {
        applyVolumeToRemoteParticipant(tileId, pct);
      }
    });

    setTiles(next);

    requestRemoteScreenShareSubscriptions(room);

    const nextScreenSharesRaw = buildScreenShareTiles({
      room,
      authUserId,
      displayName,
      userName,
      profilesById,
    }) as TileModel[];

    const nextScreenShares =
      filterRenderableScreenShareTiles(nextScreenSharesRaw);

    setScreenShareTiles(nextScreenShares);
    setScreenShareOn(hasLocalLiveScreenShare(room));
  };

  const disconnectRoom = async (opts?: {
    skipNavigate?: boolean;
    preserveKickNotice?: boolean;
    preserveAttendance?: boolean;
    preserveTabPresence?: boolean;
    preserveJoinRequested?: boolean;
  }) => {
    try {
      const r = roomRef.current;
      roomRef.current = null;
      setRoomState(null);

      if (r) {
        r.removeAllListeners();
        await r.disconnect();
      }
    } catch (e) {
      console.warn("disconnect error:", e);
    } finally {
      setConnected(false);
      setMicOn(false);
      setCamOn(false);
      setScreenShareOn(false);
      setTiles([]);
      setScreenShareTiles([]);
      setFxStatusText("");
      setFxError("");
      setFxApplying(false);
      setOpenTileAdminMenuId(null);
      if (!opts?.preserveJoinRequested) {
        setJoinRequested(false);
      }
      connectInFlightRef.current = false;

      if (!opts?.preserveKickNotice) {
        setSystemNotice((prev) => ({ ...prev, open: false }));
      }

      if (!opts?.preserveAttendance) {
        await leaveAttendanceOnce({ keepalive: false });
      }
      if (!opts?.preserveTabPresence) {
        releaseTabPresence();
      }
      await closePictureInPicture().catch(() => { });
    }
  };

  useEffect(() => {
    if (!sessionId || !sessionCloseInfo.closed) return;

    setPrejoinOpen(false);
    setJoinRequested(false);
    setTokenError("");
    setClientError("");
    setMediaWarning("");

    if (autoClosedSessionIdRef.current === sessionId) return;
    autoClosedSessionIdRef.current = sessionId;

    const shouldDisconnect =
      !!roomRef.current ||
      connectedRef.current ||
      joinRequestedRef.current ||
      connectInFlightRef.current;

    if (!shouldDisconnect) return;

    explicitLeaveRequestedRef.current = true;

    void disconnectRoom({
      skipNavigate: true,
      preserveKickNotice: true,
    }).catch((e) => {
      console.warn("[session-close] auto disconnect failed:", e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sessionCloseInfo.closed]);

  const syncLiveAudioInput = async (deviceId: string) => {
    const useId = pickExistingDeviceId(
      String(deviceId || ""),
      devices.audioInputs,
    );

    setSelectedAudioInputId(useId);
    setPrejoin((prev) => ({ ...prev, audioInputId: useId }));
    prejoinRef.current = { ...prejoinRef.current, audioInputId: useId };

    const r = roomRef.current;
    if (!r) return;

    try {
      if (!micOn) return;

      await r.localParticipant.setMicrophoneEnabled(true, {
        deviceId: useId || undefined,
        echoCancellation: prejoinRef.current.echoCancellation,
        noiseSuppression: prejoinRef.current.noiseSuppression,
        autoGainControl: prejoinRef.current.autoGainControl,
      } as any);

      scheduleRebuildTiles();
    } catch (e) {
      console.error("syncLiveAudioInput failed:", e);
      setClientError(
        String((e as any)?.message || e || "audio_input_switch_failed"),
      );
    }
  };

  const syncLiveVideoInput = async (deviceId: string) => {
    const useId = pickExistingDeviceId(
      String(deviceId || ""),
      devices.videoInputs,
    );

    setSelectedVideoInputId(useId);
    setPrejoin((prev) => ({ ...prev, videoInputId: useId }));
    prejoinRef.current = { ...prejoinRef.current, videoInputId: useId };

    const r = roomRef.current;

    try {
      if (!r) {
        if (prejoinOpen && prejoinRef.current.videoEnabled) {
          await initPrejoinPreview({
            delayedForWeak: false,
            forceTrack: true,
          });
        }
        return;
      }

      if (!camOn) return;

      const existingPub: any = getLocalCameraPublication();
      if (existingPub?.track) {
        try {
          await existingPub.track.stop?.();
        } catch { }
        try {
          await r.localParticipant.unpublishTrack(existingPub.track, true);
        } catch { }
      }

      const nextTrack = await createLocalVideoTrack({
        deviceId: useId || undefined,
        resolution: {
          width: isChromeOS ? 640 : capturePreset.width,
          height: isChromeOS ? 360 : capturePreset.height,
        },
        frameRate: isChromeOS ? 15 : capturePreset.fps,
      } as any);

      if (!shouldDisableBackgroundFx && videoFxMode !== "off") {
        try {
          await safeApplyProcessor(
            nextTrack,
            videoFxMode,
            blurStrength,
            bgImageUrl,
          );
        } catch (e) {
          console.warn("syncLiveVideoInput fx apply failed:", e);
        }
      }

      await r.localParticipant.publishTrack(nextTrack, {
        source: Track.Source.Camera,
      } as any);
      scheduleRebuildTiles();
    } catch (e) {
      console.error("syncLiveVideoInput failed:", e);
      setMediaWarning(
        normalizeMediaWarningMessage(
          (e as any)?.message || e || "video_input_switch_failed",
        ),
      );
    }
  };

  const syncLiveAudioProcessing = async (next: {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
  }) => {
    const r = roomRef.current;
    if (!r) return;
    if (!micOn) return;

    try {
      await r.localParticipant.setMicrophoneEnabled(true, {
        deviceId:
          selectedAudioInputId || prejoinRef.current.audioInputId || undefined,
        echoCancellation: next.echoCancellation,
        noiseSuppression: next.noiseSuppression,
        autoGainControl: next.autoGainControl,
      } as any);
      scheduleRebuildTiles();
    } catch (e) {
      console.error("syncLiveAudioProcessing failed:", e);
      setMediaWarning(
        normalizeMediaWarningMessage(
          (e as any)?.message || e || "audio_processing_failed",
        ),
      );
    }
  };

  const connectRoom = async (opts: {
    forceReconnect?: boolean;
    preserveAttendance?: boolean;
    preserveTabPresence?: boolean;
    preserveJoinRequested?: boolean;
  } = {}) => {
    if (!lkServerUrl || !lkToken) return;
    if (connectInFlightRef.current) return;

    const existingRoom: any = roomRef.current as any;
    const existingState = String(existingRoom?.state || "").toLowerCase();

    // Important for mobile/tablet tab switching:
    // returning to the tab can re-trigger joinRequested/effects while the original
    // LiveKit room is still connected. Do NOT disconnect/reconnect in that case,
    // because that causes the visible local video tile reload.
    if (existingRoom && existingState === "connected" && !opts.forceReconnect) {
      setConnected(true);
      setPrejoinOpen(false);
      setMobileMediaRestoreOpen(false);
      setMediaWarning("");
      scheduleRebuildTiles();
      window.setTimeout(() => scheduleRebuildTiles(), 120);
      return;
    }

    if (
      existingRoom &&
      !opts.forceReconnect &&
      (existingState === "connecting" ||
        existingState === "reconnecting" ||
        existingState === "signalreconnecting")
    ) {
      openMobileRestoreState("restoring");
      return;
    }

    if (paywallRuntimeBlocked && !!authUserId) {
      setPaywallModalOpen(true);
      return;
    }

    connectInFlightRef.current = true;
    const attemptId = connectAttemptIdRef.current + 1;
    connectAttemptIdRef.current = attemptId;

    let connectedToRoom = false;

    const failAfter = window.setTimeout(() => {
      if (connectAttemptIdRef.current !== attemptId) return;
      setClientError("Connecting to LiveKit timed out. Please try again.");
      void disconnectRoom({
        preserveAttendance: opts.preserveAttendance,
        preserveTabPresence: opts.preserveTabPresence,
        preserveJoinRequested: opts.preserveJoinRequested,
      });
      setPrejoinOpen(true);
      setJoinRequested(false);
    }, 15000);

    setClientError("");
    setFxError("");
    setMediaWarning("");

    await disconnectRoom({
      preserveAttendance: opts.preserveAttendance,
      preserveTabPresence: opts.preserveTabPresence,
      preserveJoinRequested: opts.preserveJoinRequested,
    });

    try {
      const pj = prejoinRef.current;

      const r = new Room({
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: false,
        publishDefaults: {
          simulcast: !lowPowerMobileMode,
          videoCodec: "vp8",
        } as any,
      });

      roomRef.current = r;
      setRoomState(r);

      const refresh = () => scheduleRebuildTiles();

      r.on(RoomEvent.Connected, () => {
        void writeConnectionDiagnostic("livekit.connected", {
          roomState: String((r as any)?.state || ""),
        });

        setConnected(true);
        if (returningFromBackgroundRef.current || mobileMediaRestoreOpen) {
          closeMobileRestoreState();
          returningFromBackgroundRef.current = false;
          pageHiddenAtRef.current = null;
          setMediaWarning("");
        }
        refresh();
      });

      r.on(RoomEvent.Disconnected, (reason: any) => {
        void writeConnectionDiagnostic("livekit.disconnected", {
          reason: String(reason || ""),
          roomState: String((r as any)?.state || ""),
        });

        const likelyBackgroundDisconnect =
          !explicitLeaveRequestedRef.current &&
          !kickedBySignalRef.current &&
          (returningFromBackgroundRef.current ||
            !!pageHiddenAtRef.current ||
            document.visibilityState !== "visible");

        setConnected(false);
        setTiles([]);
        setScreenShareTiles([]);
        setOpenTileAdminMenuId(null);

        if (likelyBackgroundDisconnect) {
          openMobileRestoreState("needs_action");
          setMediaWarning(
            "Mobile browser paused the room while you were using another app. Rejoin the room to continue.",
          );
          return;
        }

        void trackWeeklyUsageOnLeave();
        void leaveAttendanceOnce({ keepalive: false });

        if (!kickedBySignalRef.current && !kickRedirecting) {
          showSystemNotice({
            kind: "info",
            title: "Disconnected",
            body: "You were disconnected from the room.",
          });
        }

        releaseTabPresence();
      });

      r.on(RoomEvent.Reconnecting as any, () => {
        void writeConnectionDiagnostic("livekit.reconnecting", {
          roomState: String((r as any)?.state || ""),
        });

        if (
          !explicitLeaveRequestedRef.current &&
          !kickedBySignalRef.current &&
          (returningFromBackgroundRef.current ||
            !!pageHiddenAtRef.current ||
            document.visibilityState === "visible")
        ) {
          openMobileRestoreState("restoring");
          setMediaWarning(
            "Restoring your connection… Mobile browsers may pause the room after you switch apps.",
          );
        }
      });

      r.on(RoomEvent.Reconnected, () => {
        void writeConnectionDiagnostic("livekit.reconnected", {
          roomState: String((r as any)?.state || ""),
        });

        setConnected(true);
        closeMobileRestoreState();
        returningFromBackgroundRef.current = false;
        pageHiddenAtRef.current = null;
        setMediaWarning("");
        refresh();
      });
      r.on(RoomEvent.ParticipantConnected, () => {
        if (roomSoundsEnabledRef.current) {
          playOneShotFromCandidates(JOIN_SOUND_CANDIDATES, 0.8);
        }
        refresh();
      });
      r.on(RoomEvent.ParticipantDisconnected, () => {
        if (roomSoundsEnabledRef.current) {
          playOneShotFromCandidates(LEAVE_SOUND_CANDIDATES, 0.8);
        }
        refresh();
      });
      r.on(RoomEvent.TrackSubscribed, refresh);
      r.on(RoomEvent.TrackUnsubscribed, refresh);
      r.on(RoomEvent.TrackMuted as any, refresh as any);
      r.on(RoomEvent.TrackUnmuted as any, refresh as any);
      r.on(RoomEvent.TrackPublished as any, refresh as any);
      r.on(RoomEvent.TrackUnpublished as any, refresh as any);
      r.on(RoomEvent.TrackSubscriptionFailed as any, refresh as any);
      r.on(RoomEvent.LocalTrackPublished as any, refresh as any);
      r.on(RoomEvent.LocalTrackUnpublished as any, refresh as any);

      await r.connect(lkServerUrl, lkToken, { autoSubscribe: true });
      connectedToRoom = true;

      if (USAGE_TRACKING_ENABLED) {
        sessionJoinStartedAtRef.current = Date.now();
        usageTrackedRef.current = false;

        try {
          await incrementWeeklyUsage({
            userId: String(authUserId || "").trim(),
            addSessions: 1,
          });

          console.log("[usage] weekly session counted:", {
            userId: authUserId,
            sessionId: session?.id,
          });
        } catch (e) {
          console.error("[usage] incrementWeeklyUsage sessions failed:", e);
        }
      }

      await r.localParticipant.setCameraEnabled(false);
      setCamOn(false);

      await r.localParticipant.setMicrophoneEnabled(false);
      setMicOn(false);

      if (pendingRoomAudioUnlockRef.current) {
        try {
          await ensureRoomAudioPlaybackUnlocked("connect");
        } catch (e) {
          console.warn("post-connect room audio unlock failed:", e);
        } finally {
          pendingRoomAudioUnlockRef.current = false;
        }
      }

      kickedBySignalRef.current = false;

      leaveOnceRef.current = false;
      leavePromiseRef.current = null;
      await attendanceJoin();
      startAttendanceHeartbeat();

      const shouldAutoStartCameraOnJoin = !!pj.videoEnabled;

      // Camera from prejoin. Important: weak laptops / Firefox should still TRY camera.
      // Heavy FX can fail separately, but camera failure must not break room join.
      if (shouldAutoStartCameraOnJoin) {
        try {
          const fxAllowed = videoFxMode !== "off" && !shouldDisableBackgroundFx;
          let prepared = prejoinPreparedVideoTrackRef.current;

          if (!prepared) {
            prepared = await createPrejoinPreparedVideoTrack({ force: true });

            if (prepared && fxAllowed) {
              try {
                await safeApplyProcessor(
                  prepared,
                  videoFxMode,
                  blurStrength,
                  bgImageUrl,
                );
              } catch (e) {
                console.warn("apply fx before publish failed:", e);
              }
            }
          }

          if (prepared) {
            await r.localParticipant.publishTrack(prepared, {
              source: Track.Source.Camera,
            } as any);
            prejoinPreparedVideoTrackRef.current = null;
            setCamOn(true);
          } else {
            await r.localParticipant.setCameraEnabled(true, {
              deviceId: pj.videoInputId || selectedVideoInputId || undefined,
              resolution: {
                width: lowPowerMobileMode ? 320 : capturePreset.width,
                height: lowPowerMobileMode ? 180 : capturePreset.height,
              },
              frameRate: lowPowerMobileMode ? 8 : capturePreset.fps,
            } as any);
            setCamOn(true);
          }

          setDeviceError("");
        } catch (e: any) {
          console.warn("[join] camera enable failed:", e);
          setCamOn(false);

          const msg = normalizeMediaWarningMessage(
            e?.message || e?.name || e || "camera_enable_failed",
          );

          setDeviceError(msg);
          setMediaWarning(
            `${msg} You joined the room, but your camera is off. In Firefox, click the lock icon near the address bar, allow Camera, then choose the camera and try again.`,
          );
        }
      } else {
        try {
          await r.localParticipant.setCameraEnabled(false);
        } catch { }
        setCamOn(false);
      }

      // Microphone from prejoin. Failure should not kick user out of the room.
      if (pj.audioEnabled) {
        try {
          await r.localParticipant.setMicrophoneEnabled(true, {
            deviceId: pj.audioInputId || selectedAudioInputId || undefined,
            echoCancellation: !!pj.echoCancellation,
            noiseSuppression: !!pj.noiseSuppression,
            autoGainControl: !!pj.autoGainControl,
          } as any);
          setMicOn(true);
        } catch (e: any) {
          console.warn("[join] microphone enable failed:", e);
          setMicOn(false);

          const msg = normalizeMediaWarningMessage(
            e?.message || e?.name || e || "microphone_enable_failed",
          );

          setDeviceError(msg);
          setMediaWarning(
            `${msg} You joined the room, but your microphone is off. In Firefox, click the lock icon near the address bar, allow Microphone, then choose the microphone and try again.`,
          );
        }
      }

      refresh();

      setSelectedAudioOutputId(pj.audioOutputId || "default");
      setSelectedAudioInputId(pj.audioInputId || selectedAudioInputId || "");
      setSelectedVideoInputId(pj.videoInputId || selectedVideoInputId || "");

      setEchoCancellationEnabled(!!pj.echoCancellation);
      setNoiseSuppressionEnabled(!!pj.noiseSuppression);
      setAutoGainControlEnabled(!!pj.autoGainControl);

      setPrejoinOpen(false);
      setPrejoinPreviewVersion((v) => v + 1);
    } catch (e: any) {
      console.error("LiveKit connect failed:", e);

      const msg = String(e?.message || e || "connect_failed");

      if (!connectedToRoom) {
        setClientError(msg);
        await disconnectRoom({
          preserveAttendance: opts.preserveAttendance,
          preserveTabPresence: opts.preserveTabPresence,
          preserveJoinRequested: opts.preserveJoinRequested,
        });
      } else {
        setMediaWarning(normalizeMediaWarningMessage(msg));
        console.warn(
          "Media step failed after room connect, keeping user in room",
        );
      }
    } finally {
      window.clearTimeout(failAfter);
      if (connectAttemptIdRef.current === attemptId) {
        connectInFlightRef.current = false;
      }
    }
  };

  useEffect(() => {
    if (!joinRequested) return;
    if (!lkToken) return;
    if (!lkServerUrl) return;
    connectRoom().catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinRequested, lkToken, lkServerUrl]);

  useEffect(() => {
    return () => {
      if (rebuildRafRef.current) {
        try {
          cancelAnimationFrame(rebuildRafRef.current);
        } catch { }
      }
      disconnectRoom().catch(() => { });
      cleanupPrejoinPreparedVideoTrack().catch(() => { });
      if (uploadedBgUrlRef.current) {
        try {
          URL.revokeObjectURL(uploadedBgUrlRef.current);
        } catch { }
      }
      stopWelcomeLoop();
      releaseTabPresence();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // toggle mic
  const toggleMic = async () => {
    const room = roomRef.current || roomState;

    if (!room?.localParticipant) {
      console.warn("[mic-toggle] skipped: room/localParticipant is not ready");
      setMediaWarning(
        "Microphone is not ready yet. Please wait a moment and try again.",
      );
      return;
    }

    const lp = room.localParticipant;

    const currentlyEnabled = (() => {
      try {
        const pubs = Array.from(lp.audioTrackPublications?.values?.() || []);
        const micPub = pubs.find(
          (p: any) => p?.source === Track.Source.Microphone,
        );
        return !!micPub && !micPub.isMuted && !!micPub.track;
      } catch {
        return !!micOn;
      }
    })();

    const nextEnabled = !currentlyEnabled;

    const selectedMicId = String(
      selectedAudioInputId || prejoinRef.current.audioInputId || "",
    ).trim();

    const micConstraintsWithSelectedDevice = {
      deviceId: selectedMicId || undefined,
      echoCancellation: echoCancellationEnabled,
      noiseSuppression: noiseSuppressionEnabled,
      autoGainControl: autoGainControlEnabled,
    } as any;

    const micConstraintsWithDefaultDevice = {
      echoCancellation: echoCancellationEnabled,
      noiseSuppression: noiseSuppressionEnabled,
      autoGainControl: autoGainControlEnabled,
    } as any;

    const finishMicToggleSuccess = async (usedFallbackDefaultMic = false) => {
      setMicOn(nextEnabled);

      if (nextEnabled) {
        setDeviceError("");

        if (usedFallbackDefaultMic) {
          setSelectedAudioInputId("");
          setPrejoin((prev) => ({
            ...prev,
            audioInputId: "",
            audioEnabled: true,
          }));
          prejoinRef.current = {
            ...prejoinRef.current,
            audioInputId: "",
            audioEnabled: true,
          };

          setMediaWarning(
            "Your selected microphone did not start, so MySession switched to the default microphone. If this is not the right mic, open Settings and choose another microphone.",
          );
        } else {
          setMediaWarning("");
        }
      } else {
        setMediaWarning("");
      }

      await ensureRoomAudioPlaybackUnlocked("toggle-mic");

      window.setTimeout(() => {
        ensureRoomAudioPlaybackUnlocked("toggle-mic-delayed").catch(() => { });
      }, 180);

      scheduleRebuildTiles();

      window.setTimeout(() => {
        scheduleRebuildTiles();
      }, 120);

      window.setTimeout(() => {
        scheduleRebuildTiles();
      }, 420);

      setRemoteAudioRecoveryTick((v) => v + 1);
    };

    console.log("[mic-toggle] click", {
      currentlyEnabled,
      nextEnabled,
      selectedAudioInputId,
      prejoinAudioInputId: prejoinRef.current.audioInputId,
      selectedMicId,
      echoCancellationEnabled,
      noiseSuppressionEnabled,
      autoGainControlEnabled,
      browser: navigator.userAgent,
    });

    try {
      setMediaWarning("");

      await lp.setMicrophoneEnabled(
        nextEnabled,
        micConstraintsWithSelectedDevice,
      );

      await finishMicToggleSuccess(false);

      console.log("[mic-toggle] ok", {
        nextEnabled,
        usedFallbackDefaultMic: false,
        selectedMicId,
      });
    } catch (firstError: any) {
      console.error("[mic-toggle] first attempt failed:", firstError);

      // Self-healing unmute:
      // If a user is trying to unmute and the selected/exact microphone fails,
      // try again with the browser default microphone. This helps Firefox,
      // stale deviceId, Bluetooth/headset disconnects, and wrong-device cases.
      if (nextEnabled && selectedMicId) {
        try {
          console.warn("[mic-toggle] retrying with default microphone", {
            failedSelectedMicId: selectedMicId,
            firstError,
          });

          try {
            await lp.setMicrophoneEnabled(false);
          } catch { }

          await delay(120);

          await lp.setMicrophoneEnabled(true, micConstraintsWithDefaultDevice);

          await finishMicToggleSuccess(true);

          console.log("[mic-toggle] ok after default microphone fallback", {
            failedSelectedMicId: selectedMicId,
          });

          return;
        } catch (fallbackError: any) {
          console.error(
            "[mic-toggle] default microphone fallback failed:",
            fallbackError,
          );

          setMicOn(currentlyEnabled);

          const firstMsg = normalizeMediaWarningMessage(
            firstError?.message ||
            firstError?.name ||
            firstError ||
            "microphone_toggle_failed",
          );
          const fallbackMsg = normalizeMediaWarningMessage(
            fallbackError?.message ||
            fallbackError?.name ||
            fallbackError ||
            "default_microphone_failed",
          );

          const combinedMsg =
            firstMsg === fallbackMsg
              ? firstMsg
              : `${firstMsg} Default microphone also failed: ${fallbackMsg}`;

          setDeviceError(combinedMsg);
          setMediaWarning(
            `${combinedMsg} Check the browser lock icon, allow Microphone, close Zoom/Discord/Meet/OBS, then open Settings and choose Default microphone.`,
          );

          scheduleRebuildTiles();

          window.setTimeout(() => {
            scheduleRebuildTiles();
          }, 180);

          return;
        }
      }

      setMicOn(currentlyEnabled);

      const msg = normalizeMediaWarningMessage(
        firstError?.message ||
        firstError?.name ||
        firstError ||
        "microphone_toggle_failed",
      );

      setDeviceError(msg);
      setMediaWarning(
        `${msg} Check the browser lock icon, allow Microphone, close Zoom/Discord/Meet/OBS, then open Settings and choose Default microphone.`,
      );

      scheduleRebuildTiles();

      window.setTimeout(() => {
        scheduleRebuildTiles();
      }, 180);
    }
  };

  const unmuteMicForAiCheckin = async () => {
    if (micOn) return;
    await toggleMic();
  };

  const muteMicAfterAiCheckin = async () => {
    if (!micOn) return;
    await toggleMic();
  };

  // toggle cam without recreating track
  const toggleCam = async () => {
    try {
      await camToggleHook.toggle();

      await ensureRoomAudioPlaybackUnlocked("toggle-cam");

      window.setTimeout(() => {
        ensureRoomAudioPlaybackUnlocked("toggle-cam-delayed").catch(() => { });
      }, 180);

      scheduleRebuildTiles();

      window.setTimeout(() => {
        scheduleRebuildTiles();
      }, 120);
    } catch (e: any) {
      console.error("toggleCam error:", e);

      const msg = normalizeMediaWarningMessage(
        e?.message || e?.name || e || "camera_toggle_failed",
      );

      setMediaWarning(
        `${msg} Try allowing camera permissions, choosing another camera, or refreshing the room.`,
      );

      setDeviceError(msg);
      scheduleRebuildTiles();
    }
  };

  const createRoomScreenshot = async () => {
    const root = videoWrapRef.current;
    if (!root) throw new Error("Video container is not ready");

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1280, root.clientWidth || 1280)}" height="${Math.max(720, root.clientHeight || 720)}">
        <rect width="100%" height="100%" fill="#2B2B2B" />
        <text x="50%" y="46%" dominant-baseline="middle" text-anchor="middle" fill="#F8FAFC" font-size="34" font-family="Arial, sans-serif">
          Room screenshot placeholder
        </text>
        <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#94A3B8" font-size="18" font-family="Arial, sans-serif">
          Browser-safe fallback. Replace with html-to-image or captureStream later.
        </text>
      </svg>
    `.trim();

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    try {
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `mysession-room-${stamp}.svg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showSystemNotice({
        kind: "info",
        title: "Screenshot downloaded",
        body: "A room snapshot placeholder file was downloaded. Next step: swap this with real DOM capture.",
      });
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
    }
  };

  const copyStylesToPiPWindow = (pipWindow: Window) => {
    Array.from(document.styleSheets).forEach((styleSheet) => {
      try {
        const cssRules = Array.from((styleSheet as CSSStyleSheet).cssRules)
          .map((rule) => rule.cssText)
          .join("\n");

        const style = pipWindow.document.createElement("style");
        style.textContent = cssRules;
        pipWindow.document.head.appendChild(style);
      } catch {
        const href = (styleSheet as CSSStyleSheet).href;
        if (!href) return;

        const link = pipWindow.document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        pipWindow.document.head.appendChild(link);
      }
    });
  };

  const closePictureInPicture = async () => {
    const pipWindow = pipWindowRef.current;

    pipWindowRef.current = null;
    setPipMountEl(null);
    setPipOpen(false);

    try {
      pipWindow?.close();
    } catch { }
  };

  const openPictureInPicture = async () => {
    setPipMode("gallery");

    if (!pipSupported) {
      alert("Document Picture-in-Picture is not supported in this browser.");
      return;
    }

    if (!connected) {
      alert("Join the room first.");
      return;
    }

    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      try {
        pipWindowRef.current.focus();
      } catch { }
      return;
    }

    const pipApi = (window as WindowWithDocumentPiP).documentPictureInPicture;

    let pipWindow: Window | null = null;

    if (pipApi) {
      pipWindow = await pipApi.requestWindow({
        width: 560,
        height: 420,
        preferInitialWindowPlacement: true,
      } as any);
    } else {
      pipWindow = window.open(
        "",
        "mysession-livekit-pip",
        "popup=yes,width=560,height=420,resizable=yes,scrollbars=no",
      );

      if (!pipWindow) {
        alert("Pop-up blocked. Allow pop-ups for this site.");
        return;
      }
    }

    copyStylesToPiPWindow(pipWindow);

    pipWindow.document.title = `${String(session?.title || "Session")} · PiP`;
    pipWindow.document.body.innerHTML = "";
    pipWindow.document.documentElement.setAttribute("data-theme", theme);
    pipWindow.document.body.className =
      theme === "dark"
        ? "m-0 bg-[#1B1B1B] text-white overflow-hidden"
        : "m-0 bg-[#F3F3F3] text-[#2B2B2B] overflow-hidden";

    const mount = pipWindow.document.createElement("div");
    mount.id = "mysession-livekit-pip-root";
    mount.style.width = "100vw";
    mount.style.height = "100vh";
    mount.style.overflow = "hidden";
    pipWindow.document.body.appendChild(mount);

    pipWindow.addEventListener(
      "pagehide",
      () => {
        pipWindowRef.current = null;
        setPipMountEl(null);
        setPipOpen(false);
      },
      { once: true },
    );

    pipWindowRef.current = pipWindow;
    setPipMountEl(mount);
    setPipOpen(true);
  };

  const togglePictureInPicture = useCallback(async () => {
    if (pipOpen) {
      await closePictureInPicture();
      return;
    }

    await openPictureInPicture();
  }, [pipOpen, connected, pipSupported, theme, session?.title]);

  const openTasksFromPictureInPicture = useCallback(() => {
    closePictureInPicture().catch(() => { });

    // Open the normal Tasks tab just long enough to ensure the component is mounted,
    // then ask TasksPanel to open itself in its pinned/PiP overlay format.
    setRightTab("tasks");
    setRightPanelOpen(true);

    window.setTimeout(() => {
      try {
        window.dispatchEvent(
          new CustomEvent("mysession:tasks-open-pinned"),
        );
      } catch {
        // ignore
      }
    }, 120);
  }, [closePictureInPicture]);

  useEffect(() => {
    const pipWindow = pipWindowRef.current;
    if (!pipWindow || !pipMountEl) return;

    try {
      pipWindow.document.documentElement.setAttribute("data-theme", theme);
      pipWindow.document.body.className =
        theme === "dark"
          ? "m-0 bg-[#1B1B1B] text-white overflow-hidden"
          : "m-0 bg-[#F3F3F3] text-[#2B2B2B] overflow-hidden";
    } catch { }
  }, [theme, pipMountEl]);

  useEffect(() => {
    if (connected) return;
    if (!pipOpen) return;

    closePictureInPicture().catch(() => { });
  }, [connected, pipOpen]);

  const restoreMobileMediaFromBackground = async () => {
    if (mobileMediaRestoreBusy) return;

    try {
      setMobileMediaRestoreBusy(true);
      setMobileRestoreMode("needs_action");
      setClientError("");
      setTokenError("");
      setMediaWarning("");

      await loadBrowserDevices({ preserveSelection: true }).catch(() => { });
      await attendanceHeartbeat().catch(() => { });

      if (roomIsActuallyConnected()) {
        await ensureRoomAudioPlaybackUnlocked("mobile-restore").catch(() => { });
        scheduleRebuildTiles();
        window.setTimeout(() => scheduleRebuildTiles(), 120);
        window.setTimeout(() => scheduleRebuildTiles(), 360);
        closeMobileRestoreState();
        returningFromBackgroundRef.current = false;
        pageHiddenAtRef.current = null;
        return;
      }

      setPrejoinOpen(false);
      setJoinRequested(true);

      if (lkToken && lkServerUrl) {
        await connectRoom({
          forceReconnect: true,
          preserveAttendance: true,
          preserveTabPresence: true,
          preserveJoinRequested: true,
        }).catch((e) => {
          console.warn("mobile restore reconnect failed:", e);
          setClientError(
            String((e as any)?.message || e || "restore_reconnect_failed"),
          );
        });
      } else {
        await requestToken().catch((e) => {
          console.warn("mobile restore token refresh failed:", e);
          setTokenError(
            String((e as any)?.message || e || "restore_token_failed"),
          );
        });
      }

      await ensureRoomAudioPlaybackUnlocked(
        "mobile-restore-after-reconnect",
      ).catch(() => { });
      scheduleRebuildTiles();
      window.setTimeout(() => scheduleRebuildTiles(), 160);

      if (roomIsActuallyConnected()) {
        closeMobileRestoreState();
        returningFromBackgroundRef.current = false;
        pageHiddenAtRef.current = null;
      } else {
        setMobileRestoreMode("needs_action");
        setMobileMediaRestoreOpen(true);
        setMediaWarning(
          "Still reconnecting. Tap Rejoin room, or reload only if it does not recover.",
        );
      }
    } finally {
      setMobileMediaRestoreBusy(false);
    }
  };

  const scheduleScreenShareRebuildBurst = () => {
    scheduleRebuildTiles();
    window.setTimeout(() => scheduleRebuildTiles(), 80);
    window.setTimeout(() => scheduleRebuildTiles(), 220);
    window.setTimeout(() => scheduleRebuildTiles(), 520);
    window.setTimeout(() => scheduleRebuildTiles(), 1100);
    window.setTimeout(() => scheduleRebuildTiles(), 1800);
  };

  const stopLocalScreenShare = async (reason = "stop") => {
    const r = roomRef.current;
    const lp: any = r?.localParticipant;
    const manual = manualScreenShareRef.current;
    manualScreenShareRef.current = null;

    try {
      if (manual?.mediaTrack && lp?.unpublishTrack) {
        await lp.unpublishTrack(manual.mediaTrack, true);
      }
    } catch {
      // ignore manual unpublish failure; LiveKit cleanup below is the fallback
    }

    try {
      manual?.stream
        ?.getTracks?.()
        .forEach((track: MediaStreamTrack) => track.stop());
    } catch {
      // ignore cleanup failure
    }

    try {
      if (lp?.setScreenShareEnabled) {
        await lp.setScreenShareEnabled(false);
      }
    } catch {
      // ignore fallback cleanup failure
    }

    setScreenShareOn(false);
    scheduleScreenShareRebuildBurst();
    void logRoomDiagnostic("screen_share_local_stop_cleanup", {
      reason,
      snapshot: getScreenShareDiagnosticSnapshot(roomRef.current),
    });
  };

  const publishManualTabletScreenShare = async (r: Room) => {
    const lp: any = r.localParticipant;
    const captured = await captureDisplayMediaForTablet();
    const firstFrameReady = await waitForMediaTrackRenderableFrame(
      captured.mediaTrack,
      2600,
    );

    if (!firstFrameReady) {
      try {
        captured.stream
          ?.getTracks?.()
          .forEach((track: MediaStreamTrack) => track.stop());
      } catch {
        // ignore cleanup failure
      }
      throw new Error("display_media_video_track_not_renderable");
    }

    const publication = (await lp.publishTrack(captured.mediaTrack, {
      source: Track.Source.ScreenShare,
      name: "screen_share",
      simulcast: false,
    } as any)) as LocalTrackPublication;

    manualScreenShareRef.current = {
      mediaTrack: captured.mediaTrack,
      stream: captured.stream,
      publication,
    };

    try {
      captured.mediaTrack.addEventListener(
        "ended",
        () => {
          void stopLocalScreenShare("display_media_track_ended");
        },
        { once: true },
      );
    } catch {
      // ignore listener failure
    }

    return publication;
  };

  const toggleScreenShare = async () => {
    const r = roomRef.current;
    if (!r?.localParticipant) {
      setMediaWarning(
        "Screen sharing is not ready yet. Please wait a moment and try again.",
      );
      return;
    }

    const lp: any = r.localParticipant;

    try {
      const next = !hasLocalLiveScreenShare(r);

      if (!next) {
        void logRoomDiagnostic(
          "screen_share_stop_attempt",
          getScreenShareDiagnosticSnapshot(r) as any,
        );
        await stopLocalScreenShare("user_toggle_off");
        void logRoomDiagnostic(
          "screen_share_stopped",
          getScreenShareDiagnosticSnapshot(r) as any,
        );
        return;
      }

      const preferManualTabletPath = shouldPreferManualTabletScreenShare({
        isMobileQuery,
        isTabletQuery,
      });

      void logRoomDiagnostic("screen_share_start_attempt", {
        supported: supportsScreenShareCapture(),
        preferManualTabletPath,
        before: getScreenShareDiagnosticSnapshot(r),
      });

      if (!supportsScreenShareCapture()) {
        setScreenShareOn(false);
        setMediaWarning(
          "Screen sharing is not supported by this tablet browser. Try Chrome on the tablet, desktop Chrome/Edge, or update the browser and allow screen recording/sharing permissions.",
        );
        scheduleScreenShareRebuildBurst();
        void logRoomDiagnostic("screen_share_unsupported", {
          supported: false,
          snapshot: getScreenShareDiagnosticSnapshot(r),
        });
        return;
      }

      setMediaWarning("");

      if (preferManualTabletPath) {
        try {
          await publishManualTabletScreenShare(r);
          scheduleScreenShareRebuildBurst();
        } catch (manualError: any) {
          console.warn(
            "manual tablet screen share failed, falling back to LiveKit toggle:",
            manualError,
          );
          void logRoomDiagnostic("screen_share_manual_tablet_failed", {
            name: String(manualError?.name || ""),
            message: String(manualError?.message || manualError || ""),
            snapshot: getScreenShareDiagnosticSnapshot(r),
          });

          const manualMessage = String(
            manualError?.message || manualError || "",
          ).toLowerCase();
          const manualName = String(manualError?.name || "").toLowerCase();
          const userCancelled =
            manualName.includes("notallowed") ||
            manualName.includes("abort") ||
            manualMessage.includes("permission") ||
            manualMessage.includes("cancel");

          if (userCancelled) {
            throw manualError;
          }

          await lp.setScreenShareEnabled(true, {
            audio: false,
            video: true,
          } as any);
        }
      } else {
        await lp.setScreenShareEnabled(true, {
          audio: false,
          video: true,
        } as any);
      }

      scheduleScreenShareRebuildBurst();

      const liveTrackReady = await waitForLocalScreenShareTrack(r, 2600);
      const renderableTrackReady = await waitForLocalRenderableScreenShareTrack(
        r,
        preferManualTabletPath ? 4200 : 3200,
      );
      const afterStartSnapshot = getScreenShareDiagnosticSnapshot(r);

      if (!liveTrackReady || !renderableTrackReady) {
        await stopLocalScreenShare(
          "screen_share_track_missing_or_not_renderable",
        );

        setScreenShareOn(false);
        setMediaWarning(
          "Screen sharing started, but the tablet browser did not send a visible screen video. Please try Chrome on the tablet, close other tabs/apps, or use desktop Chrome/Edge for screen sharing.",
        );
        scheduleScreenShareRebuildBurst();
        void logRoomDiagnostic("screen_share_track_missing", {
          liveTrackReady,
          renderableTrackReady,
          preferManualTabletPath,
          afterStart: afterStartSnapshot,
          afterCleanup: getScreenShareDiagnosticSnapshot(r),
        });
        return;
      }

      setScreenShareOn(true);
      scheduleScreenShareRebuildBurst();
      void logRoomDiagnostic("screen_share_started", {
        preferManualTabletPath,
        afterStart: afterStartSnapshot,
      });
    } catch (e: any) {
      console.error("toggleScreenShare error:", e);

      await stopLocalScreenShare("screen_share_failed_cleanup");

      setScreenShareOn(false);
      setMediaWarning(getScreenShareErrorMessage(e));
      scheduleScreenShareRebuildBurst();
      void logRoomDiagnostic("screen_share_failed", {
        name: String(e?.name || ""),
        message: String(e?.message || e || ""),
        snapshot: getScreenShareDiagnosticSnapshot(roomRef.current),
      });
    }
  };

  const leave = async () => {
    explicitLeaveRequestedRef.current = true;

    const startedAt = sessionJoinStartedAtRef.current;
    const minutesSpent =
      startedAt && Number.isFinite(startedAt)
        ? Math.max(1, Math.round((Date.now() - startedAt) / 60000))
        : 0;

    const params = new URLSearchParams();

    params.set("postSession", "1");

    if (session?.id) params.set("sessionId", String(session.id));
    if (session?.title) params.set("sessionTitle", String(session.title));
    if (session?.host_id) params.set("hostId", String(session.host_id));
    if (session?.host_profile?.full_name) {
      params.set("hostName", String(session.host_profile.full_name));
    }
    if (minutesSpent > 0) params.set("minutes", String(minutesSpent));

    await disconnectRoom();

    navigate(`/sessions?${params.toString()}`, { replace: true });
  };

  const controller = new AbortController();

  // admin endpoint
  const callAdmin = async (body: Record<string, unknown>) => {
    const token = await getFreshAccessToken();

    const res = await fetch(adminEndpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...body,
        sessionId: session?.id,
        isHost,
        isModerator: !isHost && isSelfModerator,
      }),
    });

    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    window.clearTimeout(timeoutId);

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Admin endpoint error: ${res.status} ${t || ""}`.trim());
    }

    return res.json().catch(() => ({}));
  };

  const optimisticMute = (tileId: string) => {
    setTiles((prev) =>
      prev.map((t) => {
        if (t.id !== tileId) return t;
        return { ...t, micMuted: true };
      }),
    );
  };

  const optimisticCameraOff = (tileId: string) => {
    setTiles((prev) =>
      prev.map((t) => {
        if (t.id !== tileId) return t;
        return {
          ...t,
          camPubMuted: true,
          camPubHasTrack: false,
        };
      }),
    );
  };

  const adminMuteRemoteTrack = async (
    tileId: string,
    participantIdentity: string,
    trackSid: string,
  ) => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:${trackSid}:mute`;
    setAdminBusyKey(busyKey);
    closeTileMenu();

    optimisticMute(tileId);
    setAdminBusyKey("");

    void callAdmin({
      action: "mute_microphone",
      trackKind: "microphone",
      roomName,
      participantIdentity,
      trackSid,
    })
      .then(() => {
        window.setTimeout(() => scheduleRebuildTiles(), 350);
        window.setTimeout(() => scheduleRebuildTiles(), 900);
      })
      .catch((e: any) => {
        console.error("mute mic failed:", e);
        showSystemNotice({
          kind: "error",
          title: "Mic mute failed",
          body: String(e?.message || e || "mute_failed"),
        });
        window.setTimeout(() => scheduleRebuildTiles(), 350);
      });
    return;
  };

  const adminTurnOffRemoteCamera = async (
    tileId: string,
    participantIdentity: string,
    trackSid: string,
  ) => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:${trackSid}:camera-off`;
    setAdminBusyKey(busyKey);
    closeTileMenu();

    optimisticCameraOff(tileId);
    setAdminBusyKey("");

    void callAdmin({
      action: "turn_off_camera",
      trackKind: "camera",
      roomName,
      participantIdentity,
      trackSid,
    })
      .then(() => {
        window.setTimeout(() => scheduleRebuildTiles(), 350);
        window.setTimeout(() => scheduleRebuildTiles(), 900);
      })
      .catch((e: any) => {
        console.error("turn camera off failed:", e);
        showSystemNotice({
          kind: "error",
          title: "Camera action failed",
          body: String(e?.message || e || "camera_off_failed"),
        });
        window.setTimeout(() => scheduleRebuildTiles(), 350);
      });

    return;
  };

  const adminKickParticipant = async (
    participantIdentity: string,
    targetUserId?: string,
    targetLabel?: string,
  ) => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:kick`;
    setAdminBusyKey(busyKey);

    try {
      const kickedByName =
        (displayName || userName || "Moderator").trim() || "Moderator";

      const channel = kickEventChannelRef.current;
      if (channel) {
        const payload: KickBroadcastPayload = {
          type: "participant_kicked",
          targetIdentity: participantIdentity,
          targetUserId: targetUserId || null,
          kickedByUserId: authUserId || null,
          kickedByName,
          roomName,
          sessionId: session?.id || null,
          at: Date.now(),
        };

        channel
          .send({
            type: "broadcast",
            event: "participant_kicked",
            payload,
          })
          .catch((e: unknown) => {
            console.warn("kick broadcast failed:", e);
          });
      }

      try {
        await callAdmin({
          action: "remove_participant",
          roomName,
          participantIdentity,
        });
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        if (!/participant not found/i.test(msg)) {
          throw e;
        }
      }

      showSystemNotice({
        kind: "info",
        title: "Participant removed",
        body: targetLabel
          ? `${targetLabel} was removed from the room.`
          : "Participant was removed from the room.",
      });

      scheduleRebuildTiles();
      window.setTimeout(() => scheduleRebuildTiles(), 80);
      window.setTimeout(() => scheduleRebuildTiles(), 220);
    } catch (e: any) {
      console.error("kick failed:", e);
      showSystemNotice({
        kind: "error",
        title: "Kick failed",
        body: String(e?.message || e || "kick_failed"),
      });
    } finally {
      setAdminBusyKey("");
    }
  };

  // FX apply in-room
  const applyVideoFx = async (mode: FxMode) => {
    const r = roomRef.current;
    if (!r) return;

    setFxError("");
    setFxApplying(true);
    setFxStatusText("");

    try {
      const tr = getLocalCameraTrack();
      if (!tr) throw new Error("Camera track is not ready");
      await safeApplyProcessor(tr, mode, blurStrength, bgImageUrl);

      setVideoFxMode(mode);
      setFxStatusText(
        mode === "off"
          ? "FX disabled"
          : mode === "blur"
            ? `Blur applied (strength ${blurStrength})`
            : "Virtual background applied",
      );
      await delay(40);
    } catch (e: any) {
      console.error("applyVideoFx failed:", e);
      setFxError(String(e?.message || e || "video_fx_failed"));
    } finally {
      setFxApplying(false);
    }
  };

  useEffect(() => {
    if (!connected) return;
    if (videoFxMode !== "blur") return;
    if (fxApplying) return;

    const t = window.setTimeout(() => {
      applyVideoFx("blur").catch(() => { });
    }, 240);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blurStrength]);

  useEffect(() => {
    if (!connected) return;
    if (videoFxMode !== "bg") return;
    if (fxApplying) return;

    const t = window.setTimeout(() => {
      applyVideoFx("bg").catch(() => { });
    }, 240);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgImageUrl]);

  // chat unread
  const hostUserIdForChat = useMemo(() => {
    return String(session?.host_id || "")
      .trim()
      .toLowerCase();
  }, [session?.host_id]);

  const directUnreadTotal = useMemo(() => {
    return Object.values(unreadDirectChatByPeerId).reduce(
      (sum, n) => sum + clampUnreadCount(Number(n || 0)),
      0,
    );
  }, [unreadDirectChatByPeerId]);

  useEffect(() => {
    setUnreadChat(clampUnreadCount(unreadGeneralChat + directUnreadTotal));
  }, [unreadGeneralChat, directUnreadTotal]);

  useEffect(() => {
    selectedHostChatPeerIdRef.current = selectedHostChatPeerId;
  }, [selectedHostChatPeerId]);

  useEffect(() => {
    generalChatVisibleRef.current =
      rightPanelOpen && rightTab === "chat" && chatViewMode === "general";
    directChatVisibleRef.current =
      rightPanelOpen && rightTab === "chat" && chatViewMode === "host";
  }, [rightPanelOpen, rightTab, chatViewMode]);

  const chatGeneralReadKey = useMemo(() => {
    return session?.id
      ? `mysession_chat_general_last_read_at:${session.id}`
      : "";
  }, [session?.id]);

  const chatDirectReadKey = useMemo(() => {
    return session?.id
      ? `mysession_chat_direct_last_read_at:${session.id}:${authUserId || "guest"}`
      : "";
  }, [session?.id, authUserId]);

  const persistDirectReadMap = (next: Record<string, number>) => {
    lastDirectChatReadAtByPeerRef.current = next;
    try {
      if (chatDirectReadKey)
        localStorage.setItem(chatDirectReadKey, JSON.stringify(next));
    } catch { }
  };

  const markGeneralChatRead = (atMs?: number) => {
    if (!session?.id) return;

    const now = Number.isFinite(atMs as any) ? Number(atMs) : Date.now();
    lastGeneralChatReadAtRef.current = Math.max(
      lastGeneralChatReadAtRef.current || 0,
      now,
    );
    setUnreadGeneralChat(0);

    try {
      if (chatGeneralReadKey)
        localStorage.setItem(
          chatGeneralReadKey,
          String(lastGeneralChatReadAtRef.current),
        );
    } catch { }
  };

  const markDirectChatRead = (peerIdRaw?: string | null, atMs?: number) => {
    if (!session?.id) return;

    const peerId = String(peerIdRaw || selectedHostChatPeerIdRef.current || "")
      .trim()
      .toLowerCase();
    if (!peerId) return;

    const now = Number.isFinite(atMs as any) ? Number(atMs) : Date.now();
    const next = {
      ...(lastDirectChatReadAtByPeerRef.current || {}),
      [peerId]: Math.max(
        lastDirectChatReadAtByPeerRef.current?.[peerId] || 0,
        now,
      ),
    };

    persistDirectReadMap(next);

    setUnreadDirectChatByPeerId((prev) => {
      if (!prev[peerId]) return prev;
      const copy = { ...prev };
      delete copy[peerId];
      return copy;
    });
  };

  const addDirectUnread = (peerIdRaw: string, count = 1) => {
    const peerId = String(peerIdRaw || "")
      .trim()
      .toLowerCase();
    if (!peerId) return;

    setUnreadDirectChatByPeerId((prev) => ({
      ...prev,
      [peerId]: clampUnreadCount((prev[peerId] || 0) + count),
    }));
  };

  const handleIncomingChatUnreadRow = (row: ChatUnreadMessageRow) => {
    if (!row || !authUserId) return;

    const senderId = getChatRowSenderId(row);
    if (!senderId) return;
    if (
      senderId ===
      String(authUserId || "")
        .trim()
        .toLowerCase()
    )
      return;

    const msgMs = getChatRowCreatedMs(row);
    const isDirect = isChatRowDirectMessage(row, authUserId, hostUserIdForChat);

    if (!isDirect) {
      if (generalChatVisibleRef.current) {
        markGeneralChatRead(msgMs);
        return;
      }

      if (msgMs > (lastGeneralChatReadAtRef.current || 0)) {
        setUnreadGeneralChat((prev) => clampUnreadCount(prev + 1));
      }
      return;
    }

    const peerId = getChatRowDirectPeerId(row, authUserId, hostUserIdForChat);
    if (!peerId) return;

    const selectedPeer = String(selectedHostChatPeerIdRef.current || "")
      .trim()
      .toLowerCase();

    if (
      directChatVisibleRef.current &&
      selectedPeer &&
      selectedPeer === peerId
    ) {
      markDirectChatRead(peerId, msgMs);
      return;
    }

    const lastRead = Number(
      lastDirectChatReadAtByPeerRef.current?.[peerId] || 0,
    );
    if (msgMs > lastRead) {
      addDirectUnread(peerId, 1);
    }
  };

  useEffect(() => {
    if (rightPanelOpen && rightTab === "chat" && chatViewMode === "general") {
      markGeneralChatRead();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightPanelOpen, rightTab, chatViewMode, session?.id]);

  useEffect(() => {
    if (
      rightPanelOpen &&
      rightTab === "chat" &&
      chatViewMode === "host" &&
      selectedHostChatPeerId
    ) {
      markDirectChatRead(selectedHostChatPeerId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rightPanelOpen,
    rightTab,
    chatViewMode,
    selectedHostChatPeerId,
    session?.id,
  ]);

  useEffect(() => {
    if (!session?.id) return;
    if (!authUserId) return;

    let cancelled = false;

    (async () => {
      let generalLastRead = 0;
      let directLastReadMap: Record<string, number> = {};

      try {
        const raw = localStorage.getItem(chatGeneralReadKey);
        generalLastRead = raw ? Number(raw) : 0;
        if (!Number.isFinite(generalLastRead)) generalLastRead = 0;
      } catch {
        generalLastRead = 0;
      }

      try {
        const raw = localStorage.getItem(chatDirectReadKey);
        const parsed = raw ? JSON.parse(raw) : {};
        directLastReadMap =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, number>)
            : {};
      } catch {
        directLastReadMap = {};
      }

      lastGeneralChatReadAtRef.current = generalLastRead;
      lastDirectChatReadAtByPeerRef.current = directLastReadMap;

      try {
        const sinceMs = Math.max(
          0,
          generalLastRead || 0,
          ...Object.values(directLastReadMap)
            .map((n) => Number(n || 0))
            .filter((n) => Number.isFinite(n)),
        );

        const sinceIso =
          sinceMs > 0
            ? new Date(sinceMs).toISOString()
            : "1970-01-01T00:00:00.000Z";

        const { data, error } = await supabase
          .from(CHAT_MSG_TABLE)
          .select("*")
          .eq("session_id", session.id)
          .neq("user_id", authUserId)
          .gt("created_at", sinceIso)
          .order("created_at", { ascending: true })
          .limit(250);

        if (error) throw error;
        if (cancelled) return;

        let nextGeneral = 0;
        const nextDirect: Record<string, number> = {};

        for (const row of (data || []) as ChatUnreadMessageRow[]) {
          const msgMs = getChatRowCreatedMs(row);
          const isDirect = isChatRowDirectMessage(
            row,
            authUserId,
            hostUserIdForChat,
          );

          if (!isDirect) {
            if (msgMs > generalLastRead) nextGeneral += 1;
            continue;
          }

          const peerId = getChatRowDirectPeerId(
            row,
            authUserId,
            hostUserIdForChat,
          );
          if (!peerId) continue;

          const lastPeerRead = Number(directLastReadMap[peerId] || 0);
          if (msgMs > lastPeerRead) {
            nextDirect[peerId] = clampUnreadCount(
              (nextDirect[peerId] || 0) + 1,
            );
          }
        }

        setUnreadGeneralChat(clampUnreadCount(nextGeneral));
        setUnreadDirectChatByPeerId(nextDirect);
      } catch (e) {
        console.warn("[chat-unread] initial load failed:", e);
        if (!cancelled) {
          setUnreadGeneralChat(0);
          setUnreadDirectChatByPeerId({});
        }
      }
    })();

    const ch = supabase
      .channel(`chat-unread:${session.id}:${authUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: CHAT_MSG_TABLE,
          filter: `session_id=eq.${session.id}`,
        },
        (payload: any) => {
          const row = payload?.new as ChatUnreadMessageRow;
          handleIncomingChatUnreadRow(row);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      safeRemoveRealtimeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session?.id,
    authUserId,
    chatGeneralReadKey,
    chatDirectReadKey,
    hostUserIdForChat,
  ]);

  // reactions broadcast
  const pushFloatingReaction = (
    type: ReactionType,
    fromUserId: string,
    fromName: string,
  ) => {
    if (!type || !REACTION_EMOJI[type]) return;

    const id2 = reactionIdRef.current + 1;
    reactionIdRef.current = id2;

    setFloatingReactions((prev) => {
      const next = [...prev, { id: id2, type, fromUserId, fromName }];
      return next.length > 12 ? next.slice(-12) : next;
    });

    window.setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== id2));
    }, REACTION_TTL_MS);
  };

  useEffect(() => {
    if (!session?.id) return;
    if (!authUserId) return;

    const ch = supabase
      .channel(`reactions:${session.id}`, {
        config: { broadcast: { self: false }, presence: { key: authUserId } },
      })
      .on("broadcast", { event: "reaction" }, (payload: any) => {
        const p = payload?.payload || payload;
        const t = String(p?.type || "") as ReactionType;
        const fromUserId = String(p?.fromUserId || "");
        const fromName = String(p?.fromName || "User");

        if (!t || !REACTION_EMOJI[t]) return;
        pushFloatingReaction(t, fromUserId, fromName);
      })
      .subscribe();

    reactionsChannelRef.current = ch;

    return () => {
      reactionsChannelRef.current = null;
      safeRemoveRealtimeChannel(ch);
    };
  }, [session?.id, authUserId]);

  const sendReaction = (type: ReactionType) => {
    try {
      if (!session?.id || !authUserId) return;

      pushFloatingReaction(type, authUserId, displayName || userName || "You");

      const ch = reactionsChannelRef.current;
      if (!ch) return;

      void ch.send({
        type: "broadcast",
        event: "reaction",
        payload: {
          type,
          fromUserId: authUserId,
          fromName: displayName || userName || "User",
          at: Date.now(),
        },
      });
    } catch { }
  };

  // edit name
  const openEditName = () => {
    const current = String(
      localRoomDisplayNameOverrideRef.current ||
      displayName ||
      prejoinRef.current.displayName ||
      userName ||
      "",
    ).trim();

    setEditNameValue(current);
    setEditNameOpen(true);
  };

  const saveEditName = async () => {
    const nm = String(editNameValue || "").trim();
    if (!nm) return;

    try {
      // 1) сразу обновляем локальный UI
      applyRoomDisplayNameLocally(nm);

      // 2) сразу перестраиваем тайлы локально
      scheduleRebuildTiles();

      const r = roomRef.current;
      const lp: any = r?.localParticipant as any;

      if (lp) {
        const prevMeta = parseParticipantMetadata(lp.metadata) || {};

        const nextMeta = {
          ...prevMeta,
          displayName: nm,
        };

        if (typeof lp.setMetadata === "function") {
          await lp.setMetadata(JSON.stringify(nextMeta));
        }

        if (typeof lp.setName === "function") {
          try {
            await lp.setName(nm);
          } catch (e) {
            console.warn("localParticipant.setName failed", e);
          }
        }
      }

      // 3) ещё несколько перестроений после sync
      scheduleRebuildTiles();
      window.setTimeout(() => scheduleRebuildTiles(), 60);
      window.setTimeout(() => scheduleRebuildTiles(), 180);

      setEditNameOpen(false);
    } catch (e) {
      console.error("saveEditName failed:", e);
    }
  };

  // report participant
  const openReportParticipantModal = (t: TileModel) => {
    setReportTarget(t);
    setReportReason("");
    setReportError("");
    setReportModalOpen(true);
  };

  const submitParticipantReport = async () => {
    if (!reportTarget) return;

    const reason = String(reportReason || "").trim();
    if (!reason) {
      setReportError("Please describe the problem.");
      return;
    }

    setReportBusy(true);
    setReportError("");

    try {
      const reportedParticipantId =
        String(
          reportTarget.participantUserId ||
          reportTarget.participantIdentity ||
          reportTarget.id ||
          "",
        ).trim() || null;

      const payload = {
        session_id: session?.id || null,
        reporter_user_id: authUserId || null,
        reported_participant_id: reportedParticipantId,
        reason,
        created_at: new Date().toISOString(),
        status: "open",
        resolved_at: null,
        resolved_by: null,
      };

      const { error } = await supabase
        .from(REPORTS_TABLE)
        .insert(payload as any);
      if (error) throw error;

      setReportModalOpen(false);
      setReportTarget(null);
      setReportReason("");

      showSystemNotice({
        kind: "info",
        title: "Report submitted",
        body: `Your report about ${reportTarget.label || "this participant"} has been saved.`,
      });
    } catch (e: any) {
      console.error("report failed:", e);
      setReportError(String(e?.message || e || "report_failed"));
    } finally {
      setReportBusy(false);
    }
  };

  // tiles with hide/pin
  const tilesBaseForUi = useMemo(() => {
    if (!devClones) return tiles;

    const local = tiles.find((t) => t.isLocal) || tiles[0];
    if (!local) return tiles;

    const clones: TileModel[] = [];
    for (let i = 0; i < devClones; i++) {
      clones.push({
        ...local,
        id: `dev-clone-${i + 1}`,
        isLocal: false,
        label: `${local.label || "You"} (clone #${i + 1})`,
        participantIdentity: `${String(local.participantIdentity || "local")}--clone${i + 1}`,
        participantUserId: local.participantUserId,
      });
    }

    return [local, ...clones, ...tiles.filter((t) => t !== local)];
  }, [tiles, devClones]);

  const hiddenTiles = useMemo(() => {
    return tilesBaseForUi.filter((t) => !!hiddenTileIds[t.id]);
  }, [tilesBaseForUi, hiddenTileIds]);

  const tilesForRender = useMemo(() => {
    const list = tilesBaseForUi.filter((t) => !hiddenTileIds[t.id]);

    const pinned = pinnedTileId
      ? list.find((t) => t.id === pinnedTileId) || null
      : null;

    if (!pinned) return list;

    const rest = list.filter((t) => t.id !== pinned.id);
    return [pinned, ...rest];
  }, [tilesBaseForUi, hiddenTileIds, pinnedTileId]);

  // sizing
  const videoWrapRef = useRef<HTMLDivElement | null>(null);
  const {
    ref: videoSizerRef,
    width: videoWrapW,
    height: videoWrapH,
  } = useElementSize<HTMLDivElement>();
  const fallbackW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const fallbackH = typeof window !== "undefined" ? window.innerHeight : 800;
  const effectiveW = videoWrapW || fallbackW;
  const effectiveH = videoWrapH || fallbackH;

  useEffect(() => {
    const el = videoWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    let raf = 0;
    let timer: number | null = null;

    const ro = new ResizeObserver(() => {
      if (timer) window.clearTimeout(timer);

      timer = window.setTimeout(() => {
        window.cancelAnimationFrame(raf);
        raf = window.requestAnimationFrame(() => {
          try {
            window.dispatchEvent(new Event("resize"));
          } catch { }
        });
      }, 120);
    });

    ro.observe(el);

    return () => {
      if (timer) window.clearTimeout(timer);
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const roomReadyText = connected
    ? ""
    : prejoinOpen
      ? ""
      : joinRequested
        ? "Joining room…"
        : "";
  const lastErr = tokenError || clientError;

  // hide/pin helpers
  const toggleHide = (tileId: string) => {
    setHiddenTileIds((prev) => {
      const next = { ...prev };
      if (next[tileId]) delete next[tileId];
      else next[tileId] = true;
      return next;
    });
    setOpenTileAdminMenuId(null);
  };

  const togglePin = (tileId: string) => {
    setPinnedTileId((prev) => (prev === tileId ? null : tileId));
    setOpenTileAdminMenuId(null);
  };

  const getBadgeForTile = (t: TileModel): string | null => {
    if (t.isLocal) {
      if (isHost) return "Host";
      if (isSelfModerator) return "Moderator";
      return null;
    }

    const pid = (
      t.participantUserId ||
      extractBaseUserIdFromIdentity(String(t.participantIdentity || ""))
    ).toLowerCase();

    if (pid && looksLikeUuid(pid) && moderatorUserIds.includes(pid))
      return "Moderator";
    return null;
  };

  const getAvatarForTile = (t: TileModel): string => {
    if (t.isLocal) return localAvatarUrl || "";
    const pid = String(t.participantUserId || "").toLowerCase();
    const p = looksLikeUuid(pid) ? profilesById[pid] : undefined;
    return String(p?.avatar_url || "") || "";
  };

  const isTileCamOff = (t: TileModel) => {
    if (t.kind === "screen") {
      return !t.videoTrack;
    }

    const exists = !!t.camPubExists;
    const hasTrack = !!t.camPubHasTrack;
    const muted = t.camPubMuted !== false;
    return !exists || !hasTrack || muted;
  };

  const renderAvatarFallback = (t: TileModel) => {
    const avatar = getAvatarForTile(t);
    const name = t.label || "User";
    const initials = getInitials(name);

    return (
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none">
        <div
          className={[
            "w-[78px] h-[78px] rounded-full overflow-hidden flex items-center justify-center shadow-2xl border",
            isLight ? "border-[#CFCFCF]" : "border-[#2B2B2B]",
          ].join(" ")}
        >
          {avatar ? (
            <img
              src={avatar}
              alt={name}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => {
                try {
                  (e.currentTarget as any).style.display = "none";
                } catch { }
              }}
            />
          ) : (
            <div
              className={`text-xl font-bold ${isLight ? "text-black/70" : "text-white/85"}`}
            >
              {initials}
            </div>
          )}
        </div>

        <div
          className={`mt-3 px-3 py-1.5 rounded-xl border backdrop-blur ${isLight ? "border-[#CFCFCF] text-black/85" : "border-[#2B2B2B] text-white/90"}`}
        >
          <div className="text-[13px] font-semibold max-w-[260px] truncate text-center">
            {name}
          </div>
        </div>
      </div>
    );
  };

  const renderTile = (t: TileModel) => {
    const isMenuOpen = openTileAdminMenuId === t.id;

    const canAdminTarget =
      isSelfModerator && !t.isLocal && !!t.participantIdentity;
    const pidBase = String(
      t.participantUserId ||
      extractBaseUserIdFromIdentity(String(t.participantIdentity || "")),
    ).toLowerCase();
    const canRoleManageTarget =
      isHost && !!pidBase && looksLikeUuid(pidBase) && !t.isLocal;
    const isTargetModerator = !!pidBase && moderatorUserIds.includes(pidBase);
    const roleBusy =
      roleBusyKey === `mod:${pidBase}:grant` ||
      roleBusyKey === `mod:${pidBase}:revoke`;

    const hasMicTrack = !!t.micTrackSid && !!t.participantIdentity;
    const hasCamTrack = !!t.camTrackSid && !!t.participantIdentity;

    const muteMicDisabled = !canAdminTarget || !hasMicTrack || !!t.micMuted;
    const turnCameraOffDisabled =
      !canAdminTarget || !hasCamTrack || isTileCamOff(t);
    const kickDisabled = !canAdminTarget || !t.participantIdentity;

    const isHidden = !!hiddenTileIds[t.id];
    const isPinned = pinnedTileId === t.id;

    const isFeaturedTile = featuredTile?.id === t.id;
    const shouldForceMenuVisible =
      isMenuOpen || isPinned || isFeaturedTile || tileCount <= 1;
    const showLocalEditButton = t.isLocal && t.kind !== "screen";

    const busyMuteMic =
      !!t.participantIdentity &&
      !!t.micTrackSid &&
      adminBusyKey === `${t.participantIdentity}:${t.micTrackSid}:mute`;

    const busyCameraOff =
      !!t.participantIdentity &&
      !!t.camTrackSid &&
      adminBusyKey === `${t.participantIdentity}:${t.camTrackSid}:camera-off`;

    const busyKick =
      !!t.participantIdentity &&
      adminBusyKey === `${t.participantIdentity}:kick`;

    const camOff = isTileCamOff(t);
    const nameText = t.label || "User";
    const micMuted = !!t.micMuted;
    const tileAvatarUrl = getAvatarForTile(t);
    const participantProfileKey = String(
      t.participantUserId || "",
    ).toLowerCase();

    const participantProfile: HostProfile | null =
      !t.isLocal && participantProfileKey
        ? profilesById[participantProfileKey] || null
        : null;

    const volumeKey = getParticipantVolumeKey(t);
    const volPct = !t.isLocal
      ? Number(volumePctByParticipantKey[volumeKey] ?? 100)
      : 100;

    const namePlateBaseCls = [
      "group/name inline-flex items-center rounded-2xl border backdrop-blur shadow-sm",
      "px-3 py-2",
      isLight
        ? "bg-[#FAFAFA] border-[#CFCFCF] text-black/85"
        : "bg-[#242424] border-[#2B2B2B] text-white/90",
    ].join(" ");

    const micBadgeWrapCls = isLight
      ? micMuted
        ? "bg-black/8"
        : "bg-[#81DB86]/12"
      : micMuted
        ? "bg-[#242424]"
        : "bg-emerald-400/18";

    const nameTextCls =
      "truncate max-w-[220px] font-inter text-[14px] font-semibold";

    return (
      <div
        className="relative group w-full min-w-0 min-h-0"
        style={{ aspectRatio: "16 / 9" }}
      >
        <div
          className="absolute inset-0"
          style={
            t.isLocal
              ? {
                filter: localVideoFilterCss || undefined,
              }
              : undefined
          }
        >
          <VideoTile
            tileId={t.id}
            label={nameText}
            status={t.status || null}
            videoTrack={t.videoTrack}
            audioTrack={t.audioTrack}
            isLocal={t.isLocal}
            theme={theme}
            showBadge={getBadgeForTile(t)}
            hostActions={undefined}
            avatarUrl={tileAvatarUrl}
            micMuted={micMuted}
            mirrorVideo={t.isLocal ? previewMirrored : false}
            audioLevel={t.audioLevel || 0}
            currentIntention={getCurrentIntentionForTile(t)}
            onToggleMenu={(tileId, anchorEl) => {
              if (!anchorEl) return;

              if (openTileAdminMenuId === tileId) {
                closeTileMenu();
                return;
              }

              openTileMenuAt(tileId, anchorEl);
            }}
            showMenuButton={
              !!(t.isLocal || t.kind === "screen" || !!t.participantIdentity)
            }
            onOpenProfile={() => {
              if (!t.participantUserId) return;

              const p =
                profilesById[String(t.participantUserId).toLowerCase()] ||
                profilesById[
                String(t.participantIdentity || "").toLowerCase()
                ] ||
                null;

              if (p) setSelectedUser(p);
            }}
          />
        </div>

        {showLocalEditButton && (
          <div className="absolute top-2 left-2 z-30">
            <button
              type="button"
              title="Edit name"
              aria-label="Edit name"
              onClick={(e) => {
                e.stopPropagation();
                openEditName();
              }}
              className={[
                "w-9 h-9 rounded-xl flex items-center justify-center transition shadow-sm",
                shouldForceMenuVisible
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100",
                isLight
                  ? "bg-[#F1F1F1]/90 border border-[#CFCFCF] text-black/75 hover:bg-[#F3F3F3]"
                  : "bg-[#1B1B1B]/95 border border-[#2B2B2B] text-white/90 hover:bg-[#242424]",
              ].join(" ")}
            >
              <span className="text-[15px] leading-none">✎</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderPiPTile = (t: TileModel) => {
    const tileIdentity = String(t.participantIdentity || "");
    const participantProfile =
      profilesById[String(t.participantUserId || "").toLowerCase()] || null;

    const participantProfileName = String(
      participantProfile?.full_name || "",
    ).trim();
    const tileAvatarUrl = String(participantProfile?.avatar_url || "").trim();

    const nameText = t.isLocal
      ? localRoomDisplayNameOverrideRef.current ||
      t.metadataDisplayName ||
      displayName ||
      prejoinRef.current.displayName ||
      userName ||
      "You"
      : t.metadataDisplayName ||
      participantProfileName ||
      t.label ||
      "Participant";

    const micMuted = !!t.micMuted;

    return (
      <div className="relative h-full w-full min-h-0 min-w-0">
        <VideoTile
          tileId={t.id}
          label={nameText}
          videoTrack={t.videoTrack}
          audioTrack={t.audioTrack}
          isLocal={t.isLocal}
          theme={theme}
          showBadge={getBadgeForTile(t)}
          hostActions={undefined}
          avatarUrl={tileAvatarUrl}
          micMuted={micMuted}
          mirrorVideo={t.isLocal ? previewMirrored : false}
          audioLevel={t.audioLevel || 0}
          currentIntention={getCurrentIntentionForTile(t)}
          density="compact"
          onToggleMenu={(tileId, anchorEl) => {
            if (!anchorEl) return;

            if (openTileAdminMenuId === tileId) {
              closeTileMenu();
              return;
            }

            openTileMenuAt(tileId, anchorEl);
          }}
          showMenuButton={
            !!(t.isLocal || t.kind === "screen" || !!t.participantIdentity)
          }
          onOpenProfile={() => {
            if (!t.participantUserId) return;

            const p =
              profilesById[String(t.participantUserId).toLowerCase()] ||
              profilesById[String(t.participantIdentity || "").toLowerCase()] ||
              null;

            if (p) setSelectedUser(p);
          }}
        />
      </div>
    );
  };

  const screenShareTilesForRender = useMemo(() => {
    return screenShareTiles.filter((t) => !hiddenTileIds[t.id]);
  }, [screenShareTiles, hiddenTileIds]);

  const allTilesForRender = useMemo(() => {
    // Multiple participants can share screens at the same time.
    // Treat every screen share as its own normal tile by default.
    // Camera tiles are still managed by tilesForRender; screen-share tiles are separate.
    const screenIds = new Set(screenShareTilesForRender.map((t) => t.id));
    const cameraTiles = tilesForRender.filter((t) => !screenIds.has(t.id));
    return [...screenShareTilesForRender, ...cameraTiles];
  }, [screenShareTilesForRender, tilesForRender]);

  const activeScreenShareTile = useMemo(() => {
    if (!screenShareTilesForRender.length) return null;

    if (pinnedScreenShareTileId) {
      const selected = screenShareTilesForRender.find(
        (t) => t.id === pinnedScreenShareTileId,
      );
      if (selected) return selected;
    }

    return screenShareTilesForRender[0] || null;
  }, [screenShareTilesForRender, pinnedScreenShareTileId]);

  useEffect(() => {
    if (!screenShareTilesForRender.length) {
      // Keep the next screen share unpinned by default.
      // Screen share should behave like a normal video tile unless someone explicitly pins it.
      setScreenSharePinned(false);
      setPinnedScreenShareTileId(null);
      return;
    }

    if (
      pinnedScreenShareTileId &&
      !screenShareTilesForRender.some((t) => t.id === pinnedScreenShareTileId)
    ) {
      setPinnedScreenShareTileId(null);
      setScreenSharePinned(false);
    }
  }, [screenShareTilesForRender, pinnedScreenShareTileId]);

  const layoutTilesForRender = useMemo(() => {
    if (screenSharePinned && activeScreenShareTile) {
      const withoutDup = allTilesForRender.filter(
        (t) => t.id !== activeScreenShareTile.id,
      );
      return [activeScreenShareTile, ...withoutDup];
    }

    return allTilesForRender;
  }, [allTilesForRender, activeScreenShareTile, screenSharePinned]);

  const [tileTasksByUserId, setTileTasksByUserId] = useState<Record<string, string>>({});

  const loadTileTasks = useCallback(async () => {
    const sid = String(session?.id || "").trim();
    if (!sid) {
      setTileTasksByUserId({});
      return;
    }

    try {
      const { data, error } = await supabase
        .from("intentions")
        .select("id,text,user_id,session_id,created_at,completed")
        .eq("session_id", sid)
        .eq("completed", false)
        .order("created_at", { ascending: false })
        .limit(160);

      if (error || !Array.isArray(data)) {
        setTileTasksByUserId({});
        return;
      }

      const next: Record<string, string> = {};
      for (const row of data as any[]) {
        const userId = String(row?.user_id || "").trim().toLowerCase();
        const text = String(row?.text || "").trim();
        if (!userId || !text || next[userId]) continue;
        next[userId] = text;
      }

      setTileTasksByUserId(next);
    } catch {
      setTileTasksByUserId({});
    }
  }, [session?.id]);

  useEffect(() => {
    void loadTileTasks();
  }, [loadTileTasks]);

  useEffect(() => {
    const sid = String(session?.id || "").trim();
    if (!sid) return;

    const ch = supabase
      .channel(`tile-intentions:${sid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "intentions", filter: `session_id=eq.${sid}` },
        () => void loadTileTasks(),
      )
      .subscribe();

    return () => {
      safeRemoveRealtimeChannel(ch);
    };
  }, [session?.id, loadTileTasks]);

  const getCurrentIntentionForTile = useCallback(
    (tile: TileModel) => {
      const userId = getTilePersonKey(tile);
      return tileTasksByUserId[userId] || "";
    },
    [tileTasksByUserId],
  );

  const pinnedParticipantTile = useMemo(() => {
    if (!pinnedTileId) return null;
    return layoutTilesForRender.find((t) => t.id === pinnedTileId) || null;
  }, [pinnedTileId, layoutTilesForRender]);

  const featuredTile = useMemo(() => {
    if (activeScreenShareTile && screenSharePinned) {
      return activeScreenShareTile;
    }

    if (pinnedParticipantTile) {
      return pinnedParticipantTile;
    }

    return null;
  }, [activeScreenShareTile, screenSharePinned, pinnedParticipantTile]);

  const sidebarTiles = useMemo(() => {
    if (activeScreenShareTile && screenSharePinned) {
      return layoutTilesForRender.filter(
        (t) => t.id !== activeScreenShareTile.id,
      );
    }

    if (pinnedParticipantTile) {
      return layoutTilesForRender.filter(
        (t) => t.id !== pinnedParticipantTile.id,
      );
    }

    return layoutTilesForRender;
  }, [
    activeScreenShareTile,
    screenSharePinned,
    pinnedParticipantTile,
    layoutTilesForRender,
  ]);

  // Layout
  const tileCount = layoutTilesForRender.length;

  const aiHostedEnabled = !!session?.ai_hosted;

  const currentStageForAiHost = stages[currentStage] || null;

  const paddingBottomPx = 12;

  const isVeryNarrow = effectiveW < 430;
  const isNarrowForColumns = effectiveW < 520;
  const isCompact = effectiveW < 900;

  const useVeryNarrowMode =
    isVeryNarrow || (isMobileQuery && isNarrowForColumns);
  const useMobileOrTabletGallery = isMobileQuery || isTabletQuery;
  const stackTwoOnThisViewport =
    tileCount === 2 &&
    !useVeryNarrowMode &&
    (isTabletQuery || (isMobileQuery && effectiveW < 640) || isCompact);

  const useFeaturedLayout =
    !!featuredTile &&
    !useMobileOrTabletGallery &&
    !useVeryNarrowMode &&
    effectiveW >= (isLgUp && rightPanelOpen ? 980 : 900);

  const showMobileLayoutControls = useMobileOrTabletGallery && tileCount >= 3;

  const mobileLayoutIconTheme = isLight ? "light" : "dark";

  const mobileLayoutBtnBase = isLight
    ? "border-[#CFCFCF] bg-[#F1F1F1]/90 text-black/75 hover:bg-[#F3F3F3]"
    : "border-[#2B2B2B] bg-[#1B1B1B] text-white/80 hover:bg-[#242424]";

  const mobileLayoutBtnActive = isLight
    ? "border-[#5286F6]/50 bg-[#1B1B1B] text-white shadow"
    : "border-emerald-400/50 bg-[#1B1B1B] text-white shadow";

  const MobileLayoutButton = ({
    mode,
    icon,
    label,
    title,
  }: {
    mode: MobileVideoLayoutMode;
    icon: string;
    label: string;
    title: string;
  }) => {
    const active = mobileVideoLayoutMode === mode;

    return (
      <button
        type="button"
        onClick={() => setVideoTileLayoutPreset(mode)}
        className={[
          "h-9 min-w-9 rounded-xl border px-2 text-[11px] font-semibold transition inline-flex items-center justify-center gap-1.5",
          active ? mobileLayoutBtnActive : mobileLayoutBtnBase,
        ].join(" ")}
        title={title}
        aria-label={title}
      >
        <img
          src={`/icons/${icon}-${mobileLayoutIconTheme}.svg`}
          alt=""
          className="h-4 w-4 shrink-0"
          draggable={false}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        <span>{label}</span>
      </button>
    );
  };

  const videoLayout = mainViewMode === "accountability" ? (
    <AccountabilityWall
      sessionId={session?.id || null}
      tiles={layoutTilesForRender}
      profilesById={profilesById}
      authUserId={authUserId || null}
      theme={theme}
      isLight={isLight}
      onOpenTasks={() => openRightTab("tasks")}
      onSwitchBackToVideo={() => setMainViewMode("video")}
    />
  ) : useFeaturedLayout ? (
    <div
      className="h-full w-full min-w-0 min-h-0 grid gap-2 sm:gap-3 p-2 sm:p-3 overflow-hidden"
      style={{
        gridTemplateColumns:
          isLgUp && rightPanelOpen
            ? "minmax(0, 1fr) clamp(12rem, 20vw, 16rem)"
            : "minmax(0, 1fr) clamp(14rem, 24vw, 20rem)",
      }}
    >
      <div className="min-w-0 min-h-0 flex items-center justify-center overflow-hidden">
        <div className="w-full min-w-0 min-h-0">
          {featuredTile ? renderTile(featuredTile) : null}
        </div>
      </div>

      <div className="min-w-0 min-h-0 overflow-y-auto overflow-x-hidden pr-1 flex flex-col gap-3">
        {sidebarTiles.length === 0 ? (
          <div
            className={`min-h-[160px] rounded-2xl border flex items-center justify-center ${isLight
              ? "border-[#CFCFCF] bg-[#E6E6E6] text-black/50"
              : "border-[#2B2B2B] bg-[#242424] text-white/55"
              }`}
          >
            No other participants
          </div>
        ) : (
          sidebarTiles.map((t) => (
            <div key={`sidebar-${t.id}`}>{renderTile(t)}</div>
          ))
        )}
      </div>
    </div>
  ) : (
    <>
      {!tileCount && connected ? (
        <div
          className={`h-full w-full flex items-center justify-center px-4 ${isLight ? "text-black/60" : "text-white/60"}`}
        >
          <div
            className={`min-h-[240px] w-full max-w-[680px] rounded-2xl border flex items-center justify-center ${isLight ? "border-[#CFCFCF] bg-[#E6E6E6]" : "border-[#2B2B2B] bg-[#242424]"}`}
          >
            No participants yet
          </div>
        </div>
      ) : tileCount ? (
        useMobileOrTabletGallery ? (
          <div className="h-full w-full min-w-0 min-h-0 overflow-hidden">
            {tileCount <= 2 ? (
              <MobileFillLayoutSizing<TileModel>
                items={layoutTilesForRender}
                containerWidth={effectiveW}
                containerHeight={effectiveH}
                paddingBottomPx={paddingBottomPx}
                mobileMode={mobileVideoLayoutMode}
                layoutPreset={videoTileLayoutPreset}
                customColumns={videoTileLayoutColumns}
                customRows={videoTileLayoutRows}
                renderItem={(t) => renderTile(t)}
              />
            ) : (
              <MobileStackLayoutSizing<TileModel>
                items={layoutTilesForRender}
                containerWidth={effectiveW}
                containerHeight={effectiveH}
                paddingBottomPx={paddingBottomPx}
                mode={mobileVideoLayoutMode}
                layoutPreset={videoTileLayoutPreset}
                customColumns={videoTileLayoutColumns}
                customRows={videoTileLayoutRows}
                renderItem={(t) => renderTile(t)}
              />
            )}
          </div>
        ) : tileCount <= 2 ? (
          <div className="h-full w-full min-w-0 min-h-0 overflow-hidden">
            <P2PLayoutSizing<TileModel>
              items={layoutTilesForRender}
              containerWidth={effectiveW}
              containerHeight={effectiveH}
              stack={stackTwoOnThisViewport}
              renderItem={(t) => renderTile(t)}
            />
          </div>
        ) : (
          <div className="h-full w-full min-w-0 min-h-0 overflow-hidden">
            <GridLayoutSizing<TileModel>
              items={layoutTilesForRender}
              containerWidth={effectiveW}
              containerHeight={effectiveH}
              rightPanelOpen={rightPanelOpen}
              forceThreeAsTwoPlusOne={
                isLgUp && rightPanelOpen && effectiveW < 1500
              }
              layoutPreset={videoTileLayoutPreset}
              customColumns={videoTileLayoutColumns}
              customRows={videoTileLayoutRows}
              renderItem={(t) => renderTile(t)}
            />
          </div>
        )
      ) : null}
    </>
  );

  const videoContent = (
    <div className="w-full h-full min-w-0 min-h-0 relative overflow-hidden">
      {mainViewMode !== "accountability" && showMobileLayoutControls && showMobileLayoutSwitcher ? (
        <div className="absolute right-2 top-2 z-20 flex items-center gap-1.5 rounded-2xl p-1 backdrop-blur-xl pointer-events-auto">
          <MobileLayoutButton
            mode="auto"
            icon="layout-auto"
            label="Auto"
            title="Auto mobile video layout"
          />
          <MobileLayoutButton
            mode="one"
            icon="layout-one-column"
            label="1"
            title="One-column video layout"
          />
          <MobileLayoutButton
            mode="two"
            icon="layout-two-columns"
            label="2"
            title="Two-column video layout"
          />
          <button
            type="button"
            onClick={() => updateShowMobileLayoutSwitcher(false)}
            className={[
              "w-7 h-7 rounded-xl flex items-center justify-center text-[13px] font-bold transition",
              isLight
                ? "bg-[#242424]0 hover:bg-[#F3F3F3] text-black/60 border border-[#CFCFCF]"
                : "bg-[#242424] hover:bg-[#424242] text-white/70 border border-[#2B2B2B]",
            ].join(" ")}
            title="Hide layout switcher"
          >
            ×
          </button>
        </div>
      ) : null}
      {roomReadyText ? (
        <div
          className={`absolute inset-0 flex items-center justify-center z-10 ${isLight ? "text-black/60" : "text-white/70"}`}
        >
          <div
            className={`px-4 py-2 rounded-xl ${isLight ? "bg-[#FAFAFA]" : "bg-[#242424]"}`}
          >
            {roomReadyText}
          </div>
        </div>
      ) : null}

      {hiddenTiles.length > 0 && (
        <div className="absolute top-3 left-3 z-30 max-w-[80%]">
          <div
            className={[
              "inline-flex items-center gap-2 px-3 py-2 rounded-2xl border backdrop-blur shadow",
              isLight
                ? "bg-[#242424]0 border-[#CFCFCF] text-black/75"
                : "bg-[#242424] border-[#2B2B2B] text-white/85",
            ].join(" ")}
          >
            <span className="text-[12px] font-semibold">Hidden:</span>
            <div className="flex flex-wrap gap-2">
              {hiddenTiles.slice(0, 8).map((t) => (
                <button
                  key={`unhide-${t.id}`}
                  type="button"
                  onClick={() => toggleHide(t.id)}
                  className={[
                    "px-2 py-1 rounded-xl text-[12px] font-semibold border transition",
                    isLight
                      ? "bg-[#E6E6E6] border-[#CFCFCF] hover:bg-[#DCDCDC] text-black/70"
                      : "bg-[#242424] border-[#2B2B2B] hover:bg-[#303030] text-white/85",
                  ].join(" ")}
                  title="Unhide participant"
                >
                  {String(t.label || "User").slice(0, 18)} ✕
                </button>
              ))}
              {hiddenTiles.length > 8 ? (
                <span
                  className={`text-[12px] opacity-70 ${isLight ? "text-black/60" : "text-white/70"}`}
                >
                  +{hiddenTiles.length - 8}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {videoLayout}

      {floatingReactions.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex items-end justify-center">
          <div className="relative flex flex-col items-center gap-2">
            {floatingReactions.slice(-3).map((r, idx) => (
              <div
                key={r.id}
                className={[
                  "ms-reaction-float select-none",
                  "px-4 py-3 rounded-3xl shadow-2xl border backdrop-blur",
                  "flex flex-col items-center justify-center",
                  isLight
                    ? "bg-[#F1F1F1]/90 border-[#CFCFCF] text-black/80"
                    : "bg-[#242424] border-[#2B2B2B] text-white/90",
                ].join(" ")}
                style={{ animationDelay: `${idx * 0.05}s` }}
              >
                <div className="text-[44px] leading-none">
                  {REACTION_EMOJI[r.type]}
                </div>
                <div className="mt-1 text-[12px] leading-tight opacity-80 max-w-[260px] truncate">
                  {r.fromName}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const pipFeaturedTile = useMemo(() => {
    if (activeScreenShareTile && screenSharePinned)
      return activeScreenShareTile;
    if (pinnedParticipantTile) return pinnedParticipantTile;
    return layoutTilesForRender[0] || null;
  }, [
    activeScreenShareTile,
    screenSharePinned,
    pinnedParticipantTile,
    layoutTilesForRender,
  ]);

  const pipStripTiles = useMemo(() => {
    if (activeScreenShareTile && screenSharePinned) {
      return layoutTilesForRender
        .filter((t) => t.id !== activeScreenShareTile.id)
        .slice(0, 4);
    }

    if (pinnedParticipantTile) {
      return layoutTilesForRender
        .filter((t) => t.id !== pinnedParticipantTile.id)
        .slice(0, 4);
    }

    return layoutTilesForRender.slice(1, 5);
  }, [
    activeScreenShareTile,
    screenSharePinned,
    pinnedParticipantTile,
    layoutTilesForRender,
  ]);

  const pipGalleryTiles = useMemo(() => {
    if (activeScreenShareTile && screenSharePinned) {
      const withoutDup = layoutTilesForRender.filter(
        (t) => t.id !== activeScreenShareTile.id,
      );
      return [activeScreenShareTile, ...withoutDup].slice(0, 9);
    }

    if (pinnedParticipantTile) {
      const withoutDup = layoutTilesForRender.filter(
        (t) => t.id !== pinnedParticipantTile.id,
      );
      return [pinnedParticipantTile, ...withoutDup].slice(0, 9);
    }

    return layoutTilesForRender.slice(0, 9);
  }, [
    activeScreenShareTile,
    screenSharePinned,
    pinnedParticipantTile,
    layoutTilesForRender,
  ]);

  const pipGalleryColumns = useMemo(() => {
    const count = pipGalleryTiles.length;

    if (count <= 1) return 1;
    if (count === 2) return 2;
    if (count === 3) return 2;
    if (count === 4) return 2;
    if (count <= 6) return 3;
    return 3;
  }, [pipGalleryTiles.length]);

  const pipPortal = pipMountEl
    ? createPortal(
      <LiveKitPiPPortal
        isLight={isLight}
        theme={theme}
        sessionTitle={String(session?.title || "Session")}
        participantsCount={participantsCount}
        remainingTime={remainingTime}
        pipMode="gallery"
        pipFeaturedTile={pipFeaturedTile}
        pipStripTiles={pipStripTiles}
        pipGalleryTiles={pipGalleryTiles}
        pipGalleryColumns={pipGalleryColumns}
        renderTile={renderPiPTile}
        micOn={micOn}
        camOn={camOn}
        screenShareOn={screenShareOn}
        onToggleMic={() => {
          toggleMic().catch(() => { });
        }}
        onToggleCam={() => {
          toggleCam().catch(() => { });
        }}
        onToggleScreenShare={() => {
          toggleScreenShare().catch(() => { });
        }}
        onSendReaction={(reactionType) => {
          sendReaction(reactionType);
        }}
        onSetPipMode={() => setPipMode("gallery")}
        onOpenTasksPanel={openTasksFromPictureInPicture}
      />,
      pipMountEl,
    )
    : null;

  // UI colors
  const pageBg = isLight
    ? "bg-[#F3F1F1] text-[#1F1F1F]"
    : "bg-[#1B1B1B] text-white";
  const panelBg = "bg-[#F3F1F1] border border-[#D8D0D0]";
  const bottomBarBg = isLight
    ? "bg-[#F3F1F1] border border-[#D8D0D0]"
    : "bg-[#1B1B1B] border border-[#252525]";

  const ctlBtnBase = isLight
    ? "bg-[#E7E7E7] hover:bg-[#DCDCDC] text-black/75"
    : "bg-[#242424] hover:bg-[#2E2E2E] text-white/90";

  // participants list search
  const [participantsSearch, setParticipantsSearch] = useState("");

  const participantsForPanel = useMemo(() => {
    const q = participantsSearch.trim().toLowerCase();
    const base = tilesBaseForUi;
    if (!q) return base;
    return base.filter((t) => (t.label || "").toLowerCase().includes(q));
  }, [tilesBaseForUi, participantsSearch]);

  const ChatPanelAny = ChatPanel as any;

  const RightPanelBody = (
    <div
      className={`rounded-2xl shadow-lg overflow-hidden min-h-0 h-full flex flex-col ${panelBg} ${theme === "dark" ? "dark" : ""}`}
      data-theme={theme}
      style={{ colorScheme: theme }}
    >
      {rightTab === "participants" && (
        <div className="h-full min-h-0 flex flex-col">
          <div
            className={`${roomPanelHeaderClass} border-b flex items-center justify-between border-[#D8D0D0] bg-[#F3F1F1]`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="text-black/85 font-inter font-semibold truncate"
              >
                Participants
              </span>
              <span
                className="text-black/50 text-sm"
              >
                ({participantsCount})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openEditName}
                className={`px-3 h-9 rounded-xl text-[12px] font-semibold border transition ${true
                  ? "bg-[#1B1B1B] border-[#1B1B1B] hover:bg-[#242424] text-white"
                  : "bg-[#1B1B1B] border-[#1B1B1B] hover:bg-[#242424] text-white"
                  }`}
                title="Edit my name"
              >
                Edit my name
              </button>

              <button
                onClick={() => openRightTab(null)}
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${true
                  ? "bg-[#E6E6E6] hover:bg-[#DCDCDC] text-black/60"
                  : "bg-[#E6E6E6] hover:bg-[#DCDCDC] text-black/60"
                  }`}
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="p-4">
            <div
              className={`rounded-xl px-3 py-2 ${true
                ? "bg-[#E6E6E6] border border-[#CFCFCF]"
                : "bg-[#E6E6E6] border border-[#CFCFCF]"
                }`}
            >
              <input
                value={participantsSearch}
                onChange={(e) => setParticipantsSearch(e.target.value)}
                placeholder="Search participants..."
                className={`w-full bg-transparent outline-none text-[13px] placeholder:opacity-60 ${true
                  ? "text-black/80 placeholder:text-black/40"
                  : "text-black/80 placeholder:text-black/40"
                  }`}
              />
            </div>

            {rolesError ? (
              <div
                className={`mt-2 text-[12px] ${"text-red-600"}`}
              >
                {rolesError}
              </div>
            ) : null}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
            <div className="flex flex-col gap-2">
              {participantsForPanel.map((p) => {
                const isHidden = !!hiddenTileIds[p.id];
                const isPinned = pinnedTileId === p.id;

                const avatar = getAvatarForTile(p);
                const initials = getInitials(p.label);
                const statusLabel = getStatusLabel(p.status);
                const statusTone = getStatusTone(p.status);

                const pidBase = String(p.participantUserId || "").toLowerCase();
                const isMod =
                  !p.isLocal && looksLikeUuid(pidBase)
                    ? moderatorUserIds.includes(pidBase)
                    : p.isLocal
                      ? isSelfModerator && !isHost
                      : false;

                const roleText =
                  p.kind === "screen"
                    ? p.isLocal
                      ? "Your screen"
                      : "Screen share"
                    : p.isLocal
                      ? isHost
                        ? "Host"
                        : isMod
                          ? "Moderator"
                          : "You"
                      : isMod
                        ? "Moderator"
                        : "Participant";

                return (
                  <div
                    key={p.id}
                    className={`px-3 py-2 rounded-xl transition ${true ? "hover:bg-[#E8E8E8]" : "hover:bg-[#E8E8E8]"
                      }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {avatar ? (
                          <img
                            src={avatar}
                            alt={p.label}
                            className="w-10 h-10 rounded-full object-cover"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              try {
                                (e.currentTarget as any).style.display = "none";
                              } catch { }
                            }}
                          />
                        ) : (
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${true
                              ? "bg-[#1B1B1B]/15 text-[#5286F6]"
                              : "bg-[#1B1B1B]/15 text-[#5286F6]"
                              }`}
                          >
                            {p.kind === "screen" ? "🖥️" : initials}
                          </div>
                        )}

                        <div className="min-w-0">
                          <div
                            className={`text-[13px] font-medium truncate ${true ? "text-black/85" : "text-black/85"
                              }`}
                          >
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="truncate">{p.label}</span>

                              {statusLabel ? (
                                <span
                                  className={`shrink-0 rounded-full border px-1.5 py-[1px] text-[10px] leading-none ${statusTone === "yellow"
                                    ? isLight
                                      ? "bg-yellow-100 text-yellow-800 border-yellow-300/60"
                                      : "bg-yellow-400/15 text-yellow-200 border-yellow-300/25"
                                    : statusTone === "purple"
                                      ? isLight
                                        ? "bg-purple-100 text-purple-800 border-purple-300/60"
                                        : "bg-purple-400/15 text-purple-200 border-purple-300/25"
                                      : statusTone === "blue"
                                        ? isLight
                                          ? "bg-blue-100 text-blue-800 border-blue-300/60"
                                          : "bg-blue-400/15 text-blue-200 border-blue-300/25"
                                        : statusTone === "orange"
                                          ? isLight
                                            ? "bg-orange-100 text-orange-800 border-orange-300/60"
                                            : "bg-orange-400/15 text-orange-200 border-orange-300/25"
                                          : isLight
                                            ? "bg-neutral-100 text-neutral-700 border-neutral-300/60"
                                            : "bg-[#303030] text-white/80 border-[#2B2B2B]"
                                    }`}
                                  title={statusLabel}
                                >
                                  {statusLabel}
                                </span>
                              ) : null}
                            </div>
                            {isPinned ? (
                              <span className="ml-2 opacity-70">📌</span>
                            ) : null}
                            {isHidden ? (
                              <span className="ml-2 opacity-70">🙈</span>
                            ) : null}
                          </div>
                          <div
                            className={`text-[11px] truncate ${isLight ? "text-black/55" : "text-white/55"}`}
                          >
                            {roleText}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {p.kind === "screen" && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                const isThisPinnedScreen =
                                  screenSharePinned &&
                                  activeScreenShareTile?.id === p.id;
                                setPinnedScreenShareTileId(
                                  isThisPinnedScreen ? null : p.id,
                                );
                                setScreenSharePinned(!isThisPinnedScreen);
                              }}
                              className={`w-9 h-9 rounded-xl flex items-center justify-center border transition ${true
                                ? "border-[#CFCFCF] bg-[#F3F3F3] hover:bg-[#E8E8E8] text-black/80"
                                : "border-[#CFCFCF] bg-[#F3F3F3] hover:bg-[#E8E8E8] text-black/80"
                                }`}
                              title={
                                screenSharePinned &&
                                  activeScreenShareTile?.id === p.id
                                  ? "Unpin shared screen"
                                  : "Pin shared screen"
                              }
                              aria-label={
                                screenSharePinned &&
                                  activeScreenShareTile?.id === p.id
                                  ? "Unpin shared screen"
                                  : "Pin shared screen"
                              }
                            >
                              {screenSharePinned &&
                                activeScreenShareTile?.id === p.id
                                ? "⇱"
                                : "📌"}
                            </button>
                          </>
                        )}

                        {p.kind !== "screen" && (
                          <>
                            <button
                              onClick={() => togglePin(p.id)}
                              className={`w-9 h-9 rounded-xl flex items-center justify-center border transition ${true
                                ? "border-[#1B1B1B] bg-[#1B1B1B] hover:bg-[#242424] text-white"
                                : "border-[#1B1B1B] bg-[#1B1B1B] hover:bg-[#242424] text-white"
                                }`}
                              title={isPinned ? "Unpin" : "Pin"}
                            >
                              📌
                            </button>

                            <button
                              onClick={() => toggleHide(p.id)}
                              className={`w-9 h-9 rounded-xl flex items-center justify-center border transition ${true
                                ? "border-[#1B1B1B] bg-[#1B1B1B] hover:bg-[#242424] text-white"
                                : "border-[#1B1B1B] bg-[#1B1B1B] hover:bg-[#242424] text-white"
                                }`}
                              title={isHidden ? "Unhide" : "Hide"}
                            >
                              🙈
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className={`p-4 border-t ${true ? "border-[#CFCFCF]" : "border-[#CFCFCF]"}`}
          >
            <button
              onClick={() => {
                try {
                  const url = window.location.href;
                  void navigator.clipboard.writeText(url);
                  alert("Invite link copied ✅");
                } catch {
                  alert("Could not copy link");
                }
              }}
              className={`w-full h-12 rounded-xl font-semibold flex items-center justify-center gap-2 ${isLight
                ? "bg-[#1B1B1B] hover:bg-[#242424] text-white"
                : "bg-[#1B1B1B] hover:bg-[#242424] text-white"
                }`}
            >
              <span className="text-lg">⎘</span>
              <span>Copy invite link</span>
            </button>
          </div>
        </div>
      )}

      {rightPanelOpen && rightTab === "chat" && (
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[#D8D0D0] bg-[#F3F1F1] min-h-[52px]">
            <div className="flex items-center gap-2 shrink-0 mr-1">
              <img
                src="/icons/chat-light.svg"
                alt="Chat"
                className="w-4 h-4 shrink-0"
                draggable={false}
              />
              <span
                className={
                  "text-[13px] font-semibold shrink-0 text-black/85"
                }
              >
                Chat
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setChatViewMode("general")}
                className={
                  "relative h-8 px-3 rounded-full text-xs font-medium transition border shrink-0 " +
                  (chatViewMode === "general"
                    ? "bg-[#1B1B1B] border-[#1B1B1B] text-white"
                    : "bg-transparent border-[#CFCFCF] text-black/65 hover:bg-[#E8E8E8]")
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  <span>All</span>
                  {unreadGeneralChat > 0 ? (
                    <span
                      className={
                        "inline-flex min-w-[16px] h-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none " +
                        (chatViewMode === "general"
                          ? "bg-[#F65252] text-white"
                          : "bg-[#F65252] text-white")
                      }
                      title={`${unreadGeneralChat} new chat message${unreadGeneralChat === 1 ? "" : "s"}`}
                    >
                      {unreadGeneralChat > 9 ? "9+" : unreadGeneralChat}
                    </span>
                  ) : null}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setChatViewMode("host")}
                className={
                  "relative h-8 px-3 rounded-full text-xs font-medium transition border shrink-0 " +
                  (chatViewMode === "host"
                    ? "bg-[#1B1B1B] border-[#1B1B1B] text-white"
                    : "bg-transparent border-[#CFCFCF] text-black/65 hover:bg-[#E8E8E8]")
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  <span>DMs</span>
                  {directUnreadTotal > 0 ? (
                    <span
                      className="inline-flex min-w-[16px] h-4 items-center justify-center rounded-full bg-[#F65252] px-1 text-[10px] font-bold leading-none text-white"
                      title={`${directUnreadTotal} new DM${directUnreadTotal === 1 ? "" : "s"}`}
                    >
                      {directUnreadTotal > 9 ? "9+" : directUnreadTotal}
                    </span>
                  ) : null}
                </span>
              </button>
            </div>

            <div className="flex-1 min-w-0" />

            {String(session?.host_id || "")
              .trim()
              .toLowerCase() ===
              String(authUserId || "")
                .trim()
                .toLowerCase() &&
              chatViewMode === "host" && (
                <div ref={hostDmDropdownRef} className="relative shrink-0">
                  <style>
                    {`
                      @keyframes mysessionHostDmDropdownIn {
                        from {
                          opacity: 0;
                          transform: translateY(-4px) scale(0.98);
                        }
                        to {
                          opacity: 1;
                          transform: translateY(0) scale(1);
                        }
                      }
                    `}
                  </style>

                  <button
                    type="button"
                    onClick={() => setHostDmDropdownOpen((v) => !v)}
                    className={
                      "flex h-8 w-[136px] min-w-0 max-w-[136px] items-center justify-between gap-2 rounded-full border px-3 text-xs font-semibold outline-none transition sm:w-[148px] sm:max-w-[148px] xl:w-[160px] xl:max-w-[160px] " +
                      (isLight
                        ? "border-[#D8D0D0] bg-[#F7F5F5] text-black/80 hover:border-[#C9C1C1] hover:bg-white"
                        : "border-[#2B2B2B] bg-[#242424] text-white/85 hover:border-[#3A3A3A] hover:bg-[#2A2A2A]")
                    }
                    aria-haspopup="listbox"
                    aria-expanded={hostDmDropdownOpen}
                    title="Choose participant for DMs"
                  >
                    <span className="min-w-0 truncate">
                      {selectedHostChatPeerId
                        ? liveHostChatOptions.find(
                          (item) => item.userId === selectedHostChatPeerId,
                        )?.label || "Choose DM"
                        : liveHostChatOptions.length
                          ? "Choose DM"
                          : "No one live"}
                    </span>

                    <span
                      className={
                        "shrink-0 transition-transform duration-200 " +
                        (hostDmDropdownOpen ? "rotate-180" : "rotate-0") +
                        " " +
                        (isLight ? "text-black/50" : "text-white/55")
                      }
                      aria-hidden="true"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <path
                          d="M7 10L12 15L17 10"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </button>

                  {hostDmDropdownOpen ? (
                    <div
                      role="listbox"
                      className={
                        "absolute right-0 top-[calc(100%+6px)] z-[90] w-[190px] origin-top-right overflow-hidden rounded-2xl border p-1 shadow-[0_14px_34px_rgba(0,0,0,0.18)] sm:w-[204px] " +
                        (isLight
                          ? "border-[#D8D0D0] bg-[#F7F5F5] text-black"
                          : "border-[#2B2B2B] bg-[#242424] text-white")
                      }
                      style={{
                        animation:
                          "mysessionHostDmDropdownIn 140ms ease-out both",
                      }}
                    >
                      <button
                        type="button"
                        role="option"
                        aria-selected={!selectedHostChatPeerId}
                        onClick={() => {
                          setSelectedHostChatPeerId(null);
                          setHostDmDropdownOpen(false);
                        }}
                        className={
                          "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-semibold transition " +
                          (!selectedHostChatPeerId
                            ? isLight
                              ? "bg-white text-black shadow-sm"
                              : "bg-[#1B1B1B] text-white"
                            : isLight
                              ? "text-black/70 hover:bg-white"
                              : "text-white/70 hover:bg-[#2E2E2E]")
                        }
                      >
                        <span className="min-w-0 truncate">
                          {liveHostChatOptions.length ? "Choose DM" : "No one live"}
                        </span>
                      </button>

                      {liveHostChatOptions.map((item) => {
                        const dmUnread = clampUnreadCount(
                          unreadDirectChatByPeerId[item.userId] || 0,
                        );
                        const selected = selectedHostChatPeerId === item.userId;

                        return (
                          <button
                            key={item.userId}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => {
                              setSelectedHostChatPeerId(item.userId);
                              setHostDmDropdownOpen(false);
                            }}
                            className={
                              "mt-1 flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold transition " +
                              (selected
                                ? isLight
                                  ? "bg-white text-black shadow-sm"
                                  : "bg-[#1B1B1B] text-white"
                                : isLight
                                  ? "text-black/70 hover:bg-white"
                                  : "text-white/70 hover:bg-[#2E2E2E]")
                            }
                            title={item.label}
                          >
                            <span className="min-w-0 truncate">{item.label}</span>

                            {dmUnread > 0 ? (
                              <span className="shrink-0 rounded-full bg-[#F65252] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                                {dmUnread > 9 ? "9+" : dmUnread}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              )}

            {String(session?.host_id || "")
              .trim()
              .toLowerCase() ===
              String(authUserId || "")
                .trim()
                .toLowerCase() &&
              chatViewMode === "host" &&
              liveHostChatOptions.some(
                (item) =>
                  clampUnreadCount(unreadDirectChatByPeerId[item.userId] || 0) >
                  0,
              ) ? (
              <div className="hidden xl:flex items-center gap-1.5 shrink-0 max-w-[360px] overflow-x-auto pr-1">
                {liveHostChatOptions
                  .filter(
                    (item) =>
                      clampUnreadCount(
                        unreadDirectChatByPeerId[item.userId] || 0,
                      ) > 0,
                  )
                  .slice(0, 4)
                  .map((item) => {
                    const dmUnread = clampUnreadCount(
                      unreadDirectChatByPeerId[item.userId] || 0,
                    );

                    return (
                      <button
                        key={item.userId}
                        type="button"
                        onClick={() => {
                          setChatViewMode("host");
                          setSelectedHostChatPeerId(item.userId);
                        }}
                        className={
                          "h-8 max-w-[115px] rounded-full border px-2.5 text-[11px] font-semibold transition flex items-center gap-1.5 shrink-0 " +
                          (isLight
                            ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                            : "border-red-500/25 bg-red-500/10 text-red-200 hover:bg-red-500/15")
                        }
                        title={`${item.label}: ${dmUnread} new DM${dmUnread === 1 ? "" : "s"}`}
                      >
                        <span className="h-2 w-2 rounded-full bg-[#F65252] shrink-0" />
                        <span className="truncate">{item.label}</span>
                        <span className="shrink-0">
                          {dmUnread > 9 ? "9+" : dmUnread}
                        </span>
                      </button>
                    );
                  })}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setRightPanelOpen(false);
                setRightTab(null);
              }}
              className={
                "w-8 h-8 rounded-xl flex items-center justify-center transition shrink-0 " +
                "bg-[#E6E6E6] hover:bg-[#DCDCDC] text-black/60"
              }
              title="Close chat"
            >
              ✕
            </button>
          </div>

          <ChatPanel
            sessionId={sessionId}
            theme={theme}
            showHeader={false}
            onClose={() => {
              setRightPanelOpen(false);
              setRightTab(null);
            }}
            hostUserIdOverride={String(session?.host_id || "") || null}
            hostProfileOverride={session?.host_profile || null}
            externalMode={chatViewMode}
            externalDirectPeerUserId={selectedHostChatPeerId}
            onDirectPeerIdsChange={setHostChatPeerIds}
          />
        </div>
      )}

      {rightTab === "tasks" && (
        <div className="h-full min-h-0 flex flex-col">
          <div className="px-5 py-4 border-b border-[#D8D0D0] bg-[#F3F1F1] flex items-center justify-between">
            <div
              className="text-black/85 font-inter font-semibold"
            >
              Tasks
            </div>
            <button
              onClick={() => openRightTab(null)}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition bg-[#E6E6E6] hover:bg-[#DCDCDC] text-black/60"
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden p-4">
            <div
              className="h-full min-h-0 overflow-hidden rounded-xl bg-[#F3F1F1] border border-[#D8D0D0]"
            >
              <div className="h-full min-h-0 overflow-y-auto [&>*]:min-h-0">
                <div
                  data-theme="light"
                  style={{ colorScheme: "light" }}
                  className="h-full min-h-0"
                >
                  {session?.id ? (
                    <TasksPanel
                      key={`tasks-${session.id}`}
                      theme="light"
                      sessionId={session.id}
                      timerText={remainingTime || "--:--"}
                      pictureInPictureSupported={connected && pipSupported}
                      pictureInPictureOpen={pipOpen}
                      onOpenPictureInPicture={() => {
                        togglePictureInPicture().catch((e) => {
                          console.error(
                            "open Picture-in-Picture from tasks failed",
                            e,
                          );
                          alert(
                            String(
                              (e as any)?.message || e || "pip_open_failed",
                            ),
                          );
                        });
                      }}
                      accountabilityWallOpen={mainViewMode === "accountability"}
                      onToggleAccountabilityWall={() => {
                        setMainViewMode((v) =>
                          v === "accountability" ? "video" : "accountability",
                        );
                      }}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  if (loading) {
    return (
      <div className={`flex h-screen items-center justify-center ${pageBg}`}>
        Loading session...
      </div>
    );
  }

  // Do not hard-block the room on auth checking.
  // Logged-out users should see the in-room auth modal instead of a redirect/back screen.

  const handleBookFromJoinGate = async () => {
    const sessionId = String(session?.id || "").trim();
    if (!sessionId) return;

    if (!authUserId) {
      setMediaWarning(
        "Sign in in this room first, then you can book this session.",
      );
      return;
    }

    if (joinGateBooked || joinGateBookingBusy) return;

    setJoinGateBookingBusy(true);

    try {
      const { error } = await supabase.from("session_bookings").insert({
        session_id: sessionId,
        user_id: authUserId,
      });

      if (error) {
        const msg = String(error.message || "").toLowerCase();
        if (
          msg.includes("duplicate") ||
          msg.includes("unique") ||
          msg.includes("already")
        ) {
          setJoinGateBooked(true);
        } else {
          throw error;
        }
      } else {
        setJoinGateBooked(true);
      }

      setSession((prev: any) => {
        if (!prev || !authUserId) return prev;

        const existing = Array.isArray(prev.session_bookings)
          ? prev.session_bookings
          : [];
        const alreadyThere = existing.some(
          (b: any) => String(b?.user_id || "") === String(authUserId),
        );
        if (alreadyThere) return prev;

        return {
          ...prev,
          session_bookings: [
            ...existing,
            { session_id: sessionId, user_id: authUserId },
          ],
        };
      });
    } catch (e) {
      console.error("LiveKit join gate booking error:", e);
    } finally {
      setJoinGateBookingBusy(false);
    }
  };

  if (sessionCloseInfo.closed) {
    return (
      <>
        <div
          className={`min-h-screen w-full flex items-center justify-center px-4 ${pageBg}`}
        >
          <div
            className={`w-full max-w-[560px] rounded-[28px] border p-6 text-center shadow-2xl ${isLight
              ? "border-[#CFCFCF] bg-[#F3F3F3] text-black"
              : "border-[#2B2B2B] bg-[#242424] text-white"
              }`}
          >
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-[24px]">
              ⏱️
            </div>

            <div className="text-[24px] font-bold tracking-[-0.02em]">
              Session is no longer accessible
            </div>

            <div
              className={`mt-3 text-[14px] leading-6 ${isLight ? "text-black/60" : "text-white/60"}`}
            >
              This session ended at{" "}
              {sessionCloseInfo.endMs
                ? formatLocalDateTime(sessionCloseInfo.endMs)
                : "its scheduled end time"}
              . MySession keeps the room open for {SESSION_CLOSE_GRACE_MINUTES}{" "}
              minutes after the last block, then closes it automatically.
            </div>

            <button
              type="button"
              onClick={() => navigate("/sessions", { replace: true })}
              className={`mt-6 h-11 rounded-full px-5 text-[14px] font-semibold transition ${isLight
                ? "bg-black text-white hover:bg-black/85"
                : "bg-[#F3F3F3] text-black hover:bg-[#F1F1F1]/90"
                }`}
            >
              Return to sessions
            </button>

            <div
              className={`mt-3 text-[12px] ${isLight ? "text-black/55" : "text-white/55"}`}
            >
              Return to the sessions page to book or join another session.
            </div>
          </div>
        </div>

        {pipPortal}
      </>
    );
  }

  if (paywallRuntimeBlocked) {
    return (
      <>
        <div className={`flex h-screen items-center justify-center ${pageBg}`}>
          <div className="w-full max-w-[520px] rounded-[28px] border border-[#CFCFCF] bg-[#F3F3F3] p-8 shadow-sm">
            <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[#1B1B1B]">
              Upgrade to continue
            </h1>

            <p className="mt-3 text-[15px] leading-7 text-black/65">
              You’ve reached the current Free plan limit. Upgrade to Pro to keep
              joining sessions.
            </p>

            <div className="mt-6">
              <button
                type="button"
                onClick={() => navigate("/pricing")}
                className="inline-flex rounded-2xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
              >
                Upgrade plan
              </button>
            </div>
          </div>
        </div>

        <PaywallModal
          open={paywallModalOpen}
          onClose={() => setPaywallModalOpen(false)}
          title="Upgrade to join this session"
          description="Your Free plan limit has been reached. Upgrade to Pro to keep using MySession without limits."
        />
      </>
    );
  }

  if (joinBlocked && !!authUserId) {
    return (
      <JoinGateModal
        open={true}
        theme={theme}
        sessionTitle={String(session?.title || "Session")}
        joinEarlyWindowMinutes={JOIN_EARLY_WINDOW_MINUTES}
        startMs={joinGateInfo.startMs}
        allowMs={joinGateInfo.allowMs}
        msUntilAllowed={joinGateInfo.msUntilAllowed}
        bookingCtaLabel="Book this session right now"
        bookingBusy={joinGateBookingBusy}
        bookingDone={joinGateBooked}
        onBook={handleBookFromJoinGate}
        onBack={() => navigate("/sessions", { replace: true })}
        onReload={() => window.location.reload()}
      />
    );
  }

  if (!session) {
    const showAuth = !authUserId && authGateStatus !== "authed";

    return (
      <>
        <div
          className={`min-h-screen w-full flex items-center justify-center px-4 ${pageBg}`}
        >
          <div
            className={`w-full max-w-[560px] rounded-[28px] border p-6 text-center shadow-2xl ${isLight
              ? "border-[#CFCFCF] bg-[#F3F3F3] text-black"
              : "border-[#2B2B2B] bg-[#242424] text-white"
              }`}
          >
            <div className="text-[22px] font-bold">
              {showAuth ? "Sign in to open this session" : "Session not found"}
            </div>

            <div
              className={`mt-3 text-[14px] leading-6 ${isLight ? "text-black/60" : "text-white/60"}`}
            >
              {showAuth
                ? "This room link is ready. Sign in here and MySession will bring you back to the room automatically."
                : sessionLoadError ||
                "We could not load this session. It may have been deleted or the link may be wrong."}
            </div>

            {!showAuth ? (
              <button
                type="button"
                onClick={() => navigate("/sessions", { replace: true })}
                className={`mt-6 h-11 rounded-full px-5 text-[14px] font-semibold transition ${isLight
                  ? "bg-black text-white hover:bg-black/85"
                  : "bg-[#F3F3F3] text-black hover:bg-[#F1F1F1]/90"
                  }`}
              >
                Back to sessions
              </button>
            ) : null}
          </div>
        </div>

        <ActiveBanModal
          open={!!activeBan}
          ban={activeBan}
          onBackToSessions={() => navigate("/sessions", { replace: true })}
        />

        <RoomAuthModal
          open={showAuth}
          theme={theme}
          sessionTitle="this session"
          redirectPath={`${location.pathname}${location.search}`}
          onEmailAuthSuccess={refreshRoomAuth}
        />

        {pipPortal}
      </>
    );
  }

  const onJoinGate = () => {
    if (sessionCloseInfo.closed) {
      setPrejoinOpen(false);
      setJoinRequested(false);
      setMediaWarning("This session is no longer accessible.");
      return;
    }

    if (activeBan) {
      setPrejoinOpen(false);
      setJoinRequested(false);
      setMediaWarning(
        "You are banned from MySession and cannot join this room.",
      );
      return;
    }

    if (!authUserId) {
      setPrejoinOpen(false);
      setJoinRequested(false);
      setMediaWarning("Sign in in this room first, then you can join.");
      return;
    }

    joinFlowStartedRef.current = true;
    connectingFromPrejoinRef.current = true;
    if (paywallRuntimeBlocked) {
      setPaywallModalOpen(true);
      joinFlowStartedRef.current = false;
      connectingFromPrejoinRef.current = false;
      return;
    }
    if ((isMobileQuery || isTabletQuery) && videoFxMode !== "off") {
      setVideoFxMode("off");
      setFxStatusText("FX disabled automatically on mobile/tablet device");
    }

    const pj = prejoinRef.current;
    const nm =
      (pj.displayName || displayName || userName || "User").trim() || "User";

    const baseUser = safeIdentity(
      (authUserId && looksLikeUuid(authUserId)
        ? authUserId
        : authUserId || nm) as any,
    );

    if (session?.id && !tabPresenceAcquiredRef.current) {
      const g = tryAcquireTabGate(session.id, baseUser);
      if (!g.ok) {
        const msg = `Too many tabs open for this room (${g.count}/${g.max}). Close another tab and try again.`;
        setTokenError(msg);
        try {
          alert(msg);
        } catch { }
        setPrejoinOpen(true);
        setJoinRequested(false);
        return;
      }
    }

    setDisplayName(nm);
    setSelectedAudioOutputId(pj.audioOutputId || "default");
    setSelectedAudioInputId(pj.audioInputId || "");
    setSelectedVideoInputId(pj.videoInputId || "");
    setEchoCancellationEnabled(!!pj.echoCancellation);
    setNoiseSuppressionEnabled(!!pj.noiseSuppression);
    setAutoGainControlEnabled(!!pj.autoGainControl);

    setPrejoinOpen(false);
    setTokenError("");
    setClientError("");
    setDeviceError("");

    pendingRoomAudioUnlockRef.current = true;

    setJoinRequested(true);
  };

  return (
    <>
      <style>{`
        @keyframes msReactionFloatUp {
          0%   { opacity: 0; transform: translate3d(0, 14px, 0) scale(0.92); }
          12%  { opacity: 1; transform: translate3d(0, 0px, 0) scale(1); }
          78%  { opacity: 1; transform: translate3d(0, -30px, 0) scale(1); }
          100% { opacity: 0; transform: translate3d(0, -60px, 0) scale(1); }
        }
        .ms-reaction-float {
          animation: msReactionFloatUp 2.15s ease-out forwards;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .ms-reaction-float { animation: none; }
        }

        .ms-room-page,
        .ms-room-page *,
        .ms-video-stage,
        .ms-video-stage * {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .ms-room-page::-webkit-scrollbar,
        .ms-room-page *::-webkit-scrollbar,
        .ms-video-stage::-webkit-scrollbar,
        .ms-video-stage *::-webkit-scrollbar {
          width: 0 !important;
          height: 0 !important;
          display: none !important;
        }

        @media (max-width: 1023px) {
          .ms-desktop-only-fx {
            display: none !important;
          }
        }
      `}</style>

      <RoomAuthModal
        open={!authUserId && authGateStatus !== "authed"}
        theme={theme}
        sessionTitle={String(session?.title || "Session")}
        redirectPath={`${location.pathname}${location.search}`}
        onEmailAuthSuccess={refreshRoomAuth}
      />

      <PreJoinModal
        open={prejoinOpen && !!authUserId && !activeBan}
        theme={theme}
        devices={devices}
        value={prejoin}
        onChange={setPrejoin}
        deviceError={deviceError}
        hideBackgroundFx={shouldDisableBackgroundFx}
        onRefreshDevices={() => loadBrowserDevices().catch(() => { })}
        onCancel={() => {
          cleanupPrejoinPreparedVideoTrack().catch(() => { });
          releaseTabPresence();
          navigate("/sessions", { replace: true });
        }}
        onJoin={onJoinGate}
        onPrepareAudioGesture={() => {
          pendingRoomAudioUnlockRef.current = true;
        }}
        onTestSpeaker={() => {
          try {
            const a = new Audio("/sounds/joined.mp3");
            a.volume = 0.9;
            a.play().catch(() => { });
          } catch { }
        }}
        previewVideoTrack={prejoinPreparedVideoTrackRef.current}
        previewVersion={prejoinPreviewVersion}
        videoFxMode={videoFxMode}
        blurStrength={blurStrength}
        bgImageUrl={bgImageUrl}
        fxApplying={fxApplying}
        fxError={fxError}
        fxStatusText={fxStatusText}
        fxBgPresets={FX_BG_PRESETS}
        onApplyVideoFx={applyPrejoinVideoFx}
        onBlurStrengthChange={setBlurStrength}
        onSetBgImageUrl={setBgImageUrl}
        onUploadBg={(file: File) => {
          try {
            if (uploadedBgUrlRef.current) {
              URL.revokeObjectURL(uploadedBgUrlRef.current);
              uploadedBgUrlRef.current = null;
            }
            const url = URL.createObjectURL(file);
            uploadedBgUrlRef.current = url;
            setBgImageUrl(url);
          } catch (e) {
            console.error("upload bg failed", e);
            setFxError("Failed to load selected image");
          }
        }}
        onResetBg={() => {
          if (uploadedBgUrlRef.current) {
            try {
              URL.revokeObjectURL(uploadedBgUrlRef.current);
            } catch { }
            uploadedBgUrlRef.current = null;
          }
          setBgImageUrl(DEFAULT_BG_DATA_URL);
        }}
      />

      {aiHostedEnabled && session?.id && authUserId ? (
        <AIHostedRoomController
          sessionId={session.id}
          currentUserId={authUserId}
          currentUserName={displayName || userName || "there"}
          tiles={layoutTilesForRender}
          currentStage={currentStageForAiHost}
          chatTable={CHAT_MSG_TABLE}
          theme={theme}
          isOpen={aiHostInputOpen}
          onClose={() => setAiHostInputOpen(false)}
          localMicMuted={!micOn}
          onUnmuteLocalMic={unmuteMicForAiCheckin}
          onMuteLocalMic={muteMicAfterAiCheckin}
        />
      ) : null}

      <div className={`ms-room-page h-[100dvh] overflow-hidden ${pageBg}`}>
        <div className="h-full w-full px-2 sm:px-3 pt-2 pb-[calc(80px+env(safe-area-inset-bottom))] sm:pb-[calc(90px+env(safe-area-inset-bottom))] flex flex-col gap-2 min-h-0">
          <RoomTopBar
            theme={theme}
            sessionTitle={String(session?.title || "Session")}
            canEditTimeline={isHost}
            onEditTimeline={isHost ? openTimelineEditor : undefined}
            participantsCount={participantsCount}
            maxParticipants={maxParticipants}
            isSilentRoom={isSilentRoom}
            stages={stages as any}
            stagebarStartTime={stagebarStartTime}
            stagebarCycleSeconds={stagebarCycleSeconds}
            remainingTime={remainingTime}
            hostProfile={session?.host_profile || null}
            onHoverStage={setHoveredStage as any}
            onToggleTheme={() =>
              setTheme((t) => (t === "dark" ? "light" : "dark"))
            }
            onOpenHostProfile={() =>
              setSelectedUser((session?.host_profile as any) || null)
            }
          />

          <div
            className="relative grid grid-rows-1 gap-2 sm:gap-3 flex-1 min-h-0 h-full"
            style={{
              gridTemplateColumns: isLgUp
                ? roomGridTemplateColumns
                : "minmax(0, 1fr)",
            }}
          >
            <div
              ref={(el) => {
                videoWrapRef.current = el;
                videoSizerRef(el);
              }}
              className={`ms-video-stage relative rounded-2xl overflow-hidden min-h-0 h-full ${isLight
                ? "bg-[#F3F1F1] border border-[#D8D0D0]"
                : "bg-[#1B1B1B] border border-[#252525]"
                }`}
            >
              {videoContent}

              {mobileMediaRestoreOpen && (
                <div className="absolute inset-0 z-[55] flex items-center justify-center p-4">
                  <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />

                  {frozenLocalVideoFrame ? (
                    <img
                      src={frozenLocalVideoFrame}
                      alt="Frozen local video preview"
                      className="absolute inset-0 h-full w-full object-cover opacity-70 blur-[1px] scale-[1.02]"
                      draggable={false}
                    />
                  ) : null}

                  <div
                    className={[
                      "relative w-full max-w-[420px] rounded-[28px] border px-5 py-5 text-center shadow-2xl",
                      isLight
                        ? "border-[#CFCFCF] bg-[#F1F1F1]/95 text-black"
                        : "border-[#2B2B2B] bg-[#1B1B1B] text-white",
                    ].join(" ")}
                  >
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#81DB86]/15 text-[24px]">
                      🟢
                    </div>

                    <div className="mt-3 text-[20px] font-bold leading-tight">
                      {mobileRestoreMode === "restoring"
                        ? "Restoring your connection…"
                        : "Rejoin the room"}
                    </div>

                    <div
                      className={`mt-2 text-[13px] leading-5 ${isLight ? "text-black/60" : "text-white/65"}`}
                    >
                      {mobileRestoreMode === "restoring"
                        ? "Mobile browsers may pause the room after you switch apps. Please wait a few seconds while MySession reconnects."
                        : "Your browser paused the room while you were away. Rejoin to continue with your camera and microphone."}
                    </div>

                    {frozenLocalVideoFrame ? (
                      <div
                        className={`mt-3 text-[11px] ${isLight ? "text-black/55" : "text-white/55"}`}
                      >
                        Showing your last video frame while media restores.
                      </div>
                    ) : null}

                    <button
                      type="button"
                      disabled={mobileMediaRestoreBusy}
                      onClick={() => void restoreMobileMediaFromBackground()}
                      className={[
                        "mt-4 h-11 w-full rounded-2xl text-[14px] font-semibold transition disabled:opacity-60",
                        isLight
                          ? "bg-black text-white hover:bg-black/85"
                          : "bg-[#F3F3F3] text-black hover:bg-[#F1F1F1]/90",
                      ].join(" ")}
                    >
                      {mobileMediaRestoreBusy
                        ? "Rejoining…"
                        : mobileRestoreMode === "restoring"
                          ? "Reconnect now"
                          : "Rejoin room"}
                    </button>

                    <button
                      type="button"
                      disabled={mobileMediaRestoreBusy}
                      onClick={() => {
                        setMobileMediaRestoreOpen(false);
                        returningFromBackgroundRef.current = false;
                        pageHiddenAtRef.current = null;
                        scheduleRebuildTiles();
                      }}
                      className={`mt-2 h-9 w-full rounded-2xl text-[12px] font-semibold transition disabled:opacity-60 ${isLight
                        ? "border border-[#CFCFCF] bg-black/[0.03] text-black/65 hover:bg-black/[0.06]"
                        : "border border-[#2B2B2B] bg-[#252525] text-white/70 hover:bg-[#424242]"
                        }`}
                    >
                      I can see/hear everything
                    </button>
                  </div>
                </div>
              )}

              {lastErr && (
                <div className="absolute top-4 left-4 text-xs bg-[#F65252] text-white px-3 py-2 rounded-lg shadow z-30 max-w-[80%] break-words">
                  {lastErr}
                </div>
              )}
              {mediaWarning && connected && (
                <div
                  className={`rounded-2xl border px-3 py-2 text-sm ${isLight
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                    }`}
                >
                  <div className="break-words">
                    Joined the room, but a device step failed: {mediaWarning}
                  </div>
                </div>
              )}
            </div>

            {rightPanelOpen && isLgUp && (
              <div className="min-h-0 h-full overflow-hidden">
                {RightPanelBody}
              </div>
            )}

            {rightPanelOpen && !isLgUp && (
              <div className="absolute inset-0 z-40 min-h-0">
                <div
                  className="absolute inset-0 bg-black/40"
                  onClick={() => openRightTab(null)}
                />
                <div className="absolute inset-x-0 top-0 bottom-0 p-2 min-h-0">
                  {RightPanelBody}
                </div>
              </div>
            )}
          </div>
        </div>

        {roomState ? (
          <>
            <RoomAudioRenderer
              room={roomState}
              volume={1}
            />
            <div className="fixed bottom-[5.25rem] left-1/2 z-[80] -translate-x-1/2">
              <StartAudio
                room={roomState}
                label="Click to enable audio"
                className={
                  isLight
                    ? "rounded-xl border border-[#CFCFCF] bg-[#F3F3F3] px-3 py-2 text-sm font-medium text-black shadow-lg"
                    : "rounded-xl border border-[#2B2B2B] bg-[#1B1B1B] px-3 py-2 text-sm font-medium text-white shadow-lg"
                }
              />
              {remoteAudioBlocked && (
                <div className="fixed bottom-[9.5rem] left-1/2 z-[81] -translate-x-1/2 px-2">
                  <div
                    className={
                      isLight
                        ? "max-w-[92vw] rounded-2xl border border-amber-200 bg-[#F3F3F3] px-4 py-3 text-sm text-black shadow-xl"
                        : "max-w-[92vw] rounded-2xl border border-amber-500/30 bg-[#1B1B1B] px-4 py-3 text-sm text-white shadow-xl"
                    }
                  >
                    <div className="font-medium">Room audio needs a tap</div>
                    <div
                      className={`mt-1 text-xs ${isLight ? "text-black/65" : "text-white/70"}`}
                    >
                      After microphone changes on some Android devices, room
                      audio may need to be resumed manually.
                    </div>

                    {remoteAudioBlockedReason ? (
                      <div
                        className={`mt-2 text-[11px] break-words ${isLight ? "text-black/55" : "text-white/55"}`}
                      >
                        {remoteAudioBlockedReason}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      disabled={audioResumeBusy}
                      onClick={async () => {
                        try {
                          setAudioResumeBusy(true);
                          await ensureRoomAudioPlaybackUnlocked(
                            "manual-notice",
                          );
                        } finally {
                          setAudioResumeBusy(false);
                        }
                      }}
                      className={
                        isLight
                          ? "mt-3 rounded-xl border border-[#CFCFCF] bg-black px-3 py-2 text-sm font-medium text-white"
                          : "mt-3 rounded-xl border border-[#2B2B2B] bg-[#F3F3F3] px-3 py-2 text-sm font-medium text-black"
                      }
                    >
                      {audioResumeBusy
                        ? "Enabling audio..."
                        : "Enable room audio"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : null}

        <LiveKitBottomBar
          theme={theme}
          isLight={isLight}
          bottomBarBg={bottomBarBg}
          ctlBtnBase={ctlBtnBase}
          connected={connected}
          micOn={micOn}
          camOn={camOn}
          screenShareOn={screenShareOn}
          unreadChat={unreadChat}
          showPiP={connected && pipSupported}
          pipActive={pipOpen}
          onTogglePiP={() => {
            togglePictureInPicture().catch((e) => {
              console.error("togglePictureInPicture failed", e);
              alert(String((e as any)?.message || e || "pip_toggle_failed"));
            });
          }}
          onToggleMic={() => toggleMic().catch(() => { })}
          onToggleCam={() => toggleCam().catch(() => { })}
          onToggleScreenShare={() => toggleScreenShare().catch(() => { })}
          onLeave={() => leave().catch(() => { })}
          onOpenParticipants={() => openRightTab("participants")}
          onOpenChat={() => openRightTab("chat")}
          onOpenTasks={() => openRightTab("tasks")}
          onOpenSettings={() => {
            setSettingsOpen(true);
            setSettingsPreviewVersion((v) => v + 1);
          }}
          onOpenBugReport={() => setBugReportOpen(true)}
          onSendReaction={sendReaction}
          showAIHost={aiHostedEnabled}
          aiHostOpen={aiHostInputOpen}
          onOpenAIHost={() => setAiHostInputOpen(true)}
        />

        <BugReportModal
          open={bugReportOpen}
          theme={theme}
          isLight={isLight}
          onClose={() => setBugReportOpen(false)}
          sessionId={session?.id || null}
          roomName={session?.title || session?.id || null}
          userId={authUserId || null}
        />

        <RoomSettingsModalLiveKit
          open={settingsOpen}
          theme={theme}
          mode={videoFxMode}
          blurStrength={blurStrength}
          onBlurStrengthChange={setBlurStrength}
          bgImageUrl={bgImageUrl}
          onSetBgImageUrl={setBgImageUrl}
          onApplyMode={async (m) => {
            await applyVideoFx(m);
          }}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsPreviewVersion((v) => v + 1);
          }}
          fxError={fxError}
          fxApplying={fxApplying}
          fxStatusText={fxStatusText}
          previewTrack={
            prejoinPreparedVideoTrackRef.current ||
            (() => {
              try {
                const pubs = Array.from(
                  roomState?.localParticipant?.videoTrackPublications?.values?.() ||
                  [],
                );
                const camPub = pubs.find(
                  (p: any) => p?.source === Track.Source.Camera,
                );
                return (camPub?.track as LocalVideoTrack | null) || null;
              } catch {
                return null;
              }
            })()
          }
          previewVideoFilterCss={localVideoFilterCss}
          previewMirrored={previewMirrored}
          onTogglePreviewMirrored={setPreviewMirrored}
          onUploadBg={(file) => {
            try {
              if (uploadedBgUrlRef.current) {
                URL.revokeObjectURL(uploadedBgUrlRef.current);
                uploadedBgUrlRef.current = null;
              }
              const url = URL.createObjectURL(file);
              uploadedBgUrlRef.current = url;
              setBgImageUrl(url);
            } catch (e) {
              console.error("upload bg failed", e);
              setFxError("Failed to load selected image");
            }
          }}
          onResetBg={() => {
            if (uploadedBgUrlRef.current) {
              try {
                URL.revokeObjectURL(uploadedBgUrlRef.current);
              } catch { }
              uploadedBgUrlRef.current = null;
            }
            setBgImageUrl(DEFAULT_BG_DATA_URL);
          }}
          videoTileLayoutPreset={videoTileLayoutPreset}
          videoTileLayoutColumns={videoTileLayoutColumns}
          videoTileLayoutRows={videoTileLayoutRows}
          onChangeVideoTileLayoutPreset={setVideoTileLayoutPreset}
          onChangeVideoTileLayoutColumns={setVideoTileLayoutColumns}
          onChangeVideoTileLayoutRows={setVideoTileLayoutRows}
          devices={devices}
          selectedAudioInputId={selectedAudioInputId}
          selectedVideoInputId={selectedVideoInputId}
          selectedAudioOutputId={selectedAudioOutputId}
          onChangeAudioInput={async (deviceId: string) => {
            setSelectedAudioInputId(deviceId);
            setPrejoin((prev) => ({ ...prev, audioInputId: deviceId }));
            await syncLiveAudioInput(deviceId);
          }}
          onChangeVideoInput={async (deviceId: string) => {
            setSelectedVideoInputId(deviceId);
            setPrejoin((prev) => ({ ...prev, videoInputId: deviceId }));
            await syncLiveVideoInput(deviceId);
          }}
          onChangeAudioOutput={(deviceId: string) => {
            const nextId = audioOutputSupported
              ? deviceId || "default"
              : "default";
            setSelectedAudioOutputId(nextId);
            setPrejoin((prev) => ({ ...prev, audioOutputId: nextId }));
            prejoinRef.current = {
              ...prejoinRef.current,
              audioOutputId: nextId,
            };
          }}
          echoCancellationEnabled={echoCancellationEnabled}
          noiseSuppressionEnabled={noiseSuppressionEnabled}
          autoGainControlEnabled={autoGainControlEnabled}
          onChangeEchoCancellation={async (v: boolean) => {
            setEchoCancellationEnabled(v);
            setPrejoin((prev) => ({ ...prev, echoCancellation: v }));
            await syncLiveAudioProcessing({
              echoCancellation: v,
              noiseSuppression: noiseSuppressionEnabled,
              autoGainControl: autoGainControlEnabled,
            });
          }}
          onChangeNoiseSuppression={async (v: boolean) => {
            setNoiseSuppressionEnabled(v);
            setPrejoin((prev) => ({ ...prev, noiseSuppression: v }));
            await syncLiveAudioProcessing({
              echoCancellation: echoCancellationEnabled,
              noiseSuppression: v,
              autoGainControl: autoGainControlEnabled,
            });
          }}
          onChangeAutoGainControl={async (v: boolean) => {
            setAutoGainControlEnabled(v);
            setPrejoin((prev) => ({ ...prev, autoGainControl: v }));
            await syncLiveAudioProcessing({
              echoCancellation: echoCancellationEnabled,
              noiseSuppression: noiseSuppressionEnabled,
              autoGainControl: v,
            });
          }}
          roomSoundsEnabled={roomSoundsEnabled}
          onToggleRoomSounds={() => setRoomSoundsEnabled((prev) => !prev)}
          roomSoundsVolume={roomSoundsVolume}
          onChangeRoomSoundsVolume={setRoomSoundsVolume}
          colorCorrectionEnabled={isLgUp}
          brightness={colorCorrection.brightness}
          contrast={colorCorrection.contrast}
          saturate={colorCorrection.saturation}
          onToggleColorCorrection={() => { }}
          onChangeBrightness={(v: number) => {
            if (!isLgUp) return;
            setColorCorrection((p) => ({ ...p, brightness: v }));
          }}
          onChangeContrast={(v: number) => {
            if (!isLgUp) return;
            setColorCorrection((p) => ({ ...p, contrast: v }));
          }}
          onChangeSaturate={(v: number) => {
            if (!isLgUp) return;
            setColorCorrection((p) => ({ ...p, saturation: v }));
          }}
          showMobileLayoutSwitcher={showMobileLayoutSwitcher}
          onChangeShowMobileLayoutSwitcher={updateShowMobileLayoutSwitcher}
        />

        {settingsOpen && deviceError ? (
          <div
            className={`fixed left-1/2 top-[88px] z-[91] -translate-x-1/2 rounded-xl px-3 py-2 text-[12px] shadow-lg ${isLight
              ? "bg-red-50 border border-red-200 text-red-700"
              : "bg-red-500/10 border border-red-500/20 text-red-200"
              }`}
          >
            {deviceError}
          </div>
        ) : null}

        {systemNotice.open && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
              onClick={
                systemNotice.kind === "kick" ? undefined : closeSystemNotice
              }
            />
            <div
              className={`relative w-[92%] max-w-[520px] rounded-2xl border shadow-2xl p-5 ${isLight
                ? "bg-[#F3F3F3] border-[#CFCFCF] text-black/85"
                : "bg-[#1B1B1B] border-[#2B2B2B] text-white/90"
                }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[18px] font-semibold">
                    {systemNotice.title}
                  </div>
                  <div
                    className={`mt-1 text-[13px] leading-relaxed ${isLight ? "text-black/65" : "text-white/70"}`}
                  >
                    {systemNotice.body}
                  </div>
                </div>

                {systemNotice.kind !== "kick" && (
                  <button
                    type="button"
                    onClick={closeSystemNotice}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight
                      ? "bg-[#E6E6E6] hover:bg-[#DCDCDC] text-black/70"
                      : "bg-[#242424] hover:bg-[#303030] text-white/80"
                      }`}
                    title="Close"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    closeSystemNotice();
                    if (systemNotice.kind === "kick") {
                      navigate("/sessions", { replace: true });
                      return;
                    }
                  }}
                  className={`px-4 h-10 rounded-xl font-semibold ${isLight
                    ? "bg-[#1B1B1B] hover:bg-[#242424] text-white"
                    : "bg-[#1B1B1B] hover:bg-[#242424] text-white"
                    }`}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}

        <ReportParticipantModalLiveKit
          open={reportModalOpen}
          theme={theme}
          participantName={reportTarget?.label || "Participant"}
          value={reportReason}
          busy={reportBusy}
          error={reportError}
          onChange={setReportReason}
          onClose={() => {
            if (reportBusy) return;
            setReportModalOpen(false);
            setReportTarget(null);
            setReportReason("");
            setReportError("");
          }}
          onSubmit={() => {
            submitParticipantReport().catch(() => { });
          }}
        />

        {editNameOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setEditNameOpen(false)}
            />
            <div
              className={`relative w-[92%] max-w-[480px] rounded-2xl border shadow-2xl p-5 ${isLight
                ? "bg-[#F3F3F3] border-[#CFCFCF]"
                : "bg-[#1B1B1B] border-[#2B2B2B]"
                }`}
            >
              <div
                className={`text-[16px] font-semibold ${true ? "text-black/85" : "text-black/85"}`}
              >
                Edit your name
              </div>
              <div
                className={`mt-1 text-[12px] ${isLight ? "text-black/50" : "text-white/50"}`}
              >
                This only changes your name inside the current room.
              </div>

              <input
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                placeholder="Your name"
                className={`mt-4 w-full rounded-xl px-3 py-2 outline-none border ${isLight
                  ? "bg-[#F3F3F3] border-[#CFCFCF] text-black/85"
                  : "bg-[#1B1B1B] border-[#2B2B2B] text-white/90"
                  }`}
              />

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setEditNameOpen(false)}
                  className={`px-4 h-10 rounded-xl font-semibold ${isLight
                    ? "bg-[#E6E6E6] hover:bg-[#DCDCDC] text-black/75"
                    : "bg-[#242424] hover:bg-[#303030] text-white/85"
                    }`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => saveEditName().catch(() => { })}
                  className={`px-4 h-10 rounded-xl font-semibold ${isLight
                    ? "bg-[#1B1B1B] hover:bg-[#242424] text-white"
                    : "bg-[#1B1B1B] hover:bg-[#242424] text-white"
                    }`}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {timelineEditorOpen && (
          <RoomTimelineEditor
            open={timelineEditorOpen}
            theme={theme}
            title={sessionTitle}
            blocks={timelineDraftBlocks}
            onChange={setTimelineDraftBlocks}
            onClose={closeTimelineEditor}
            onSave={saveTimelineEditor}
            saving={timelineSaving}
            preserveInfinite={isInfiniteRoom}
          />
        )}

        {selectedUser && (
          <UserProfileModal
            user={selectedUser}
            onClose={() => setSelectedUser(null)}
          />
        )}
      </div>
      {openTileAdminMenuId &&
        tileMenuAnchor &&
        createPortal(
          <div
            className="fixed inset-0 z-[220] pointer-events-none"
            aria-hidden={false}
          >
            <div
              data-lk-admin-menu-surface="true"
              className={`pointer-events-auto fixed w-[min(22rem,calc(100vw-1rem))] max-h-[min(78vh,34rem)] overflow-y-auto overflow-x-hidden rounded-2xl border shadow-2xl ${isLight
                ? "bg-[#F3F3F3] border-[#CFCFCF] text-black/85"
                : "bg-[#1B1B1B] border-[#2B2B2B] text-white/90"
                }`}
              style={{
                left: Math.max(
                  8,
                  Math.min(
                    tileMenuAnchor.x - 352,
                    tileMenuAnchor.viewportWidth - 360,
                  ),
                ),
                top: Math.max(
                  8,
                  Math.min(
                    tileMenuAnchor.y + 8,
                    tileMenuAnchor.viewportHeight - 520,
                  ),
                ),
                fontFamily:
                  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                overscrollBehavior: "contain",
                WebkitOverflowScrolling: "touch",
                touchAction: "pan-y",
                backgroundColor: isLight ? "#F3F3F3" : "#262626",
                opacity: 1,
              }}
              onWheel={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
            >
              {(() => {
                const targetTile =
                  layoutTilesForRender.find(
                    (t) => t.id === openTileAdminMenuId,
                  ) ||
                  tilesForRender.find((t) => t.id === openTileAdminMenuId) ||
                  (featuredTile && featuredTile.id === openTileAdminMenuId
                    ? featuredTile
                    : null) ||
                  null;
                if (!targetTile) return null;

                const targetIdentity = String(
                  targetTile.participantIdentity || "",
                ).trim();
                const targetUserId = String(
                  targetTile.participantUserId ||
                  extractBaseUserIdFromIdentity(targetIdentity),
                )
                  .trim()
                  .toLowerCase();

                const pidBase = looksLikeUuid(targetUserId) ? targetUserId : "";
                const isTargetModerator = !!(
                  pidBase && moderatorUserIds.includes(pidBase)
                );

                const canRoleManageTarget =
                  !targetTile.isLocal &&
                  isHost &&
                  !!pidBase &&
                  pidBase !== String(authUserId || "").toLowerCase();

                const canModerateTarget =
                  !targetTile.isLocal &&
                  !!targetIdentity &&
                  (isHost || isSelfModerator);

                const participantVolumeKey =
                  getParticipantVolumeKey(targetTile);
                const participantVolumePctRaw =
                  volumePctByParticipantKey[participantVolumeKey];
                const participantVolumePct = Number.isFinite(
                  Number(participantVolumePctRaw),
                )
                  ? clamp(Number(participantVolumePctRaw), 0, 300)
                  : 100;

                const roleBusy = !!pidBase
                  ? roleBusyKey ===
                  `mod:${pidBase}:${isTargetModerator ? "revoke" : "grant"}`
                  : false;

                const muteBusyKey = `${targetIdentity}:${String(
                  targetTile.remoteMicPubSid || targetTile.micTrackSid || "",
                )}:mute`;
                const camBusyKey = `${targetIdentity}:${String(targetTile.camTrackSid || "")}:camera-off`;

                const micBusy = adminBusyKey === muteBusyKey;
                const camBusy = adminBusyKey === camBusyKey;
                const kickBusy = adminBusyKey === `${targetIdentity}:kick`;

                const remoteMicTrackSid = String(
                  targetTile.remoteMicPubSid || targetTile.micTrackSid || "",
                ).trim();

                const remoteCamTrackSid = String(
                  targetTile.camTrackSid || "",
                ).trim();

                const isMicAlreadyMuted = !!targetTile.micMuted;
                const isCamAlreadyOff =
                  !!targetTile.camPubMuted ||
                  !targetTile.camPubHasTrack ||
                  !targetTile.camPubExists;

                const canMuteMic =
                  canModerateTarget &&
                  !!remoteMicTrackSid &&
                  !isMicAlreadyMuted;

                const canTurnOffCam =
                  canModerateTarget && !!remoteCamTrackSid && !isCamAlreadyOff;

                const canSeeMuteMicAction =
                  !!remoteMicTrackSid || isMicAlreadyMuted;
                const canSeeTurnOffCamAction =
                  !!remoteCamTrackSid || isCamAlreadyOff;

                const muteMicDisabled =
                  micBusy ||
                  isMicAlreadyMuted ||
                  !canModerateTarget ||
                  !remoteMicTrackSid;

                const turnOffCamDisabled =
                  camBusy ||
                  isCamAlreadyOff ||
                  !canModerateTarget ||
                  !remoteCamTrackSid;

                const participantActionButtonCls = `w-full px-4 py-3 text-left text-[13px] transition ${isLight
                  ? "text-black/85 hover:bg-[#E8E8E8]"
                  : "text-white/90 hover:bg-[#303030]"
                  }`;

                const participantActionButtonDisabledCls = `w-full px-4 py-3 text-left text-[13px] transition disabled:cursor-not-allowed disabled:opacity-50 ${isLight
                  ? "text-black/55 bg-transparent"
                  : "text-white/55 bg-transparent"
                  }`;

                const isPinned = pinnedTileId === targetTile.id;
                const isHidden = !!hiddenTileIds[targetTile.id];

                return (
                  <>
                    {canRoleManageTarget && (
                      <>
                        <div
                          className={
                            isLight
                              ? "border-t border-[#CFCFCF]"
                              : "border-t border-[#2B2B2B]"
                          }
                        />

                        <div
                          className={`px-4 py-2 text-[11px] ${isLight ? "text-black/55" : "text-white/55"}`}
                        >
                          Roles
                        </div>

                        {!isTargetModerator ? (
                          <button
                            type="button"
                            disabled={roleBusy || rolesLoading}
                            onClick={async () => {
                              if (!pidBase) return;
                              await grantModerator(pidBase);
                              closeTileMenu();
                            }}
                            className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                          >
                            Make moderator
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={roleBusy || rolesLoading}
                            onClick={async () => {
                              if (!pidBase) return;
                              await revokeModerator(pidBase);
                              closeTileMenu();
                            }}
                            className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                          >
                            Remove moderator
                          </button>
                        )}
                      </>
                    )}

                    <>
                      {(canModerateTarget || true) && (
                        <>
                          <div
                            className={
                              isLight
                                ? "border-t border-[#CFCFCF]"
                                : "border-t border-[#2B2B2B]"
                            }
                          />

                          <div
                            className={`px-4 py-2 font-inter text-[12px] font-bold ${isLight ? "text-black/55" : "text-white/55"}`}
                          >
                            Participant actions
                          </div>

                          {canSeeMuteMicAction && (
                            <button
                              type="button"
                              disabled={muteMicDisabled}
                              onClick={() => {
                                if (muteMicDisabled) return;
                                if (!targetIdentity || !remoteMicTrackSid)
                                  return;

                                closeTileMenu();
                                void adminMuteRemoteTrack(
                                  targetTile.id,
                                  targetIdentity,
                                  remoteMicTrackSid,
                                );
                              }}
                              className={
                                muteMicDisabled
                                  ? participantActionButtonDisabledCls
                                  : participantActionButtonCls
                              }
                              title={
                                !canModerateTarget
                                  ? "Only host or moderator can mute participants"
                                  : "Mute Mic"
                              }
                            >
                              Mute Mic
                            </button>
                          )}

                          {canSeeTurnOffCamAction && (
                            <button
                              type="button"
                              disabled={turnOffCamDisabled}
                              onClick={() => {
                                if (turnOffCamDisabled) return;
                                if (!targetIdentity || !remoteCamTrackSid)
                                  return;

                                closeTileMenu();
                                void adminTurnOffRemoteCamera(
                                  targetTile.id,
                                  targetIdentity,
                                  remoteCamTrackSid,
                                );
                              }}
                              className={
                                turnOffCamDisabled
                                  ? participantActionButtonDisabledCls
                                  : participantActionButtonCls
                              }
                              title={
                                !canModerateTarget
                                  ? "Only host or moderator can control participant camera"
                                  : "Turn camera off"
                              }
                            >
                              Turn camera off
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              togglePin(targetTile.id);
                              closeTileMenu();
                            }}
                            className={`block w-full px-4 py-3 text-left text-[13px] transition ${isLight
                              ? "text-black/85 hover:bg-[#E8E8E8]"
                              : "text-white/90 hover:bg-[#303030]"
                              }`}
                          >
                            {isPinned ? "Unpin participant" : "Pin participant"}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              toggleHide(targetTile.id);
                              closeTileMenu();
                            }}
                            className={`block w-full px-4 py-3 text-left text-[13px] transition ${isLight
                              ? "text-black/85 hover:bg-[#E8E8E8]"
                              : "text-white/90 hover:bg-[#303030]"
                              }`}
                          >
                            {isHidden
                              ? "Unhide participant"
                              : "Hide participant"}
                          </button>

                          {!targetTile.isLocal && (
                            <button
                              type="button"
                              onClick={() => {
                                setReportTarget(targetTile);
                                setReportReason("");
                                setReportError("");
                                setReportModalOpen(true);
                                closeTileMenu();
                              }}
                              className={`block w-full px-4 py-3 text-left text-[13px] transition ${isLight
                                ? "text-black/85 hover:bg-[#E8E8E8]"
                                : "text-white/90 hover:bg-[#303030]"
                                }`}
                            >
                              Report participant
                            </button>
                          )}

                          {canModerateTarget && !targetTile.isLocal && (
                            <button
                              type="button"
                              disabled={kickBusy}
                              onClick={() => {
                                if (!targetIdentity) return;

                                closeTileMenu();
                                void adminKickParticipant(
                                  targetIdentity,
                                  targetUserId || undefined,
                                  targetTile.label || undefined,
                                );
                              }}
                              className={`w-full px-4 py-3 text-left text-[13px] transition disabled:cursor-not-allowed disabled:opacity-50 ${isLight
                                ? "text-red-600 hover:bg-red-50"
                                : "text-red-300 hover:bg-red-500/10"
                                }`}
                            >
                              Kick participant
                            </button>
                          )}
                        </>
                      )}
                    </>

                    {!targetTile.isLocal && targetTile.kind !== "screen" ? (
                      <>
                        <div
                          className={
                            isLight
                              ? "border-t border-[#CFCFCF]"
                              : "border-t border-[#2B2B2B]"
                          }
                        />

                        <div
                          className={`px-4 pb-3 pt-3 ${isLight ? "text-black/85" : "text-white/90"}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-inter text-[12px] font-bold">
                                Participant volume
                              </div>
                              <div className={`mt-1 text-[11px] ${isLight ? "text-black/50" : "text-white/50"}`}>
                                Only changes what you hear.
                              </div>
                            </div>
                            <div className={`shrink-0 rounded-xl border px-2 py-1 text-[12px] font-semibold tabular-nums ${isLight ? "border-[#CFCFCF] bg-[#F7F7F7] text-black/75" : "border-[#2B2B2B] bg-[#242424] text-white/80"}`}>
                              {participantVolumePct}%
                            </div>
                          </div>

                          <input
                            type="range"
                            min={0}
                            max={300}
                            step={5}
                            value={participantVolumePct}
                            onChange={(e) => {
                              setParticipantVolumePct(
                                targetTile,
                                Number(e.currentTarget.value),
                              );
                            }}
                            className="mt-3 w-full accent-[#5286F6]"
                            aria-label="Participant volume"
                          />

                          <div className="mt-2 grid grid-cols-6 gap-1.5">
                            {[0, 50, 100, 150, 200, 300].map((pct) => (
                              <button
                                key={pct}
                                type="button"
                                onClick={() => {
                                  setParticipantVolumePct(targetTile, pct);
                                }}
                                className={`rounded-xl border px-2 py-1.5 text-[11px] font-semibold transition ${participantVolumePct === pct
                                  ? isLight
                                    ? "border-black bg-black text-white"
                                    : "border-white bg-white text-black"
                                  : isLight
                                    ? "border-[#CFCFCF] bg-[#F7F7F7] text-black/70 hover:bg-[#E8E8E8]"
                                    : "border-[#2B2B2B] bg-[#242424] text-white/75 hover:bg-[#303030]"
                                  }`}
                              >
                                {pct}%
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : null}

                    <div
                      className={
                        isLight
                          ? "border-t border-[#CFCFCF]"
                          : "border-t border-[#2B2B2B]"
                      }
                    />

                    {targetTile?.kind === "screen" && (
                      <>
                        <div
                          className={
                            isLight
                              ? "border-t border-[#CFCFCF]"
                              : "border-t border-[#2B2B2B]"
                          }
                        />

                        <button
                          type="button"
                          onClick={() => {
                            const isThisPinnedScreen =
                              screenSharePinned &&
                              activeScreenShareTile?.id === targetTile.id;
                            setPinnedScreenShareTileId(
                              isThisPinnedScreen ? null : targetTile.id,
                            );
                            setScreenSharePinned(!isThisPinnedScreen);
                            closeTileMenu();
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight
                            ? "text-black/85 hover:bg-[#E8E8E8]"
                            : "text-white/90 hover:bg-[#303030]"
                            }`}
                        >
                          {screenSharePinned &&
                            activeScreenShareTile?.id === targetTile.id
                            ? "Unpin shared screen"
                            : "Pin shared screen"}
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setSettingsOpen(true);
                        setSettingsPreviewVersion((v) => v + 1);
                        closeTileMenu();
                      }}
                      className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                    >
                      Video room settings
                    </button>

                    {targetTile?.isLocal && targetTile?.kind !== "screen" && (
                      <>
                        <div
                          className={
                            isLight
                              ? "border-t border-[#CFCFCF]"
                              : "border-t border-[#2B2B2B]"
                          }
                        />

                        <div
                          className={`px-4 py-2 font-inter text-[12px] font-bold ${isLight ? "text-black/55" : "text-white/55"}`}
                        >
                          Status
                        </div>

                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus(null);
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          Clear status
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus("afk");
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          AFK
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus("break");
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          Taking a break
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus("skip");
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          Skip me
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus("call");
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          On a call
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus("eating");
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          Eating
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus("private");
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          Private
                        </button>
                      </>
                    )}

                  </>
                );
              })()}
            </div>
          </div>,
          tileMenuAnchor?.portalDocument?.body || document.body,
        )}
      {pipPortal}
    </>
  );
}

export default RoomPageLiveKit;
