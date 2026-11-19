const { app, BrowserWindow, Menu, dialog, session, shell, Tray, powerSaveBlocker } = require("electron");
const path = require("node:path");

const { setupUpdates } = require("./updater.cjs");
const { attachContextMenu } = require("./context-menu.cjs");
const { chooseScreen } = require("./screen-picker.cjs");
let tray;
let quitting = false;

const sessionsUrl = "https://mysession.club/sessions";
const allowedOrigins = new Set(["https://mysession.club", "https://www.mysession.club"]);

function isMySession(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && allowedOrigins.has(url.origin);
  } catch {
    return false;
  }
}

async function openSessions(window) {
  try {
    await window.loadURL(sessionsUrl);
  } catch (error) {
    if (window.isDestroyed() || error.code === "ERR_ABORTED") return;
    const { response } = await dialog.showMessageBox(window, {
      type: "error",
      title: "MySession",
      message: "Could not open MySession",
      detail: "Check your connection and try again.",
      buttons: ["Retry", "Close"],
      cancelId: 1,
    });
    if (window.isDestroyed()) return;
    if (response === 0) void openSessions(window);
    else window.close();
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 760,
    minHeight: 600,
    title: "MySession",
    backgroundColor: "#1b1b1b",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      partition: "persist:mysession",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const web = window.webContents;
  attachContextMenu(window);
  const updates = setupUpdates(window, () => { quitting = true; });
  const siteSession = session.fromPartition("persist:mysession");
  const mediaGranted = new Set();
  siteSession.setPermissionCheckHandler((contents, permission, origin, details) =>
    contents === web && permission === "media" && details.isMainFrame &&
    isMySession(origin) && mediaGranted.has(details.mediaType));
  siteSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const types = details.mediaTypes || [];
    if (contents !== web || permission !== "media" || !details.isMainFrame ||
        !isMySession(details.requestingUrl) || !isMySession(web.getURL()) ||
        !types.length || types.some((type) => !["audio", "video"].includes(type))) {
      callback(false);
      return;
    }
    if (types.every((type) => mediaGranted.has(type))) {
      callback(true);
      return;
    }
    const origin = new URL(web.getURL()).origin;
    const devices = types.map((type) => type === "audio" ? "microphone" : "camera").join(" and ");
    dialog.showMessageBox(window, {
      type: "question",
      message: `Allow MySession to use your ${devices}?`,
      buttons: ["Allow for this window", "Deny"],
      defaultId: 1,
      cancelId: 1,
    }).then(({ response }) => {
      const allowed = response === 0 && !web.isDestroyed() && isMySession(web.getURL()) &&
        new URL(web.getURL()).origin === origin;
      if (allowed) types.forEach((type) => mediaGranted.add(type));
      callback(allowed);
    }, () => callback(false));
  });
  siteSession.setDisplayMediaRequestHandler((request, callback) => {
    if (request.frame !== web.mainFrame || !isMySession(web.getURL())) return callback({});
    void chooseScreen(window, request, callback, isMySession);
  });
  let mediaWakeLock;
  web.on("media-started-playing", () => {
    if (mediaWakeLock == null) mediaWakeLock = powerSaveBlocker.start("prevent-app-suspension");
  });
  const releaseWakeLock = () => {
    if (mediaWakeLock != null && powerSaveBlocker.isStarted(mediaWakeLock)) powerSaveBlocker.stop(mediaWakeLock);
    mediaWakeLock = undefined;
  };
  web.on("media-paused", releaseWakeLock);
  web.on("destroyed", releaseWakeLock);
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  tray = new Tray(path.join(__dirname, "icon.png"));
  tray.setToolTip("MySession");
  tray.on("double-click", () => { window.show(); window.focus(); });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show MySession", click: () => { window.show(); window.focus(); } },
    { label: "Quit MySession", click: () => app.quit() },
  ]));

  let noticeOpen = false;
  function showBrowserOption(target) {
    if (noticeOpen) return;
    let url;
    try { url = new URL(target); } catch { return; }
    if (url.protocol !== "https:") return;
    noticeOpen = true;
    void dialog.showMessageBox(window, {
      type: "info",
      message: "Continue in your browser",
      detail: "External pages and provider sign-in are available in the web version of MySession.",
      buttons: ["Open MySession in browser", "Cancel"],
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) return shell.openExternal(sessionsUrl);
    }).catch(() => {}).finally(() => { noticeOpen = false; });
  }

  web.on("will-frame-navigate", (event) => {
    if (isMySession(event.url)) return;
    event.preventDefault();
    if (event.isMainFrame) showBrowserOption(event.url);
  });
  web.on("will-redirect", (event) => {
    if (isMySession(event.url)) return;
    event.preventDefault();
    if (event.isMainFrame) showBrowserOption(event.url);
  });
  web.setWindowOpenHandler(({ url }) => {
    if (isMySession(url)) {
      setImmediate(() => {
        if (!web.isDestroyed()) window.loadURL(url).catch(() => {});
      });
    } else {
      setImmediate(() => { if (!window.isDestroyed()) showBrowserOption(url); });
    }
    return { action: "deny" };
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "MySession", submenu: [
      { label: "Sessions", accelerator: "Ctrl+Home", click: () => void openSessions(window) },
      { label: "Check for updates", click: () => { void updates.check(); } },
      { label: "Open MySession in browser", click: () => { void shell.openExternal(sessionsUrl); } },
      { type: "separator" },
      { label: "Quit MySession", accelerator: "Alt+F4", click: () => app.quit() },
    ] },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }] },
  ]));

  void openSessions(window);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId("club.mysession.desktop");
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    window.show();
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on("before-quit", () => { quitting = true; });
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
}
