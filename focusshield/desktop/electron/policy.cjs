const DEFAULT_SESSION = Object.freeze({
  active: false,
  locked: false,
  task: "",
  startedAt: null,
  endAt: null,
  web: { domains: [], urls: [], allow: [] },
  desktop: { applications: [], blockOtherApplications: false },
});

const DEFAULT_POLICY = Object.freeze({
  active: false,
  locked: false,
  mode: "blocklist",
  task: "",
  startedAt: null,
  endAt: null,
  updatedAt: null,
  source: "desktop",
  web: { domains: [], urls: [], allow: [] },
  desktop: { applications: [], blockOtherApplications: false },
  layers: { blocklist: DEFAULT_SESSION, hyperfocus: DEFAULT_SESSION },
  sessions: [],
  savedLists: [],
});

const PROTECTED_EXECUTABLES = new Set([
  "csrss.exe", "dwm.exe", "electron.exe", "explorer.exe", "focusshield.exe",
  "fontdrvhost.exe", "lsass.exe", "services.exe", "smss.exe", "svchost.exe",
  "system", "taskhostw.exe", "wininit.exe", "winlogon.exe", "audiodg.exe",
  "ctfmon.exe", "dllhost.exe", "msmpeng.exe", "runtimebroker.exe",
  "searchhost.exe", "securityhealthservice.exe", "shellexperiencehost.exe",
  "sihost.exe", "startmenuexperiencehost.exe", "textinputhost.exe",
]);

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean))];
}

