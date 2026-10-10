import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(await readFile(path.join(root, "sources.json"), "utf8"));
const template = await readFile(path.join(root, "cover-template.html"), "utf8");
const compositions = path.join(root, "compositions");
const destination = path.resolve(root, "../../public/blog/editorial");
const chrome = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function materialize(source) {
  if (!/^[a-z0-9-]+$/.test(source.slug)) throw new Error(`Unsafe slug: ${source.slug}`);
  return template.replace(/{{(category|theme|slug|photoDescription|headline|subline|number|footerLabel)}}/g, (_, key) => escapeHtml(key === "footerLabel" ? source.footerLabel || "EDITORIAL GUIDE" : source[key]));
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForPort(profile, child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Chrome exited with ${child.exitCode}`);
    try {
      const content = await readFile(path.join(profile, "DevToolsActivePort"), "utf8");
      return Number(content.split(/\r?\n/)[0]);
    } catch { await sleep(100); }
  }
  throw new Error("Chrome DevTools port did not appear");
}

async function openPage(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Chrome could not open page: ${response.status}`);
  const target = await response.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const events = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
    if (message.method && events.has(message.method)) {
      events.get(message.method)(message.params);
      events.delete(message.method);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const once = (event) => new Promise((resolve) => events.set(event, resolve));
  return { socket, send, once };
}

await mkdir(compositions, { recursive: true });
await mkdir(destination, { recursive: true });
for (const source of sources) {
  await readFile(path.join(root, "photos", `${source.slug}.jpg`));
  await writeFile(path.join(compositions, `${source.slug}.html`), materialize(source), "utf8");
}

const profile = await mkdtemp(path.join(tmpdir(), "mysession-cover-"));
const child = spawn(chrome, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--allow-file-access-from-files", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--window-size=1200,630", "--force-device-scale-factor=1", "about:blank",
], { windowsHide: true, stdio: "ignore" });

try {
  const port = await waitForPort(profile, child);
  for (const source of sources) {
    const url = pathToFileURL(path.join(compositions, `${source.slug}.html`)).href;
    const page = await openPage(port, url);
    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
      const loaded = page.once("Page.loadEventFired");
      await page.send("Page.navigate", { url });
      await loaded;
      const readiness = await page.send("Runtime.evaluate", {
        expression: "Promise.all([...document.images].map(image => image.decode())).then(() => document.fonts.ready).then(() => ({ width: innerWidth, height: innerHeight, images: [...document.images].map(image => ({ loaded: image.naturalWidth > 0, width: image.naturalWidth })) }))",
        awaitPromise: true,
        returnByValue: true,
      });
      if (readiness.exceptionDetails || readiness.result.value?.images.some((image) => !image.loaded)) {
        throw new Error(`Photo failed to load for ${source.slug}`);
      }
      const shot = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 86, fromSurface: true, captureBeyondViewport: false });
      const bytes = Buffer.from(shot.data, "base64");
      if (bytes.length < 30_000 || bytes.length > 800_000) throw new Error(`Unexpected screenshot size for ${source.slug}: ${bytes.length}`);
      const output = path.join(destination, `${source.slug}-cover.jpg`);
      await writeFile(output, bytes);
      console.log(`[covers:render] ${source.slug}: ${Math.round(bytes.length / 1024)} KB`);
    } finally {
      page.socket.close();
    }
  }
} finally {
  child.kill();
  const temporaryRoot = path.resolve(tmpdir()) + path.sep;
  if (path.resolve(profile).startsWith(temporaryRoot) && path.basename(profile).startsWith("mysession-cover-")) {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
