const { contextBridge, ipcRenderer } = require("electron");
let channel;
contextBridge.exposeInMainWorld("screenPicker", {
  onSources(callback) {
    ipcRenderer.once("mysession:screen-sources", (_event, input) => {
      channel = input.channel;
      callback({ sources: input.sources, audio: input.audio });
    });
  },
  choose(id, audio) { if (channel) ipcRenderer.send(channel, id ? { id, audio } : null); },
});
