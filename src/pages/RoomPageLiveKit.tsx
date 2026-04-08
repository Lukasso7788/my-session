// src/pages/RoomPageLiveKit.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Room,
  RoomEvent,
  Track,
  RemoteParticipant,
  LocalVideoTrack,
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

import ChatPanel from "../components/ChatPanel";
import { IntentionsPanel } from "../components/IntentionsPanel";
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
import { RemoteAudioRenderer } from "./livekit/RemoteAudioRendererLiveKit";
import ReportParticipantModalLiveKit from "./livekit/ReportParticipantModalLiveKit";
import { buildScreenShareTiles } from "./livekit/screenShareHelpers";
import LiveKitPiPPortal from "./livekit/LiveKitPiPPortal";

import {
  useElementSize,
  GridLayoutSizing,
  P2PLayoutSizing,
  MobileFillLayoutSizing,
  MobileStackLayoutSizing,
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
  isLocal: boolean;

  videoTrack?: Track;
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

type RightPanelTab = "participants" | "chat" | "intentions" | null;
type PiPMode = "focus" | "gallery";

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
function normalizeTemplates(t: SessionTemplate | SessionTemplate[] | null | undefined): SessionTemplate[] {
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
function parse50505(raw: unknown): { focus: number; break: number; intentions: number } | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const m1 = s.match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/);
  const m2 = s.match(/^(\d+)\s*-\s*(\d+)\s*-\s*(\d+)$/);
  const m = m1 || m2;
  if (!m) return null;

  const focus = Number(m[1]);
  const br = Number(m[2]);
  const intentions = Number(m[3]);

  if (!Number.isFinite(focus) || !Number.isFinite(br) || !Number.isFinite(intentions)) return null;
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
  if (k.includes("outro") || k.includes("farewell") || k.includes("celebrat") || k.includes("finish") || k.includes("end")) return "outro";
  if (k.includes("checkin") || k.includes("intention") || k.includes("checkinspoken")) return "intentions";
  if (k.includes("break") || k.includes("rest") || k.includes("pause")) return "break";
  if (k.includes("focus") || k.includes("work") || k.includes("deepwork") || k.includes("pomodoro")) return "focus";
  return "focus";
}
function isCheckInLikeLabel(raw: string): boolean {
  const k = normalizeKey(raw);
  return k.includes("checkin");
}
function normalizeInfinitePhases(anyPhases: unknown): { name: string; seconds: number }[] {
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
        const name = isRecord(p) ? str((p as any).name || (p as any).key || (p as any).type) : "";
        const seconds = toSeconds(p);
        return { name, seconds };
      })
      .filter((x) => x.seconds > 0);
  }

  if (isRecord(anyPhases)) {
    return Object.entries(anyPhases)
      .map(([k, v]) => {
        const name = String(k || "");
        const seconds = typeof v === "number" ? (v <= 180 ? Number(v) * 60 : Number(v)) : toSeconds(v);
        return { name, seconds };
      })
      .filter((x) => x.seconds > 0);
  }

  return [];
}
function phaseToStageType(phaseName: string): Stage["type"] {
  const k = normalizeKey(phaseName);

  if (k.includes("welcome") || k.includes("intro")) return "intro";
  if (k.includes("outro") || k.includes("farewell") || k.includes("celebrat") || k.includes("finish") || k.includes("end")) return "outro";
  if (k.includes("checkin") || k.includes("intention")) return "intentions";
  if (k.includes("break") || k.includes("rest") || k.includes("pause")) return "break";
  if (k.includes("focus") || k.includes("work") || k.includes("deepwork") || k.includes("pomodoro")) return "focus";
  return "focus";
}

const STAGE_COLORS: Record<string, string> = {
  intro: "#80DF86",
  intentions: "#ADD3FF",
  focus: "#4CA0FF",
  break: "#F9ADA2",
  outro: "#80DF86",
};

function getTemplateFirst(tpl: SessionRow["session_templates"]): SessionTemplate | null {
  if (!tpl) return null;
  return Array.isArray(tpl) ? tpl[0] ?? null : tpl;
}
function looksLikeUuid(v: string) {
  const s = String(v || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
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
  const s = String(identity || "").trim().toLowerCase();
  const m = s.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:--.*)?$/);
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

