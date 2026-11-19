const { BrowserWindow, desktopCapturer, ipcMain } = require("electron");
const path = require("node:path");

async function chooseScreen(parent, request, callback, isAllowed) {
  if (!request.userGesture || !isAllowed(request.securityOrigin)) return callback({});
  let completed = false;
  const picker = new BrowserWindow({
    parent, modal: true, width: 800, height: 620, minWidth: 600, minHeight: 440,
    title: "Share your screen · MySession", backgroundColor: "#1b1b1b",
    autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, "picker-preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const channel = "mysession:screen-choice:" + picker.webContents.id;
  const finish = (result) => {
    if (completed) return;
    completed = true;
    ipcMain.removeAllListeners(channel);
    parent.removeListener("closed", onParentClosed);
    callback(result);
    if (!picker.isDestroyed()) picker.close();
  };
  const onParentClosed = () => finish({});
  picker.on("closed", () => finish({}));
  parent.once("closed", onParentClosed);
  picker.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  picker.webContents.on("will-navigate", event => event.preventDefault());
  try {
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 300, height: 180 }, fetchWindowIcons: false });
    const choices = sources.filter(source => source.name !== picker.getTitle());
    ipcMain.on(channel, (event, input) => {
      if (event.sender !== picker.webContents) return;
      if (!input || !isAllowed(parent.webContents.getURL()) || parent.webContents.mainFrame !== request.frame) return finish({});
      const source = choices.find(item => item.id === input.id);
      if (!source) return finish({});
      finish({
        video: source,
        ...(request.audioRequested && input.audio === true ? { audio: "loopback" } : {}),
      });
    });
    await picker.loadFile(path.join(__dirname, "picker.html"));
    if (completed) return;
    picker.webContents.send("mysession:screen-sources", {
      channel, audio: request.audioRequested,
      sources: choices.map(source => ({ id: source.id, name: source.name, image: source.thumbnail.toDataURL() })),
    });
    picker.show();
  } catch {
    finish({});
  }
}

module.exports = { chooseScreen };
