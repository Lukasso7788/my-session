const { app, BrowserWindow, Menu, dialog, session, shell, Tray, powerSaveBlocker } = require("electron");
const path = require("node:path");

const { setupUpdates } = require("./updater.cjs");
const { attachContextMenu } = require("./context-menu.cjs");
const { chooseScreen } = require("./screen-picker.cjs");
const { logoutDesktop } = require("./logout.cjs");
const { createAuthNavigationHandler } = require("./auth-window-navigation.cjs");
const { createBrowserAuth, AUTH_ORIGIN, APP_ORIGIN } = require("./browser-auth.cjs");
const { providerFromNavigation } = require("./oauth-protocol.cjs");
const { accountUrl, authWindowDecision, isMySessionUrl } = require("./oauth-protocol.cjs");
let tray;
let quitting = false;
let receiveAuthLink = async () => false;

const sessionsUrl = "https://mysession.club/sessions";

function isMySession(value) {
  return isMySessionUrl(value);
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
  const browserAuth = createBrowserAuth({
    fetchConfig: async () => {
      const response = await fetch(`${APP_ORIGIN}/api/desktop-auth-config`, { signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!response.ok) throw new Error("config");
      return response.json();
    },
    openExternal: url => shell.openExternal(url),
    exchange: async (config, code, verifier) => {
      const response = await fetch(`${AUTH_ORIGIN}/auth/v1/token?grant_type=pkce`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json", apikey: config.anonKey },
        body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
      });
      if (!response.ok) throw new Error("exchange");
      return response.json();
    },
    adopt: async tokens => {
      const callback = new URL("/auth/callback", APP_ORIGIN);
      callback.hash = new URLSearchParams({
        access_token: tokens.access_token, refresh_token: tokens.refresh_token,
        token_type: "bearer", expires_in: String(tokens.expires_in || 3600),
      }).toString();
      // Existing Supabase callback consumes and clears this fragment; never log it.
      await window.loadURL(callback.href);
      showApp();
    },
    failed: message => {
      if (!window.isDestroyed()) void dialog.showMessageBox(window, { type: "error", message }).catch(() => {});
    },
  });
  receiveAuthLink = browserAuth.receive;
  window.on("closed", browserAuth.cancel);
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
    { label: "Log in", click: () => openAccount("login") },
    { label: "Create account", click: () => openAccount("register") },
    { label: "Log out", click: () => void logOut() },
    { type: "separator" },
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
      detail: "MySession stays open here. This link is outside the app.",
      buttons: ["Open MySession in browser", "Cancel"],
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) return shell.openExternal(sessionsUrl);
    }).catch(() => {}).finally(() => { noticeOpen = false; });
  }

  let authWindow = null;
  let loggingOut = false;
  async function logOut() {
    if (loggingOut) return;
    const { response } = await dialog.showMessageBox(window, {
      type: "question", message: "Log out of MySession?",
      detail: "This leaves your current room and signs out of this desktop app only.",
      buttons: ["Log out", "Cancel"], defaultId: 1, cancelId: 1,
    });
    if (response !== 0 || window.isDestroyed()) return;
    loggingOut = true;
    browserAuth.cancel();
    try {
      await logoutDesktop(window, siteSession, () => {
        if (authWindow && !authWindow.isDestroyed()) authWindow.close();
        mediaGranted.clear();
      });
      showApp();
    } catch {
      if (!window.isDestroyed()) await dialog.showMessageBox(window, { type: "error", message: "Could not finish logging out. Please try again." });
    } finally { loggingOut = false; }
  }
  let lastProviderUrl = "";
  let lastProviderAt = 0;
  const showApp = () => {
    if (window.isDestroyed()) return;
    window.show();
    if (window.isMinimized()) window.restore();
    window.focus();
  };
  const openAccount = (kind) => {
    showApp();
    window.loadURL(accountUrl(web.getURL(), kind)).catch(() => {});
  };
  const finishProviderSignIn = (url) => {
    const popup = authWindow;
    authWindow = null;
    if (popup && !popup.isDestroyed()) popup.close();
    showApp();
    if (!web.isDestroyed()) window.loadURL(url).catch(() => {});
  };
  const openProviderSignIn = (targetUrl) => {
    if (providerFromNavigation(targetUrl) === "google") {
      if (authWindow && !authWindow.isDestroyed()) authWindow.close();
      void browserAuth.start();
      return;
    }
    const now = Date.now();
    if (authWindow && !authWindow.isDestroyed() && targetUrl === lastProviderUrl && now - lastProviderAt < 1500) {
      authWindow.show();
      authWindow.focus();
      return;
    }
    lastProviderUrl = targetUrl;
    lastProviderAt = now;
    if (!authWindow || authWindow.isDestroyed()) {
      authWindow = new BrowserWindow({
        parent: window,
        modal: true,
        width: 480,
        height: 760,
        title: "Sign in to MySession",
        autoHideMenuBar: true,
        backgroundColor: "#ffffff",
        icon: path.join(__dirname, "icon.png"),
        webPreferences: {
          partition: "persist:mysession",
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      const popup = authWindow;
      const popupWeb = popup.webContents;
      let blockedNotice = false;
      const showBlocked = () => {
        if (blockedNotice || popup.isDestroyed()) return;
        blockedNotice = true;
        void dialog.showMessageBox(popup, {
          type: "info", title: "Sign-in could not continue",
          message: "The sign-in provider requested an unsupported page.",
          detail: "Close this sign-in window and try again, or use email and password in MySession.",
          buttons: ["OK"],
        }).catch(() => {}).finally(() => { blockedNotice = false; });
      };
      const follow = createAuthNavigationHandler({ finish: finishProviderSignIn, blocked: showBlocked });
      popupWeb.on("will-navigate", follow);
      popupWeb.on("will-redirect", follow);
      popupWeb.setWindowOpenHandler(({ url }) => {
        const decision = authWindowDecision(url);
        if (decision === "block") {
          setImmediate(showBlocked);
          return { action: "deny" };
        }
        setImmediate(() => {
          if (popup.isDestroyed()) return;
          if (decision === "app") finishProviderSignIn(url);
          else popup.loadURL(url).catch(() => {});
        });
        return { action: "deny" };
      });
      popup.on("closed", () => {
        if (authWindow === popup) authWindow = null;
      });
    }
    authWindow.show();
    authWindow.focus();
    authWindow.loadURL(targetUrl).catch(() => {
      if (!window.isDestroyed()) {
        void dialog.showMessageBox(window, {
          type: "info",
          title: "MySession",
          message: "Sign-in did not open",
          detail: "Stay in MySession and try Log in again.",
          buttons: ["OK"],
        }).catch(() => {});
      }
    });
  };
  const acceptNavigation = (url, isMainFrame) => {
    if (loggingOut && url === "about:blank") return true;
    const decision = authWindowDecision(url);
    if (decision === "app") return true;
    if (!isMainFrame) return false;
    if (decision === "provider") openProviderSignIn(url);
    else showBrowserOption(url);
    return false;
  };

  web.on("will-frame-navigate", (event) => {
    if (!acceptNavigation(event.url, event.isMainFrame !== false)) event.preventDefault();
  });
  web.on("will-redirect", (event) => {
    if (!acceptNavigation(event.url, event.isMainFrame !== false)) event.preventDefault();
  });
  web.setWindowOpenHandler(({ url }) => {
    setImmediate(() => {
      if (window.isDestroyed() || web.isDestroyed()) return;
      if (acceptNavigation(url, true)) window.loadURL(url).catch(() => {});
    });
    return { action: "deny" };
  });
  window.on("closed", () => {
    if (authWindow && !authWindow.isDestroyed()) authWindow.close();
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "MySession", submenu: [
      { label: "Sessions", accelerator: "Ctrl+Home", click: () => void openSessions(window) },
      { label: "Log in", accelerator: "Ctrl+L", click: () => openAccount("login") },
      { label: "Create account", click: () => openAccount("register") },
      { label: "Log out", click: () => void logOut() },
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
  app.on("second-instance", (_event, argv) => {
    const authLink = argv.find(value => value.startsWith("mysession://"));
    if (authLink) void receiveAuthLink(authLink);
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    window.show();
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on("before-quit", () => { quitting = true; });
  app.on("open-url", (event, url) => { event.preventDefault(); void receiveAuthLink(url); });
  if (app.isPackaged) app.setAsDefaultProtocolClient("mysession");
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
}
