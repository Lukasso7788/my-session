const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("focusShield", {
  getState: () => ipcRenderer.invoke("focusshield:get-state"),
  listProcesses: () => ipcRenderer.invoke("focusshield:list-processes"),
  listInstalledApps: (force = false) =>
    ipcRenderer.invoke("focusshield:list-installed-apps", Boolean(force)),
  start: (payload) => ipcRenderer.invoke("focusshield:start", payload),
  stop: () => ipcRenderer.invoke("focusshield:stop"),
  setLaunchAtLogin: (enabled) =>
    ipcRenderer.invoke("focusshield:set-launch-at-login", Boolean(enabled)),
  showWindow: () => ipcRenderer.invoke("focusshield:show-window"),
  connectAccount: () => ipcRenderer.invoke("focusshield:connect-account"),
  disconnectAccount: () => ipcRenderer.invoke("focusshield:disconnect-account"),
  syncNow: () => ipcRenderer.invoke("focusshield:sync-now"),
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
});
