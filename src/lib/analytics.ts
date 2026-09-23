type SentryClient = typeof import("@sentry/react");
type PosthogClient = (typeof import("posthog-js"))["default"];

export type ProductEventProperties = Record<string, unknown>;

type ClarityFunction = ((...args: unknown[]) => void) & { q?: unknown[][] };
type AnalyticsWindow = Window & {
  clarity?: ClarityFunction;
  gtag?: (...args: unknown[]) => void;
  dataLayer?: Array<Record<string, unknown>>;
};

const ROOM_EVENT_ALLOWLIST = new Set([
  "prejoin_opened",
  "camera_permission_failed",
  "room_connected",
  "room_reconnecting",
  "room_disconnected",
  "panel_opened",
  "leave_clicked",
]);

const BLOCKED_PROPERTY_PATTERN =
  /(email|name|text|message|content|task|chat|dm|url|title|description|avatar|token|identity)/i;
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let initialized = false;
let Sentry: SentryClient | null = null;
let posthog: PosthogClient | null = null;
let posthogReady = false;
let sentryReady = false;
let clarityReady = false;
let sensitiveRoomRoute = false;
let lastTrackedPath = "";
let analyticsUserId: string | null = null;
let posthogReplayWasActive = false;
let sentryReplayWasActive = false;
const pendingPosthogEvents: Array<{ name: string; properties: ProductEventProperties }> = [];

const isEnabled = () => import.meta.env.VITE_ANALYTICS_ENABLED?.trim().toLowerCase() === "true";

