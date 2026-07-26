const DEFAULT_POLICY = Object.freeze({
  active: false,
  locked: false,
  startedAt: null,
  endAt: null,
  updatedAt: null,
  source: "desktop",
  web: { domains: [], urls: [], allow: [] },
  desktop: { applications: [] },
});

const PROTECTED_EXECUTABLES = new Set([
  "csrss.exe",
  "dwm.exe",
  "electron.exe",
  "explorer.exe",
  "focusshield.exe",
  "fontdrvhost.exe",
  "lsass.exe",
  "services.exe",
  "smss.exe",
  "svchost.exe",
  "system",
  "taskhostw.exe",
  "wininit.exe",
  "winlogon.exe",
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

function sanitizePolicy(input = {}) {
  const now = Date.now();
  const web = input.web || {};
  const desktop = input.desktop || {};
  const active = Boolean(input.active);
  const applications = [...new Set(
    uniqueStrings(desktop.applications)
      .map(normalizeExecutable)
      .filter(Boolean),
  )];

  return {
    active,
    locked: active && Boolean(input.locked),
    startedAt: active ? Number(input.startedAt) || now : null,
    endAt: active ? Number(input.endAt) || now + 25 * 60_000 : null,
    updatedAt: Number(input.updatedAt) || null,
    source: String(input.source || "desktop").slice(0, 32),
    web: {
      domains: [...new Set(uniqueStrings(web.domains).map((item) => item.toLowerCase()))],
      urls: uniqueStrings(web.urls),
      allow: [...new Set(uniqueStrings(web.allow).map((item) => item.toLowerCase()))],
    },
    desktop: { applications },
  };
}

function inactivePolicy(source = "desktop") {
  return sanitizePolicy({ ...DEFAULT_POLICY, source, updatedAt: Date.now() });
}

function isExpired(policy) {
  return Boolean(policy?.active && policy?.endAt && Date.now() >= policy.endAt);
}

module.exports = {
  DEFAULT_POLICY,
  PROTECTED_EXECUTABLES,
  inactivePolicy,
  isExpired,
  normalizeExecutable,
  sanitizePolicy,
};
