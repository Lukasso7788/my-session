const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.whenReady().then(async () => {
  try {
    const source = path.join(__dirname, "../assets/icon.svg");
    const destination = path.join(__dirname, "../assets/icon.png");
    const window = new BrowserWindow({
      width: 512,
      height: 512,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { offscreen: true },
    });
    await window.loadFile(source);
    const image = await window.webContents.capturePage();
    if (image.isEmpty()) throw new Error("Could not capture FocusShield icon");
    fs.writeFileSync(destination, image.toPNG());
    console.log(`Wrote ${destination}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
