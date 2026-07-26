const { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, safeStorage, shell, Tray } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createExtensionBridge } = require("./bridge.cjs");
const { CloudSync } = require("./cloud-sync.cjs");
const { listInstalledApps } = require("./installed-apps.cjs");
const { ProcessBlocker } = require("./process-blocker.cjs");
const { inactivePolicy, isExpired, sanitizePolicy } = require("./policy.cjs");

let mainWindow = null;
let tray = null;
let quitting = false;
let bridge = null;
let cloudSync = null;
let expiryTimer = null;
let policy = { ...inactivePolicy(), updatedAt: null };
let settings = { launchAtLogin: true, deviceId: crypto.randomUUID() };
let pairingNonce = crypto.randomBytes(24).toString("hex");

function dataPath(name) {
  return path.join(app.getPath("userData"), name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(name), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  const destination = dataPath(name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, destination);
}

function saveCloudSession(session) {
  const destination = dataPath("cloud-session.json");
  if (!session) {
    try { fs.unlinkSync(destination); } catch { }
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) return;
  writeJson("cloud-session.json", {
    encrypted: true,
    value: safeStorage.encryptString(JSON.stringify(session)).toString("base64"),
  });
}

function loadCloudSession() {
  try {
    const stored = readJson("cloud-session.json", null);
    if (!stored?.encrypted || !stored?.value || !safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(
      safeStorage.decryptString(Buffer.from(stored.value, "base64")),
    );
  } catch {
    return null;
  }
}

function publicState() {
  return {
    platform: process.platform,
    policy,
    settings,
    bridgeOnline: Boolean(bridge?.listening),
    account: cloudSync?.getAccount() || { connected: false },
  };
}

function notifyRenderers(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function updateTray() {
  if (!tray) return;
  const label = policy.active ? "FocusShield is active" : "FocusShield is inactive";
  tray.setToolTip(label);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label, enabled: false },
    { type: "separator" },
    { label: "Open FocusShield", click: () => showWindow() },
    {
      label: "Stop shield",
      enabled: policy.active && !(policy.locked && !isExpired(policy)),
      click: () => deactivatePolicy("tray"),
    },
    { type: "separator" },
    {
      label: policy.active && policy.locked ? "Quit (available when timer ends)" : "Quit",
      enabled: !(policy.active && policy.locked && !isExpired(policy)),
      click: () => { quitting = true; app.quit(); },
    },
  ]));
}

function deactivatePolicy(source = "desktop") {
  return updatePolicy({
    ...policy,
    active: false,
    locked: false,
    startedAt: null,
    endAt: null,
  }, source);
}

function updatePolicy(nextInput, source = "desktop", options = {}) {
  const next = sanitizePolicy({
    ...nextInput,
    source,
    updatedAt: options.preserveUpdatedAt
      ? Number(nextInput?.updatedAt) || Date.now()
      : Date.now(),
  });
  if (
    policy.active &&
    policy.locked &&
    !isExpired(policy) &&
    (!next.active || Number(next.endAt) < Number(policy.endAt))
  ) {
    return { ok: false, status: 423, error: "locked", endAt: policy.endAt };
  }
  policy = next;
  writeJson("policy.json", policy);
  updateTray();
  notifyRenderers("focusshield:policy-changed", publicState());
  if (!options.skipCloud && cloudSync?.getAccount().connected) {
    void cloudSync.syncNow({ preferLocal: true });
  }
  return { ok: true, policy };
}

async function connectCloudAccount(body) {
  if (!body || String(body.nonce || "") !== pairingNonce) {
    return { ok: false, error: "invalid_or_expired_pairing_code" };
  }
  const supabaseUrl = String(body.supabaseUrl || "").replace(/\/$/, "");
  let parsedUrl;
  try { parsedUrl = new URL(supabaseUrl); } catch { return { ok: false, error: "invalid_supabase_url" }; }
  if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname.endsWith(".supabase.co")) {
    return { ok: false, error: "invalid_supabase_url" };
  }
  const session = {
    supabaseUrl,
    anonKey: String(body.anonKey || ""),
    accessToken: String(body.accessToken || ""),
    refreshToken: String(body.refreshToken || ""),
    expiresAt: Number(body.expiresAt || 0),
    user: body.user || null,
  };
  if (
    session.anonKey.length < 20 ||
    session.accessToken.length < 20 ||
    session.refreshToken.length < 20 ||
    !session.user?.id
  ) {
    return { ok: false, error: "invalid_session" };
  }

  pairingNonce = crypto.randomBytes(24).toString("hex");
  cloudSync.configure(session);
  saveCloudSession(session);
  notifyRenderers("focusshield:policy-changed", publicState());
  return { ok: true, account: cloudSync.getAccount() };
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

function trayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#1f2521"/><path d="M16 5l9 4v6c0 6-3.8 10.2-9 12-5.2-1.8-9-6-9-12V9l9-4z" fill="#81DB86"/><path d="M12 16l2.6 2.7L20.5 13" fill="none" stroke="#102013" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

const blocker = new ProcessBlocker({
  getPolicy: () => policy,
  onBlocked: (item) => {
    notifyRenderers("focusshield:app-blocked", item);
    if (Notification.isSupported()) {
      new Notification({
        title: "FocusShield blocked a distraction",
        body: `${item.name} was closed while your focus session is active.`,
        silent: true,
      }).show();
    }
  },
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 760,
    minWidth: 820,
    minHeight: 620,
    backgroundColor: "#151715",
    icon: path.join(__dirname, "../assets/icon.png"),
    show: false,
    title: "FocusShield",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(() => {
    policy = sanitizePolicy(readJson("policy.json", { ...inactivePolicy(), updatedAt: null }));
    if (isExpired(policy)) policy = inactivePolicy("expired");
    settings = { ...settings, ...readJson("settings.json", {}) };
    if (!settings.deviceId) settings.deviceId = crypto.randomUUID();
    writeJson("settings.json", settings);
    cloudSync = new CloudSync({
      deviceId: settings.deviceId,
      getPolicy: () => policy,
      applyRemotePolicy: (remotePolicy) =>
        updatePolicy(remotePolicy, "cloud", {
          preserveUpdatedAt: true,
          skipCloud: true,
        }),
      onSessionChanged: (session) => {
        if (session) saveCloudSession(session);
        notifyRenderers("focusshield:policy-changed", publicState());
      },
    });
    const savedCloudSession = loadCloudSession();
    if (savedCloudSession) cloudSync.configure(savedCloudSession);
    createWindow();
    tray = new Tray(trayIcon());
    tray.on("double-click", showWindow);
    updateTray();
    blocker.start();
    bridge = createExtensionBridge({
      getPolicy: () => policy,
      updatePolicy,
      connectAccount: connectCloudAccount,
    });
    expiryTimer = setInterval(() => {
      if (isExpired(policy)) deactivatePolicy("expired");
    }, 1000);
    app.setLoginItemSettings({ openAtLogin: Boolean(settings.launchAtLogin), openAsHidden: true });
  });
}

ipcMain.handle("focusshield:get-state", () => publicState());
ipcMain.handle("focusshield:list-processes", async () => blocker.listProcesses());
ipcMain.handle("focusshield:list-installed-apps", async (_event, force) =>
  listInstalledApps({ force: Boolean(force) }),
);
ipcMain.handle("focusshield:start", (_event, input) => {
  const minutes = Math.max(1, Math.min(1440, Number(input?.minutes) || 25));
  return updatePolicy({
    active: true,
    locked: Boolean(input?.locked),
    startedAt: Date.now(),
    endAt: Date.now() + minutes * 60_000,
    web: input?.web,
    desktop: input?.desktop,
  });
});
ipcMain.handle("focusshield:stop", () => deactivatePolicy("desktop"));
ipcMain.handle("focusshield:set-launch-at-login", (_event, enabled) => {
  settings.launchAtLogin = Boolean(enabled);
  writeJson("settings.json", settings);
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, openAsHidden: true });
  return publicState();
});
ipcMain.handle("focusshield:show-window", () => showWindow());
ipcMain.handle("focusshield:connect-account", async () => {
  pairingNonce = crypto.randomBytes(24).toString("hex");
  const target = `https://mysession.club/focus-shield?desktopConnect=${encodeURIComponent(pairingNonce)}`;
  await shell.openExternal(target);
  return { ok: true };
});
ipcMain.handle("focusshield:disconnect-account", () => {
  cloudSync?.configure(null);
  saveCloudSession(null);
  notifyRenderers("focusshield:policy-changed", publicState());
  return publicState();
});
ipcMain.handle("focusshield:sync-now", async () => {
  const result = await cloudSync?.syncNow();
  return { ...result, state: publicState() };
});

app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => {
  blocker.stop();
  cloudSync?.stop();
  if (expiryTimer) clearInterval(expiryTimer);
  bridge?.close();
});
app.on("window-all-closed", () => {
  // Keep enforcing the active policy from the Windows tray.
});
