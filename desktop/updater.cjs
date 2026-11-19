const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");

function setupUpdates(parent, prepareQuit) {
  let state = { status: "idle", version: app.getVersion() };
  let checking = false;
  let downloading = false;
  const banner = new BrowserWindow({
    parent, width: 270, height: 54, frame: false, resizable: false,
    skipTaskbar: true, show: false, backgroundColor: "#242424",
    webPreferences: { preload: path.join(__dirname, "update-preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const channel = "mysession:install-update:" + banner.webContents.id;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  const place = () => {
    if (parent.isDestroyed() || banner.isDestroyed()) return;
    const bounds = parent.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    banner.setPosition(Math.max(area.x, Math.min(bounds.x + bounds.width - 286, area.x + area.width - 270)), Math.max(area.y, bounds.y + 44));
  };
  const publish = (patch) => {
    state = { ...state, ...patch };
    if (banner.isDestroyed()) return;
    banner.webContents.send("mysession:update-state", state);
    const visible = ["available", "downloading", "ready", "error"].includes(state.status);
    if (visible && parent.isVisible()) {
      place();
      banner.showInactive();
    } else banner.hide();
  };
  const fail = () => publish({ status: "error" });
  const check = async () => {
    if (!app.isPackaged || checking || downloading || state.status === "ready") return;
    checking = true;
    try { await autoUpdater.checkForUpdates(); }
    catch {
      // A missing initial release or an offline check is retried later.
      // Keep an already visible update actionable.
    } finally { checking = false; }
  };

  autoUpdater.on("update-available", info => {
    if (state.status !== "ready" && !downloading) publish({ status: "available", version: info.version });
  });
  autoUpdater.on("download-progress", info => publish({ status: "downloading", percent: Math.floor(info.percent) }));
  autoUpdater.on("update-downloaded", info => {
    downloading = false;
    publish({ status: "ready", version: info.version });
  });
  autoUpdater.on("error", () => { if (downloading) { downloading = false; fail(); } });

  ipcMain.on(channel, async (event) => {
    if (event.sender !== banner.webContents || downloading) return;
    if (state.status === "ready") {
      prepareQuit();
      autoUpdater.quitAndInstall(false, true);
      return;
    }
    if (!["available", "error"].includes(state.status)) return;
    downloading = true;
    publish({ status: "downloading", percent: 0 });
    try { await autoUpdater.downloadUpdate(); }
    catch { downloading = false; fail(); }
  });
  banner.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  banner.webContents.on("will-navigate", event => event.preventDefault());
  banner.loadFile(path.join(__dirname, "update.html")).then(() => {
    banner.webContents.send("mysession:update-channel", channel);
    publish({});
  }).catch(() => {});
  parent.on("move", place);
  parent.on("resize", place);
  parent.on("show", () => publish({}));
  parent.on("hide", () => { if (!banner.isDestroyed()) banner.hide(); });
  const initial = setTimeout(check, 10000);
  const interval = setInterval(check, 15 * 60 * 1000);
  parent.once("closed", () => {
    clearTimeout(initial);
    clearInterval(interval);
    ipcMain.removeAllListeners(channel);
    if (!banner.isDestroyed()) banner.close();
  });
  return { check };
}

module.exports = { setupUpdates };
