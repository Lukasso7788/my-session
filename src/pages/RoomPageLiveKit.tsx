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
import { SessionStageBar } from "../components/SessionStageBar";
import { UserProfileModal } from "../components/UserProfileModal";
import { PreJoinModal } from "./LiveKit/PreJoinModalLiveKit";
import { RoomSettingsModalLiveKit } from "./LiveKit/RoomSettingsModalLiveKit";
import { VideoTile } from "./LiveKit/VideoTileLiveKit";
import { RemoteAudioRenderer } from "./LiveKit/RemoteAudioRendererLiveKit";

type RoomTheme = "dark" | "light";
type RightPanelTab = "participants" | "chat" | "intentions" | null;
type FxMode = "off" | "blur" | "bg";

type ReactionType = "fire" | "laugh" | "clap" | "heart" | "thumbsUp" | "thumbsDown";

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

type HostTileActions = {
  canMuteMic: boolean;
  canMuteCam: boolean;
  micMuted?: boolean;
  camMuted?: boolean;
  onToggleMuteMic?: () => void;
  onToggleMuteCam?: () => void;
  onKick?: () => void;
  busy?: boolean;
};

type TileModel = {
  id: string;
  label: string;
  isLocal: boolean;
  videoTrack?: Track;

  participantIdentity?: string;
  participantUserId?: string;
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

// ---- tab presence ----
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

// ---- default bg ----
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

// ---- capture defaults ----
const LK_CAPTURE_WIDTH = 960;
const LK_CAPTURE_HEIGHT = 540;
const LK_CAPTURE_FPS = 24;

// ---- ErrorBoundary ----
class LiveKitErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void; isLight: boolean },
  { hasError: boolean; errorText: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, errorText: "" };
  }
  static getDerivedStateFromError(err: any) {
    return {
      hasError: true,
      errorText: String(err?.message || err || "LiveKit error"),
    };
  }
  componentDidCatch(err: any) {
    console.error("LiveKit UI crashed:", err);
  }
  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-3 px-6">
        <div className="text-red-500 font-semibold">LiveKit UI crashed</div>
        <div className="text-xs opacity-80 break-words text-center">{this.state.errorText}</div>
        <button
          onClick={() => {
            this.setState({ hasError: false, errorText: "" });
            this.props.onReset();
          }}
          className={this.props.isLight ? "px-4 py-2 rounded-xl bg-black/5 hover:bg-black/10" : "px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10"}
        >
          Reset + retry
        </button>
      </div>
    );
  }
}

// ---- sizing hook (your stable one) ----
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(!!mql.matches);
    onChange();
    try {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    } catch {
      // @ts-ignore
      mql.addListener(onChange);
      // @ts-ignore
      return () => mql.removeListener(onChange);
    }
  }, [query]);
  return matches;
}

function useElementSizeStable<T extends HTMLElement>(thresholdPx = 2) {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const rafRef = useRef<number | null>(null);

  const ref = (el: T | null) => setNode(el);

  useEffect(() => {
    if (!node) return;

    const update = () => {
      const r = node.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);

      setSize((prev) => {
        if (Math.abs(prev.width - w) < thresholdPx && Math.abs(prev.height - h) < thresholdPx) return prev;
        return { width: w, height: h };
      });
    };

    const schedule = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(update);
    };

    schedule();

    const RO: any = (window as any).ResizeObserver;
    if (RO) {
      const ro = new RO(() => schedule());
      ro.observe(node);
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        ro.disconnect();
      };
    }

    window.addEventListener("resize", schedule);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      window.removeEventListener("resize", schedule);
    };
  }, [node, thresholdPx]);

  return { ref, width: size.width, height: size.height };
}

function computeCols(count: number, containerWidth: number) {
  const w = containerWidth || 1200;
  const isDesktop = w >= 1024;

  if (count <= 1) return 1;
  if (count === 2) return 2;
  if (count === 4) return 2;
  if (count === 3 && isDesktop) return 2;
  if (isDesktop && count >= 5 && count <= 9) return 3;
  if (count === 3) return 2;
  if (count === 5) return w >= 900 ? 3 : 2;
  if (count === 6) return w >= 780 ? 3 : 2;
  return w >= 1400 ? 4 : 3;
}