const normalizePath = (path: string) => {
  const normalized = String(path || "/").split(/[?#]/, 1)[0].trim();
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

const isRoomPath = (path: string) => {
  const normalized = normalizePath(path).replace(/\/+$/, "");
  return normalized === "/room-livekit" || normalized.startsWith("/room-livekit/") ||
    normalized === "/room-iframe" || normalized.startsWith("/room-iframe/");
};

const parseRate = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback;
};

const getRoot = () => (typeof document === "undefined" ? null : document.getElementById("root"));

const protectSensitiveRoot = (sensitive: boolean) => {
  const root = getRoot();
  if (!root) return;
  root.classList.toggle("ph-no-capture", sensitive);
  if (sensitive) root.setAttribute("data-clarity-mask", "true");
  else root.removeAttribute("data-clarity-mask");
};

const ensureClarity = () => {
  if (!isEnabled() || clarityReady || sensitiveRoomRoute || typeof window === "undefined") return;
  const projectId = import.meta.env.VITE_CLARITY_PROJECT_ID?.trim();
  if (!projectId) return;

  const analyticsWindow = window as AnalyticsWindow;
  if (!analyticsWindow.clarity) {
    const clarity: ClarityFunction = (...args: unknown[]) => clarity.q?.push(args);
    clarity.q = [];
    analyticsWindow.clarity = clarity;
  }

  if (!document.getElementById("mysession-clarity")) {
    const script = document.createElement("script");
    script.id = "mysession-clarity";
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${encodeURIComponent(projectId)}`;
    document.head.appendChild(script);
  }
  clarityReady = true;
};

const sanitizeValue = (value: unknown): unknown => {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const clean = value.trim().slice(0, 100);
  if (!clean || clean.includes("@") || /https?:\/\//i.test(clean)) return undefined;
  return clean;
};

const sanitizeProperties = (properties: ProductEventProperties) =>
  Object.entries(properties).reduce<Record<string, unknown>>((safe, [key, value]) => {
    if (BLOCKED_PROPERTY_PATTERN.test(key)) return safe;
    const sanitized = sanitizeValue(value);
    if (sanitized !== undefined) safe[key.slice(0, 64)] = sanitized;
    return safe;
  }, {});

export function initializeAnalytics(): void {
  if (initialized || !isEnabled() || typeof window === "undefined") return;
  initialized = true;
  sensitiveRoomRoute = isRoomPath(window.location.pathname);
  protectSensitiveRoot(sensitiveRoomRoute);

  const posthogKey = import.meta.env.VITE_POSTHOG_KEY?.trim();
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  // Analytics is not part of room admission. Load its SDKs after the first
  // paint so they cannot delay the Sessions/LiveKit route chunks.
  const loadSdk = () => {
    if (posthogKey) void import("posthog-js").then(({ default: client }) => {
      client.init(posthogKey, {
        api_host: import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://us.i.posthog.com",
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: sensitiveRoomRoute,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: "*",
          blockSelector: "video, audio, canvas, iframe",
        },
      });
      posthog = client;
      posthogReady = true;
      if (analyticsUserId) client.identify(analyticsUserId);
      if (!sensitiveRoomRoute && lastTrackedPath) client.capture("$pageview", { path: lastTrackedPath });
      pendingPosthogEvents.splice(0).forEach(({ name, properties }) => client.capture(name, properties));
    }).catch((error) => {
      console.warn("[analytics] PostHog initialization failed", error);
    });

    if (sentryDsn) void import("@sentry/react").then((client) => {
      client.init({
        dsn: sentryDsn,
        environment: import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || import.meta.env.MODE,
        sendDefaultPii: false,
        tracesSampleRate: parseRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE, 0.05),
        replaysSessionSampleRate: sensitiveRoomRoute
          ? 0
          : parseRate(import.meta.env.VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE, 0.02),
        replaysOnErrorSampleRate: sensitiveRoomRoute ? 0 : 1,
        integrations: [client.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true })],
      });
      Sentry = client;
      sentryReady = true;
      client.setTag("route_group", sensitiveRoomRoute ? "room" : lastTrackedPath || "/");
      client.setUser(analyticsUserId ? { id: analyticsUserId } : null);
    }).catch((error) => {
      console.warn("[analytics] Sentry initialization failed", error);
    });
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(loadSdk, { timeout: 2_000 });
  } else {
    window.setTimeout(loadSdk, 500);
  }

  ensureClarity();
}

export function trackRoute(pathname: string): void {
  if (!isEnabled() || typeof window === "undefined") return;
  initializeAnalytics();

  const path = normalizePath(pathname);
  const nextSensitive = isRoomPath(path);
  const wasSensitive = sensitiveRoomRoute;
  sensitiveRoomRoute = nextSensitive;
  protectSensitiveRoot(nextSensitive);

  if (posthogReady && posthog && nextSensitive !== wasSensitive) {
    if (nextSensitive) {
      posthogReplayWasActive = posthog.sessionRecordingStarted();
      posthog.stopSessionRecording();
    } else if (posthogReplayWasActive) {
      posthog.startSessionRecording();
      posthogReplayWasActive = false;
    }
  }

  if (sentryReady && Sentry) {
    Sentry.setTag("route_group", nextSensitive ? "room" : path);
    if (nextSensitive !== wasSensitive) {
      const replay = Sentry.getReplay();
      if (nextSensitive) {
        sentryReplayWasActive = Boolean(replay?.getReplayId(true));
        void replay?.stop({ flush: false });
      } else if (sentryReplayWasActive) {
        replay?.start();
        sentryReplayWasActive = false;
      }
    }
  }

  if (!nextSensitive) {
    ensureClarity();
    (window as AnalyticsWindow).clarity?.("set", "route", path);
  }

  if (lastTrackedPath === path) return;
  lastTrackedPath = path;
  if (!nextSensitive && posthogReady && posthog) posthog.capture("$pageview", { path });
}

export function setAnalyticsUser(userId: string | null): void {
  if (!isEnabled() || typeof window === "undefined") return;
  initializeAnalytics();

  const safeId = userId && UUID_PATTERN.test(userId) ? userId : null;
  if (analyticsUserId === safeId) return;
  analyticsUserId = safeId;

  if (posthogReady && posthog) {
    if (safeId) posthog.identify(safeId);
    else posthog.reset();
  }
  if (sentryReady && Sentry) Sentry.setUser(safeId ? { id: safeId } : null);
  if (safeId && !sensitiveRoomRoute) (window as AnalyticsWindow).clarity?.("identify", safeId);
}

export function captureProductEvent(
  eventName: string,
  properties: ProductEventProperties = {},
): void {
  if (!isEnabled() || typeof window === "undefined") return;
  initializeAnalytics();

  const name = String(eventName || "").trim().toLowerCase();
  if (!EVENT_NAME_PATTERN.test(name)) return;
  if (sensitiveRoomRoute && !ROOM_EVENT_ALLOWLIST.has(name)) return;

  const safeProperties = sanitizeProperties(properties);
  try {
    if (posthogReady && posthog) posthog.capture(name, safeProperties);
    else if (import.meta.env.VITE_POSTHOG_KEY && pendingPosthogEvents.length < 20) {
      pendingPosthogEvents.push({ name, properties: safeProperties });
    }
    if (sentryReady && Sentry) {
      Sentry.addBreadcrumb({ category: "product", message: name, data: safeProperties, level: "info" });
    }
    if (!sensitiveRoomRoute) (window as AnalyticsWindow).clarity?.("event", name);

    const analyticsWindow = window as AnalyticsWindow;
    analyticsWindow.gtag?.("event", name, safeProperties);
    analyticsWindow.dataLayer?.push({ event: name, ...safeProperties });
  } catch {
    // Analytics must never interrupt registration, booking, or a live room.
  }
}
