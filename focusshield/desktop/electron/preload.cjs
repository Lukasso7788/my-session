const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("focusShield", {
  getState: () => ipcRenderer.invoke("focusshield:get-state"),
  listProcesses: () => ipcRenderer.invoke("focusshield:list-processes"),
  listInstalledApps: (force = false) =>
    ipcRenderer.invoke("focusshield:list-installed-apps", Boolean(force)),
  start: (payload) => ipcRenderer.invoke("focusshield:start", payload),
  saveBlockList: (payload) => ipcRenderer.invoke("focusshield:save-block-list", payload),
  deleteBlockList: (id) => ipcRenderer.invoke("focusshield:delete-block-list", id),
  stop: (mode = null) => ipcRenderer.invoke("focusshield:stop", mode),
  setLaunchAtLogin: (enabled) =>
    ipcRenderer.invoke("focusshield:set-launch-at-login", Boolean(enabled)),
  showWindow: () => ipcRenderer.invoke("focusshield:show-window"),
  quickBlockActiveTab: () =>
    ipcRenderer.invoke("focusshield:quick-block-active-tab"),
  setQuickBlockVisible: (visible) =>
    ipcRenderer.invoke("focusshield:set-quick-block-visible", Boolean(visible)),
  connectAccount: () => ipcRenderer.invoke("focusshield:connect-account"),
  disconnectAccount: () => ipcRenderer.invoke("focusshield:disconnect-account"),
  syncNow: () => ipcRenderer.invoke("focusshield:sync-now"),
  checkForUpdates: () => ipcRenderer.invoke("focusshield:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("focusshield:install-update"),
  onPolicyChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("focusshield:policy-changed", listener);
    return () => ipcRenderer.removeListener("focusshield:policy-changed", listener);
  },
  onAppBlocked: (callback) => {
    const listener = (_event, item) => callback(item);
    ipcRenderer.on("focusshield:app-blocked", listener);
    return () => ipcRenderer.removeListener("focusshield:app-blocked", listener);
  },
  onUpdateChanged: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on("focusshield:update-changed", listener);
    return () => ipcRenderer.removeListener("focusshield:update-changed", listener);
  },
});
