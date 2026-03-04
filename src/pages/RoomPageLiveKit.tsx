// src/pages/RoomPageLiveKit.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Room,
  RoomEvent,
  Track,
  RemoteParticipant,
  LocalVideoTrack,
  RemoteAudioTrackPublication,
  LocalTrackPublication,
  RemoteTrackPublication,
  createLocalVideoTrack,
} from "livekit-client";

import {
  BackgroundBlur,
  VirtualBackground,
  supportsBackgroundProcessors,
  supportsModernBackgroundProcessors,
  type TrackProcessor,
} from "@livekit/track-processors";

import { supabase } from "../lib/supabase";

import ChatPanel from "../components/ChatPanel";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { UserProfileModal } from "../components/UserProfileModal";
import RoomTopBar from "../components/RoomTopBar";
import VideoControls, {
  Icon,
  ParticipantsSmartIcon,
  REACTION_EMOJI,
  type ReactionType,
  type RoomTheme,
} from "../components/VideoControls";

import { PreJoinModal } from "./LiveKit/PreJoinModalLiveKit";
import { RoomSettingsModalLiveKit } from "./LiveKit/RoomSettingsModalLiveKit";
import { VideoTile } from "./LiveKit/VideoTileLiveKit";
import { RemoteAudioRenderer } from "./LiveKit/RemoteAudioRendererLiveKit";

import {
  useElementSize,
  GridLayoutSizing,
  P2PLayoutSizing,
  MobileFillLayoutSizing,
  MobileStackLayoutSizing,
} from "./LiveKit/sizing";

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
  max_participants?: number | null;
  host_id?: string | null;
};

type Stage = {
  name: string;
  duration: number; // minutes (display / legacy)
  color: string;
  type: "intro" | "intentions" | "focus" | "break" | "outro" | string;
  durationSeconds?: number; // preferred when present
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
  id: string; // local | rp.sid
  label: string;
  isLocal: boolean;

  // video for render
  videoTrack?: Track;

  participantIdentity?: string; // exact LK identity
  participantUserId?: string; // extracted base uuid when possible

  micTrackSid?: string;
  camTrackSid?: string;
  micMuted?: boolean;
  camMuted?: boolean;
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

// ===============================
// helpers
// ===============================
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
      const explicitSeconds = num((raw as any).seconds) || num((raw as any).duration_seconds) || num((raw as any).durationSeconds);
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
function getInitials(name: string) {
  const s = String(name || "").trim();
  if (!s) return "U";
  const parts = s.split(/\s+/).filter(Boolean).slice(0, 2);
  const out = parts.map((p) => p[0]?.toUpperCase()).join("");
  return out || "U";
}

// ===============================
// realtime cleanup safe
// ===============================
function safeRemoveRealtimeChannel(ch: any) {
  if (!ch) return;

  try {
    if (typeof ch.unsubscribe === "function") {
      void ch.unsubscribe();
      return;
    }
  } catch {}

  const sb: any = supabase as any;

  try {
    if (typeof sb.removeChannel === "function") {
      void sb.removeChannel(ch);
      return;
    }
  } catch {}

  try {
    if (typeof sb.removeSubscription === "function") {
      void sb.removeSubscription(ch);
      return;
    }
  } catch {}

  try {
    if (sb.realtime && typeof sb.realtime.removeChannel === "function") {
      void sb.realtime.removeChannel(ch);
      return;
    }
  } catch {}
}

// ===============================
// avatars (profiles -> storage public url)
// ===============================
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
  } catch {}

  return "";
}

// ===============================
// ---- tab presence (allow up to N tabs per user per room)
// ===============================
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
  } catch {}

  let id = "";
  try {
    const c: any = crypto as any;
    if (c?.randomUUID) id = String(c.randomUUID()).replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase();
  } catch {}
  if (!id) id = randId(12);

  try {
    sessionStorage.setItem(storageKey, id);
  } catch {}

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
  } catch {}
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

// ---- default background (data url)
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

// capture defaults
const LK_CAPTURE_WIDTH = 960;
const LK_CAPTURE_HEIGHT = 540;
const LK_CAPTURE_FPS = 24;

// chat unread
const CHAT_MSG_TABLE = "session_chat_messages";

// reactions
type FloatingReaction = {
  id: number;
  type: ReactionType;
  fromUserId: string;
  fromName: string;
};
const REACTION_TTL_MS = 2750;

