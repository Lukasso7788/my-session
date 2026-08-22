const { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, safeStorage, screen, shell, Tray } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { autoUpdater } = require("electron-updater");
const { createExtensionBridge } = require("./bridge.cjs");
const { CloudSync } = require("./cloud-sync.cjs");
const { listInstalledApps } = require("./installed-apps.cjs");
const { ProcessBlocker } = require("./process-blocker.cjs");
const { inactivePolicy, isExpired, isSafeForBulkBlocking, sanitizePolicy, sanitizeSavedLists } = require("./policy.cjs");

let mainWindow = null;
let quickBlockWindow = null;
let tray = null;
let quitting = false;
let bridge = null;
let cloudSync = null;
let expiryTimer = null;
let policy = { ...inactivePolicy(), updatedAt: null };
let settings = { launchAtLogin: true, quickBlockVisible: true, deviceId: crypto.randomUUID() };
let pairingNonce = crypto.randomBytes(24).toString("hex");
let updateCheckTimer = null;
let updateState = {
  status: app.isPackaged ? "idle" : "development",
  currentVersion: app.getVersion(),
  availableVersion: "",
  percent: 0,
  error: "",
};

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
    update: updateState,
  };
}

function notifyRenderers(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  notifyRenderers("focusshield:update-changed", updateState);
}

function checkForUpdates() {
  if (!app.isPackaged) {
    setUpdateState({ status: "development", error: "" });
    return Promise.resolve({ updateInfo: null });
  }
  return autoUpdater.checkForUpdates().catch((error) => {
    setUpdateState({
      status: "error",
      error: String(error?.message || error || "update_check_failed"),
    });
    return null;
  });
}

function configureAutoUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("checking-for-update", () =>
    setUpdateState({ status: "checking", error: "", percent: 0 }),
  );
  autoUpdater.on("update-available", (info) =>
    setUpdateState({
      status: "downloading",
      availableVersion: String(info?.version || ""),
      error: "",
      percent: 0,
    }),
  );
  autoUpdater.on("update-not-available", () =>
    setUpdateState({
      status: "current",
      availableVersion: "",
      error: "",
      percent: 0,
    }),
  );
  autoUpdater.on("download-progress", (progress) =>
    setUpdateState({
      status: "downloading",
      percent: Math.max(0, Math.min(100, Math.round(progress?.percent || 0))),
    }),
  );
  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({
      status: "ready",
      availableVersion: String(info?.version || updateState.availableVersion || ""),
      error: "",
      percent: 100,
    });
    if (Notification.isSupported()) {
      new Notification({
        title: "FocusShield update is ready",
        body: "Open FocusShield and restart to install it.",
        silent: true,
      }).show();
    }
  });
  autoUpdater.on("error", (error) =>
    setUpdateState({
      status: "error",
      error: String(error?.message || error || "update_failed"),
    }),
  );

  setTimeout(() => void checkForUpdates(), 8_000);
  updateCheckTimer = setInterval(() => void checkForUpdates(), 4 * 60 * 60_000);
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
      label: settings.quickBlockVisible ? "Hide quick block" : "Show quick block",
      click: () => setQuickBlockVisible(!settings.quickBlockVisible),
    },
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

function deactivatePolicy(source = "desktop", target = null) {
  const sessions = (policy.sessions || []).filter((session) => {
    if (!target) return false;
    if (target === "blocklist" || target === "hyperfocus") return session.mode !== target;
    return session.id !== target;
  });
  return updatePolicy({ ...policy, sessions }, source);
}