function calcMaxGridWidthPx(params: {
  containerWidth: number;
  containerHeight: number;
  cols: number;
  rows: number;
  gapPx: number;
  paddingPx: number;
  aspectHOverW: number;
}) {
  const { containerWidth, containerHeight, cols, rows, gapPx, paddingPx, aspectHOverW } = params;
  if (!containerWidth || !containerHeight) return null;

  const availW = Math.max(0, containerWidth - paddingPx * 2);
  const availH = Math.max(0, containerHeight - paddingPx * 2);

  const byWidth = (availW - (cols - 1) * gapPx) / cols;
  const byHeight = (availH - (rows - 1) * gapPx) / (rows * aspectHOverW);

  const tileW = Math.max(0, Math.min(byWidth, byHeight));
  const gridW = cols * tileW + (cols - 1) * gapPx;

  return Math.min(availW, gridW);
}

// ---- MAIN ----
export function RoomPageLiveKit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const tabId = useMemo(() => getOrCreateTabId("mysession_lk_tab_id"), []);
  const devClones = useMemo(() => Math.max(0, Math.min(24, getQueryInt("devClones", 0))), []);

  const [theme, setTheme] = useState<RoomTheme>(() => {
    try {
      const v = String(localStorage.getItem("room_theme") || "").toLowerCase();
      return v === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });

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

  const isLight = theme === "light";
  const isLgUp = useMediaQuery("(min-width: 1024px)");

  const pageBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
  const topBarBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#111827]/40 border border-white/5";
  const chipBg = isLight ? "bg-black/5 border border-black/10" : "bg-[#0B1220]/70 border border-white/5";
  const strongText = isLight ? "text-black/85" : "text-[#F3F4F6]/90";
  const panelBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#0B1220]/55 border border-white/5";
  const bottomBarBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#07101E]/85 border border-white/10";
  const ctlBtnBase = isLight ? "bg-black/5 hover:bg-black/10" : "bg-[#111827] hover:bg-[#1f2937]";

  const [session, setSession] = useState<SessionRow | null>(null);
  const [loading, setLoading] = useState(true);

  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [userName, setUserName] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [selectedUser, setSelectedUser] = useState<HostProfile | null>(null);

  const [prejoinOpen, setPrejoinOpen] = useState(false);
  const [joinRequested, setJoinRequested] = useState(false);

  const [devices, setDevices] = useState<MediaDevicesResult>({ videoInputs: [], audioInputs: [], audioOutputs: [] });

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

  // prejoin prepared track + preview version
  const prejoinPreparedVideoTrackRef = useRef<LocalVideoTrack | null>(null);
  const [prejoinPreviewVersion, setPrejoinPreviewVersion] = useState(0);

  // roles
  const [moderatorUserIds, setModeratorUserIds] = useState<string[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState<string>("");
  const [roleBusyKey, setRoleBusyKey] = useState<string>("");

  // right panel
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

  // stages
  const [stages, setStages] = useState<Stage[]>([]);
  const [, setHoveredStage] = useState<Stage | null>(null);

  const [stagebarStartTime, setStagebarStartTime] = useState<string>("");
  const [stagebarCycleSeconds, setStagebarCycleSeconds] = useState<number | undefined>(undefined);

  // audio unlock loop bits (оставляю как у тебя, но без лишней простыни)
  const welcomeLoopRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef<boolean>(false);

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

  // build stages
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
        (parsed as any).blocks || (parsed as any).script || (parsed as any).agenda || (parsed as any).items || (parsed as any).stages;
      if (Array.isArray(maybeBlocks)) parsed = maybeBlocks;
    }

    if (Array.isArray(parsed)) {
      const formatted: Stage[] = parsed
        .map((b): Stage | null => {
          const blk = isRecord(b) ? b : null;
          if (!blk) return null;

          const rawName =
            str((blk as any).name) || str((blk as any).title) || str((blk as any).label) || str((blk as any).text) || str((blk as any).key) || "Stage";

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
      return;
    }

    // infinite object schedule
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
      return;
    }

    setStagebarStartTime(fallbackStart);
  }, [session]);

  // auth user
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const u = data.user;
        setAuthUserId(u?.id || null);

        let name =
          str((u as any)?.user_metadata?.full_name) ||
          str((u as any)?.user_metadata?.name) ||
          (u?.email ? u.email.split("@")[0] : "");

        if (!name && u?.id) {
          const { data: p } = await supabase.from("profiles").select("full_name").eq("id", u.id).single();
          name = str((p as any)?.full_name);
        }

        setUserName(name);
        setDisplayName((prev) => prev || name || "Guest");
        setPrejoin((prev) => ({ ...prev, displayName: prev.displayName || name || "Guest" }));
      } finally {
        setAuthReady(true);
      }
    })();
  }, []);

  const loadBrowserDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;

      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        s.getTracks().forEach((t) => t.stop());
      } catch { }

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

  // ---- FX state (shared)
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
    if (!supportsBackgroundProcessors()) {
      throw new Error("Background processors are not supported in this browser/device");
    }
    try {
      supportsModernBackgroundProcessors();
    } catch { }
  };

  const makeProcessorForMode = (mode: FxMode, blur: number, bgUrl: string): TrackProcessor<"video"> | null => {
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

  // ---- prejoin helpers
  const cleanupPrejoinPreparedVideoTrack = async () => {
    const t = prejoinPreparedVideoTrackRef.current as any;
    prejoinPreparedVideoTrackRef.current = null;

    if (!t) return;

    try {
      await stopAnyProcessor(t);
    } catch { }

    try {
      t.stop?.();
    } catch { }

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

  // show prejoin
  useEffect(() => {
    if (loading) return;
    if (!session) return;
    if (joinRequested) return;

    setPrejoinOpen(true);

    (async () => {
      await loadBrowserDevices().catch(() => { });
      const pj = prejoinRef.current;
      if (pj.videoEnabled) {
        await createPrejoinPreparedVideoTrack().catch((e) => {
          console.warn("prejoin preview init failed", e);
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, joinRequested]);

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

  useEffect(() => {
    if (!prejoinOpen) return;

    if (!prejoin.videoEnabled) {
      cleanupPrejoinPreparedVideoTrack().catch(() => { });
      return;
    }

    createPrejoinPreparedVideoTrack().catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prejoin.videoEnabled, prejoinOpen]);

  // host flag + moderators
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // allow host to grant / revoke moderators
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

  const [lkToken, setLkToken] = useState<string>("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string>("");

  const baseUserIdRef = useRef<string>("");
  const livekitIdentityRef = useRef<string>("");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildAuthHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token || "";
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    } catch { }
    return headers;
  };

  const tryAcquireTabGate = (sessionId: string, baseUserId: string) => {
    const maxTabs = Math.max(1, Math.min(6, Number((import.meta as any)?.env?.VITE_LIVEKIT_MAX_TABS || LK_MAX_TABS_DEFAULT) || LK_MAX_TABS_DEFAULT));
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

  const requestToken = async () => {
    if (!session) return;
    setTokenError("");
    setTokenLoading(true);

    try {
      const pj = prejoinRef.current;
      const nameToUse = (pj.displayName || displayName || userName || "Guest").trim() || "Guest";

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

  // ---- livekit room ----
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

  useEffect(() => {
    setOpenTileAdminMenuId((prev) => (prev && tiles.some((t) => t.id === prev) ? prev : null));
  }, [tiles]);

  const participantsCount = useMemo(() => {
    const r = roomRef.current;
    if (!r) return 0;
    return 1 + r.remoteParticipants.size;
  }, [roomState, tiles]);

  const roomNameForApi = useMemo(() => {
    if (!session) return "";
    return safeRoomName(`session-${session.id}`);
  }, [session]);

  const rebuildTiles = () => {
    const room = roomRef.current;
    if (!room) return;

    const next: TileModel[] = [];

    const lp = room.localParticipant;

    const localCamPub = Array.from(lp.videoTrackPublications.values()).find((p) => p.source === Track.Source.Camera) as any;
    const localTrack = (localCamPub?.track as any) || undefined;

    const localMicPub = Array.from(lp.audioTrackPublications.values()).find((p) => p.source === Track.Source.Microphone) as any;

    const localIdentity = String(lp.identity || livekitIdentityRef.current || "");
    const localUserId =
      authUserId && looksLikeUuid(authUserId) ? String(authUserId).toLowerCase() : extractBaseUserIdFromIdentity(localIdentity);

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
      const nm = (rp.name || rp.identity || "Guest").trim() || "Guest";

      const exactIdentity = String(rp.identity || "");
      const baseUserId = extractBaseUserIdFromIdentity(exactIdentity);

      next.push({
        id: rp.sid,
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
    });

    setTiles(next);

    try {
      const lpScreenPub = Array.from(lp.videoTrackPublications.values()).find((p: any) => p.source === Track.Source.ScreenShare) as any;
      setScreenShareOn(!!lpScreenPub?.track && !lpScreenPub?.isMuted);
    } catch {
      setScreenShareOn(false);
    }
  };

  // ✅ FIX: disconnectRoom больше НЕ трогает prejoinPreparedVideoTrackRef (иначе FX слетает перед publish)
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
          // publish prepared track AS-IS (processor stays attached)
          await r.localParticipant.publishTrack(prepared, { source: Track.Source.Camera } as any);
          setCamOn(true);
          usedPrepared = true;

          // after publish, release ref to avoid double-stop in prejoin cleanup
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

      // ✅ если prepared трек НЕ использовался — применим выбранный FX уже на in-room track
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
    connectRoom().catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinRequested, lkToken, lkServerUrl]);

  useEffect(() => {
    return () => {
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
        } catch { }
        setFxStatusText("");
        setFxError("");
      } else {
        // если камера включили и FX режим был выбран — переапплай
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

  // ---- host admin calls (оставляю как было)
  const callHostAdmin = async (body: Record<string, unknown>) => {
    const res = await fetch(adminEndpoint, {
      method: "POST",
      headers: await buildAuthHeaders(),
      body: JSON.stringify({ ...body, sessionId: session?.id, isHost }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Admin endpoint error: ${res.status} ${t || ""}`.trim());
    }

    return res.json().catch(() => ({}));
  };

  const hostToggleRemoteTrackMute = async (participantIdentity: string, trackSid: string, currentlyMuted: boolean | undefined, kind: "mic" | "cam") => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:${trackSid}`;
    setAdminBusyKey(busyKey);

    try {
      await callHostAdmin({
        action: currentlyMuted ? "unmute_track" : "mute_track",
        roomName,
        participantIdentity,
        trackSid,
      });

      window.setTimeout(() => rebuildTiles(), 150);
    } catch (e: any) {
      console.error(`host ${kind} toggle failed:`, e);
      alert(String(e?.message || e || "host_action_failed"));
    } finally {
      setAdminBusyKey("");
    }
  };

  const hostKickParticipant = async (participantIdentity: string) => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:kick`;
    setAdminBusyKey(busyKey);

    try {
      await callHostAdmin({
        action: "remove_participant",
        roomName,
        participantIdentity,
      });
      window.setTimeout(() => rebuildTiles(), 150);
    } catch (e: any) {
      console.error("host kick failed:", e);
      alert(String(e?.message || e || "host_kick_failed"));
    } finally {
      setAdminBusyKey("");
    }
  };

  // ---- FX APPLY (in-room)
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

  useEffect(() => {
    if (!connected || !camOn) return;
    if (videoFxMode !== "blur") return;
    if (fxApplying) return;

    const t = window.setTimeout(() => {
      applyVideoFx("blur").catch(() => { });
    }, 220);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blurStrength]);

  useEffect(() => {
    if (!connected || !camOn) return;
    if (videoFxMode !== "bg") return;
    if (fxApplying) return;

    const t = window.setTimeout(() => {
      applyVideoFx("bg").catch(() => { });
    }, 220);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgImageUrl]);

  // ---- UI data
  const tilesForRender = useMemo(() => {
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

  const [participantsSearch, setParticipantsSearch] = useState("");
  const filteredParticipants = useMemo(() => {
    const q = participantsSearch.trim().toLowerCase();
    if (!q) return tilesForRender;
    return tilesForRender.filter((t) => (t.label || "").toLowerCase().includes(q));
  }, [tilesForRender, participantsSearch]);

  const tileCount = tilesForRender.length;
  const { ref: layoutRef, width: layoutW, height: layoutH } = useElementSizeStable<HTMLDivElement>(2);

  const paddingPx = useMemo(() => (layoutW && layoutW < 520 ? 8 : 10), [layoutW]);
  const gapPx = useMemo(() => (layoutW && layoutW < 520 ? 6 : 10), [layoutW]);

  const gridCols = useMemo(() => computeCols(tileCount, layoutW || 1200), [tileCount, layoutW]);
  const gridRows = useMemo(() => Math.max(1, Math.ceil(tileCount / (gridCols || 1))), [tileCount, gridCols]);

  const maxGridWidth = useMemo(() => {
    if (tileCount <= 1) return null;
    return calcMaxGridWidthPx({
      containerWidth: layoutW || (typeof window !== "undefined" ? window.innerWidth : 1200),
      containerHeight: layoutH || (typeof window !== "undefined" ? window.innerHeight : 800),
      cols: gridCols || 1,
      rows: gridRows || 1,
      gapPx,
      paddingPx,
      aspectHOverW: 9 / 16,
    });
  }, [tileCount, layoutW, layoutH, gridCols, gridRows, gapPx, paddingPx]);

  const remainder = useMemo(() => {
    const c = gridCols || 1;
    return c > 0 ? tileCount % c : 0;
  }, [tileCount, gridCols]);

  const fullCount = useMemo(() => (!remainder ? tileCount : tileCount - remainder), [tileCount, remainder]);
  const fullRowsTiles = useMemo(() => tilesForRender.slice(0, fullCount), [tilesForRender, fullCount]);
  const lastRowTiles = useMemo(() => tilesForRender.slice(fullCount), [tilesForRender, fullCount]);

  const oneColWidth = useMemo(() => {
    const c = gridCols || 1;
    return `calc((100% - ${(c - 1) * gapPx}px) / ${c})`;
  }, [gridCols, gapPx]);

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

  const getTileHostActions = (t: TileModel): HostTileActions | undefined => {
    if (!isSelfModerator || t.isLocal || !t.participantIdentity) return undefined;
    return {
      canMuteMic: !!t.micTrackSid,
      canMuteCam: !!t.camTrackSid,
      micMuted: !!t.micMuted,
      camMuted: !!t.camMuted,
      busy:
        adminBusyKey === `${t.participantIdentity}:${t.micTrackSid}` ||
        adminBusyKey === `${t.participantIdentity}:${t.camTrackSid}` ||
        adminBusyKey === `${t.participantIdentity}:kick`,
      onToggleMuteMic:
        t.micTrackSid && t.participantIdentity ? () => hostToggleRemoteTrackMute(t.participantIdentity!, t.micTrackSid!, t.micMuted, "mic") : undefined,
      onToggleMuteCam:
        t.camTrackSid && t.participantIdentity ? () => hostToggleRemoteTrackMute(t.participantIdentity!, t.camTrackSid!, t.camMuted, "cam") : undefined,
      onKick: t.participantIdentity ? () => hostKickParticipant(t.participantIdentity!) : undefined,
    };
  };

  const renderTile = (t: TileModel) => {
    const hostActions = getTileHostActions(t);
    return (
      <div key={t.id} className="relative">
        <VideoTile
          label={t.label}
          videoTrack={t.videoTrack}
          isLocal={t.isLocal}
          theme={theme}
          showBadge={getBadgeForTile(t)}
          hostActions={undefined /* оставляем меню отдельно; если хочешь кнопки на тайле — поставь hostActions */}
        />

        {/* простое меню оставляю как у тебя: */}
        {!!hostActions && !t.isLocal && (
          <div className="absolute top-2 right-2 z-20" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={[
                "w-9 h-9 rounded-xl flex items-center justify-center transition shadow-sm",
                isLight ? "bg-white/90 border border-black/10 text-black/75 hover:bg-white" : "bg-black/55 border border-white/10 text-white/90 hover:bg-black/70",
              ].join(" ")}
              title="Settings"
              onClick={() => setOpenTileAdminMenuId((prev) => (prev === t.id ? null : t.id))}
            >
              <span className="text-lg leading-none -mt-[2px]">⋯</span>
            </button>

            {openTileAdminMenuId === t.id && (
              <div className={`absolute right-0 top-[calc(100%+8px)] w-[210px] rounded-2xl shadow-2xl overflow-hidden ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"}`}>
                <div className={`px-4 py-2 text-[11px] ${isLight ? "text-black/45" : "text-white/45"}`}>Actions</div>

                {!!hostActions.onToggleMuteMic && (
                  <button
                    type="button"
                    disabled={hostActions.busy}
                    onClick={async () => {
                      await hostActions.onToggleMuteMic?.();
                      setOpenTileAdminMenuId(null);
                    }}
                    className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${isLight ? "text-black/80 hover:bg-black/5" : "text-white/90 hover:bg-white/5"}`}
                  >
                    {hostActions.micMuted ? "Unmute mic" : "Mute mic"}
                  </button>
                )}

                {!!hostActions.onToggleMuteCam && (
                  <button
                    type="button"
                    disabled={hostActions.busy}
                    onClick={async () => {
                      await hostActions.onToggleMuteCam?.();
                      setOpenTileAdminMenuId(null);
                    }}
                    className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${isLight ? "text-black/80 hover:bg-black/5" : "text-white/90 hover:bg-white/5"}`}
                  >
                    {hostActions.camMuted ? "Unmute cam" : "Mute cam"}
                  </button>
                )}

                {!!hostActions.onKick && (
                  <>
                    <div className={isLight ? "h-px bg-black/10" : "h-px bg-white/10"} />
                    <button
                      type="button"
                      disabled={hostActions.busy}
                      onClick={async () => {
                        await hostActions.onKick?.();
                        setOpenTileAdminMenuId(null);
                      }}
                      className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${isLight ? "text-red-700 hover:bg-red-50" : "text-red-300 hover:bg-red-500/10"}`}
                    >
                      Kick participant
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const roomReadyText = !joinRequested ? "Waiting to join…" : tokenLoading ? "Preparing token…" : !connected ? "Connecting to LiveKit…" : "";
  const lastErr = tokenError || clientError;

  const videoContent = (
    <div ref={layoutRef} className="w-full h-full min-h-0 relative">
      {roomReadyText ? (
        <div className={`absolute inset-0 flex items-center justify-center z-10 ${isLight ? "text-black/60" : "text-white/70"}`}>
          <div className={`px-4 py-2 rounded-xl ${isLight ? "bg-white/70" : "bg-black/30"}`}>{roomReadyText}</div>
        </div>
      ) : null}

      {tileCount <= 1 ? (
        <div className="h-full min-h-0 flex items-center justify-center p-2 sm:p-3">
          <div className="w-full max-w-[860px]">{tilesForRender.map((t) => renderTile(t))}</div>
        </div>
      ) : (
        <div className="h-full min-h-0 overflow-hidden" style={{ padding: paddingPx }}>
          <div className="w-full flex justify-center">
            <div className="w-full" style={{ maxWidth: maxGridWidth ? `${maxGridWidth}px` : undefined }}>
              <div
                className="w-full grid items-start"
                style={{
                  gap: gapPx,
                  gridTemplateColumns: `repeat(${gridCols || 1}, minmax(0, 1fr))`,
                }}
              >
                {fullRowsTiles.map((t) => (
                  <div key={t.id}>{renderTile(t)}</div>
                ))}

                {lastRowTiles.length > 0 && (
                  <div className="col-span-full w-full flex justify-center" style={{ gap: gapPx }}>
                    {lastRowTiles.map((t) => (
                      <div key={t.id} className="shrink-0" style={{ width: oneColWidth }}>
                        {renderTile(t)}
                      </div>
                    ))}
                  </div>
                )}

                {!tilesForRender.length && connected && (
                  <div className={`col-span-full min-h-[240px] rounded-2xl border flex items-center justify-center ${isLight ? "border-black/10 bg-black/5 text-black/60" : "border-white/10 bg-white/5 text-white/60"}`}>
                    No participants yet
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {lastErr && (
        <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow z-30 max-w-[80%] break-words">
          {lastErr}
        </div>
      )}
    </div>
  );

  if (loading) {
    return <div className={`flex h-screen items-center justify-center ${pageBg}`}>Loading session...</div>;
  }

  if (!session) {
    return (
      <div className={`flex h-screen items-center justify-center ${pageBg}`}>
        <button onClick={() => navigate("/sessions")}>Back</button>
      </div>
    );
  }

  const ChatPanelAny = ChatPanel as any;

  const TopBar = (
    <div className={`flex w-full rounded-2xl overflow-hidden ${topBarBg}`}>
      <div className="flex-1 px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <p className={`min-w-0 font-inter font-semibold text-[16px] sm:text-[18px] truncate ${strongText}`}>
                {String(session?.title || "Session")}
              </p>
              <span className={["shrink-0 px-2 py-[3px] rounded-lg border text-[12px] font-inter", chipBg, isLight ? "text-black/65" : "text-white/80"].join(" ")}>
                {participantsCount}/{maxParticipants}
              </span>
              <span className={["hidden sm:inline-flex shrink-0 px-2 py-[3px] rounded-lg border text-[11px] font-inter", chipBg, isLight ? "text-black/65" : "text-white/75"].join(" ")}>
                LiveKit
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} className={`px-3 py-2 rounded-xl ${chipBg}`} title="Toggle theme">
              Theme
            </button>

            {session.host_profile && (
              <button
                onClick={() => setSelectedUser(session.host_profile || null)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition text-[13px] ${isLight ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/75" : "border-white/10 bg-[#0B1220]/60 hover:bg-[#0B1220]/80 text-[#F3F4F6]/85"
                  }`}
                title="Host profile"
              >
                <span className="font-inter">
                  <span className="font-light">Host:</span> <span className="font-bold">{String(session.host_profile.full_name || "Host")}</span>
                </span>
              </button>
            )}
          </div>
        </div>

        {!isSilentRoom && stages.length > 0 && !!stagebarStartTime && (
          <div className="mt-2 w-full overflow-hidden">
            <SessionStageBar stages={stages} startTime={stagebarStartTime} cycleSeconds={stagebarCycleSeconds} onHoverStage={setHoveredStage} />
          </div>
        )}
      </div>
    </div>
  );

  const RightPanelBody = (
    <div className={`rounded-2xl shadow-lg overflow-hidden min-h-0 h-full flex flex-col ${panelBg}`} data-theme={theme}>
      <div className={`p-3 border-b ${isLight ? "border-black/10" : "border-white/10"} flex items-center gap-2`}>
        <button
          className={`px-3 py-2 rounded-xl text-[13px] ${rightTab === "participants" ? chipBg : ctlBtnBase}`}
          onClick={() => openRightTab("participants")}
        >
          Participants
        </button>
        <button className={`px-3 py-2 rounded-xl text-[13px] ${rightTab === "chat" ? chipBg : ctlBtnBase}`} onClick={() => openRightTab("chat")}>
          Chat
        </button>
        <button
          className={`px-3 py-2 rounded-xl text-[13px] ${rightTab === "intentions" ? chipBg : ctlBtnBase}`}
          onClick={() => openRightTab("intentions")}
        >
          Intentions
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        {rightTab === "participants" ? (
          <div className="flex flex-col gap-3">
            <input
              value={participantsSearch}
              onChange={(e) => setParticipantsSearch(e.target.value)}
              placeholder="Search participants…"
              className={`w-full px-3 py-2 rounded-xl outline-none text-[13px] ${isLight ? "bg-black/5 border border-black/10 text-black" : "bg-white/5 border border-white/10 text-white"}`}
            />
            <div className="flex flex-col gap-2">
              {filteredParticipants.map((t) => (
                <div
                  key={`p-${t.id}`}
                  className={`rounded-xl px-3 py-2 text-[13px] flex items-center justify-between ${isLight ? "bg-black/5 border border-black/10" : "bg-white/5 border border-white/10"}`}
                >
                  <div className="min-w-0">
                    <div className="truncate">{t.label}</div>
                    <div className="text-[11px] opacity-60">{t.isLocal ? "You" : t.participantIdentity || ""}</div>
                  </div>
                  <div className="text-[11px] opacity-70">{getBadgeForTile(t) || ""}</div>
                </div>
              ))}
            </div>
          </div>
        ) : rightTab === "chat" ? (
          <ChatPanelAny sessionId={session.id} theme={theme} />
        ) : rightTab === "intentions" ? (
          <IntentionsPanel sessionId={session.id} theme={theme} />
        ) : (
          <div className="opacity-70 text-sm">Select a tab</div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <PreJoinModal
        open={prejoinOpen}
        theme={theme}
        devices={devices}
        value={prejoin}
        onChange={setPrejoin}
        onRefreshDevices={() => loadBrowserDevices().catch(() => { })}
        onCancel={() => {
          cleanupPrejoinPreparedVideoTrack().catch(() => { });
          releaseTabPresence();
          navigate("/sessions", { replace: true });
        }}
        onJoin={() => {
          const pj = prejoinRef.current;
          const nm = (pj.displayName || displayName || userName || "Guest").trim() || "Guest";

          const baseUser = safeIdentity((authUserId && looksLikeUuid(authUserId) ? authUserId : authUserId || nm) as any);
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
            } catch { }
            uploadedBgUrlRef.current = null;
          }
          setBgImageUrl(DEFAULT_BG_DATA_URL);
        }}
      />

      <div className={`h-[100dvh] overflow-hidden ${pageBg}`}>
        <div className="h-full w-full px-2 sm:px-4 pt-3 pb-[calc(84px+env(safe-area-inset-bottom))] sm:pb-[calc(94px+env(safe-area-inset-bottom))] flex flex-col gap-3 sm:gap-4 min-h-0">
          {TopBar}

          <div className={"relative grid grid-rows-1 gap-3 sm:gap-4 flex-1 min-h-0 h-full " + (rightPanelOpen ? "lg:grid-cols-[minmax(0,1fr),380px] xl:grid-cols-[minmax(0,1fr),420px]" : "grid-cols-1")}>
            <div className={`relative rounded-2xl overflow-hidden min-h-0 h-full ${isLight ? "bg-white/70 border border-black/10" : "bg-[#0B1220]/45 border border-white/5"}`}>
              <LiveKitErrorBoundary
                isLight={isLight}
                onReset={() => {
                  setClientError("");
                  setTokenError("");
                  if (joinRequested && lkToken && lkServerUrl) connectRoom().catch(() => { });
                }}
              >
                {videoContent}
              </LiveKitErrorBoundary>
            </div>

            {rightPanelOpen && isLgUp && <div className="min-h-0 h-full overflow-hidden">{RightPanelBody}</div>}
          </div>
        </div>

        <RemoteAudioRenderer room={roomState} audioOutputId={selectedAudioOutputId} />

        {/* bottom bar */}
        <div className={`fixed left-0 right-0 bottom-0 z-50 px-2 sm:px-4 pb-[env(safe-area-inset-bottom)]`}>
          <div className={`mx-auto max-w-[1200px] rounded-2xl ${bottomBarBg} px-3 sm:px-4 py-3 flex items-center justify-between gap-2`}>
            <div className="flex items-center gap-2">
              <button className={`h-11 px-4 rounded-2xl text-[13px] ${ctlBtnBase}`} onClick={toggleMic}>
                {micOn ? "Mic on" : "Mic off"}
              </button>
              <button className={`h-11 px-4 rounded-2xl text-[13px] ${ctlBtnBase}`} onClick={toggleCam}>
                {camOn ? "Cam on" : "Cam off"}
              </button>
              <button className={`h-11 px-4 rounded-2xl text-[13px] ${ctlBtnBase}`} onClick={toggleScreenShare}>
                {screenShareOn ? "Stop share" : "Share"}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                className={`h-11 px-4 rounded-2xl text-[13px] ${ctlBtnBase}`}
                onClick={() => openRightTab(rightTab === "participants" ? null : "participants")}
              >
                Panel
              </button>

              <button className={`h-11 px-4 rounded-2xl text-[13px] ${ctlBtnBase}`} onClick={() => setSettingsOpen(true)}>
                FX
              </button>

              <button className={`h-11 px-4 rounded-2xl text-[13px] ${isLight ? "bg-red-600 text-white hover:bg-red-700" : "bg-red-500 text-white hover:bg-red-600"}`} onClick={leave}>
                Leave
              </button>
            </div>
          </div>
        </div>

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
              } catch { }
              uploadedBgUrlRef.current = null;
            }
            setBgImageUrl(DEFAULT_BG_DATA_URL);
          }}
        />

        {selectedUser && <UserProfileModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
      </div>
    </>
  );
}

export default RoomPageLiveKit;