// ===============================
// MAIN
// ===============================
export function RoomPageLiveKit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

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
    } catch {}
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
    } catch {}
  }, [theme]);

  const isLgUp = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia("(min-width: 1024px)").matches;
  }, []);

  // session
  const [session, setSession] = useState<SessionRow | null>(null);
  const [loading, setLoading] = useState(true);

  // auth + profile (NAME must come from supabase)
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [userName, setUserName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [localAvatarUrl, setLocalAvatarUrl] = useState<string>("");

  const [selectedUser, setSelectedUser] = useState<HostProfile | null>(null);

  // profile cache for remote
  const [profilesById, setProfilesById] = useState<Record<string, HostProfile>>({});

  // prejoin
  const [prejoinOpen, setPrejoinOpen] = useState(false);
  const [joinRequested, setJoinRequested] = useState(false);

  const [devices, setDevices] = useState<MediaDevicesResult>({
    videoInputs: [],
    audioInputs: [],
    audioOutputs: [],
  });

  const [prejoin, setPrejoin] = useState<PreJoinSettings>(() => ({
    displayName: "",
    audioInputId: "",
    videoInputId: "",
    audioOutputId: "default",
    audioEnabled: true,
    videoEnabled: true,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }));
  const prejoinRef = useRef(prejoin);
  useEffect(() => {
    prejoinRef.current = prejoin;
  }, [prejoin]);

  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState<string>("default");

  // ---- pre-join prepared preview track
  const prejoinPreparedVideoTrackRef = useRef<LocalVideoTrack | null>(null);
  const [prejoinPreviewVersion, setPrejoinPreviewVersion] = useState(0);

  // ---- roles (moderators)
  const [moderatorUserIds, setModeratorUserIds] = useState<string[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState<string>("");
  const [roleBusyKey, setRoleBusyKey] = useState<string>("");

  // right panel
  type RightPanelTab = "participants" | "chat" | "intentions" | null;
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightPanelTab>(null);
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

  // resize poke after opening panels
  useEffect(() => {
    const fire = () => {
      try {
        window.dispatchEvent(new Event("resize"));
      } catch {}
    };
    requestAnimationFrame(fire);
    const t1 = window.setTimeout(fire, 60);
    const t2 = window.setTimeout(fire, 220);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [rightPanelOpen, rightTab]);

  // stages / timer / sounds (kept)
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

  const playOneShot = (url: string, volume = 0.9) => {
    if (!url) return;
    const a = new Audio(url);
    a.volume = volume;
    a.play().catch(() => {});
  };

  const startWelcomeLoop = () => {
    stopWelcomeLoop();
    const a = new Audio(WELCOME_LOOP_SOUND);
    a.loop = true;
    a.volume = 0.6;
    welcomeLoopRef.current = a;
    a.play().catch(() => {});
  };

  const stopWelcomeLoop = () => {
    try {
      if (welcomeLoopRef.current) {
        welcomeLoopRef.current.pause();
        welcomeLoopRef.current.currentTime = 0;
        welcomeLoopRef.current = null;
      }
    } catch {}
  };

  useEffect(() => {
    const unlock = () => {
      if (audioUnlockedRef.current) return;
      const a = new Audio();
      a.play().catch(() => {});
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

    if (isRecord((parsed as any).timer) && ((parsed as any).timer.phases || (parsed as any).timer.segments)) return true;
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

  // load session
  useEffect(() => {
    (async () => {
      if (!id) return;
      setLoading(true);

      const { data, error } = await supabase
        .from("sessions")
        .select("*, host_profile:profiles!sessions_host_id_fkey(id, full_name, avatar_url, bio), session_templates(*)")
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

  // build stages from schedule
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
      const maybeBlocks = (parsed as any).blocks || (parsed as any).script || (parsed as any).agenda || (parsed as any).items || (parsed as any).stages;
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

          const seconds = num((blk as any).seconds) || num((blk as any).durationSeconds) || num((blk as any).duration_seconds) || 0;

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

        const displayName =
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

        return { name: displayName, duration: minutes, color: STAGE_COLORS[type] || "#F63135", type, durationSeconds: seconds };
      });

      setStages(formatted);

      const anchor = String(str((parsed as any).anchor_ts) || str((parsed as any).anchorTs) || str(session?.start_time) || fallbackStart);
      setStagebarStartTime(anchor);

      const sumSeconds = phases.reduce((acc, p) => acc + (Number(p.seconds) || 0), 0);
      const timerCycle = timer && isRecord(timer) ? num((timer as any).cycle_seconds) || num((timer as any).cycleSeconds) : 0;

      let cycleSeconds = timerCycle || num((parsed as any).cycle_seconds) || num((parsed as any).cycleSeconds) || 0;
      if (!cycleSeconds || cycleSeconds <= 0) cycleSeconds = sumSeconds;
      if (cycleSeconds < sumSeconds) cycleSeconds = sumSeconds;

      setStagebarCycleSeconds(Math.max(1, cycleSeconds));
    }

    if (!parsed) setStagebarStartTime(fallbackStart);
  }, [session]);

  // stage timer + sounds
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
    const loopSeconds = (Number(stagebarCycleSeconds) || 0) > 0 ? Number(stagebarCycleSeconds) : Math.max(1, sumStageSeconds);

    const timer = window.setInterval(() => {
      const now = Date.now();
      const diffSecRaw = (now - startMs) / 1000;
      const diffSec = loopSeconds > 0 && isInfiniteRoom ? ((diffSecRaw % loopSeconds) + loopSeconds) % loopSeconds : diffSecRaw;

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

  // auth user (NAME from profiles only)
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const u = data.user;
        setAuthUserId(u?.id || null);

        let name = "";
        let avatar = "";

        if (u?.id) {
          try {
            const { data: p } = await supabase.from("profiles").select("id, full_name, avatar_url").eq("id", u.id).single();
            name = String((p as any)?.full_name || "").trim();
            avatar = await resolveAvatarUrlFromProfilesField(String((p as any)?.avatar_url || ""));
          } catch {}
        }

        // fallback: only email (NOT google metadata)
        if (!name) {
          name = u?.email ? String(u.email.split("@")[0] || "").trim() : "";
        }

        setUserName(name || "User");
        setDisplayName((prev) => prev || name || "User");
        setPrejoin((prev) => ({ ...prev, displayName: prev.displayName || name || "User" }));
        setLocalAvatarUrl(avatar || "");
      } finally {
        setAuthReady(true);
      }
    })();
  }, []);

  // enumerate devices
  const loadBrowserDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;

      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        s.getTracks().forEach((t) => t.stop());
      } catch {}

      const list = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = list.filter((d) => d.kind === "videoinput");
      const audioInputs = list.filter((d) => d.kind === "audioinput");
      const audioOutputs = list.filter((d) => d.kind === "audiooutput");

      setDevices({ videoInputs, audioInputs, audioOutputs });

      setPrejoin((prev) => ({
        ...prev,
        videoInputId: prev.videoInputId || videoInputs?.[0]?.deviceId || "",
        audioInputId: prev.audioInputId || audioInputs?.[0]?.deviceId || "",
        audioOutputId: prev.audioOutputId || "default",
      }));
    } catch (e) {
      console.error("loadBrowserDevices error:", e);
    }
  };

  // ---- FX state
  const [videoFxMode, setVideoFxMode] = useState<FxMode>("off");
  const [bgImageUrl, setBgImageUrl] = useState<string>(DEFAULT_BG_DATA_URL);
  const [fxError, setFxError] = useState<string>("");
  const [fxApplying, setFxApplying] = useState(false);
  const [fxStatusText, setFxStatusText] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [blurStrength, setBlurStrength] = useState<number>(12);

  const uploadedBgUrlRef = useRef<string | null>(null);
  const fxOpIdRef = useRef<number>(0);

  const ensureFxSupportedOrThrow = () => {
    if (!supportsBackgroundProcessors()) throw new Error("Background processors are not supported in this browser/device");
    try {
      supportsModernBackgroundProcessors();
    } catch {}
  };

  const makeProcessorForMode = (mode: FxMode, blur: number, bgUrl: string): TrackProcessor<"video"> | null => {
    if (mode === "off") return null;
    if (mode === "blur") return BackgroundBlur(Math.max(1, Math.min(30, Math.round(blur || 12)))) as any;
    return VirtualBackground(bgUrl || DEFAULT_BG_DATA_URL) as any;
  };

  const stopAnyProcessor = async (track: LocalVideoTrack) => {
    try {
      await (track as any).stopProcessor?.(true);
    } catch {}
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

    if (!t) return;

    try {
      await stopAnyProcessor(t);
    } catch {}

    try {
      t.stop?.();
    } catch {}

    setPrejoinPreviewVersion((v) => v + 1);
  };

  const createPrejoinPreparedVideoTrack = async () => {
    const pj = prejoinRef.current;

    await cleanupPrejoinPreparedVideoTrack();

    if (!pj.videoEnabled) return null;

    const track = await createLocalVideoTrack({
      deviceId: pj.videoInputId || undefined,
      resolution: { width: LK_CAPTURE_WIDTH, height: LK_CAPTURE_HEIGHT },
      frameRate: LK_CAPTURE_FPS,
    } as any);

    prejoinPreparedVideoTrackRef.current = track;
    setPrejoinPreviewVersion((v) => v + 1);
    return track;
  };

  const applyPrejoinVideoFx = async (mode: FxMode) => {
    setFxError("");
    setFxApplying(true);
    setFxStatusText("");

    try {
      const pj = prejoinRef.current;
      if (!pj.videoEnabled) throw new Error("Turn camera on in pre-join first");

      let track = prejoinPreparedVideoTrackRef.current;
      if (!track) track = await createPrejoinPreparedVideoTrack();
      if (!track) throw new Error("Pre-join camera track is not ready");

      await safeApplyProcessor(track, mode, blurStrength, bgImageUrl);

      setVideoFxMode(mode);
      setFxStatusText(mode === "off" ? "FX disabled" : mode === "blur" ? `Blur applied (${blurStrength})` : "Virtual background applied");
      setPrejoinPreviewVersion((v) => v + 1);
    } catch (e: any) {
      console.error("applyPrejoinVideoFx failed:", e);
      setFxError(String(e?.message || e || "prejoin_video_fx_failed"));
    } finally {
      setFxApplying(false);
    }
  };

  // show prejoin + init devices + preview
  useEffect(() => {
    if (loading) return;
    if (!session) return;
    if (joinRequested) return;

    setPrejoinOpen(true);

    (async () => {
      await loadBrowserDevices().catch(() => {});
      const pj = prejoinRef.current;
      if (pj.videoEnabled) {
        await createPrejoinPreparedVideoTrack().catch((e) => console.warn("prejoin preview init failed", e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, joinRequested]);

  // prejoin camera switch -> rebuild preview + reapply fx
  useEffect(() => {
    if (!prejoinOpen) return;

    const pj = prejoinRef.current;
    if (!pj.videoEnabled) return;

    const t = window.setTimeout(async () => {
      try {
        await createPrejoinPreparedVideoTrack();
        if (videoFxMode !== "off") await applyPrejoinVideoFx(videoFxMode);
      } catch (e) {
        console.warn("prejoin camera switch failed", e);
      }
    }, 180);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prejoin.videoInputId, prejoinOpen]);

  // prejoin video enabled toggles
  useEffect(() => {
    if (!prejoinOpen) return;

    if (!prejoin.videoEnabled) {
      cleanupPrejoinPreparedVideoTrack().catch(() => {});
      return;
    }

    createPrejoinPreparedVideoTrack().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prejoin.videoEnabled, prejoinOpen]);

  // host flag
  const isHost = useMemo(() => {
    if (!authUserId) return false;
    const hostId = (session as any)?.host_profile?.id || (session as any)?.host_id;
    return !!hostId && String(hostId) === String(authUserId);
  }, [authUserId, session]);

  // moderators (host always admin)
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
    loadModerators(session.id).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  const grantModerator = async (userId: string) => {
    if (!session?.id) return;
    if (!authUserId) return;
    const uid = String(userId || "").toLowerCase();
    if (!looksLikeUuid(uid)) return;

    setRolesError("");
    setRoleBusyKey(`mod:${uid}:grant`);
    try {
      const payload: SessionRoleAssignmentRow = { session_id: session.id, user_id: uid, role: "moderator", granted_by: authUserId };
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

  // tab presence gate refs
  const tabPresenceKeyRef = useRef<string>("");
  const tabPresenceAcquiredRef = useRef<boolean>(false);
  const tabPresenceHeartbeatRef = useRef<number | null>(null);
  const tabPresenceChannelRef = useRef<any>(null);

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
    } catch {}
    try {
      if (tabPresenceChannelRef.current) tabPresenceChannelRef.current.close?.();
    } catch {}
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
        } catch {}
      } catch {}
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildAuthHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token || "";
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    } catch {}
    return headers;
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
          } catch {}
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
      } catch {}
      tabPresenceChannelRef.current = null;
      return { ok: false, max: res.max, count: res.count };
    }

    tabPresenceAcquiredRef.current = true;
    startTabPresenceHeartbeat();
    return { ok: true, max: res.max, count: res.count };
  };

  const requestToken = async () => {
    if (!session) return;
    setTokenError("");
    setTokenLoading(true);

    try {
      const pj = prejoinRef.current;
      const nameToUse = (pj.displayName || displayName || userName || "User").trim() || "User";

      const roomName = safeRoomName(`session-${session.id}`);

      const baseUser = safeIdentity((authUserId && looksLikeUuid(authUserId) ? authUserId : authUserId || nameToUse) as any);
      baseUserIdRef.current = baseUser;

      const identity = safeIdentity(`${baseUser}--${tabId}`);
      livekitIdentityRef.current = identity;

      if (!tabPresenceAcquiredRef.current) {
        const g = tryAcquireTabGate(session.id, baseUser);
        if (!g.ok) {
          const msg = `Too many tabs open for this room (${g.count}/${g.max}). Close another tab and try again.`;
          setTokenError(msg);
          setTokenLoading(false);
          try {
            alert(msg);
          } catch {}
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
          isModerator: !isHost && !!authUserId ? moderatorUserIds.includes(String(authUserId).toLowerCase()) : false,
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
    }
  };

  useEffect(() => {
    (async () => {
      if (!session) return;
      if (!joinRequested) return;
      if (!authReady) return;
      if (lkToken) return;
      await requestToken();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, joinRequested, authReady, isHost, moderatorUserIds.join("|")]);

  // ---- livekit room
  const roomRef = useRef<Room | null>(null);
  const [roomState, setRoomState] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [clientError, setClientError] = useState<string>("");

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenShareOn, setScreenShareOn] = useState(false);

  const [tiles, setTiles] = useState<TileModel[]>([]);
  const [adminBusyKey, setAdminBusyKey] = useState<string>("");
  const [openTileAdminMenuId, setOpenTileAdminMenuId] = useState<string | null>(null);

  // hide/pin (local UI)
  const [hiddenTileIds, setHiddenTileIds] = useState<Record<string, boolean>>({});
  const [pinnedTileId, setPinnedTileId] = useState<string | null>(null);

  // per participant volume (0..100)
  const [volumePctByTileId, setVolumePctByTileId] = useState<Record<string, number>>({});

  // chat unread
  const [unreadChat, setUnreadChat] = useState<number>(0);
  const chatVisibleRef = useRef<boolean>(false);
  const lastChatReadAtRef = useRef<number>(0);

  // reactions (1:1 with iframe)
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const reactionIdRef = useRef<number>(0);
  const reactionsChannelRef = useRef<any>(null);

  // edit name modal
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");

  // keep admin menu stable
  useEffect(() => {
    setOpenTileAdminMenuId((prev) => (prev && tiles.some((t) => t.id === prev) ? prev : null));
  }, [tiles]);

  useEffect(() => {
    if (!openTileAdminMenuId) return;

    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("[data-lk-admin-menu-anchor='true']")) return;
      setOpenTileAdminMenuId(null);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenTileAdminMenuId(null);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openTileAdminMenuId]);

  const participantsCount = useMemo(() => {
    const r = roomRef.current;
    if (!r) return 0;
    return 1 + r.remoteParticipants.size;
  }, [roomState, tiles]);

  const roomNameForApi = useMemo(() => {
    if (!session) return "";
    return safeRoomName(`session-${session.id}`);
  }, [session]);

  // pull profiles for anyone we see in room (for names + avatars)
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
        const { data } = await supabase.from("profiles").select("id, full_name, avatar_url, bio").in("id", missing);
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
        if (Object.keys(patch).length) setProfilesById((prev) => ({ ...prev, ...patch }));
      } catch (e) {
        console.warn("profiles fetch failed", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles.map((t) => `${t.participantUserId || ""}`).join("|")]);

  const applyVolumeToRemoteParticipant = (tileId: string, pct: number) => {
    const r = roomRef.current;
    if (!r) return;
    const p = Array.from(r.remoteParticipants.values()).find((rp) => rp.sid === tileId);
    if (!p) return;

    try {
      const micPub = Array.from(p.audioTrackPublications.values()).find((x: any) => x.source === Track.Source.Microphone) as any;
      const tr = micPub?.track as any;
      const vol = clamp(pct, 0, 100) / 100;

      if (tr?.setVolume) {
        tr.setVolume(vol);
      } else if (typeof (tr as any)?.volume === "number") {
        (tr as any).volume = vol;
      }
    } catch {}
  };

  const setParticipantVolumePct = (tileId: string, pct: number) => {
    const v = clamp(Math.round(pct), 0, 100);
    setVolumePctByTileId((prev) => ({ ...prev, [tileId]: v }));
    applyVolumeToRemoteParticipant(tileId, v);
  };

  const rebuildTiles = () => {
    const room = roomRef.current;
    if (!room) return;

    const next: TileModel[] = [];

    const lp = room.localParticipant;

    const localCamPub = Array.from(lp.videoTrackPublications.values()).find((p) => p.source === Track.Source.Camera) as any;
    const localTrack = (localCamPub?.track as any) || undefined;

    const localMicPub = Array.from(lp.audioTrackPublications.values()).find((p) => p.source === Track.Source.Microphone) as any;

    const localIdentity = String(lp.identity || livekitIdentityRef.current || "");
    const localUserId = authUserId && looksLikeUuid(authUserId) ? String(authUserId).toLowerCase() : extractBaseUserIdFromIdentity(localIdentity);

    next.push({
      id: "local",
      label: (displayName || userName || "You").trim() || "You",
      isLocal: true,
      videoTrack: localTrack,
      participantIdentity: localIdentity || undefined,
      participantUserId: localUserId || undefined,
      micMuted: !!localMicPub?.isMuted || !micOn,
      camMuted: !localCamPub?.track || !!(localCamPub as any)?.isMuted || !camOn,
    });

    room.remoteParticipants.forEach((rp: RemoteParticipant) => {
      const allVideoPubs = Array.from(rp.videoTrackPublications.values()) as RemoteTrackPublication[];
      const allAudioPubs = Array.from(rp.audioTrackPublications.values()) as RemoteAudioTrackPublication[];

      const camPub = allVideoPubs.find((p: any) => p.source === Track.Source.Camera) as any;
      const micPub = allAudioPubs.find((p: any) => p.source === Track.Source.Microphone) as any;

      const vt = (camPub?.track as any) || undefined;

      const exactIdentity = String(rp.identity || "");
      const baseUserId = extractBaseUserIdFromIdentity(exactIdentity);
      const prof = looksLikeUuid(baseUserId) ? profilesById[String(baseUserId).toLowerCase()] : undefined;

      const nameFromProfile = String(prof?.full_name || "").trim();
      const nm = (nameFromProfile || rp.name || rp.identity || "Guest").trim() || "Guest";

      const tileId = rp.sid;

      next.push({
        id: tileId,
        label: nm,
        isLocal: false,
        videoTrack: vt,
        participantIdentity: exactIdentity || undefined,
        participantUserId: baseUserId || undefined,
        micTrackSid: micPub?.trackSid,
        camTrackSid: camPub?.trackSid,
        micMuted: !!(micPub as any)?.isMuted,
        camMuted: !!(camPub as any)?.isMuted || !vt,
      });

      // apply stored volume immediately
      const pct = Number(volumePctByTileId[tileId] ?? 100);
      if (Number.isFinite(pct)) applyVolumeToRemoteParticipant(tileId, pct);
    });

    setTiles(next);

    try {
      const lpScreenPub = Array.from(lp.videoTrackPublications.values()).find((p: any) => p.source === Track.Source.ScreenShare) as any;
      setScreenShareOn(!!lpScreenPub?.track && !lpScreenPub?.isMuted);
    } catch {
      setScreenShareOn(false);
    }
  };

  const disconnectRoom = async () => {
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
      setFxStatusText("");
      setFxError("");
      setFxApplying(false);
      setOpenTileAdminMenuId(null);

      releaseTabPresence();
    }
  };

  const getLocalCameraPublication = () => {
    const r = roomRef.current;
    if (!r) return null;
    const lp = r.localParticipant;
    const pub = Array.from(lp.videoTrackPublications.values()).find((p: LocalTrackPublication) => p.source === Track.Source.Camera);
    return pub || null;
  };

  const getLocalCameraTrack = (): LocalVideoTrack | null => {
    const pub = getLocalCameraPublication();
    return (pub?.track as any) || null;
  };

  const connectRoom = async () => {
    if (!lkServerUrl || !lkToken) return;

    setClientError("");
    setFxError("");

    await disconnectRoom();

    try {
      const pj = prejoinRef.current;

      const r = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      roomRef.current = r;
      setRoomState(r);

      const refresh = () => rebuildTiles();

      r.on(RoomEvent.Connected, () => {
        setConnected(true);
        refresh();
      });

      r.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setTiles([]);
        setOpenTileAdminMenuId(null);
        releaseTabPresence();
      });

      r.on(RoomEvent.Reconnected, refresh);
      r.on(RoomEvent.ParticipantConnected, refresh);
      r.on(RoomEvent.ParticipantDisconnected, refresh);
      r.on(RoomEvent.TrackSubscribed, refresh);
      r.on(RoomEvent.TrackUnsubscribed, refresh);
      r.on(RoomEvent.LocalTrackPublished as any, refresh as any);
      r.on(RoomEvent.LocalTrackUnpublished as any, refresh as any);
      r.on(RoomEvent.TrackMuted as any, refresh as any);
      r.on(RoomEvent.TrackUnmuted as any, refresh as any);

      await r.connect(lkServerUrl, lkToken, { autoSubscribe: true });

      // mic
      if (pj.audioEnabled) {
        await r.localParticipant.setMicrophoneEnabled(true, { deviceId: pj.audioInputId || undefined } as any);
        setMicOn(true);
      } else {
        await r.localParticipant.setMicrophoneEnabled(false);
        setMicOn(false);
      }

      // cam
      let usedPrepared = false;

      if (pj.videoEnabled) {
        const prepared = prejoinPreparedVideoTrackRef.current;

        if (prepared) {
          await r.localParticipant.publishTrack(prepared, { source: Track.Source.Camera } as any);
          setCamOn(true);
          usedPrepared = true;
          prejoinPreparedVideoTrackRef.current = null;
        } else {
          await r.localParticipant.setCameraEnabled(
            true,
            {
              deviceId: pj.videoInputId || undefined,
              resolution: { width: LK_CAPTURE_WIDTH, height: LK_CAPTURE_HEIGHT },
              frameRate: LK_CAPTURE_FPS,
            } as any
          );
          setCamOn(true);
        }
      } else {
        await r.localParticipant.setCameraEnabled(false);
        setCamOn(false);
      }

      refresh();

      setPrejoinOpen(false);
      setPrejoinPreviewVersion((v) => v + 1);

      // if not using prepared track, re-apply selected FX after connect
      if (!usedPrepared && pj.videoEnabled && videoFxMode !== "off") {
        await delay(80);
        const tr = getLocalCameraTrack();
        if (tr) {
          try {
            await safeApplyProcessor(tr, videoFxMode, blurStrength, bgImageUrl);
            setFxStatusText(videoFxMode === "blur" ? `Blur applied (strength ${blurStrength})` : "Virtual background applied");
          } catch (e: any) {
            console.warn("auto-apply fx after connect failed:", e);
          }
        }
      }
    } catch (e: any) {
      console.error("LiveKit connect failed:", e);
      setClientError(String(e?.message || e || "connect_failed"));
      await disconnectRoom();
    }
  };

  useEffect(() => {
    if (!joinRequested) return;
    if (!lkToken) return;
    if (!lkServerUrl) return;
    connectRoom().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinRequested, lkToken, lkServerUrl]);

  useEffect(() => {
    return () => {
      disconnectRoom().catch(() => {});
      cleanupPrejoinPreparedVideoTrack().catch(() => {});
      if (uploadedBgUrlRef.current) {
        try {
          URL.revokeObjectURL(uploadedBgUrlRef.current);
        } catch {}
      }
      stopWelcomeLoop();
      releaseTabPresence();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // local toggles
  const toggleMic = async () => {
    const r = roomRef.current;
    if (!r) return;
    try {
      const next = !micOn;
      await r.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
      window.setTimeout(() => rebuildTiles(), 40);
    } catch (e) {
      console.error("toggleMic error:", e);
    }
  };

  const toggleCam = async () => {
    const r = roomRef.current;
    if (!r) return;

    try {
      const next = !camOn;

      await r.localParticipant.setCameraEnabled(
        next,
        next
          ? ({
              deviceId: prejoinRef.current.videoInputId || undefined,
              resolution: { width: LK_CAPTURE_WIDTH, height: LK_CAPTURE_HEIGHT },
              frameRate: LK_CAPTURE_FPS,
            } as any)
          : undefined
      );

      setCamOn(next);

      if (!next) {
        try {
          const tr = getLocalCameraTrack();
          if (tr) await stopAnyProcessor(tr);
        } catch {}
        setFxStatusText("");
        setFxError("");
      } else {
        if (videoFxMode !== "off") {
          await delay(80);
          const tr = getLocalCameraTrack();
          if (tr) await safeApplyProcessor(tr, videoFxMode, blurStrength, bgImageUrl);
        }
      }

      rebuildTiles();
    } catch (e) {
      console.error("toggleCam error:", e);
    }
  };

  const toggleScreenShare = async () => {
    const r = roomRef.current;
    if (!r) return;
    try {
      const next = !screenShareOn;
      await (r.localParticipant as any).setScreenShareEnabled(next);
      setScreenShareOn(next);
      window.setTimeout(() => rebuildTiles(), 80);
    } catch (e) {
      console.error("toggleScreenShare error:", e);
    }
  };

  const leave = async () => {
    await disconnectRoom();
    navigate("/sessions", { replace: true });
  };

  // --- admin endpoint (host OR moderator)
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

  // optimistic mute in tiles (fixes perceived latency)
  const optimisticMute = (tileId: string, kind: "mic" | "cam") => {
    setTiles((prev) =>
      prev.map((t) => {
        if (t.id !== tileId) return t;
        if (kind === "mic") return { ...t, micMuted: true };
        return { ...t, camMuted: true, videoTrack: t.videoTrack }; // keep track; UI will show muted badge anyway
      })
    );
  };

  // ONLY MUTE actions (no unmute)
  const adminMuteRemoteTrack = async (tileId: string, participantIdentity: string, trackSid: string, kind: "mic" | "cam") => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:${trackSid}:mute`;
    setAdminBusyKey(busyKey);

    // optimistic
    optimisticMute(tileId, kind);

    try {
      await callAdmin({
        action: "mute_track",
        roomName,
        participantIdentity,
        trackSid,
      });

      // rebuild immediately (no delay)
      rebuildTiles();
    } catch (e: any) {
      console.error(`mute ${kind} failed:`, e);
      alert(String(e?.message || e || "mute_failed"));
      rebuildTiles();
    } finally {
      setAdminBusyKey("");
    }
  };

  const adminKickParticipant = async (participantIdentity: string) => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:kick`;
    setAdminBusyKey(busyKey);

    try {
      await callAdmin({
        action: "remove_participant",
        roomName,
        participantIdentity,
      });
      rebuildTiles();
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
      if (!camOn) throw new Error("Turn camera on first (Cam on), then apply FX.");

      const tr = getLocalCameraTrack();
      if (!tr) throw new Error("Camera track is not ready");

      await safeApplyProcessor(tr, mode, blurStrength, bgImageUrl);

      setVideoFxMode(mode);
      setFxStatusText(mode === "off" ? "FX disabled" : mode === "blur" ? `Blur applied (strength ${blurStrength})` : "Virtual background applied");

      await delay(40);
    } catch (e: any) {
      console.error("applyVideoFx failed:", e);
      setFxError(String(e?.message || e || "video_fx_failed"));
    } finally {
      setFxApplying(false);
    }
  };

  // auto re-apply blur/bg after changes
  useEffect(() => {
    if (!connected || !camOn) return;
    if (videoFxMode !== "blur") return;
    if (fxApplying) return;

    const t = window.setTimeout(() => {
      applyVideoFx("blur").catch(() => {});
    }, 220);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blurStrength]);

  useEffect(() => {
    if (!connected || !camOn) return;
    if (videoFxMode !== "bg") return;
    if (fxApplying) return;

    const t = window.setTimeout(() => {
      applyVideoFx("bg").catch(() => {});
    }, 220);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgImageUrl]);

  // =========================
  // chat unread badge (like iframe)
  // =========================
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
    } catch {}
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
        const sinceIso = lastRead > 0 ? new Date(lastRead).toISOString() : "1970-01-01T00:00:00.000Z";

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

  // =========================
  // reactions broadcast (1:1 with iframe)
  // =========================
  const pushFloatingReaction = (type: ReactionType, fromUserId: string, fromName: string) => {
    if (!type || !REACTION_EMOJI[type]) return;

    const id = reactionIdRef.current + 1;
    reactionIdRef.current = id;

    setFloatingReactions((prev) => {
      const next = [...prev, { id, type, fromUserId, fromName }];
      return next.length > 12 ? next.slice(-12) : next;
    });

    window.setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
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

      // local echo
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
    } catch {}
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

    // update profiles
    if (authUserId) {
      try {
        await supabase.from("profiles").update({ full_name: nm }).eq("id", authUserId);
      } catch {}
    }

    setDisplayName(nm);
    setUserName(nm);
    setPrejoin((prev) => ({ ...prev, displayName: nm }));

    // best-effort livekit rename
    try {
      const r = roomRef.current;
      const lp: any = r?.localParticipant as any;
      if (lp?.setName) await lp.setName(nm);
    } catch {}

    rebuildTiles();
    setEditNameOpen(false);
  };

  // report participant (best-effort)
  const reportParticipant = async (t: TileModel) => {
    try {
      const reason = window.prompt(`Report "${t.label}" — reason?`, "");
      if (reason === null) return;

      const payload = {
        session_id: session?.id || null,
        reporter_user_id: authUserId || null,
        target_identity: t.participantIdentity || null,
        target_user_id: looksLikeUuid(String(t.participantUserId || "")) ? String(t.participantUserId).toLowerCase() : null,
        reason: String(reason || "").trim(),
        created_at: new Date().toISOString(),
      };

      // you can create this table later: participant_reports
      await supabase.from("participant_reports").insert(payload as any);
      alert("Report submitted ✅");
    } catch (e) {
      alert("Report saved locally (backend table may be missing).");
    }
  };

  // =========================
  // tile list with hide/pin
  // =========================
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

  const tilesForRender = useMemo(() => {
    const list = tilesBaseForUi.filter((t) => !hiddenTileIds[t.id]);
    const local = list.find((t) => t.isLocal);
    const remotes = list.filter((t) => !t.isLocal);

    const pinned = pinnedTileId ? remotes.find((t) => t.id === pinnedTileId) : undefined;
    const remRest = remotes.filter((t) => t.id !== pinnedTileId);

    const ordered = [
      ...(local ? [local] : []),
      ...(pinned ? [pinned] : []),
      ...remRest,
    ];

    return ordered;
  }, [tilesBaseForUi, hiddenTileIds, pinnedTileId]);

  // sizing measurement
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
    const ro = new ResizeObserver(() => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        try {
          window.dispatchEvent(new Event("resize"));
        } catch {}
      });
    });

    ro.observe(el);

    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const roomReadyText = !joinRequested ? "Waiting to join…" : tokenLoading ? "Preparing token…" : !connected ? "Connecting to LiveKit…" : "";
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

  // badge
  const getBadgeForTile = (t: TileModel): string | null => {
    if (t.isLocal) {
      if (isHost) return "Host";
      if (isSelfModerator) return "Moderator";
      return null;
    }

    const pid = (t.participantUserId || extractBaseUserIdFromIdentity(String(t.participantIdentity || ""))).toLowerCase();
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
    if (t.isLocal) return !camOn || !!t.camMuted || !t.videoTrack;
    return !!t.camMuted || !t.videoTrack;
  };

  const renderAvatarFallback = (t: TileModel) => {
    const avatar = getAvatarForTile(t);
    const name = t.label || "User";
    const initials = getInitials(name);
    const pinned = pinnedTileId === t.id;

    return (
      <div
        className={[
          "absolute inset-0 z-10 flex flex-col items-center justify-center",
          isLight ? "bg-white/80" : "bg-[#020617]/60",
        ].join(" ")}
      >
        <div
          className={[
            "w-[78px] h-[78px] rounded-full overflow-hidden flex items-center justify-center shadow-2xl border",
            isLight ? "border-black/10 bg-black/5" : "border-white/10 bg-white/5",
            pinned ? (isLight ? "ring-2 ring-blue-500/60" : "ring-2 ring-emerald-400/60") : "",
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
                } catch {}
              }}
            />
          ) : (
            <div className={`text-xl font-bold ${isLight ? "text-black/70" : "text-white/85"}`}>{initials}</div>
          )}
        </div>

        <div className={`mt-3 px-3 py-1.5 rounded-xl border ${isLight ? "border-black/10 bg-white/70 text-black/80" : "border-white/10 bg-black/30 text-white/85"}`}>
          <div className="text-[13px] font-semibold max-w-[260px] truncate text-center">{name}</div>
        </div>
      </div>
    );
  };

  // TILE MENU rendering (mute-only, plus hide/pin/report)
  const renderTile = (t: TileModel) => {
    const isMenuOpen = openTileAdminMenuId === t.id;
    const canAdminTarget = isSelfModerator && !t.isLocal && !!t.participantIdentity;
    const pidBase = String(t.participantUserId || extractBaseUserIdFromIdentity(String(t.participantIdentity || ""))).toLowerCase();
    const canRoleManageTarget = isHost && !!pidBase && looksLikeUuid(pidBase) && !t.isLocal;
    const isTargetModerator = !!pidBase && moderatorUserIds.includes(pidBase);
    const roleBusy = roleBusyKey === `mod:${pidBase}:grant` || roleBusyKey === `mod:${pidBase}:revoke`;

    const hasMicTrack = !!t.micTrackSid && !!t.participantIdentity;
    const hasCamTrack = !!t.camTrackSid && !!t.participantIdentity;

    const muteMicDisabled = !canAdminTarget || !hasMicTrack || !!t.micMuted;
    const muteCamDisabled = !canAdminTarget || !hasCamTrack || !!t.camMuted;

    const kickDisabled = !canAdminTarget || !t.participantIdentity;

    const isHidden = !!hiddenTileIds[t.id];
    const isPinned = pinnedTileId === t.id;

    const busyMuteMic = !!t.participantIdentity && !!t.micTrackSid && adminBusyKey === `${t.participantIdentity}:${t.micTrackSid}:mute`;
    const busyMuteCam = !!t.participantIdentity && !!t.camTrackSid && adminBusyKey === `${t.participantIdentity}:${t.camTrackSid}:mute`;
    const busyKick = !!t.participantIdentity && adminBusyKey === `${t.participantIdentity}:kick`;

    const showAdminMenu =
      (!t.isLocal && (canAdminTarget || canRoleManageTarget)) ||
      (!t.isLocal) ||
      t.isLocal;

    const camOff = isTileCamOff(t);

    return (
      <div
        className={[
          "relative group w-full",
          isPinned ? (isLight ? "ring-2 ring-blue-500/50" : "ring-2 ring-emerald-400/50") : "",
        ].join(" ")}
        style={{ aspectRatio: "16 / 9" }}
        onMouseLeave={() => {
          setOpenTileAdminMenuId((prev) => (prev === t.id ? null : prev));
        }}
      >
        <VideoTile
          label={t.label}
          videoTrack={t.videoTrack}
          isLocal={t.isLocal}
          theme={theme}
          showBadge={getBadgeForTile(t)}
          hostActions={undefined}
        />

        {/* avatar overlay when cam off */}
        {camOff && renderAvatarFallback(t)}

        {/* mic/cam indicators (fix #1.1 + UX) */}
        <div className="absolute bottom-2 left-2 z-20 flex items-center gap-2">
          <div
            className={[
              "w-8 h-8 rounded-xl flex items-center justify-center border shadow",
              t.micMuted ? (isLight ? "bg-red-500/10 border-red-500/20" : "bg-red-500/20 border-red-500/25") : isLight ? "bg-white/70 border-black/10" : "bg-black/30 border-white/10",
            ].join(" ")}
            title={t.micMuted ? "Mic muted" : "Mic on"}
          >
            <Icon name={t.micMuted ? "mic-off" : "mic-on"} theme={theme} className="w-4 h-4" />
          </div>

          <div
            className={[
              "w-8 h-8 rounded-xl flex items-center justify-center border shadow",
              t.camMuted ? (isLight ? "bg-red-500/10 border-red-500/20" : "bg-red-500/20 border-red-500/25") : isLight ? "bg-white/70 border-black/10" : "bg-black/30 border-white/10",
            ].join(" ")}
            title={t.camMuted ? "Camera off" : "Camera on"}
          >
            <Icon name={t.camMuted ? "camera-off" : "camera-on"} theme={theme} className="w-4 h-4" />
          </div>
        </div>

        {/* menu */}
        {showAdminMenu && (
          <div className="absolute top-2 right-2 z-30" data-lk-admin-menu-anchor="true" onClick={(e) => e.stopPropagation()}>
            <div className="relative">
              <button
                type="button"
                title="Participant actions"
                aria-label="Participant actions"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenTileAdminMenuId((prev) => (prev === t.id ? null : t.id));
                }}
                className={[
                  "w-9 h-9 rounded-xl flex items-center justify-center transition shadow-sm",
                  isLight ? "bg-white/90 border border-black/10 text-black/75 hover:bg-white" : "bg-black/55 border border-white/10 text-white/90 hover:bg-black/70",
                  isMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                ].join(" ")}
              >
                <span className="text-lg leading-none -mt-[2px]">⋯</span>
              </button>

              {isMenuOpen && (
                <div
                  className={`absolute right-0 top-[calc(100%+8px)] w-[240px] rounded-2xl shadow-2xl overflow-hidden ${
                    isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"
                  }`}
                >
                  {/* roles (host only) */}
                  {canRoleManageTarget && (
                    <>
                      <div className={`px-4 py-2 text-[11px] ${isLight ? "text-black/45" : "text-white/45"}`}>Roles</div>

                      {!isTargetModerator ? (
                        <button
                          type="button"
                          disabled={roleBusy || rolesLoading}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!pidBase) return;
                            await grantModerator(pidBase);
                            setOpenTileAdminMenuId(null);
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${
                            isLight ? "text-black/80 hover:bg-black/5" : "text-white/90 hover:bg-white/5"
                          }`}
                        >
                          Make moderator
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={roleBusy || rolesLoading}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!pidBase) return;
                            await revokeModerator(pidBase);
                            setOpenTileAdminMenuId(null);
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${
                            isLight ? "text-black/80 hover:bg-black/5" : "text-white/90 hover:bg-white/5"
                          }`}
                        >
                          Remove moderator
                        </button>
                      )}

                      <div className={isLight ? "h-px bg-black/10" : "h-px bg-white/10"} />
                    </>
                  )}

                  {/* mute only (no unmute) */}
                  {!t.isLocal && (
                    <>
                      <div className={`px-4 py-2 text-[11px] ${isLight ? "text-black/45" : "text-white/45"}`}>Moderation</div>

                      <button
                        type="button"
                        disabled={muteMicDisabled || busyMuteMic}
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!t.participantIdentity || !t.micTrackSid) return;
                          if (muteMicDisabled) return;
                          await adminMuteRemoteTrack(t.id, t.participantIdentity, t.micTrackSid, "mic");
                          setOpenTileAdminMenuId(null);
                        }}
                        className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${
                          isLight ? "text-black/80 hover:bg-black/5" : "text-white/90 hover:bg-white/5"
                        }`}
                        title={t.micMuted ? "Already muted" : !hasMicTrack ? "No mic track" : "Mute mic"}
                      >
                        Mute Mic
                      </button>

                      <button
                        type="button"
                        disabled={muteCamDisabled || busyMuteCam}
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!t.participantIdentity || !t.camTrackSid) return;
                          if (muteCamDisabled) return;
                          await adminMuteRemoteTrack(t.id, t.participantIdentity, t.camTrackSid, "cam");
                          setOpenTileAdminMenuId(null);
                        }}
                        className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${
                          isLight ? "text-black/80 hover:bg-black/5" : "text-white/90 hover:bg-white/5"
                        }`}
                        title={t.camMuted ? "Already muted" : !hasCamTrack ? "No cam track" : "Mute cam"}
                      >
                        Mute Camera
                      </button>

                      <div className={isLight ? "h-px bg-black/10" : "h-px bg-white/10"} />
                    </>
                  )}

                  {/* local actions */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(t.id);
                    }}
                    className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/80 hover:bg-black/5" : "text-white/90 hover:bg-white/5"}`}
                  >
                    {isPinned ? "Unpin participant" : "Pin participant"}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleHide(t.id);
                    }}
                    className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/80 hover:bg-black/5" : "text-white/90 hover:bg-white/5"}`}
                  >
                    {isHidden ? "Unhide participant" : "Hide participant"}
                  </button>

                  {!t.isLocal && (
                    <>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await reportParticipant(t);
                          setOpenTileAdminMenuId(null);
                        }}
                        className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/80 hover:bg-black/5" : "text-white/90 hover:bg-white/5"}`}
                      >
                        Report participant
                      </button>

                      <div className={isLight ? "h-px bg-black/10" : "h-px bg-white/10"} />

                      <button
                        type="button"
                        disabled={kickDisabled || busyKick}
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!t.participantIdentity) return;
                          if (!confirm(`Kick "${t.label}"?`)) return;
                          await adminKickParticipant(t.participantIdentity);
                          setOpenTileAdminMenuId(null);
                        }}
                        className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${
                          isLight ? "text-red-700 hover:bg-red-50" : "text-red-300 hover:bg-red-500/10"
                        }`}
                      >
                        Kick participant
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Layout
  const tileCount = tilesForRender.length;
  const paddingBottomPx = 12;

  const isVeryNarrow = effectiveW < 430;
  const isNarrowForColumns = effectiveW < 520;
  const isCompact = effectiveW < 900;

  const isMobileQuery = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(max-width: 767px)").matches;
  }, []);
  const isTabletQuery = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(min-width: 768px) and (max-width: 1023px)").matches;
  }, []);

  const useVeryNarrowMode = isVeryNarrow || (isMobileQuery && isNarrowForColumns);
  const stackTwoOnThisViewport = tileCount === 2 && !useVeryNarrowMode && (isTabletQuery || (isMobileQuery && effectiveW < 640) || isCompact);

  const videoLayout = (
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
            <MobileFillLayoutSizing<TileModel>
              items={tilesForRender}
              containerWidth={effectiveW}
              containerHeight={effectiveH}
              paddingBottomPx={paddingBottomPx}
              renderItem={(t) => renderTile(t)}
            />
          ) : (
            <MobileStackLayoutSizing<TileModel> items={tilesForRender} paddingBottomPx={paddingBottomPx} renderItem={(t) => renderTile(t)} />
          )
        ) : tileCount <= 2 ? (
          <P2PLayoutSizing<TileModel>
            items={tilesForRender}
            containerWidth={effectiveW}
            containerHeight={effectiveH}
            stack={stackTwoOnThisViewport}
            renderItem={(t) => renderTile(t)}
          />
        ) : (
          <GridLayoutSizing<TileModel>
            items={tilesForRender}
            containerWidth={effectiveW}
            containerHeight={effectiveH}
            forceThreeAsTwoPlusOne={rightPanelOpen}
            renderItem={(t) => renderTile(t)}
          />
        )
      ) : null}
    </>
  );

  const videoContent = (
    <div className="w-full h-full min-h-0 relative">
      {roomReadyText ? (
        <div className={`absolute inset-0 flex items-center justify-center z-10 ${isLight ? "text-black/60" : "text-white/70"}`}>
          <div className={`px-4 py-2 rounded-xl ${isLight ? "bg-white/70" : "bg-black/30"}`}>{roomReadyText}</div>
        </div>
      ) : null}

      {videoLayout}

      {/* reactions overlay (1:1 with iframe) */}
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
                <div className="mt-1 text-[12px] leading-tight opacity-80 max-w-[260px] truncate">{r.fromName}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // UI colors
  const pageBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
  const panelBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#0B1220]/55 border border-white/5";

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
    <div className={`rounded-2xl shadow-lg overflow-hidden min-h-0 h-full flex flex-col ${panelBg} ${theme === "dark" ? "dark" : ""}`} data-theme={theme} style={{ colorScheme: theme }}>
      {rightTab === "participants" && (
        <div className="h-full min-h-0 flex flex-col">
          <div className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"}`}>
            <div className="flex items-center gap-2 min-w-0">
              <span className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold truncate`}>Participants</span>
              <span className={`${isLight ? "text-black/50" : "text-white/55"} text-sm`}>({participantsCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openEditName}
                className={`px-3 h-9 rounded-xl text-[12px] font-semibold border transition ${isLight ? "bg-black/5 border-black/10 hover:bg-black/10 text-black/70" : "bg-white/5 border-white/10 hover:bg-white/10 text-white/85"}`}
                title="Edit my name"
              >
                Edit my name
              </button>

              <button
                onClick={() => openRightTab(null)}
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"}`}
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="p-4">
            <div className={`rounded-xl px-3 py-2 ${isLight ? "bg-black/5 border border-black/10" : "bg-[#0B1220]/70 border border-white/10"}`}>
              <input
                value={participantsSearch}
                onChange={(e) => setParticipantsSearch(e.target.value)}
                placeholder="Search participants..."
                className={`w-full bg-transparent outline-none text-[13px] placeholder:opacity-60 ${isLight ? "text-black/80 placeholder:text-black/40" : "text-white/85 placeholder:text-white/35"}`}
              />
            </div>

            {rolesError ? <div className={`mt-2 text-[12px] ${isLight ? "text-red-600" : "text-red-300"}`}>{rolesError}</div> : null}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
            <div className="flex flex-col gap-2">
              {participantsForPanel.map((p) => {
                const isHidden = !!hiddenTileIds[p.id];
                const isPinned = pinnedTileId === p.id;

                const avatar = getAvatarForTile(p);
                const initials = getInitials(p.label);

                const volPct = p.isLocal ? 100 : Number(volumePctByTileId[p.id] ?? 100);

                const pidBase = String(p.participantUserId || "").toLowerCase();
                const isMod = !p.isLocal && looksLikeUuid(pidBase) ? moderatorUserIds.includes(pidBase) : p.isLocal ? isSelfModerator && !isHost : false;

                const roleText = p.isLocal ? (isHost ? "Host" : isMod ? "Moderator" : "You") : isMod ? "Moderator" : "Participant";

                return (
                  <div key={p.id} className={`px-3 py-2 rounded-xl transition ${isLight ? "hover:bg-black/5" : "hover:bg-white/5"}`}>
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
                              } catch {}
                            }}
                          />
                        ) : (
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${isLight ? "bg-blue-500/15 text-blue-700" : "bg-emerald-500/80 text-[#02140B]"}`}>
                            {initials}
                          </div>
                        )}

                        <div className="min-w-0">
                          <div className={`text-[13px] font-medium truncate ${isLight ? "text-black/85" : "text-white/90"}`}>
                            {p.label}
                            {isPinned ? <span className="ml-2 opacity-70">📌</span> : null}
                            {isHidden ? <span className="ml-2 opacity-70">🙈</span> : null}
                          </div>
                          <div className={`text-[11px] truncate ${isLight ? "text-black/45" : "text-white/45"}`}>{roleText}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div
                          className={"w-8 h-8 rounded-lg flex items-center justify-center " + (p.micMuted ? (isLight ? "bg-red-500/10" : "bg-red-500/20") : isLight ? "bg-black/5" : "bg-white/5")}
                          title={p.micMuted ? "Muted" : "Unmuted"}
                        >
                          <Icon name={p.micMuted ? "mic-off" : "mic-on"} theme={theme} className={`w-4 h-4 ${p.micMuted ? "opacity-90" : "opacity-80"}`} />
                        </div>

                        <div
                          className={"w-8 h-8 rounded-lg flex items-center justify-center " + (p.camMuted ? (isLight ? "bg-red-500/10" : "bg-red-500/20") : isLight ? "bg-black/5" : "bg-white/5")}
                          title={p.camMuted ? "Video off" : "Video on"}
                        >
                          <Icon name={p.camMuted ? "camera-off" : "camera-on"} theme={theme} className={`w-4 h-4 ${p.camMuted ? "opacity-90" : "opacity-80"}`} />
                        </div>

                        <button
                          onClick={() => togglePin(p.id)}
                          className={`w-9 h-9 rounded-xl flex items-center justify-center border transition ${isLight ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/70" : "border-white/10 bg-white/5 hover:bg-white/10 text-white/85"}`}
                          title={isPinned ? "Unpin" : "Pin"}
                        >
                          📌
                        </button>

                        <button
                          onClick={() => toggleHide(p.id)}
                          className={`w-9 h-9 rounded-xl flex items-center justify-center border transition ${isLight ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/70" : "border-white/10 bg-white/5 hover:bg-white/10 text-white/85"}`}
                          title={isHidden ? "Unhide" : "Hide"}
                        >
                          🙈
                        </button>
                      </div>
                    </div>

                    {/* volume slider (remote only) */}
                    {!p.isLocal && (
                      <div className="mt-2 flex items-center gap-3">
                        <div className={`text-[11px] ${isLight ? "text-black/55" : "text-white/55"} w-[46px]`}>Vol</div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Number.isFinite(volPct) ? volPct : 100}
                          onChange={(e) => setParticipantVolumePct(p.id, Number(e.target.value))}
                          className="w-full"
                        />
                        <div className={`text-[11px] ${isLight ? "text-black/55" : "text-white/55"} w-[40px] text-right`}>{Number.isFinite(volPct) ? volPct : 100}%</div>
                      </div>
                    )}
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
              className={`w-full h-12 rounded-xl font-semibold flex items-center justify-center gap-2 ${isLight ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"}`}
            >
              <span className="text-lg">⎘</span>
              <span>Copy invite link</span>
            </button>
          </div>
        </div>
      )}

      {rightTab === "chat" && (
        <div className="h-full min-h-0 flex flex-col">
          <div className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"}`}>
            <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>Chat</div>
            <button
              onClick={() => openRightTab(null)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"}`}
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 min-h-0 p-4 overflow-hidden">
            <div className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight ? "bg-white/70 border border-black/10" : "bg-[#020617]/40 border border-white/10"}`}>
              <div className="h-full min-h-0 flex flex-col overflow-hidden [&>*]:h-full [&>*]:min-h-0">
                {session?.id ? (
                  <div data-theme={theme} style={{ colorScheme: theme }} className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}>
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
          <div className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"}`}>
            <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>Intentions</div>
            <button
              onClick={() => openRightTab(null)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"}`}
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden p-4">
            <div className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight ? "bg-white/70 border border-black/10" : "bg-[#020617]/40 border border-white/10"}`}>
              <div className="h-full min-h-0 overflow-y-auto [&>*]:min-h-0">
                <div data-theme={theme} style={{ colorScheme: theme }} className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}>
                  {session?.id ? <IntentionsPanel key={`intentions-${session.id}-${theme}`} theme={theme} sessionId={session.id} timerText={remainingTime || "--:--"} /> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (loading) return <div className={`flex h-screen items-center justify-center ${pageBg}`}>Loading session...</div>;

  if (!session) {
    return (
      <div className={`flex h-screen items-center justify-center ${pageBg}`}>
        <button onClick={() => navigate("/sessions")}>Back</button>
      </div>
    );
  }

  return (
    <>
      {/* reactions CSS (1:1 with iframe) */}
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
      `}</style>

      <PreJoinModal
        open={prejoinOpen}
        theme={theme}
        devices={devices}
        value={prejoin}
        onChange={setPrejoin}
        onRefreshDevices={() => loadBrowserDevices().catch(() => {})}
        onCancel={() => {
          cleanupPrejoinPreparedVideoTrack().catch(() => {});
          releaseTabPresence();
          navigate("/sessions", { replace: true });
        }}
        onJoin={() => {
          const pj = prejoinRef.current;
          const nm = (pj.displayName || displayName || userName || "User").trim() || "User";

          const baseUser = safeIdentity((authUserId && looksLikeUuid(authUserId) ? authUserId : authUserId || nm) as any);
          if (session?.id && !tabPresenceAcquiredRef.current) {
            const g = tryAcquireTabGate(session.id, baseUser);
            if (!g.ok) {
              const msg = `Too many tabs open for this room (${g.count}/${g.max}). Close another tab and try again.`;
              setTokenError(msg);
              try {
                alert(msg);
              } catch {}
              setPrejoinOpen(true);
              setJoinRequested(false);
              return;
            }
          }

          setDisplayName(nm);
          setSelectedAudioOutputId(pj.audioOutputId || "default");

          setPrejoinOpen(false);
          setJoinRequested(true);
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
            } catch {}
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
              className={`relative rounded-2xl overflow-hidden min-h-0 h-full ${isLight ? "bg-white/70 border border-black/10" : "bg-[#0B1220]/45 border border-white/5"}`}
            >
              {videoContent}
              {lastErr && (
                <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow z-30 max-w-[80%] break-words">
                  {lastErr}
                </div>
              )}
            </div>

            {rightPanelOpen && isLgUp && <div className="min-h-0 h-full overflow-hidden">{RightPanelBody}</div>}

            {rightPanelOpen && !isLgUp && (
              <div className="absolute inset-0 z-40 min-h-0">
                <div className="absolute inset-0 bg-black/40" onClick={() => openRightTab(null)} />
                <div className="absolute inset-x-0 top-0 bottom-0 p-2 min-h-0">{RightPanelBody}</div>
              </div>
            )}
          </div>
        </div>

        <RemoteAudioRenderer room={roomState} audioOutputId={selectedAudioOutputId} />

        {/* Bottom controls (VideoControls like iframe) */}
        <VideoControls
          theme={theme}
          tile={true}
          mutedAudio={!micOn}
          mutedVideo={!camOn}
          isScreenSharing={screenShareOn}
          unreadChat={unreadChat}
          onOpenTab={(tab) => openRightTab(tab)}
          onToggleAudio={() => toggleMic().catch?.(() => {})}
          onToggleVideo={() => toggleCam().catch?.(() => {})}
          onToggleScreenShare={() => toggleScreenShare().catch?.(() => {})}
          onToggleTile={() => {
            // no-op for LiveKit (kept for UI parity)
          }}
          onReloadRoom={() => {
            // reload = disconnect + return to prejoin
            disconnectRoom().catch(() => {});
            setLkToken("");
            setJoinRequested(false);
            setPrejoinOpen(true);
          }}
          onSendReaction={sendReaction}
          onLeave={() => leave().catch?.(() => {})}
        />

        {/* settings */}
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
          onClose={() => setSettingsOpen(false)}
          fxError={fxError}
          fxApplying={fxApplying}
          fxStatusText={fxStatusText}
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
              } catch {}
              uploadedBgUrlRef.current = null;
            }
            setBgImageUrl(DEFAULT_BG_DATA_URL);
          }}
        />

        {/* edit name modal */}
        {editNameOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => setEditNameOpen(false)} />
            <div className={`relative w-[92%] max-w-[480px] rounded-2xl border shadow-2xl p-5 ${isLight ? "bg-white border-black/10" : "bg-[#020617] border-white/10"}`}>
              <div className={`text-[16px] font-semibold ${isLight ? "text-black/85" : "text-white/90"}`}>Edit your name</div>
              <div className={`mt-1 text-[12px] ${isLight ? "text-black/50" : "text-white/50"}`}>Saved into Supabase profiles (full_name).</div>

              <input
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                placeholder="Your name"
                className={`mt-4 w-full rounded-xl px-3 py-2 outline-none border ${isLight ? "bg-white border-black/10 text-black/85" : "bg-black/20 border-white/10 text-white/90"}`}
              />

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setEditNameOpen(false)}
                  className={`px-4 h-10 rounded-xl font-semibold ${isLight ? "bg-black/5 hover:bg-black/10 text-black/75" : "bg-white/5 hover:bg-white/10 text-white/85"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => saveEditName().catch(() => {})}
                  className={`px-4 h-10 rounded-xl font-semibold ${isLight ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"}`}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedUser && <UserProfileModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
      </div>
    </>
  );
}

export default RoomPageLiveKit;