function normalizeExecutable(value) {
  const raw = String(value || "").trim().replace(/^['\"]|['\"]$/g, "");
  if (!raw) return "";
  const name = raw.split(/[\\/]/).pop().toLowerCase();
  if (!name) return "";
  const withExtension = name.includes(".") ? name : `${name}.exe`;
  return PROTECTED_EXECUTABLES.has(withExtension) ? "" : withExtension;
}

function sanitizeApplications(value) {
  return [...new Set(uniqueStrings(value).map(normalizeExecutable).filter(Boolean))];
}

function sanitizeWeb(web = {}) {
  return {
    domains: [...new Set(uniqueStrings(web.domains).map((item) => item.toLowerCase()))],
    urls: uniqueStrings(web.urls),
    allow: [...new Set(uniqueStrings(web.allow).map((item) => item.toLowerCase()))],
  };
}

function sanitizeSavedLists(value) {
  return (Array.isArray(value) ? value : [])
    .slice(0, 30)
    .map((item, index) => ({
      id: String(item?.id || `list-${index + 1}`).slice(0, 80),
      name: String(item?.name || `Block list ${index + 1}`).trim().slice(0, 48),
      createdAt: Number(item?.createdAt) || Date.now(),
      updatedAt: Number(item?.updatedAt) || Date.now(),
      web: sanitizeWeb(item?.web),
      desktop: { applications: sanitizeApplications(item?.desktop?.applications) },
    }))
    .filter((item) => item.name);
}

function sanitizeLayer(input = {}, mode, now) {
  const requestedActive = Boolean(input.active);
  const requestedEndAt = requestedActive ? Number(input.endAt) || now + 25 * 60_000 : null;
  const active = requestedActive && requestedEndAt > now;
  const web = sanitizeWeb(input.web);
  return {
    active,
    locked: active && Boolean(input.locked),
    task: mode === "hyperfocus" ? String(input.task || "").trim().slice(0, 240) : "",
    startedAt: active ? Number(input.startedAt) || now : null,
    endAt: active ? requestedEndAt : null,
    web: mode === "hyperfocus"
      ? { domains: [], urls: [], allow: web.allow }
      : { domains: web.domains, urls: web.urls, allow: [] },
    desktop: {
      applications: sanitizeApplications(input.desktop?.applications),
      blockOtherApplications: mode === "hyperfocus" && Boolean(input.desktop?.blockOtherApplications),
    },
  };
}

function sanitizeSession(input = {}, index = 0, now = Date.now()) {
  const mode = input.mode === "hyperfocus" ? "hyperfocus" : "blocklist";
  const layer = sanitizeLayer(input, mode, now);
  return {
    ...layer,
    id: String(input.id || `session-${now}-${index + 1}`).slice(0, 80),
    name: String(input.name || (mode === "hyperfocus" ? input.task : "") ||
      (mode === "hyperfocus" ? "Hyper Focus" : `FocusShield session ${index + 1}`))
      .trim().slice(0, 64),
    mode,
  };
}
function legacyLayers(input, now) {
  const mode = input.mode === "hyperfocus" ? "hyperfocus" : "blocklist";
  return {
    blocklist: sanitizeLayer(mode === "blocklist" ? input : {}, "blocklist", now),
    hyperfocus: sanitizeLayer(mode === "hyperfocus" ? input : {}, "hyperfocus", now),
  };
}

function intersectLists(lists) {
  if (!lists.length) return [];
  return lists.slice(1).reduce(
    (result, list) => result.filter((item) => list.includes(item)),
    [...lists[0]],
  );
}

function legacySessions(input, now) {
  const layers = input.layers ? {
    blocklist: input.layers.blocklist,
    hyperfocus: input.layers.hyperfocus,
  } : legacyLayers(input, now);
  return [
    sanitizeSession({ ...layers.blocklist, id: "legacy-blocklist", mode: "blocklist" }, 0, now),
    sanitizeSession({ ...layers.hyperfocus, id: "legacy-hyperfocus", mode: "hyperfocus" }, 1, now),
  ].filter((session) => session.active);
}

function aggregateLayer(sessions, mode, now) {
  const matching = sessions.filter((session) => session.active && session.mode === mode);
  if (!matching.length) return sanitizeLayer({}, mode, now);
  const web = mode === "hyperfocus" ? {
    allow: intersectLists(matching.map((session) => session.web.allow)),
  } : {
    domains: [...new Set(matching.flatMap((session) => session.web.domains))],
    urls: [...new Set(matching.flatMap((session) => session.web.urls))],
  };
  return sanitizeLayer({
    active: true,
    locked: matching.some((session) => session.locked),
    task: matching.map((session) => session.task).filter(Boolean).join(" · ").slice(0, 240),
    startedAt: Math.min(...matching.map((session) => session.startedAt)),
    endAt: Math.max(...matching.map((session) => session.endAt)),
    web,
    desktop: {
      applications: [...new Set(matching.flatMap((session) => session.desktop.applications))],
      blockOtherApplications: matching.some((session) => session.desktop.blockOtherApplications),
    },
  }, mode, now);
}

function sanitizePolicy(input = {}) {
  const now = Date.now();
  const sessions = (Array.isArray(input.sessions)
    ? input.sessions.map((session, index) => sanitizeSession(session, index, now))
    : legacySessions(input, now))
    .filter((session) => session.active)
    .slice(0, 30);
  const layers = {
    blocklist: aggregateLayer(sessions, "blocklist", now),
    hyperfocus: aggregateLayer(sessions, "hyperfocus", now),
  };
  const activeLayers = Object.values(layers).filter((layer) => layer.active);
  const active = activeLayers.length > 0;
  const hyperActive = layers.hyperfocus.active;
  const startedTimes = activeLayers.map((layer) => layer.startedAt).filter(Boolean);
  const endTimes = activeLayers.map((layer) => layer.endAt).filter(Boolean);

  return {
    active,
    locked: activeLayers.some((layer) => layer.locked),
    mode: hyperActive ? "hyperfocus" : "blocklist",
    task: hyperActive ? layers.hyperfocus.task : "",
    startedAt: startedTimes.length ? Math.min(...startedTimes) : null,
    endAt: endTimes.length ? Math.max(...endTimes) : null,
    updatedAt: Number(input.updatedAt) || null,
    source: String(input.source || "desktop").slice(0, 32),
    web: {
      domains: layers.blocklist.active ? layers.blocklist.web.domains : [],
      urls: layers.blocklist.active ? layers.blocklist.web.urls : [],
      allow: hyperActive ? layers.hyperfocus.web.allow : [],
    },
    desktop: {
      applications: [...new Set([
        ...(layers.blocklist.active ? layers.blocklist.desktop.applications : []),
        ...(layers.hyperfocus.active ? layers.hyperfocus.desktop.applications : []),
      ])],
      blockOtherApplications: layers.hyperfocus.active && layers.hyperfocus.desktop.blockOtherApplications,
    },
    layers,
    sessions,
    savedLists: sanitizeSavedLists(input.savedLists),
  };
}

const BULK_BLOCK_EXCLUSIONS = /(windows|driver|runtime|redistributable|webview|service|host|helper|updater?|update|security|antivirus|audio|speech|dictation|accessibility|wispr|whisper)/i;

function isSafeForBulkBlocking(item) {
  const executable = normalizeExecutable(item?.executable);
  if (!executable) return false;
  return !BULK_BLOCK_EXCLUSIONS.test(`${item?.name || ""} ${executable}`);
}

function inactivePolicy(source = "desktop") {
  return sanitizePolicy({ ...DEFAULT_POLICY, source, updatedAt: Date.now() });
}

function isExpired(policy) {
  if (Array.isArray(policy?.sessions) && policy.sessions.length) {
    return policy.sessions.some(
      (session) => session?.active && session?.endAt && Date.now() >= session.endAt,
    );
  }
  if (policy?.layers) {
    return Object.values(policy.layers).some(
      (layer) => layer?.active && layer?.endAt && Date.now() >= layer.endAt,
    );
  }
  return Boolean(policy?.active && policy?.endAt && Date.now() >= policy.endAt);
}

module.exports = {
  DEFAULT_POLICY,
  PROTECTED_EXECUTABLES,
  inactivePolicy,
  isExpired,
  isSafeForBulkBlocking,
  normalizeExecutable,
  sanitizePolicy,
  sanitizeSession,
  sanitizeSavedLists,
};