function pickExistingDeviceId(
  wantedId: string,
  list: MediaDeviceInfo[],
  fallback = ""
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
      width: 480,
      height: 270,
      fps: 12,
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

function getInitials(name: string) {
  const s = String(name || "").trim();
  if (!s) return "U";
  const parts = s.split(/\s+/).filter(Boolean).slice(0, 2);
  const out = parts.map((p) => p[0]?.toUpperCase()).join("");
  return out || "U";
}

function getParticipantVolumeKey(tile: Pick<TileModel, "id" | "participantUserId" | "participantIdentity">) {
  const userId = String(tile.participantUserId || "").toLowerCase();
  if (userId && looksLikeUuid(userId)) return `user:${userId}`;

  const identity = String(tile.participantIdentity || "").trim().toLowerCase();
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
async function resolveAvatarUrlFromProfilesField(avatarUrlOrPath: string): Promise<string> {
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
  return String(v || "").trim().toLowerCase();
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

  if (targetIdentity && localIdentity && targetIdentity === localIdentity) return true;
  if (targetUserId && authUserId && targetUserId === authUserId) return true;
  if (targetUserId && baseUserId && targetUserId === baseUserId) return true;

  return false;
}

function playOneShotFromCandidates(urls: string[], volume = 0.9) {
  const list = Array.from(
    new Set(
      (urls || [])
        .map((u) => String(u || "").trim())
        .filter(Boolean)
    )
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
  const brightness = Math.max(50, Math.min(150, Math.round(state.brightness || 100)));
  const contrast = Math.max(50, Math.min(150, Math.round(state.contrast || 100)));
  const saturation = Math.max(0, Math.min(200, Math.round(state.saturation || 100)));
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

// tab presence
const LK_TAB_PREFIX = "mysession_lk_tabs";
const LK_TAB_TTL_MS = 18_000;
const LK_TAB_HEARTBEAT_MS = 5_000;
const LK_MAX_TABS_DEFAULT = 2;

type TabPresence = { v: number; tabs: { id: string; ts: number }[] };

function nowMs() {
  return Date.now();
}
function randId(len = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
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
    if (c?.randomUUID) id = String(c.randomUUID()).replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase();
  } catch { }
  if (!id) id = randId(12);

  try {
    sessionStorage.setItem(storageKey, id);
  } catch { }

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
  const tabs = (p.tabs || []).filter((x) => t - (Number(x.ts) || 0) <= LK_TAB_TTL_MS);
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
  return `${LK_TAB_PREFIX}:${String(sessionId || "").trim()}:${String(baseUserId || "").trim().toLowerCase()}`;
}

// default background
const DEFAULT_BG_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1220"/>
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
  <circle cx="1030" cy="170" r="230" fill="#ffffff" opacity="0.04"/>
  <circle cx="360" cy="520" r="310" fill="#ffffff" opacity="0.03"/>
</svg>
`)
  );
}

const FX_BG_PRESETS = [
  { id: "ocean", label: "Ocean", url: makeBgPresetDataUrl("#081226", "#123a76", "#031019", "#38bdf8") },
  { id: "forest", label: "Forest", url: makeBgPresetDataUrl("#07160f", "#124b2c", "#040d08", "#22c55e") },
  { id: "violet", label: "Violet", url: makeBgPresetDataUrl("#120a22", "#3b2378", "#090512", "#a78bfa") },
  { id: "sunset", label: "Sunset", url: makeBgPresetDataUrl("#1c0d10", "#7c2d12", "#11070a", "#fb7185") },
];

const LK_CAPTURE_WIDTH = 960;
const LK_CAPTURE_HEIGHT = 540;
const LK_CAPTURE_FPS = 24;

const CHAT_MSG_TABLE = "session_chat_messages";
const REACTION_TTL_MS = 2750;
const SESSION_SELECT_STR =
  "*, host_profile:profiles!sessions_host_id_fkey(id, full_name, avatar_url, bio), session_templates(*), session_bookings(user_id)";

const JOIN_EARLY_WINDOW_MINUTES = 10;
const WEAK_DEVICE_PREVIEW_INIT_DELAY_MS = 450;

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

export function RoomPageLiveKit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const tabId = useMemo(() => getOrCreateTabId("mysession_lk_tab_id"), []);
  const devClones = useMemo(() => Math.max(0, Math.min(24, getQueryInt("devClones", 0))), []);

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
      const isDark = theme === "dark";

      root.classList.toggle("dark", isDark);
      body.classList.toggle("dark", isDark);

      root.setAttribute("data-theme", theme);
      body.setAttribute("data-theme", theme);

      (root.style as any).colorScheme = theme;
      (body.style as any).colorScheme = theme;
    } catch { }
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
    return window.matchMedia("(min-width: 768px) and (max-width: 1023px)").matches;
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

  const [joinGateBookingBusy, setJoinGateBookingBusy] = useState(false);
  const [joinGateBooked, setJoinGateBooked] = useState(false);

  // auth + profile
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  useEffect(() => {
    const booked =
      !!authUserId &&
      !!(session as any)?.session_bookings?.some(
        (b: any) => String(b?.user_id || "") === String(authUserId)
      );

    setJoinGateBooked(booked);
  }, [(session as any)?.session_bookings, authUserId]);
  const [authReady, setAuthReady] = useState(false);
  const [authGateStatus, setAuthGateStatus] = useState<"checking" | "authed" | "redirecting">("checking");
  const [userName, setUserName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const localRoomDisplayNameOverrideRef = useRef<string>("");
  const [localRoomDisplayNameVersion, setLocalRoomDisplayNameVersion] = useState(0);
  

  const applyRoomDisplayNameLocally = (nextRaw: string) => {
    const next = String(nextRaw || "").trim();
    if (!next) return;

    // 1) главный локальный source of truth для local tile
    localRoomDisplayNameOverrideRef.current = next;
    setLocalRoomDisplayNameVersion((v) => v + 1);

    // 2) обычный state
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
  const [localAvatarUrl, setLocalAvatarUrl] = useState<string>("");
  const accessTokenRef = useRef<string>("");

  const [selectedUser, setSelectedUser] = useState<HostProfile | null>(null);
  const [tileMenuAnchor, setTileMenuAnchor] = useState<{
    tileId: string;
    x: number;
    y: number;
    viewportWidth: number;
    viewportHeight: number;
    portalDocument: Document | null;
  } | null>(null);
  const [openTileAdminMenuId, setOpenTileAdminMenuId] = useState<string | null>(null);
  const [timelineEditorOpen, setTimelineEditorOpen] = useState(false);
  const [timelineDraftBlocks, setTimelineDraftBlocks] = useState<RoomTimelineBlock[]>([]);
  const [timelineSaving, setTimelineSaving] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<TileModel | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");

  // profile cache for remote
  const [profilesById, setProfilesById] = useState<Record<string, HostProfile>>({});

  // prejoin
  const [prejoinOpen, setPrejoinOpen] = useState(false);
  const [joinRequested, setJoinRequested] = useState(false);
  const prejoinBootstrappedSessionIdRef = useRef<string>("");
  const joinFlowStartedRef = useRef(false);
  const connectingFromPrejoinRef = useRef(false);

  const [devices, setDevices] = useState<MediaDevicesResult>({
    videoInputs: [],
    audioInputs: [],
    audioOutputs: [],
  });

  const [deviceError, setDeviceError] = useState<string>("");
  const [audioOutputSupported, setAudioOutputSupported] = useState<boolean>(() => canUseSetSinkId());

  const deviceTier = useMemo(
    () =>
      detectDeviceTier({
        isMobile: isMobileQuery,
        isTablet: isTabletQuery,
      }),
    [isMobileQuery, isTabletQuery]
  );

  const capturePreset = useMemo(() => getCapturePresetForTier(deviceTier), [deviceTier]);

  const [prejoin, setPrejoin] = useState<PreJoinSettings>(() => ({
    displayName: "",
    audioInputId: "",
    videoInputId: "",
    audioOutputId: "default",

    audioEnabled: false,
    videoEnabled: true,

    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: false,
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

  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState<string>("default");
  const [selectedAudioInputId, setSelectedAudioInputId] = useState<string>("");
  const [selectedVideoInputId, setSelectedVideoInputId] = useState<string>("");

  const [echoCancellationEnabled, setEchoCancellationEnabled] = useState(true);
  const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState(false);
  const [autoGainControlEnabled, setAutoGainControlEnabled] = useState(false);

  useEffect(() => {
    const nextEcho = true;
    const nextNoise = isMobileQuery || isTabletQuery;
    const nextAgc = isMobileQuery || isTabletQuery;

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
  }, [isMobileQuery, isTabletQuery]);

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

  // right panel
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia("(min-width: 1024px)").matches;
  });

  const [rightTab, setRightTab] = useState<RightPanelTab>("intentions");
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

  const openTileMenuAt = useCallback((tileId: string, anchorEl: HTMLElement | null) => {
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
  }, []);

  const closeTileMenu = useCallback(() => {
    setOpenTileAdminMenuId(null);
    setTileMenuAnchor(null);
  }, []);

  useEffect(() => {
    if (!openTileAdminMenuId) return;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const insideAnchor = !!target.closest("[data-lk-admin-menu-anchor='true']");
      const insideSurface = !!target.closest("[data-lk-admin-menu-surface='true']");

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
    window.addEventListener("scroll", onWindowChange, true);

    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("touchstart", onPointerDown, true);
      document.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
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
  const [stagebarCycleSeconds, setStagebarCycleSeconds] = useState<number | undefined>(undefined);

  const prevStageRef = useRef<number>(-1);
  const firstTickDoneRef = useRef<boolean>(false);
  const welcomeLoopRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef<boolean>(false);

  const STAGE_SOUND_MAP: Record<string, string> = {
    intentions: "/sounds/intentions.mp3",
    focus: "/sounds/focus.mp3",
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
      const raw = Number(localStorage.getItem(ROOM_SOUNDS_VOLUME_PREF_KEY) || "90");
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
      localStorage.setItem(ROOM_SOUNDS_VOLUME_PREF_KEY, String(roomSoundsVolume));
    } catch { }
  }, [roomSoundsVolume]);

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_MIRROR_PREF_KEY, String(previewMirrored));
    } catch { }
  }, [previewMirrored]);

  const playOneShot = (url: string, volume = 1) => {
    if (!url) return;
    if (!roomSoundsEnabledRef.current) return;

    const baseVolume = Math.max(0, Math.min(1, roomSoundsVolumeRef.current / 100));
    const finalVolume = Math.max(0, Math.min(1, baseVolume * volume));

    const a = new Audio(url);
    a.volume = finalVolume;
    a.play().catch(() => { });
  };

  const startWelcomeLoop = () => {
    stopWelcomeLoop();
    if (!roomSoundsEnabledRef.current) return;

    const baseVolume = Math.max(0, Math.min(1, roomSoundsVolumeRef.current / 100));

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

    if (isRecord((parsed as any).timer) && (((parsed as any).timer as any).phases || ((parsed as any).timer as any).segments)) return true;
    if ((parsed as any).phases || (parsed as any).segments) return true;

    return false;
  }, [session]);

  const isSilentRoom = useMemo(() => {
    const fmt = str(session?.format).toLowerCase();
    const title = str(session?.title).toLowerCase();

    const tpl0 = getTemplateFirst(session?.session_templates ?? null);
    const tplName = str(tpl0?.name || tpl0?.title).toLowerCase();
    const tplKey = str(tpl0?.key || tpl0?.slug || tpl0?.type).toLowerCase();
    const tplFmt = str(tpl0?.format).toLowerCase();

    const hay = `${fmt} ${title} ${tplName} ${tplKey} ${tplFmt}`.toLowerCase();
    return hay.includes("silent");
  }, [session]);

  const sessionId = useMemo(() => String(session?.id || ""), [session?.id]);
  const sessionTitle = useMemo(() => String(session?.title || "Session"), [session?.title]);
  useEffect(() => {
    prejoinBootstrappedSessionIdRef.current = "";
    joinFlowStartedRef.current = false;
    connectingFromPrejoinRef.current = false;
    setPrejoinOpen(false);
    setJoinRequested(false);
    setLkToken("");
  }, [sessionId]);

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

  useEffect(() => {
    (async () => {
      if (!id) return;
      setLoading(true);

      const { data, error } = await supabase
        .from("sessions")
        .select(SESSION_SELECT_STR)
        .eq("id", id)
        .single();

      if (data && !error) {
        const t = normalizeTemplates((data as any)?.session_templates);
        const norm = { ...(data as any), session_templates: t };
        setSession(norm as any);
      }

      setLoading(false);
    })();
  }, [id]);

  useEffect(() => {
    if (!session) return;

    setStages([]);
    setStagebarCycleSeconds(undefined);
    setStagebarStartTime("");

    const fallbackStart = String(session?.start_time || session?.created_at || new Date().toISOString());

    let parsed: unknown = safeParseJson(session.schedule);

    if (!parsed) {
      const t = parse50505(session.schedule);
      if (t) {
        parsed = {
          kind: "infinite_room",
          timer: { phases: { focus: t.focus, break: t.break, intentions: t.intentions } },
          anchor_ts: session?.start_time || session?.created_at || fallbackStart,
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
          const inferredType: Stage["type"] = rawType ? inferStageTypeFromLabel(rawType) : inferStageTypeFromLabel(rawName);

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

          const durationSeconds = seconds > 0 ? seconds : minutes > 0 ? minutes * 60 : 0;
          const displayMinutes = minutes > 0 ? minutes : seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;

          if (durationSeconds <= 0 || displayMinutes <= 0) return null;

          const color = str((blk as any).color) || STAGE_COLORS[inferredType] || "#F63135";
          return { name: rawName, duration: displayMinutes, color, type: inferredType, durationSeconds };
        })
        .filter((x): x is Stage => !!x);

      setStages(formatted);
      setStagebarStartTime(String(session.start_time || fallbackStart));
      setStagebarCycleSeconds(undefined);
    }

    const isInfiniteScheduleObject =
      isRecord(parsed) &&
      (str((parsed as any).kind).toLowerCase().includes("infinite") ||
        (isRecord((parsed as any).timer) && (((parsed as any).timer as any).phases || ((parsed as any).timer as any).segments)) ||
        !!(parsed as any).phases ||
        !!(parsed as any).segments);

    if (isInfiniteScheduleObject && isRecord(parsed)) {
      const timer = isRecord((parsed as any).timer) ? ((parsed as any).timer as any) : null;

      const phasesRaw = (timer?.phases ?? timer?.segments ?? (parsed as any).phases ?? (parsed as any).segments) ?? null;
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
                : "Intentions"
              : type === "break"
                ? "Break"
                : type === "intro"
                  ? "Intro"
                  : type === "outro"
                    ? "Outro"
                    : rawPhaseName || "Stage";

        const seconds = Number(p.seconds) || 0;
        const minutes = Math.max(1, Math.round(seconds / 60));

        return { name: displayName2, duration: minutes, color: STAGE_COLORS[type] || "#F63135", type, durationSeconds: seconds };
      });

      setStages(formatted);

      const anchor = String(
        str((parsed as any).anchor_ts) ||
        str((parsed as any).anchorTs) ||
        str(session?.start_time) ||
        fallbackStart
      );
      setStagebarStartTime(anchor);

      const sumSeconds = phases.reduce((acc, p) => acc + (Number(p.seconds) || 0), 0);
      const timerCycle = timer && isRecord(timer) ? num((timer as any).cycle_seconds) || num((timer as any).cycleSeconds) : 0;

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

  const applySessionSnapshot = React.useCallback((nextSession: SessionRow | any) => {
    if (!nextSession) return;

    setSession(nextSession);

    let parsed: unknown = safeParseJson(nextSession.schedule);

    if (!parsed) {
      const t = parse50505(nextSession.schedule);
      if (t) {
        parsed = {
          kind: "infinite_room",
          timer: { phases: { focus: t.focus, break: t.break, intentions: t.intentions } },
          anchor_ts: nextSession?.start_time || nextSession?.created_at || new Date().toISOString(),
        };
      }
    }

    setStages([]);
    setStagebarCycleSeconds(undefined);
    setStagebarStartTime("");

    const fallbackStart = String(
      nextSession?.start_time || nextSession?.created_at || new Date().toISOString()
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

          const durationSeconds = seconds > 0 ? seconds : minutes > 0 ? minutes * 60 : 0;
          const displayMinutes =
            minutes > 0 ? minutes : seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;

          if (durationSeconds <= 0 || displayMinutes <= 0) return null;

          const color = str((blk as any).color) || STAGE_COLORS[inferredType] || "#F63135";
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
      (str((parsed as any).kind).toLowerCase().includes("infinite") ||
        (isRecord((parsed as any).timer) &&
          (((parsed as any).timer as any).phases || ((parsed as any).timer as any).segments)) ||
        !!(parsed as any).phases ||
        !!(parsed as any).segments);

    if (isInfiniteScheduleObject && isRecord(parsed)) {
      const timer = isRecord((parsed as any).timer) ? ((parsed as any).timer as any) : null;

      const phasesRaw =
        (timer?.phases ?? timer?.segments ?? (parsed as any).phases ?? (parsed as any).segments) ?? null;
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
                : "Intentions"
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
        fallbackStart
      );
      setStagebarStartTime(anchor);

      const sumSeconds = phases.reduce((acc, p) => acc + (Number(p.seconds) || 0), 0);
      const timerCycle =
        timer && isRecord(timer)
          ? num((timer as any).cycle_seconds) || num((timer as any).cycleSeconds)
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
  }, []);

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
        }
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
      (Number(stagebarCycleSeconds) || 0) > 0 ? Number(stagebarCycleSeconds) : Math.max(1, sumStageSeconds);

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
          setRemainingTime(`${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, "0")}`);
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
        if (stage?.type === "intro") startWelcomeLoop();
        else stopWelcomeLoop();

        prevStageRef.current = active;
        firstTickDoneRef.current = true;
        return;
      }

      if (prevStageRef.current !== active) {
        const prev = stages[prevStageRef.current];
        const prevType = prev?.type;
        const newType = stage?.type;

        if (prevType === "break" && newType !== "break") playOneShot(BREAK_END_SOUND);

        if (newType === "intro") {
          startWelcomeLoop();
        } else {
          stopWelcomeLoop();
          if (newType) {
            const t = inferStageTypeFromLabel(String(newType));
            const sound = STAGE_SOUND_MAP[t];
            if (sound) playOneShot(sound);
          }
        }

        prevStageRef.current = active;
      }

      if (stage?.type !== "intro" && welcomeLoopRef.current) stopWelcomeLoop();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [stagebarStartTime, stages, isSilentRoom, isInfiniteRoom, stagebarCycleSeconds]);

  useEffect(() => {
    (async () => {
      setAuthGateStatus("checking");
      setAuthReady(false);

      try {
        const { data: ud } = await supabase.auth.getUser();
        const u = ud.user;

        if (!u) {
          setAuthUserId(null);
          accessTokenRef.current = "";
          setAuthGateStatus("redirecting");
          setAuthReady(true);

          const redirect = encodeURIComponent(location.pathname + location.search);
          navigate(`/login?redirect=${redirect}`, { replace: true });
          return;
        }

        setAuthUserId(u.id || null);

        try {
          const { data: sd } = await supabase.auth.getSession();
          accessTokenRef.current = String(sd.session?.access_token || "").trim();
        } catch {
          accessTokenRef.current = "";
        }

        setAuthGateStatus("authed");
        setAuthReady(true);
      } catch {
        setAuthUserId(null);
        accessTokenRef.current = "";
        setAuthGateStatus("redirecting");
        setAuthReady(true);

        const redirect = encodeURIComponent(location.pathname + location.search);
        navigate(`/login?redirect=${redirect}`, { replace: true });
      }
    })();
  }, [navigate, location.pathname, location.search]);

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
        const avatar = await resolveAvatarUrlFromProfilesField(String((data as any)?.avatar_url || ""));

        if (nm) {
          setUserName(nm);
          setDisplayName((prev) => String(prev || "").trim() || nm);
          setPrejoin((prev) => {
            if (String(prev.displayName || "").trim()) return prev;
            return { ...prev, displayName: nm };
          });
          prejoinRef.current = {
            ...prejoinRef.current,
            displayName: String(prejoinRef.current.displayName || "").trim() || nm,
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
    setTimelineDraftBlocks(parsedBlocks.length ? parsedBlocks : makeDefaultTimelineBlocks());
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
      const nextSchedule = timelineBlocksToSchedulePayload(timelineDraftBlocks, {
        preserveInfinite: isInfiniteRoom,
        anchorTs:
          stagebarStartTime ||
          session?.start_time ||
          session?.created_at ||
          new Date().toISOString(),
      });

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

  const loadBrowserDevices = useCallback(async (opts?: { preserveSelection?: boolean }) => {
    console.time("lk:loadBrowserDevices");

    try {
      setDeviceError("");
      setAudioOutputSupported(canUseSetSinkId());

      if (!navigator.mediaDevices?.enumerateDevices) {
        setDeviceError("This browser does not support media device enumeration.");
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
        videoInputs
      );

      const nextAudioInputId = pickExistingDeviceId(
        opts?.preserveSelection
          ? selectedAudioInputId || prejoinRef.current.audioInputId
          : prejoinRef.current.audioInputId,
        audioInputs
      );

      const nextAudioOutputId = canUseSetSinkId()
        ? pickExistingDeviceId(
          opts?.preserveSelection
            ? selectedAudioOutputId || prejoinRef.current.audioOutputId
            : prejoinRef.current.audioOutputId,
          audioOutputs,
          "default"
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
  }, [
    selectedVideoInputId,
    selectedAudioInputId,
    selectedAudioOutputId,
    isMobileQuery,
    isTabletQuery,
  ]);

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
      navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
    };
  }, [loadBrowserDevices]);

  // FX
  const [videoFxMode, setVideoFxMode] = useState<FxMode>("off");
  const [bgImageUrl, setBgImageUrl] = useState<string>(DEFAULT_BG_DATA_URL);
  const [fxError, setFxError] = useState<string>("");
  const [fxApplying, setFxApplying] = useState(false);
  const [fxStatusText, setFxStatusText] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPreviewVersion, setSettingsPreviewVersion] = useState(0);
  const [blurStrength, setBlurStrength] = useState<number>(12);
  const [connected, setConnected] = useState(false);

  const [colorCorrection, setColorCorrection] = useState<ColorCorrectionState>({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    warmth: 0,
  });

  const localVideoFilterCss = useMemo(() => buildColorCorrectionFilter(colorCorrection), [colorCorrection]);

  const uploadedBgUrlRef = useRef<string | null>(null);
  const fxOpIdRef = useRef<number>(0);
  const lastPrejoinFxSignatureRef = useRef<string>("");

  const ensureFxSupportedOrThrow = () => {
    if (!supportsBackgroundProcessors()) throw new Error("Background processors are not supported in this browser/device");
    try {
      supportsModernBackgroundProcessors();
    } catch { }
  };

  const makeProcessorForMode = (mode: FxMode, blur: number, bgUrl: string): any | null => {
    if (mode === "off") return null;
    if (mode === "blur") return BackgroundBlur(Math.max(1, Math.min(30, Math.round(blur || 12)))) as any;
    return VirtualBackground(bgUrl || DEFAULT_BG_DATA_URL) as any;
  };

  const stopAnyProcessor = async (track: LocalVideoTrack) => {
    try {
      await (track as any).stopProcessor?.(true);
    } catch { }
  };

  const safeApplyProcessor = async (track: LocalVideoTrack, mode: FxMode, blur: number, bgUrl: string) => {
    ensureFxSupportedOrThrow();

    const opId = fxOpIdRef.current + 1;
    fxOpIdRef.current = opId;

    await stopAnyProcessor(track);
    if (fxOpIdRef.current !== opId) return;

    const proc = makeProcessorForMode(mode, blur, bgUrl);
    if (!proc) return;

    await (track as any).setProcessor(proc, true);
  };

  // pre-join helpers
  const cleanupPrejoinPreparedVideoTrack = async () => {
    const t = prejoinPreparedVideoTrackRef.current as any;
    prejoinPreparedVideoTrackRef.current = null;
    lastPrejoinFxSignatureRef.current = "";

    if (!t) return;

    try {
      await stopAnyProcessor(t);
    } catch { }

    try {
      t.stop?.();
    } catch { }

    setPrejoinPreviewVersion((v) => v + 1);
  };

  const createPrejoinPreparedVideoTrack = async (opts?: { force?: boolean }) => {
    const pj = prejoinRef.current;
    const current = prejoinPreparedVideoTrackRef.current as any;

    if (!pj.videoEnabled) {
      if (current) {
        await cleanupPrejoinPreparedVideoTrack();
      }
      return null;
    }

    if (!opts?.force && current) {
      const currentDeviceId =
        String(current?.mediaStreamTrack?.getSettings?.().deviceId || "").trim();
      const wantedDeviceId = String(pj.videoInputId || "").trim();

      if (!wantedDeviceId || currentDeviceId === wantedDeviceId) {
        return current;
      }
    }

    await cleanupPrejoinPreparedVideoTrack();

    const isMobileLike = isMobileQuery || isTabletQuery || deviceTier === "weak";
    const wantedVideoDeviceId = String(pj.videoInputId || "").trim();

    try {
      const track = await createLocalVideoTrack({
        deviceId:
          !isMobileLike && wantedVideoDeviceId
            ? wantedVideoDeviceId
            : undefined,
        resolution: {
          width: isMobileLike ? 320 : capturePreset.width,
          height: isMobileLike ? 180 : capturePreset.height,
        },
        frameRate: isMobileLike ? 8 : capturePreset.fps,
      } as any);

      prejoinPreparedVideoTrackRef.current = track;
      setPrejoinPreviewVersion((v) => v + 1);
      return track;
    } catch (e: any) {
      console.warn("createPrejoinPreparedVideoTrack failed:", e);

      if (isMobileLike) {
        setDeviceError(String(e?.message || e || "camera_preview_failed"));
        return null;
      }

      throw e;
    }
  };

  const applyPrejoinVideoFx = async (mode: FxMode) => {
    setFxError("");
    setFxApplying(true);
    setFxStatusText("");

    try {
      const pj = prejoinRef.current;
      if (deviceTier === "weak") {
        throw new Error("Background FX are disabled on weak/mobile devices for stability");
      }
      if (!pj.videoEnabled) throw new Error("Turn camera on in pre-join first");

      let track = prejoinPreparedVideoTrackRef.current;
      if (!track) track = await createPrejoinPreparedVideoTrack();
      if (!track) throw new Error("Pre-join camera track is not ready");
      const currentTrackId = String((track as any)?.mediaStreamTrack?.id || "").trim();
      if (!currentTrackId) {
        throw new Error("Pre-join camera track id is missing");
      }

      const sig = `${mode}|${blurStrength}|${bgImageUrl}|${String(
        (track as any)?.mediaStreamTrack?.id || ""
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
            : "Virtual background applied"
      );
      setPrejoinPreviewVersion((v) => v + 1);
    } catch (e: any) {
      console.error("applyPrejoinVideoFx failed:", e);
      setFxError(String(e?.message || e || "prejoin_video_fx_failed"));
    } finally {
      setFxApplying(false);
    }
  };

  const initPrejoinPreview = async (opts?: { delayedForWeak?: boolean; forceTrack?: boolean }) => {
    if (prejoinPreviewInitInFlightRef.current) return;
    prejoinPreviewInitInFlightRef.current = true;

    try {
      const pj = prejoinRef.current;

      if (!pj.videoEnabled) return;

      if (opts?.delayedForWeak && deviceTier === "weak") {
        await delay(WEAK_DEVICE_PREVIEW_INIT_DELAY_MS);

        if (!prejoinOpen) return;
        if (!prejoinRef.current.videoEnabled) return;
      }

      await createPrejoinPreparedVideoTrack({ force: !!opts?.forceTrack });

      if (deviceTier !== "weak" && videoFxMode !== "off") {
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
        if (isMobileQuery || isTabletQuery || deviceTier === "weak") return;

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
  }, [loading, session, sessionId, joinRequested, loadBrowserDevices, deviceTier]);

  useEffect(() => {
    if (!prejoinOpen) return;
    if (isMobileQuery || isTabletQuery || deviceTier === "weak") return;

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
  }, [prejoin.videoInputId, prejoinOpen, deviceTier, isMobileQuery, isTabletQuery]);

  useEffect(() => {
    if (!prejoinOpen) return;

    if (!prejoin.videoEnabled) {
      cleanupPrejoinPreparedVideoTrack().catch(() => { });
      return;
    }

    if (isMobileQuery || isTabletQuery || deviceTier === "weak") return;

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
  }, [prejoin.videoEnabled, prejoinOpen, deviceTier, isMobileQuery, isTabletQuery]);

  useEffect(() => {
    if (!settingsOpen) return;
    if (!prejoinOpen) return;
    if (!prejoinRef.current.videoEnabled) return;
    if (isMobileQuery || isTabletQuery || deviceTier === "weak") return;

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
    if (deviceTier === "weak") return;
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
    deviceTier,
  ]);

  const isHost = useMemo(() => {
    if (!authUserId) return false;
    const hostId = (session as any)?.host_profile?.id || (session as any)?.host_id;
    return !!hostId && String(hostId) === String(authUserId);
  }, [authUserId, session]);

  const isSelfModerator = useMemo(() => {
    if (!authUserId) return false;
    if (isHost) return true;
    return moderatorUserIds.includes(String(authUserId).toLowerCase());
  }, [authUserId, isHost, moderatorUserIds]);

  const loadModerators = async (sessionId: string) => {
    setRolesError("");
    setRolesLoading(true);
    try {
      const { data, error } = await supabase
        .from("session_role_assignments")
        .select("user_id, role")
        .eq("session_id", sessionId)
        .eq("role", "moderator");
      if (error) throw error;
      const ids = uniqStrings((data || []).map((r: any) => String(r?.user_id || "")));
      setModeratorUserIds(ids);
    } catch (e: any) {
      console.error("loadModerators failed:", e);
      setRolesError(String(e?.message || e || "failed_to_load_roles"));
      setModeratorUserIds([]);
    } finally {
      setRolesLoading(false);
    }
  };

  useEffect(() => {
    if (!session?.id) return;
    loadModerators(session.id).catch(() => { });
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id) return;

    const ch = supabase
      .channel(`session-role-assignments:${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_role_assignments",
          filter: `session_id=eq.${session.id}`,
        },
        () => {
          void loadModerators(session.id);
        }
      )
      .subscribe();

    return () => {
      safeRemoveRealtimeChannel(ch);
    };
  }, [session?.id]);

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
      const { error } = await supabase.from("session_role_assignments").insert(payload as any);
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

  // LiveKit env
  const lkServerUrl = String((import.meta as any)?.env?.VITE_LIVEKIT_URL || "").trim();
  const tokenEndpoint = String((import.meta as any)?.env?.VITE_LIVEKIT_TOKEN_ENDPOINT || "/api/livekit/token").trim();
  const adminEndpoint = String((import.meta as any)?.env?.VITE_LIVEKIT_ADMIN_ENDPOINT || "/api/livekit/admin").trim();

  // token
  const [lkToken, setLkToken] = useState<string>("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string>("");

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
      if (tabPresenceChannelRef.current) tabPresenceChannelRef.current.close?.();
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
    const onBeforeUnload = () => releaseTabPresence();
    const onPageHide = () => releaseTabPresence();
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  useEffect(() => {
    const onBeforeUnload = () => {
      void leaveAttendanceOnce({ keepalive: true });
    };

    const onPageHide = () => {
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
      const fallbackAccessToken = String(data.session?.access_token || "").trim();

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
      const { error } = await supabase
        .from("session_attendance")
        .upsert(
          {
            session_id: session.id,
            user_id: authUserId,
            joined_at: nowIso,
            left_at: null,
            last_seen_at: nowIso,
          },
          { onConflict: "session_id,user_id" }
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

      const supabaseUrl = String((import.meta as any).env.VITE_SUPABASE_URL || "").trim();
      const anonKey = String((import.meta as any).env.VITE_SUPABASE_ANON_KEY || "").trim();
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
      Math.min(6, Number((import.meta as any)?.env?.VITE_LIVEKIT_MAX_TABS || LK_MAX_TABS_DEFAULT) || LK_MAX_TABS_DEFAULT)
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
        if (tabPresenceChannelRef.current) tabPresenceChannelRef.current.close?.();
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
      const nameToUse = (pj.displayName || displayName || userName || "User").trim() || "User";
      const roomName = safeRoomName(`session-${session.id}`);

      const baseUser = safeIdentity(
        (authUserId && looksLikeUuid(authUserId) ? authUserId : authUserId || nameToUse) as any
      );
      baseUserIdRef.current = baseUser;

      const identity = safeIdentity(`${baseUser}--${tabId}`);
      livekitIdentityRef.current = identity;

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

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        const msg = `Token endpoint error: ${res.status} ${t || ""}`.trim();
        console.error(msg);
        setTokenError(msg);
        setTokenLoading(false);
        return;
      }

      const json = (await res.json()) as { token?: string };
      const tok = String(json.token || "");
      if (!tok) {
        setTokenError("Token endpoint returned empty token");
        setTokenLoading(false);
        return;
      }

      setLkToken(tok);
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
      if (lkToken) return;
      await requestToken();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, joinRequested, authReady, isHost, moderatorUserIds.join("|")]);
  useEffect(() => {
    if (!lkToken) return;
    setPrejoinOpen(false);
  }, [lkToken]);

  // ---- livekit room
  const roomRef = useRef<Room | null>(null);
  const [roomState, setRoomState] = useState<Room | null>(null);
  const [clientError, setClientError] = useState<string>("");
  const [mediaWarning, setMediaWarning] = useState<string>("");
  
  const connectInFlightRef = useRef(false);
  const connectAttemptIdRef = useRef(0);

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenShareOn, setScreenShareOn] = useState(false);
  const [remoteAudioRecoveryTick, setRemoteAudioRecoveryTick] = useState(0);
  const [pipMode, setPipMode] = useState<PiPMode>("focus");

  function getSettingsPreviewTrack(): LocalVideoTrack | null {
    if (prejoinPreparedVideoTrackRef.current) {
      return prejoinPreparedVideoTrackRef.current;
    }

    try {
      const r = roomRef.current;
      if (!r) return null;

      const pubs = Array.from(r.localParticipant.videoTrackPublications.values());
      const camPub = pubs.find((p: any) => p?.source === Track.Source.Camera);

      return (camPub?.track as LocalVideoTrack | null) || null;
    } catch {
      return null;
    }
  }

  const [tiles, setTiles] = useState<TileModel[]>([]);
  const [screenShareTiles, setScreenShareTiles] = useState<TileModel[]>([]);
  const [adminBusyKey, setAdminBusyKey] = useState<string>("");

  // hide / pin
  const [hiddenTileIds, setHiddenTileIds] = useState<Record<string, boolean>>({});
  const [pinnedTileId, setPinnedTileId] = useState<string | null>(null);

  // per participant volume
  const [volumePctByParticipantKey, setVolumePctByParticipantKey] = useState<Record<string, number>>({});
  const [defaultRemoteVolumePct, setDefaultRemoteVolumePct] = useState<number>(() => {
    try {
      const raw = Number(localStorage.getItem("mysession_lk_default_remote_volume_pct") || "125");
      if (!Number.isFinite(raw)) return 125;
      return Math.max(25, Math.min(300, Math.round(raw)));
    } catch {
      return 125;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "mysession_lk_default_remote_volume_pct",
        String(defaultRemoteVolumePct)
      );
    } catch { }
  }, [defaultRemoteVolumePct]);

  // chat unread
  const [unreadChat, setUnreadChat] = useState<number>(0);
  const chatVisibleRef = useRef<boolean>(false);
  const lastChatReadAtRef = useRef<number>(0);

  // reactions
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const reactionIdRef = useRef<number>(0);
  const reactionsChannelRef = useRef<any>(null);

  // edit name modal
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const pipWindowRef = useRef<Window | null>(null);
  const [pipMountEl, setPipMountEl] = useState<HTMLElement | null>(null);
  const [pipOpen, setPipOpen] = useState(false);
  
  const documentPipSupported =
    typeof window !== "undefined" &&
    typeof (window as WindowWithDocumentPiP).documentPictureInPicture !== "undefined";

  const pipSupported = typeof window !== "undefined";

  useEffect(() => {
    setOpenTileAdminMenuId((prev) => (prev && tiles.some((t) => t.id === prev) ? prev : null));
  }, [tiles]);

  const participantsCount = useMemo(() => {
    const r = roomRef.current;
    if (!r) return 0;
    return 1 + r.remoteParticipants.size;
  }, [roomState, tiles]);

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
      setVolumePctByParticipantKey(parsed && typeof parsed === "object" ? parsed : {});
    } catch {
      setVolumePctByParticipantKey({});
    }
  }, [volumeStorageKey]);

  useEffect(() => {
    if (!volumeStorageKey) return;
    try {
      localStorage.setItem(volumeStorageKey, JSON.stringify(volumePctByParticipantKey));
    } catch { }
  }, [volumeStorageKey, volumePctByParticipantKey]);

  const resetAllParticipantVolumesToDefault = useCallback(() => {
    setVolumePctByParticipantKey({});
  }, []);

  const applyDefaultRemoteVolumePreset = useCallback((pct: number) => {
    setDefaultRemoteVolumePct(clamp(Math.round(pct), 25, 300));
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
      .on("broadcast", { event: "participant_kicked" }, async (payload: any) => {
        const p = (payload?.payload || payload || {}) as KickBroadcastPayload;

        const matched = matchesKickPayload({
          payload: p,
          localIdentity: livekitIdentityRef.current,
          authUserId: String(authUserId || ""),
          baseUserId: String(baseUserIdRef.current || ""),
        });

        if (!matched) return;
        await handleKickedOut(p);
      })
      .subscribe();

    kickEventChannelRef.current = ch;

    return () => {
      if (kickEventChannelRef.current === ch) kickEventChannelRef.current = null;
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
        .filter((x) => looksLikeUuid(x))
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
          const avatar = await resolveAvatarUrlFromProfilesField(String(r?.avatar_url || ""));
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
    const p = Array.from(r.remoteParticipants.values()).find((rp) => rp.sid === tileId);
    if (!p) return;

    try {
      const micPub = Array.from(p.audioTrackPublications.values()).find(
        (x: any) => x.source === Track.Source.Microphone
      ) as any;
      const tr = micPub?.track as any;
      const vol = clamp(pct, 0, 100) / 100;
      if (tr?.setVolume) tr.setVolume(vol);
      else if (typeof (tr as any)?.volume === "number") (tr as any).volume = vol;
    } catch { }
  };

  const setParticipantVolumePct = (tile: TileModel, pct: number) => {
    const v = clamp(Math.round(pct), 0, 100);
    const key = getParticipantVolumeKey(tile);

    setVolumePctByParticipantKey((prev) => ({ ...prev, [key]: v }));
    applyVolumeToRemoteParticipant(tile.id, v);
  };

  const getLocalCameraPublication = () => {
    const r = roomRef.current;
    if (!r) return null;
    const lp = r.localParticipant;
    const pub = Array.from(lp.videoTrackPublications.values()).find(
      (p: LocalTrackPublication) => p.source === Track.Source.Camera
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
      (p: any) => p.source === Track.Source.Microphone
    );
    return pub || null;
  };

  const rebuildTiles = () => {
    const room = roomRef.current;
    if (!room) return;

    const next: TileModel[] = [];
    const lp = room.localParticipant;

    const localCamPub = Array.from(lp.videoTrackPublications.values()).find(
      (p) => p.source === Track.Source.Camera
    ) as any;
    const localMicPub = Array.from(lp.audioTrackPublications.values()).find(
      (p) => p.source === Track.Source.Microphone
    ) as any;

    const localCamTrackRaw = (localCamPub?.track as any) || undefined;

    const localIdentity = String(lp.identity || livekitIdentityRef.current || "");
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

    const localCamTrack = localCamActuallyVisible ? localCamTrackRaw : undefined;

    setMicOn((prev) => {
      const nextOn = !localMicMuted;
      return prev === nextOn ? prev : nextOn;
    });
    setCamOn((prev) => {
      const nextOn = localCamPubExists && localCamPubHasTrack && !localCamPubMuted;
      return prev === nextOn ? prev : nextOn;
    });

    next.push({
      id: "local",
      kind: "camera",
      label:
        String(
          localRoomDisplayNameOverrideRef.current ||
          displayName ||
          prejoinRef.current.displayName ||
          userName ||
          "You"
        ).trim() || "You",
      isLocal: true,
      videoTrack: localCamTrack,
      participantIdentity: localIdentity || undefined,
      participantUserId: localUserId || undefined,
      micMuted: localMicMuted,
      camPubExists: localCamPubExists,
      camPubHasTrack: localCamPubHasTrack,
      camPubMuted: localCamPubMuted,
    });

    room.remoteParticipants.forEach((rp: RemoteParticipant) => {
      const allVideoPubs = Array.from(rp.videoTrackPublications.values()) as RemoteTrackPublication[];
      const allAudioPubs = Array.from(rp.audioTrackPublications.values()) as RemoteTrackPublication[];

      const camPub = allVideoPubs.find((p: any) => p.source === Track.Source.Camera) as any;
      const micPub = allAudioPubs.find((p: any) => p.source === Track.Source.Microphone) as any;

      const remoteCamPubExists = !!camPub;
      const remoteCamPubHasTrack = !!camPub?.track;
      const remoteCamPubMuted = camPub ? !!camPub.isMuted : true;

      const remoteCamActuallyVisible =
        remoteCamPubExists && remoteCamPubHasTrack && !remoteCamPubMuted;

      const vt = remoteCamActuallyVisible ? ((camPub?.track as any) || undefined) : undefined;

      const exactIdentity = String(rp.identity || "");
      const baseUserId = extractBaseUserIdFromIdentity(exactIdentity);
      const prof = looksLikeUuid(baseUserId)
        ? profilesById[String(baseUserId).toLowerCase()]
        : undefined;

      const nameFromProfile = String(prof?.full_name || "").trim();
      const nm = (nameFromProfile || rp.name || rp.identity || "Guest").trim() || "Guest";

      const tileId = rp.sid;
      const remoteMicMuted = micPub ? !!(micPub as any).isMuted : true;

      next.push({
        id: tileId,
        kind: "camera",
        label: nm,
        isLocal: false,
        videoTrack: vt,
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

      const pct = Number(volumePctByParticipantKey[volumeKey] ?? 100);
      if (Number.isFinite(pct)) applyVolumeToRemoteParticipant(tileId, pct);
    });

    setTiles(next);

    const nextScreenShares = buildScreenShareTiles({
      room,
      authUserId,
      displayName,
      userName,
      profilesById,
    }) as TileModel[];

    setScreenShareTiles(nextScreenShares);
    setScreenShareOn(nextScreenShares.some((x) => x.isLocal));
  };

  const disconnectRoom = async (opts?: {
    skipNavigate?: boolean;
    preserveKickNotice?: boolean;
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
      setJoinRequested(false);
      connectInFlightRef.current = false;

      if (!opts?.preserveKickNotice) {
        setSystemNotice((prev) => ({ ...prev, open: false }));
      }

      await leaveAttendanceOnce({ keepalive: false });
      releaseTabPresence();
      await closePictureInPicture().catch(() => { });
    }
  };

  const syncLiveAudioInput = async (deviceId: string) => {
    const useId = pickExistingDeviceId(String(deviceId || ""), devices.audioInputs);

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
      setClientError(String((e as any)?.message || e || "audio_input_switch_failed"));
    }
  };

  const syncLiveVideoInput = async (deviceId: string) => {
    const useId = pickExistingDeviceId(String(deviceId || ""), devices.videoInputs);

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
        resolution: { width: capturePreset.width, height: capturePreset.height },
        frameRate: capturePreset.fps,
      } as any);

      if (deviceTier !== "weak" && videoFxMode !== "off") {
        try {
          await safeApplyProcessor(nextTrack, videoFxMode, blurStrength, bgImageUrl);
        } catch (e) {
          console.warn("syncLiveVideoInput fx apply failed:", e);
        }
      }

      await r.localParticipant.publishTrack(nextTrack, { source: Track.Source.Camera } as any);
      scheduleRebuildTiles();
    } catch (e) {
      console.error("syncLiveVideoInput failed:", e);
      setMediaWarning(
        normalizeMediaWarningMessage((e as any)?.message || e || "video_input_switch_failed")
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
        deviceId: selectedAudioInputId || prejoinRef.current.audioInputId || undefined,
        echoCancellation: next.echoCancellation,
        noiseSuppression: next.noiseSuppression,
        autoGainControl: next.autoGainControl,
      } as any);
      scheduleRebuildTiles();
    } catch (e) {
      console.error("syncLiveAudioProcessing failed:", e);
      setMediaWarning(
        normalizeMediaWarningMessage((e as any)?.message || e || "audio_processing_failed")
      );
    }
  };

  const connectRoom = async () => {
    if (!lkServerUrl || !lkToken) return;
    if (connectInFlightRef.current) return;

    connectInFlightRef.current = true;
    const attemptId = connectAttemptIdRef.current + 1;
    connectAttemptIdRef.current = attemptId;

    let connectedToRoom = false;

    const failAfter = window.setTimeout(() => {
      if (connectAttemptIdRef.current !== attemptId) return;
      setClientError("Connecting to LiveKit timed out. Please try again.");
      void disconnectRoom();
      setPrejoinOpen(true);
      setJoinRequested(false);
    }, 15000);

    setClientError("");
    setFxError("");
    setMediaWarning("");

    await disconnectRoom();
  
    try {
      const pj = prejoinRef.current;

      const r = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      roomRef.current = r;
      setRoomState(r);

      const refresh = () => scheduleRebuildTiles();

      r.on(RoomEvent.Connected, () => {
        setConnected(true);
        refresh();
      });

      r.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setTiles([]);
        setScreenShareTiles([]);
        setOpenTileAdminMenuId(null);

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

      r.on(RoomEvent.Reconnected, refresh);
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
      r.on(RoomEvent.LocalTrackPublished as any, refresh as any);
      r.on(RoomEvent.LocalTrackUnpublished as any, refresh as any);

      await r.connect(lkServerUrl, lkToken, { autoSubscribe: true });
      connectedToRoom = true;

      await r.localParticipant.setCameraEnabled(false);
      setCamOn(false);

      await r.localParticipant.setMicrophoneEnabled(false);
      setMicOn(false);

      kickedBySignalRef.current = false;

      leaveOnceRef.current = false;
      leavePromiseRef.current = null;
      await attendanceJoin();
      startAttendanceHeartbeat();

      // mic
      await r.localParticipant.setMicrophoneEnabled(false);
      setMicOn(false);

      const shouldAutoStartCameraOnJoin =
        pj.videoEnabled &&
        !isMobileQuery &&
        !isTabletQuery &&
        deviceTier !== "weak";
        
      // cam
      let usedPrepared = false;

      if (shouldAutoStartCameraOnJoin) {
        const fxAllowed = videoFxMode !== "off";
        let prepared = prejoinPreparedVideoTrackRef.current;

        if (!prepared) {
          prepared = await createLocalVideoTrack({
            deviceId: pj.videoInputId || selectedVideoInputId || undefined,
            resolution: { width: capturePreset.width, height: capturePreset.height },
            frameRate: capturePreset.fps,
          } as any);

          if (prepared && fxAllowed) {
            try {
              await safeApplyProcessor(prepared, videoFxMode, blurStrength, bgImageUrl);
            } catch (e) {
              console.warn("apply fx before publish failed:", e);
            }
          }
        }

        if (prepared) {
          await r.localParticipant.publishTrack(prepared, { source: Track.Source.Camera } as any);
          usedPrepared = true;
          prejoinPreparedVideoTrackRef.current = null;
          setCamOn(true);
        } else {
          await r.localParticipant.setCameraEnabled(false);
          setCamOn(false);
        }
      } else {
        await r.localParticipant.setCameraEnabled(false);
        setCamOn(false);
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
        await disconnectRoom();
      } else {
        setMediaWarning(normalizeMediaWarningMessage(msg));
        console.warn("Media step failed after room connect, keeping user in room");
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
    const r = roomRef.current;
    if (!r) return;

    try {
      const pub: any = getLocalMicPublication();
      if (pub) {
        const next = !!pub.isMuted;
        if (next) await pub.unmute?.();
        else await pub.mute?.();

        scheduleRebuildTiles();
        setRemoteAudioRecoveryTick((v) => v + 1);
        return;
      }

      const next = !micOn;
      await r.localParticipant.setMicrophoneEnabled(next, {
        deviceId: selectedAudioInputId || prejoinRef.current.audioInputId || undefined,
        echoCancellation: echoCancellationEnabled,
        noiseSuppression: noiseSuppressionEnabled,
        autoGainControl: autoGainControlEnabled,
      } as any);

      scheduleRebuildTiles();
      setRemoteAudioRecoveryTick((v) => v + 1);
    } catch (e) {
      console.error("toggleMic error:", e);
    }
  };

  // toggle cam without recreating track
  const toggleCam = async () => {
    const r = roomRef.current;
    if (!r) return;

    try {
      const pub: any = getLocalCameraPublication();

      if (pub) {
        const nextOn = !!pub.isMuted;

        setCamOn(nextOn);

        if (nextOn) {
          await pub.unmute?.();
        } else {
          await pub.mute?.();
        }

        scheduleRebuildTiles();

        window.setTimeout(() => {
          scheduleRebuildTiles();
        }, 120);

        return;
      }

      if (camOn) return;

      const isMobileLike = isMobileQuery || isTabletQuery || deviceTier === "weak";

      const shouldForceVideoDeviceId =
        !isMobileLike &&
        !!String(selectedVideoInputId || prejoinRef.current.videoInputId || "").trim();

      const nextTrack = await createLocalVideoTrack({
        deviceId: shouldForceVideoDeviceId
          ? selectedVideoInputId || prejoinRef.current.videoInputId || undefined
          : undefined,
        resolution: {
          width: isMobileLike ? 320 : capturePreset.width,
          height: isMobileLike ? 180 : capturePreset.height,
        },
        frameRate: isMobileLike ? 8 : capturePreset.fps,
      } as any);

      if (deviceTier !== "weak" && videoFxMode !== "off") {
        try {
          await safeApplyProcessor(nextTrack, videoFxMode, blurStrength, bgImageUrl);
        } catch (e) {
          console.warn("toggleCam fx apply failed:", e);
        }
      }

      await r.localParticipant.publishTrack(nextTrack, { source: Track.Source.Camera } as any);
      setCamOn(true);

      scheduleRebuildTiles();

      window.setTimeout(() => {
        scheduleRebuildTiles();
      }, 120);
    } catch (e) {
      console.error("toggleCam error:", e);
    }
  };

  const createRoomScreenshot = async () => {
    const root = videoWrapRef.current;
    if (!root) throw new Error("Video container is not ready");

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1280, root.clientWidth || 1280)}" height="${Math.max(720, root.clientHeight || 720)}">
        <rect width="100%" height="100%" fill="#0B1220" />
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
        width: 480,
        height: 320,
        preferInitialWindowPlacement: true,
      } as any);
    } else {
      pipWindow = window.open(
        "",
        "mysession-livekit-pip",
        "popup=yes,width=480,height=320,resizable=yes,scrollbars=no"
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
        ? "m-0 bg-[#050F1A] text-white overflow-hidden"
        : "m-0 bg-[#F6F7FB] text-[#0B1220] overflow-hidden";

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
      { once: true }
    );

    pipWindowRef.current = pipWindow;
    setPipMountEl(mount);
    setPipOpen(true);
  };

  useEffect(() => {
    const pipWindow = pipWindowRef.current;
    if (!pipWindow || !pipMountEl) return;

    try {
      pipWindow.document.documentElement.setAttribute("data-theme", theme);
      pipWindow.document.body.className =
        theme === "dark"
          ? "m-0 bg-[#050F1A] text-white overflow-hidden"
          : "m-0 bg-[#F6F7FB] text-[#0B1220] overflow-hidden";
    } catch { }
  }, [theme, pipMountEl]);

  useEffect(() => {
    if (connected) return;
    if (!pipOpen) return;

    closePictureInPicture().catch(() => { });
  }, [connected, pipOpen]);

  const toggleScreenShare = async () => {
    const r = roomRef.current;
    if (!r) return;
    try {
      const next = !screenShareOn;
      await (r.localParticipant as any).setScreenShareEnabled(next);
      setScreenShareOn(next);
      window.setTimeout(() => scheduleRebuildTiles(), 80);
    } catch (e) {
      console.error("toggleScreenShare error:", e);
    }
  };

  const leave = async () => {
    await disconnectRoom();
    navigate("/sessions", { replace: true });
  };

  // admin endpoint
  // admin endpoint
  const callAdmin = async (body: Record<string, unknown>) => {
    const res = await fetch(adminEndpoint, {
      method: "POST",
      headers: await buildAuthHeaders(),
      body: JSON.stringify({
        ...body,
        sessionId: session?.id,
        isHost,
        isModerator: !isHost && isSelfModerator,
      }),
    });

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
      })
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
      })
    );
  };

  const adminMuteRemoteTrack = async (
    tileId: string,
    participantIdentity: string,
    trackSid: string
  ) => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:${trackSid}:mute`;
    setAdminBusyKey(busyKey);

    optimisticMute(tileId);

    try {
      await callAdmin({
        action: "mute_track",
        roomName,
        participantIdentity,
        trackSid,
      });

      scheduleRebuildTiles();
    } catch (e: any) {
      console.error("mute mic failed:", e);
      alert(String(e?.message || e || "mute_failed"));
      scheduleRebuildTiles();
    } finally {
      setAdminBusyKey("");
    }
  };

  const adminTurnOffRemoteCamera = async (
    tileId: string,
    participantIdentity: string,
    trackSid: string
  ) => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:${trackSid}:camera-off`;
    setAdminBusyKey(busyKey);

    optimisticCameraOff(tileId);

    try {
      await callAdmin({
        action: "mute_track",
        roomName,
        participantIdentity,
        trackSid,
      });

      scheduleRebuildTiles();
    } catch (e: any) {
      console.error("turn camera off failed:", e);
      alert(String(e?.message || e || "camera_off_failed"));
      scheduleRebuildTiles();
    } finally {
      setAdminBusyKey("");
    }
  };

  const adminKickParticipant = async (
    participantIdentity: string,
    targetUserId?: string,
    targetLabel?: string
  ) => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:kick`;
    setAdminBusyKey(busyKey);

    try {
      const kickedByName = (displayName || userName || "Moderator").trim() || "Moderator";

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

        try {
          await channel.send({
            type: "broadcast",
            event: "participant_kicked",
            payload,
          });
          await delay(180);
        } catch (e) {
          console.warn("kick broadcast failed:", e);
        }
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
    } catch (e: any) {
      console.error("kick failed:", e);
      alert(String(e?.message || e || "kick_failed"));
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
            : "Virtual background applied"
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
  useEffect(() => {
    chatVisibleRef.current = rightPanelOpen && rightTab === "chat";
  }, [rightPanelOpen, rightTab]);

  const chatReadKey = useMemo(() => {
    return session?.id ? `mysession_chat_last_read_at:${session.id}` : "";
  }, [session?.id]);

  const markChatRead = (atMs?: number) => {
    if (!session?.id) return;

    const now = Number.isFinite(atMs as any) ? Number(atMs) : Date.now();
    lastChatReadAtRef.current = Math.max(lastChatReadAtRef.current || 0, now);

    setUnreadChat(0);

    try {
      if (chatReadKey) localStorage.setItem(chatReadKey, String(lastChatReadAtRef.current));
    } catch { }
  };

  useEffect(() => {
    if (rightPanelOpen && rightTab === "chat") markChatRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightPanelOpen, rightTab, session?.id]);

  useEffect(() => {
    if (!session?.id) return;
    if (!authUserId) return;

    let cancelled = false;

    (async () => {
      let lastRead = 0;
      try {
        const raw = localStorage.getItem(chatReadKey);
        lastRead = raw ? Number(raw) : 0;
        if (!Number.isFinite(lastRead)) lastRead = 0;
      } catch {
        lastRead = 0;
      }
      lastChatReadAtRef.current = lastRead;

      try {
        const sinceIso =
          lastRead > 0
            ? new Date(lastRead).toISOString()
            : "1970-01-01T00:00:00.000Z";

        const { count } = await supabase
          .from(CHAT_MSG_TABLE)
          .select("id", { count: "exact", head: true })
          .eq("session_id", session.id)
          .neq("user_id", authUserId)
          .gt("created_at", sinceIso);

        if (!cancelled) setUnreadChat(Math.min(99, Math.max(0, Number(count || 0))));
      } catch {
        if (!cancelled) setUnreadChat(0);
      }
    })();

    const ch = supabase
      .channel(`chat-unread:${session.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: CHAT_MSG_TABLE, filter: `session_id=eq.${session.id}` },
        (payload: any) => {
          const row = payload?.new;
          if (!row) return;

          const senderId = String(row.user_id || "");
          if (!senderId) return;
          if (senderId === authUserId) return;

          const ts = new Date(row.created_at).getTime();
          const msgMs = Number.isFinite(ts) ? ts : Date.now();

          if (chatVisibleRef.current) {
            markChatRead(msgMs);
            return;
          }

          if (msgMs > (lastChatReadAtRef.current || 0)) {
            setUnreadChat((prev) => Math.min(99, prev + 1));
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      safeRemoveRealtimeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, authUserId, chatReadKey]);

  // reactions broadcast
  const pushFloatingReaction = (type: ReactionType, fromUserId: string, fromName: string) => {
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
    const current = (displayName || userName || "").trim();
    setEditNameValue(current);
    setEditNameOpen(true);
  };

  const saveEditName = async () => {
    const nm = String(editNameValue || "").trim();
    if (!nm) return;

    // 1) сразу обновляем локальный source of truth
    applyRoomDisplayNameLocally(nm);

    // 2) сразу перестраиваем тайлы уже с новым локальным именем
    scheduleRebuildTiles();

    try {
      const r = roomRef.current;
      const lp: any = r?.localParticipant as any;

      if (lp?.setName) {
        await lp.setName(nm);
      }
    } catch (e) {
      console.warn("localParticipant.setName failed", e);
    }

    // 3) ещё один rebuild после sync с LiveKit
    requestAnimationFrame(() => {
      scheduleRebuildTiles();
    });

    setEditNameOpen(false);
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
          ""
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

      const { error } = await supabase.from(REPORTS_TABLE).insert(payload as any);
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
  const { ref: videoSizerRef, width: videoWrapW, height: videoWrapH } = useElementSize<HTMLDivElement>();
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

    if (pid && looksLikeUuid(pid) && moderatorUserIds.includes(pid)) return "Moderator";
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
            isLight ? "border-black/10" : "border-white/10",
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
            <div className={`text-xl font-bold ${isLight ? "text-black/70" : "text-white/85"}`}>
              {initials}
            </div>
          )}
        </div>

        <div
          className={`mt-3 px-3 py-1.5 rounded-xl border backdrop-blur ${isLight ? "border-black/10 text-black/85" : "border-white/10 text-white/90"}`}
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

    const canAdminTarget = isSelfModerator && !t.isLocal && !!t.participantIdentity;
    const pidBase = String(
      t.participantUserId || extractBaseUserIdFromIdentity(String(t.participantIdentity || ""))
    ).toLowerCase();
    const canRoleManageTarget = isHost && !!pidBase && looksLikeUuid(pidBase) && !t.isLocal;
    const isTargetModerator = !!pidBase && moderatorUserIds.includes(pidBase);
    const roleBusy = roleBusyKey === `mod:${pidBase}:grant` || roleBusyKey === `mod:${pidBase}:revoke`;

    const hasMicTrack = !!t.micTrackSid && !!t.participantIdentity;
    const hasCamTrack = !!t.camTrackSid && !!t.participantIdentity;

    const muteMicDisabled = !canAdminTarget || !hasMicTrack || !!t.micMuted;
    const turnCameraOffDisabled = !canAdminTarget || !hasCamTrack || isTileCamOff(t);
    const kickDisabled = !canAdminTarget || !t.participantIdentity;

    const isHidden = !!hiddenTileIds[t.id];
    const isPinned = pinnedTileId === t.id;

    const isFeaturedTile = featuredTile?.id === t.id;
    const shouldForceMenuVisible = isMenuOpen || isPinned || isFeaturedTile || tileCount <= 1;
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
    const participantProfileKey = String(t.participantUserId || "").toLowerCase();

    const participantProfile: HostProfile | null =
      !t.isLocal && participantProfileKey
        ? profilesById[participantProfileKey] || null
        : null;

    const volumeKey = getParticipantVolumeKey(t);
    const volPct = !t.isLocal ? Number(volumePctByParticipantKey[volumeKey] ?? 100) : 100;

    const namePlateBaseCls = [
      "group/name inline-flex items-center rounded-2xl border backdrop-blur shadow-sm",
      "px-3 py-2",
      isLight ? "bg-white/70 border-black/10 text-black/85" : "bg-black/30 border-white/10 text-white/90",
    ].join(" ");

    const micBadgeWrapCls = isLight
      ? micMuted
        ? "bg-black/8"
        : "bg-emerald-500/12"
      : micMuted
        ? "bg-white/8"
        : "bg-emerald-400/18";

    const nameTextCls = "truncate max-w-[220px] font-inter text-[14px] font-semibold";

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
            videoTrack={t.videoTrack}
            isLocal={t.isLocal}
            theme={theme}
            showBadge={getBadgeForTile(t)}
            hostActions={undefined}
            avatarUrl={tileAvatarUrl}
            micMuted={micMuted}
            mirrorVideo={t.isLocal ? previewMirrored : false}
            audioLevel={t.audioLevel || 0}
            onToggleMenu={(tileId, anchorEl) => {
              if (openTileAdminMenuId === tileId) {
                closeTileMenu();
                return;
              }
              openTileMenuAt(tileId, anchorEl);
            }}
            showMenuButton={true}
            onOpenProfile={() => {
              if (participantProfile) {
                setSelectedUser(participantProfile);
              }
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
                shouldForceMenuVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                isLight
                  ? "bg-white/90 border border-black/10 text-black/75 hover:bg-white"
                  : "bg-black/55 border border-white/10 text-white/90 hover:bg-black/70",
              ].join(" ")}
            >
              <span className="text-[15px] leading-none">✎</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  const activeScreenShareTile = useMemo(() => {
    return screenShareTiles.length ? screenShareTiles[0] : null;
  }, [screenShareTiles]);

  const pinnedParticipantTile = useMemo(() => {
    if (!pinnedTileId) return null;
    return tilesForRender.find((t) => t.id === pinnedTileId) || null;
  }, [pinnedTileId, tilesForRender]);

  const featuredTile = activeScreenShareTile || pinnedParticipantTile || null;

  const sidebarTiles = useMemo(() => {
    if (activeScreenShareTile) return tilesForRender;
    if (pinnedParticipantTile) return tilesForRender.filter((t) => t.id !== pinnedParticipantTile.id);
    return tilesForRender;
  }, [activeScreenShareTile, pinnedParticipantTile, tilesForRender]);

  // Layout
  const tileCount = tilesForRender.length;
  const paddingBottomPx = 12;

  const isVeryNarrow = effectiveW < 430;
  const isNarrowForColumns = effectiveW < 520;
  const isCompact = effectiveW < 900;

  const useVeryNarrowMode = isVeryNarrow || (isMobileQuery && isNarrowForColumns);
  const stackTwoOnThisViewport =
    tileCount === 2 &&
    !useVeryNarrowMode &&
    (isTabletQuery || (isMobileQuery && effectiveW < 640) || isCompact);

  const useFeaturedLayout =
    !!featuredTile &&
    !useVeryNarrowMode &&
    effectiveW >= 900;

  const videoLayout = useFeaturedLayout ? (
    <div className="h-full w-full min-w-0 min-h-0 grid grid-cols-[minmax(0,1fr),clamp(15rem,24vw,20rem)] gap-3 p-3 overflow-hidden">
  <div className="min-w-0 min-h-0 flex items-center justify-center overflow-hidden">
    <div className="w-full min-w-0 min-h-0">
      {featuredTile ? renderTile(featuredTile) : null}
    </div>
  </div>

  <div className="min-w-0 min-h-0 overflow-y-auto overflow-x-hidden pr-1 flex flex-col gap-3">
        {sidebarTiles.length === 0 ? (
          <div
            className={`min-h-[160px] rounded-2xl border flex items-center justify-center ${isLight ? "border-black/10 bg-black/5 text-black/50" : "border-white/10 bg-white/5 text-white/55"
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
        <div className={`h-full w-full flex items-center justify-center px-4 ${isLight ? "text-black/60" : "text-white/60"}`}>
          <div className={`min-h-[240px] w-full max-w-[680px] rounded-2xl border flex items-center justify-center ${isLight ? "border-black/10 bg-black/5" : "border-white/10 bg-white/5"}`}>
            No participants yet
          </div>
        </div>
      ) : tileCount ? (
        useVeryNarrowMode ? (
              tileCount <= 2 ? (
                <div className="h-full w-full min-w-0 min-h-0 overflow-hidden">
                  <MobileFillLayoutSizing<TileModel>
                    items={tilesForRender}
                    containerWidth={effectiveW}
                    containerHeight={effectiveH}
                    paddingBottomPx={paddingBottomPx}
                    renderItem={(t) => renderTile(t)}
                  />
                </div>
              ) : (
                  <div className="h-full w-full min-w-0 min-h-0 overflow-hidden">
                    <MobileStackLayoutSizing<TileModel>
                      items={tilesForRender}
                      paddingBottomPx={paddingBottomPx}
                      renderItem={(t) => renderTile(t)}
                    />
                  </div>
          )
            ) : tileCount <= 2 ? (
              <div className="h-full w-full min-w-0 min-h-0 overflow-hidden">
                <P2PLayoutSizing<TileModel>
                  items={tilesForRender}
                  containerWidth={effectiveW}
                  containerHeight={effectiveH}
                  stack={stackTwoOnThisViewport}
                  renderItem={(t) => renderTile(t)}
                />
              </div>
            ) : (
                <div className="h-full w-full min-w-0 min-h-0 overflow-hidden">
                  <GridLayoutSizing<TileModel>
                    items={tilesForRender}
                    containerWidth={effectiveW}
                    containerHeight={effectiveH}
                    forceThreeAsTwoPlusOne={rightPanelOpen}
                    renderItem={(t) => renderTile(t)}
                  />
                </div>
              )
      ) : null}
    </>
  );

  const videoContent = (
    <div className="w-full h-full min-w-0 min-h-0 relative overflow-hidden">
      {roomReadyText ? (
        <div className={`absolute inset-0 flex items-center justify-center z-10 ${isLight ? "text-black/60" : "text-white/70"}`}>
          <div className={`px-4 py-2 rounded-xl ${isLight ? "bg-white/70" : "bg-black/30"}`}>
            {roomReadyText}
          </div>
        </div>
      ) : null}

      {hiddenTiles.length > 0 && (
        <div className="absolute top-3 left-3 z-30 max-w-[80%]">
          <div
            className={[
              "inline-flex items-center gap-2 px-3 py-2 rounded-2xl border backdrop-blur shadow",
              isLight ? "bg-white/80 border-black/10 text-black/75" : "bg-black/35 border-white/10 text-white/85",
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
                    isLight ? "bg-black/5 border-black/10 hover:bg-black/10 text-black/70" : "bg-white/5 border-white/10 hover:bg-white/10 text-white/85",
                  ].join(" ")}
                  title="Unhide participant"
                >
                  {String(t.label || "User").slice(0, 18)} ✕
                </button>
              ))}
              {hiddenTiles.length > 8 ? (
                <span className={`text-[12px] opacity-70 ${isLight ? "text-black/60" : "text-white/70"}`}>
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
                  isLight ? "bg-white/90 border-black/10 text-black/80" : "bg-[#020617]/70 border-white/10 text-white/90",
                ].join(" ")}
                style={{ animationDelay: `${idx * 0.05}s` }}
              >
                <div className="text-[44px] leading-none">{REACTION_EMOJI[r.type]}</div>
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
    if (activeScreenShareTile) return activeScreenShareTile;
    if (pinnedParticipantTile) return pinnedParticipantTile;
    return tilesForRender[0] || null;
  }, [activeScreenShareTile, pinnedParticipantTile, tilesForRender]);

  const pipStripTiles = useMemo(() => {
    if (activeScreenShareTile) return tilesForRender.slice(0, 4);
    if (pinnedParticipantTile) {
      return tilesForRender.filter((t) => t.id !== pinnedParticipantTile.id).slice(0, 4);
    }
    return tilesForRender.slice(1, 5);
  }, [activeScreenShareTile, pinnedParticipantTile, tilesForRender]);

  const pipGalleryTiles = useMemo(() => {
    if (activeScreenShareTile) {
      const withoutDup = tilesForRender.filter((t) => t.id !== activeScreenShareTile.id);
      return [activeScreenShareTile, ...withoutDup].slice(0, 9);
    }

    if (pinnedParticipantTile) {
      const withoutDup = tilesForRender.filter((t) => t.id !== pinnedParticipantTile.id);
      return [pinnedParticipantTile, ...withoutDup].slice(0, 9);
    }

    return tilesForRender.slice(0, 9);
  }, [activeScreenShareTile, pinnedParticipantTile, tilesForRender]);

  const pipGalleryColumns = useMemo(() => {
    const count = pipGalleryTiles.length;

    if (count <= 1) return 1;
    if (count <= 4) return 2;
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
        pipMode={pipMode}
        pipFeaturedTile={pipFeaturedTile}
        pipStripTiles={pipStripTiles}
        pipGalleryTiles={pipGalleryTiles}
        pipGalleryColumns={pipGalleryColumns}
        renderTile={renderTile}
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
        onSetPipMode={setPipMode}
      />,
      pipMountEl
    )
    : null;

  // UI colors
  const pageBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
  const panelBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#0B1220]/55 border border-white/5";
  const bottomBarBg = isLight
    ? "bg-white/85 border border-black/10"
    : "bg-[#0B1220]/80 border border-white/10";

  const ctlBtnBase = isLight
    ? "bg-black/5 hover:bg-black/10 text-black/75"
    : "bg-white/5 hover:bg-white/10 text-white/90";

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
            className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"
              }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`${isLight ? "text-black/80" : "text-white/85"
                  } font-inter font-semibold truncate`}
              >
                Participants
              </span>
              <span className={`${isLight ? "text-black/50" : "text-white/55"} text-sm`}>
                ({participantsCount})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openEditName}
                className={`px-3 h-9 rounded-xl text-[12px] font-semibold border transition ${isLight
                  ? "bg-black/5 border-black/10 hover:bg-black/10 text-black/70"
                  : "bg-white/5 border-white/10 hover:bg-white/10 text-white/85"
                  }`}
                title="Edit my name"
              >
                Edit my name
              </button>

              <button
                onClick={() => openRightTab(null)}
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight
                  ? "bg-black/5 hover:bg-black/10 text-black/60"
                  : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                  }`}
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="p-4">
            <div
              className={`rounded-xl px-3 py-2 ${isLight ? "bg-black/5 border border-black/10" : "bg-[#0B1220]/70 border border-white/10"
                }`}
            >
              <input
                value={participantsSearch}
                onChange={(e) => setParticipantsSearch(e.target.value)}
                placeholder="Search participants..."
                className={`w-full bg-transparent outline-none text-[13px] placeholder:opacity-60 ${isLight
                  ? "text-black/80 placeholder:text-black/40"
                  : "text-white/85 placeholder:text-white/35"
                  }`}
              />
            </div>

            {rolesError ? (
              <div className={`mt-2 text-[12px] ${isLight ? "text-red-600" : "text-red-300"}`}>
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

                const pidBase = String(p.participantUserId || "").toLowerCase();
                const isMod = !p.isLocal && looksLikeUuid(pidBase)
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
                    className={`px-3 py-2 rounded-xl transition ${isLight ? "hover:bg-black/5" : "hover:bg-white/5"
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
                            className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${isLight
                              ? "bg-blue-500/15 text-blue-700"
                              : "bg-emerald-500/80 text-[#02140B]"
                              }`}
                          >
                            {p.kind === "screen" ? "🖥️" : initials}
                          </div>
                        )}

                        <div className="min-w-0">
                          <div
                            className={`text-[13px] font-medium truncate ${isLight ? "text-black/85" : "text-white/90"
                              }`}
                          >
                            {p.label}
                            {isPinned ? <span className="ml-2 opacity-70">📌</span> : null}
                            {isHidden ? <span className="ml-2 opacity-70">🙈</span> : null}
                          </div>
                          <div
                            className={`text-[11px] truncate ${isLight ? "text-black/45" : "text-white/45"
                              }`}
                          >
                            {roleText}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {p.kind !== "screen" && (
                          <>
                            <button
                              onClick={() => togglePin(p.id)}
                              className={`w-9 h-9 rounded-xl flex items-center justify-center border transition ${isLight
                                ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/70"
                                : "border-white/10 bg-white/5 hover:bg-white/10 text-white/85"
                                }`}
                              title={isPinned ? "Unpin" : "Pin"}
                            >
                              📌
                            </button>

                            <button
                              onClick={() => toggleHide(p.id)}
                              className={`w-9 h-9 rounded-xl flex items-center justify-center border transition ${isLight
                                ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/70"
                                : "border-white/10 bg-white/5 hover:bg-white/10 text-white/85"
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

          <div className={`p-4 border-t ${isLight ? "border-black/10" : "border-white/5"}`}>
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
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                }`}
            >
              <span className="text-lg">⎘</span>
              <span>Copy invite link</span>
            </button>
          </div>
        </div>
      )}

      {rightTab === "chat" && (
        <div className="h-full min-h-0 flex flex-col">
          <div
            className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"
              }`}
          >
            <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>
              Chat
            </div>
            <button
              onClick={() => openRightTab(null)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight
                ? "bg-black/5 hover:bg-black/10 text-black/60"
                : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                }`}
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 min-h-0 p-4 overflow-hidden">
            <div
              className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight
                ? "bg-white/70 border border-black/10"
                : "bg-[#020617]/40 border border-white/10"
                }`}
            >
              <div className="h-full min-h-0 flex flex-col overflow-hidden [&>*]:h-full [&>*]:min-h-0">
                {session?.id ? (
                  <div
                    data-theme={theme}
                    style={{ colorScheme: theme }}
                    className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}
                  >
                    <ChatPanelAny
                      sessionId={session.id}
                      theme={theme}
                      showHeader={false}
                      title="Chat"
                      onClose={() => openRightTab(null)}
                      embedded={true}
                      hideHeader={true}
                      authUserId={authUserId}
                      displayName={displayName || userName}
                      onAnyMessageSeen={() => markChatRead()}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {rightTab === "intentions" && (
        <div className="h-full min-h-0 flex flex-col">
          <div
            className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"
              }`}
          >
            <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>
              Intentions
            </div>
            <button
              onClick={() => openRightTab(null)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight
                ? "bg-black/5 hover:bg-black/10 text-black/60"
                : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                }`}
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden p-4">
            <div
              className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight
                ? "bg-white/70 border border-black/10"
                : "bg-[#020617]/40 border border-white/10"
                }`}
            >
              <div className="h-full min-h-0 overflow-y-auto [&>*]:min-h-0">
                <div
                  data-theme={theme}
                  style={{ colorScheme: theme }}
                  className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}
                >
                  {session?.id ? (
                    <IntentionsPanel
                      key={`intentions-${session.id}-${theme}`}
                      theme={theme}
                      sessionId={session.id}
                      timerText={remainingTime || "--:--"}
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
    return <div className={`flex h-screen items-center justify-center ${pageBg}`}>Loading session...</div>;
  }

  if (authGateStatus === "checking" || authGateStatus === "redirecting") {
    return (
      <>
        <div className={`min-h-screen w-full flex items-center justify-center ${isLight ? "bg-[#f6f8fb]" : "bg-[#020617]"}`}>
          <div className={`w-[92%] max-w-[520px] rounded-3xl border shadow-2xl p-6 ${isLight ? "bg-white border-black/10" : "bg-[#0b1220] border-white/10"}`}>
            <div className={`text-[18px] font-semibold ${isLight ? "text-black/85" : "text-white/90"}`}>
              Checking access…
            </div>
            <div className={`mt-2 text-[14px] ${isLight ? "text-black/55" : "text-white/55"}`}>
              Please wait a moment.
            </div>
          </div>
        </div>
        {pipPortal}
      </>
    );
  }

  const handleBookFromJoinGate = async () => {
    const sessionId = String(session?.id || "").trim();
    if (!sessionId) return;

    if (!authUserId) {
      const redirect = encodeURIComponent(location.pathname + location.search);
      navigate(`/login?redirect=${redirect}`, { replace: true });
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
          (b: any) => String(b?.user_id || "") === String(authUserId)
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

  if (joinBlocked) {
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
    return (
      <div className={`flex h-screen items-center justify-center ${pageBg}`}>
        <button onClick={() => navigate("/sessions")}>Back</button>
      </div>
    );
  }

  const onJoinGate = () => {
    joinFlowStartedRef.current = true;
    connectingFromPrejoinRef.current = true;
    if (deviceTier === "weak" && videoFxMode !== "off") {
      setVideoFxMode("off");
      setFxStatusText("FX disabled automatically on weak/mobile device");
    }

    const pj = prejoinRef.current;
    const nm = (pj.displayName || displayName || userName || "User").trim() || "User";

    const baseUser = safeIdentity(
      (authUserId && looksLikeUuid(authUserId) ? authUserId : authUserId || nm) as any
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

        @media (max-width: 1023px) {
          .ms-desktop-only-fx {
            display: none !important;
          }
        }
      `}</style>

      <PreJoinModal
        open={prejoinOpen}
        theme={theme}
        devices={devices}
        value={prejoin}
        onChange={setPrejoin}
        hideBackgroundFx={isMobileQuery}
        onRefreshDevices={() => loadBrowserDevices().catch(() => { })}
        onCancel={() => {
          cleanupPrejoinPreparedVideoTrack().catch(() => { });
          releaseTabPresence();
          navigate("/sessions", { replace: true });
        }}
        onJoin={onJoinGate}
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

      <div className={`h-[100dvh] overflow-hidden ${pageBg}`}>
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
            onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            onOpenHostProfile={() => setSelectedUser((session?.host_profile as any) || null)}
          />

          <div
            className={
              "relative grid grid-rows-1 gap-2 sm:gap-3 flex-1 min-h-0 h-full " +
              (rightPanelOpen ? "lg:grid-cols-[minmax(0,1fr),420px]" : "grid-cols-1")
            }
          >
            <div
              ref={(el) => {
                videoWrapRef.current = el;
                videoSizerRef(el);
              }}
              className={`relative rounded-2xl overflow-hidden min-h-0 h-full ${isLight ? "bg-white/70 border border-black/10" : "bg-[#0B1220]/45 border border-white/5"
                }`}
            >
              {videoContent}

              {lastErr && (
                <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow z-30 max-w-[80%] break-words">
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
              <div className="min-h-0 h-full overflow-hidden">{RightPanelBody}</div>
            )}

            {rightPanelOpen && !isLgUp && (
              <div className="absolute inset-0 z-40 min-h-0">
                <div className="absolute inset-0 bg-black/40" onClick={() => openRightTab(null)} />
                <div className="absolute inset-x-0 top-0 bottom-0 p-2 min-h-0">{RightPanelBody}</div>
              </div>
            )}
          </div>
        </div>

        <RemoteAudioRenderer
          room={roomState}
          audioOutputId={selectedAudioOutputId}
          defaultRemoteVolumePct={defaultRemoteVolumePct}
          volumePctByParticipantKey={volumePctByParticipantKey}
          recoveryTick={remoteAudioRecoveryTick}
        />

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
            if (pipOpen) {
              closePictureInPicture().catch(() => { });
            } else {
              openPictureInPicture().catch((e) => {
                console.error("openPictureInPicture failed", e);
                alert(String((e as any)?.message || e || "pip_open_failed"));
              });
            }
          }}
          onToggleMic={() => toggleMic().catch(() => { })}
          onToggleCam={() => toggleCam().catch(() => { })}
          onToggleScreenShare={() => toggleScreenShare().catch(() => { })}
          onLeave={() => leave().catch(() => { })}
          onOpenParticipants={() => openRightTab("participants")}
          onOpenChat={() => openRightTab("chat")}
          onOpenIntentions={() => openRightTab("intentions")}
          onOpenSettings={() => {
            setSettingsOpen(true);
            setSettingsPreviewVersion((v) => v + 1);
          }}
          onSendReaction={sendReaction}
        />

        <RoomSettingsModalLiveKit
          open={settingsOpen}
          theme={theme}
          mode={videoFxMode}
          blurStrength={blurStrength}
          onBlurStrengthChange={setBlurStrength}
          bgImageUrl={bgImageUrl}
          onSetBgImageUrl={setBgImageUrl}

          defaultRemoteVolumePct={defaultRemoteVolumePct}
          onDefaultRemoteVolumePctChange={setDefaultRemoteVolumePct}
          onResetAllParticipantVolumes={resetAllParticipantVolumesToDefault}

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
                const pubs = Array.from(roomState?.localParticipant?.videoTrackPublications?.values?.() || []);
                const camPub = pubs.find((p: any) => p?.source === Track.Source.Camera);
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
            const nextId = audioOutputSupported ? (deviceId || "default") : "default";
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
              onClick={systemNotice.kind === "kick" ? undefined : closeSystemNotice}
            />
            <div
              className={`relative w-[92%] max-w-[520px] rounded-2xl border shadow-2xl p-5 ${isLight ? "bg-white border-black/10 text-black/85" : "bg-[#020617] border-white/10 text-white/90"
                }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[18px] font-semibold">{systemNotice.title}</div>
                  <div className={`mt-1 text-[13px] leading-relaxed ${isLight ? "text-black/65" : "text-white/70"}`}>
                    {systemNotice.body}
                  </div>
                </div>

                {systemNotice.kind !== "kick" && (
                  <button
                    type="button"
                    onClick={closeSystemNotice}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight
                      ? "bg-black/5 hover:bg-black/10 text-black/70"
                      : "bg-white/5 hover:bg-white/10 text-white/80"
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
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
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
            <div className="absolute inset-0 bg-black/40" onClick={() => setEditNameOpen(false)} />
            <div
              className={`relative w-[92%] max-w-[480px] rounded-2xl border shadow-2xl p-5 ${isLight ? "bg-white border-black/10" : "bg-[#020617] border-white/10"
                }`}
            >
              <div className={`text-[16px] font-semibold ${isLight ? "text-black/85" : "text-white/90"}`}>
                Edit your name
              </div>
              <div className={`mt-1 text-[12px] ${isLight ? "text-black/50" : "text-white/50"}`}>
                This only changes your name inside the current room.
              </div>

              <input
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                placeholder="Your name"
                className={`mt-4 w-full rounded-xl px-3 py-2 outline-none border ${isLight ? "bg-white border-black/10 text-black/85" : "bg-black/20 border-white/10 text-white/90"
                  }`}
              />

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setEditNameOpen(false)}
                  className={`px-4 h-10 rounded-xl font-semibold ${isLight
                    ? "bg-black/5 hover:bg-black/10 text-black/75"
                    : "bg-white/5 hover:bg-white/10 text-white/85"
                    }`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => saveEditName().catch(() => { })}
                  className={`px-4 h-10 rounded-xl font-semibold ${isLight
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
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
          <UserProfileModal user={selectedUser} onClose={() => setSelectedUser(null)} />
        )}
      </div>
      {openTileAdminMenuId && tileMenuAnchor && createPortal(
        <div
          className="fixed inset-0 z-[220] pointer-events-none"
          aria-hidden={false}
        >
          <div
            className="absolute inset-0 pointer-events-auto"
            onClick={() => closeTileMenu()}
          />

          <div
            data-lk-admin-menu-surface="true"
            className={`pointer-events-auto absolute w-[min(22rem,calc(100vw-1rem))] max-h-[min(70vh,32rem)] overflow-y-auto rounded-2xl shadow-2xl ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"
              }`}
            style={{
              left: Math.max(
                8,
                Math.min(
                  tileMenuAnchor.x - 352,
                  tileMenuAnchor.viewportWidth - 360
                )
              ),
              top: Math.max(
                8,
                Math.min(
                  tileMenuAnchor.y + 8,
                  tileMenuAnchor.viewportHeight - 520
                )
              ),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const targetTile = tilesBaseForUi.find((t) => t.id === openTileAdminMenuId) || null;
              if (!targetTile) return null;

              const targetIdentity = String(targetTile.participantIdentity || "").trim();
              const targetUserId = String(
                targetTile.participantUserId ||
                extractBaseUserIdFromIdentity(targetIdentity)
              )
                .trim()
                .toLowerCase();

              const pidBase = looksLikeUuid(targetUserId) ? targetUserId : "";
              const isTargetModerator = !!(pidBase && moderatorUserIds.includes(pidBase));

              const canRoleManageTarget =
                !targetTile.isLocal &&
                isHost &&
                !!pidBase &&
                pidBase !== String(authUserId || "").toLowerCase();

              const canModerateTarget =
                !targetTile.isLocal &&
                !!targetIdentity &&
                (isHost || isSelfModerator);

              const participantVolumeKey = getParticipantVolumeKey(targetTile);
              const participantVolumePctRaw = volumePctByParticipantKey[participantVolumeKey];
              const participantVolumePct = Number.isFinite(Number(participantVolumePctRaw))
                ? clamp(Number(participantVolumePctRaw), 0, 100)
                : 100;

              const roleBusy = !!pidBase
                ? roleBusyKey === `mod:${pidBase}:${isTargetModerator ? "revoke" : "grant"}`
                : false;

              const muteBusyKey = `${targetIdentity}:${String(
                targetTile.remoteMicPubSid || targetTile.micTrackSid || ""
              )}:mute`;
              const camBusyKey = `${targetIdentity}:${String(targetTile.camTrackSid || "")}:camera-off`;

              const micBusy = adminBusyKey === muteBusyKey;
              const camBusy = adminBusyKey === camBusyKey;
              const kickBusy = adminBusyKey === `${targetIdentity}:kick`;

              const canMuteMic =
                canModerateTarget &&
                !!String(targetTile.remoteMicPubSid || targetTile.micTrackSid || "").trim();

              const canTurnOffCam =
                canModerateTarget &&
                !!String(targetTile.camTrackSid || "").trim();

              const isPinned = pinnedTileId === targetTile.id;
              const isHidden = !!hiddenTileIds[targetTile.id];

              return (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsOpen(true);
                      setSettingsPreviewVersion((v) => v + 1);
                      closeTileMenu();
                    }}
                    className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-black/5" : "text-white/90 hover:bg-white/5"
                      }`}
                  >
                    Video room settings
                  </button>

                  {isHost && (
                    <>
                      <div className={isLight ? "border-t border-black/10" : "border-t border-white/10"} />

                      <div className={`px-4 py-2 text-[11px] ${isLight ? "text-black/45" : "text-white/45"}`}>
                        Remote audio for everyone
                      </div>

                      {[100, 150, 200, 300].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => {
                            setDefaultRemoteVolumePct(pct);
                            closeTileMenu();
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-black/5" : "text-white/90 hover:bg-white/5"
                            }`}
                        >
                          Set default remote volume to {pct}%
                        </button>
                      ))}

                      <button
                        type="button"
                        onClick={() => {
                          resetAllParticipantVolumesToDefault();
                          closeTileMenu();
                        }}
                        className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-black/5" : "text-white/90 hover:bg-white/5"
                          }`}
                      >
                        Reset all participant volumes
                      </button>
                    </>
                  )}

                  {canRoleManageTarget && (
                    <>
                      <div className={isLight ? "border-t border-black/10" : "border-t border-white/10"} />

                      <div className={`px-4 py-2 text-[11px] ${isLight ? "text-black/45" : "text-white/45"}`}>
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
                          className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${isLight ? "text-black/85 hover:bg-black/5" : "text-white/90 hover:bg-white/5"
                            }`}
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
                          className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${isLight ? "text-black/85 hover:bg-black/5" : "text-white/90 hover:bg-white/5"
                            }`}
                        >
                          Remove moderator
                        </button>
                      )}
                    </>
                  )}

                  {canModerateTarget && (
                    <>
                      <div className={isLight ? "border-t border-black/10" : "border-t border-white/10"} />

                      <div className={`px-4 py-2 text-[11px] ${isLight ? "text-black/45" : "text-white/45"}`}>
                        Moderation
                      </div>

                      {canMuteMic && (
                        <button
                          type="button"
                          disabled={micBusy}
                          onClick={async () => {
                            const trackSid = String(targetTile.remoteMicPubSid || targetTile.micTrackSid || "").trim();
                            if (!targetIdentity || !trackSid) return;
                            await adminMuteRemoteTrack(targetTile.id, targetIdentity, trackSid);
                            closeTileMenu();
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${isLight ? "text-black/85 hover:bg-black/5" : "text-white/90 hover:bg-white/5"
                            }`}
                        >
                          Mute Mic
                        </button>
                      )}

                      {canTurnOffCam && (
                        <button
                          type="button"
                          disabled={camBusy}
                          onClick={async () => {
                            const trackSid = String(targetTile.camTrackSid || "").trim();
                            if (!targetIdentity || !trackSid) return;
                            await adminTurnOffRemoteCamera(targetTile.id, targetIdentity, trackSid);
                            closeTileMenu();
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${isLight ? "text-black/85 hover:bg-black/5" : "text-white/90 hover:bg-white/5"
                            }`}
                        >
                          Turn camera off
                        </button>
                      )}
                    </>
                  )}

                  {!targetTile.isLocal && (
                    <>
                      <div className={isLight ? "border-t border-black/10" : "border-t border-white/10"} />

                      <div className={`px-4 py-2 text-[11px] ${isLight ? "text-black/45" : "text-white/45"}`}>
                        Audio
                      </div>

                      <div className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`text-[13px] ${isLight ? "text-black/70" : "text-white/70"}`}>
                            Vol
                          </div>

                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={participantVolumePct}
                            onChange={(e) => {
                              const nextPct = clamp(Number(e.target.value || 100), 0, 100);
                              setVolumePctByParticipantKey((prev) => ({
                                ...prev,
                                [participantVolumeKey]: nextPct,
                              }));
                            }}
                            className="flex-1 accent-blue-500"
                          />

                          <div className={`w-10 text-right text-[13px] tabular-nums ${isLight ? "text-black/70" : "text-white/70"
                            }`}>
                            {participantVolumePct}%
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {!targetTile.isLocal && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          togglePin(targetTile.id);
                          closeTileMenu();
                        }}
                        className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-black/5" : "text-white/90 hover:bg-white/5"
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
                        className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-black/5" : "text-white/90 hover:bg-white/5"
                          }`}
                      >
                        {isHidden ? "Unhide participant" : "Hide participant"}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setReportTarget(targetTile);
                          setReportReason("");
                          setReportError("");
                          setReportModalOpen(true);
                          closeTileMenu();
                        }}
                        className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-black/5" : "text-white/90 hover:bg-white/5"
                          }`}
                      >
                        Report participant
                      </button>

                      {canModerateTarget && (
                        <>
                          <div className={isLight ? "border-t border-black/10" : "border-t border-white/10"} />

                          <button
                            type="button"
                            disabled={kickBusy}
                            onClick={async () => {
                              if (!targetIdentity) return;
                              await adminKickParticipant(targetIdentity, targetUserId || undefined, targetTile.label || undefined);
                              closeTileMenu();
                            }}
                            className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${isLight ? "text-red-600 hover:bg-red-50" : "text-red-300 hover:bg-red-500/10"
                              }`}
                          >
                            Kick participant
                          </button>
                        </>
                      )}
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>,
        tileMenuAnchor?.portalDocument?.body || document.body
      )}
      {pipPortal}
    </>
  );
}

export default RoomPageLiveKit;