function updatePolicy(nextInput, source = "desktop", options = {}) {
  if (
    source === "extension" &&
    !Array.isArray(nextInput?.sessions) &&
    "active" in (nextInput || {})
  ) {
    const sessionId = "extension-primary";
    const sessions = (policy.sessions || []).filter((session) => session.id !== sessionId);
    if (nextInput.active) {
      sessions.push({
        ...nextInput,
        id: sessionId,
        name: String(nextInput.name || "Browser block session"),
        mode: nextInput.mode === "hyperfocus" ? "hyperfocus" : "blocklist",
      });
    }
    nextInput = {
      ...policy,
      sessions,
      savedLists: nextInput.savedLists || policy.savedLists,
    };
  }
  const next = sanitizePolicy({
    ...nextInput,
    source,
    updatedAt: options.preserveUpdatedAt
      ? Number(nextInput?.updatedAt) || Date.now()
      : Date.now(),
  });
  const lockedSession = (policy.sessions || []).find((currentSession) => {
    if (!currentSession.active || !currentSession.locked || Number(currentSession.endAt) <= Date.now()) return false;
    const nextSession = (next.sessions || []).find((session) => session.id === currentSession.id);
    return !nextSession?.active || Number(nextSession.endAt) < Number(currentSession.endAt);
  });
  if (lockedSession) {
    return {
      ok: false,
      status: 423,
      error: "locked",
      sessionId: lockedSession.id,
      mode: lockedSession.mode,
      endAt: lockedSession.endAt,
    };
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

async function saveBlockList(input = {}) {
  const now = Date.now();
  const id = String(input.id || crypto.randomUUID()).slice(0, 80);
  const existing = (policy.savedLists || []).find((item) => item.id === id);
  const nextList = {
    ...input,
    id,
    createdAt: Number(existing?.createdAt || input.createdAt) || now,
    updatedAt: now,
  };
  const savedLists = sanitizeSavedLists([
    nextList,
    ...(policy.savedLists || []).filter((item) => item.id !== id),
  ]);
  const result = updatePolicy(
    { ...policy, savedLists },
    "desktop",
    { skipCloud: true },
  );
  if (result.ok && cloudSync?.getAccount().connected) {
    const cloud = await cloudSync.upsertSavedList(savedLists[0])
      .catch((error) => ({ ok: false, error: String(error?.message || error) }));
    return { ...result, cloud };
  }
  return result;
}

async function deleteBlockList(id) {
  const savedLists = (policy.savedLists || []).filter(
    (item) => item.id !== String(id || ""),
  );
  const result = updatePolicy(
    { ...policy, savedLists },
    "desktop",
    { skipCloud: true },
  );
  if (result.ok && cloudSync?.getAccount().connected) {
    const cloud = await cloudSync.deleteSavedList(id)
      .catch((error) => ({ ok: false, error: String(error?.message || error) }));
    return { ...result, cloud };
  }
  return result;
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

function positionQuickBlockWindow() {
  if (!quickBlockWindow || quickBlockWindow.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  const [windowWidth, windowHeight] = quickBlockWindow.getSize();
  quickBlockWindow.setPosition(
    Math.round(x + width - windowWidth - 18),
    Math.round(y + height - windowHeight - 18),
    false,
  );
}

function setQuickBlockVisible(visible) {
  settings.quickBlockVisible = Boolean(visible);
  writeJson("settings.json", settings);
  if (quickBlockWindow && !quickBlockWindow.isDestroyed()) {
    if (settings.quickBlockVisible) {
      positionQuickBlockWindow();
      quickBlockWindow.showInactive();
    } else {
      quickBlockWindow.hide();
    }
  }
  updateTray();
  notifyRenderers("focusshield:policy-changed", publicState());
  return publicState();
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

function createQuickBlockWindow() {
  quickBlockWindow = new BrowserWindow({
    width: 202,
    height: 58,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  quickBlockWindow.setAlwaysOnTop(true, "floating");
  quickBlockWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  quickBlockWindow.loadFile(path.join(__dirname, "../renderer/quick-block.html"));
  quickBlockWindow.once("ready-to-show", () => {
    positionQuickBlockWindow();
    if (settings.quickBlockVisible) quickBlockWindow.showInactive();
  });
  quickBlockWindow.on("closed", () => { quickBlockWindow = null; });
}

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
    if (isExpired(policy)) policy = sanitizePolicy(policy);
    settings = { ...settings, ...readJson("settings.json", {}) };
    if (!settings.extensionQuickBlockMigrated) {
      settings.quickBlockVisible = false;
      settings.extensionQuickBlockMigrated = true;
    }
    if (!settings.deviceId) settings.deviceId = crypto.randomUUID();
    writeJson("settings.json", settings);
    cloudSync = new CloudSync({
      deviceId: settings.deviceId,
      getPolicy: () => policy,
      applyRemotePolicy: (remotePolicy) =>
        updatePolicy({ ...remotePolicy, savedLists: policy.savedLists }, "cloud", {
          preserveUpdatedAt: true,
          skipCloud: true,
        }),
      getSavedLists: () => policy.savedLists || [],
      applyRemoteSavedLists: (savedLists) =>
        updatePolicy(
          { ...policy, savedLists },
          "cloud-lists",
          { preserveUpdatedAt: true, skipCloud: true },
        ),
      onSessionChanged: (session) => {
        if (session) saveCloudSession(session);
        notifyRenderers("focusshield:policy-changed", publicState());
      },
    });
    const savedCloudSession = loadCloudSession();
    if (savedCloudSession) cloudSync.configure(savedCloudSession);
    createWindow();
    createQuickBlockWindow();
    tray = new Tray(trayIcon());
    tray.on("double-click", showWindow);
    updateTray();
    blocker.start();
    bridge = createExtensionBridge({
      getPolicy: () => policy,
      updatePolicy,
      connectAccount: connectCloudAccount,
    });
    configureAutoUpdates();
    expiryTimer = setInterval(() => {
      if (isExpired(policy)) updatePolicy(policy, "expired");
    }, 1000);
    app.setLoginItemSettings({ openAtLogin: Boolean(settings.launchAtLogin), openAsHidden: true });
  });
}

ipcMain.handle("focusshield:get-state", () => publicState());
ipcMain.handle("focusshield:list-processes", async () => blocker.listProcesses());
ipcMain.handle("focusshield:list-installed-apps", async (_event, force) =>
  listInstalledApps({ force: Boolean(force) }),
);
ipcMain.handle("focusshield:start", async (_event, input) => {
  const minutes = Math.max(1, Math.min(1440, Number(input?.minutes) || 25));
  const hyperFocus = input?.mode === "hyperfocus";
  let applications = input?.desktop?.applications || [];

  if (hyperFocus && input?.desktop?.blockOtherApplications) {
    const browsers = new Set([
      "brave.exe", "chrome.exe", "firefox.exe", "msedge.exe",
      "opera.exe", "opera_gx.exe", "vivaldi.exe",
    ]);
    const installed = await listInstalledApps().catch(() => []);
    applications = [
      ...applications,
      ...installed
        .filter(isSafeForBulkBlocking)
        .map((item) => item.executable)
        .filter((name) => name && !browsers.has(name)),
    ];
  }

  const mode = hyperFocus ? "hyperfocus" : "blocklist";
  const now = Date.now();
  const session = {
    id: crypto.randomUUID(),
    name: String(input?.name || (hyperFocus ? input?.task : "") ||
      `FocusShield session ${(policy.sessions || []).length + 1}`).trim().slice(0, 64),
    mode,
    active: true,
    locked: Boolean(input?.locked),
    task: hyperFocus ? input?.task : "",
    startedAt: now,
    endAt: now + minutes * 60_000,
    web: input?.web,
    desktop: {
      applications,
      blockOtherApplications: Boolean(input?.desktop?.blockOtherApplications),
    },
  };
  const result = updatePolicy({
    ...policy,
    sessions: [...(policy.sessions || []), session],
    savedLists: policy.savedLists,
  });
  return result.ok ? { ...result, sessionId: session.id } : result;
});
ipcMain.handle("focusshield:save-block-list", (_event, input) => saveBlockList(input));
ipcMain.handle("focusshield:delete-block-list", (_event, id) => deleteBlockList(id));
ipcMain.handle("focusshield:stop", (_event, mode) => deactivatePolicy("desktop", mode));
ipcMain.handle("focusshield:set-launch-at-login", (_event, enabled) => {
  settings.launchAtLogin = Boolean(enabled);
  writeJson("settings.json", settings);
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, openAsHidden: true });
  return publicState();
});
ipcMain.handle("focusshield:show-window", () => showWindow());
ipcMain.handle("focusshield:set-quick-block-visible", (_event, visible) =>
  setQuickBlockVisible(visible),
);
ipcMain.handle("focusshield:quick-block-active-tab", async () => {
  if (!bridge?.enqueueCommand) {
    return { ok: false, error: "extension_unavailable" };
  }
  const result = await bridge.enqueueCommand("block_active_tab");
  if (result?.ok && Notification.isSupported()) {
    new Notification({
      title: "Site blocked",
      body: `${result.hostname || "The active site"} was added to FocusShield.`,
      silent: true,
    }).show();
  }
  return result;
});
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
  const result = await cloudSync?.syncAll();
  return { ...result, state: publicState() };
});
ipcMain.handle("focusshield:check-for-updates", async () => {
  await checkForUpdates();
  return updateState;
});
ipcMain.handle("focusshield:install-update", () => {
  if (updateState.status !== "ready") return { ok: false, error: "update_not_ready" };
  quitting = true;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { ok: true };
});

app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => {
  blocker.stop();
  cloudSync?.stop();
  if (expiryTimer) clearInterval(expiryTimer);
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  bridge?.close();
});
app.on("window-all-closed", () => {
  // Keep enforcing the active policy from the Windows tray.
});
