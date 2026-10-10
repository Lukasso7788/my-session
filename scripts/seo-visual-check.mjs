// Optional local visual QA; not part of CI because it needs an installed Chrome.
// Usage: node scripts/seo-visual-check.mjs http://127.0.0.1:4193 <output-directory>
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const baseUrl = new URL(process.argv[2] || "http://127.0.0.1:4173");
const outputDir = path.resolve(process.argv[3] || path.join(tmpdir(), "mysession-seo-visual"));
const chrome = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = await mkdtemp(path.join(tmpdir(), "mysession-seo-qa-"));
const cases = [
  { route: "/body-doubling-app", name: "body-doubling-app-mobile", width: 390, height: 844 },
  { route: "/body-doubling-app", name: "body-doubling-app-desktop", width: 1440, height: 900 },
  { route: "/virtual-coworking", name: "virtual-coworking-mobile", width: 390, height: 844 },
  { route: "/virtual-coworking-for-remote-workers", name: "remote-coworking-desktop", width: 1440, height: 900 },
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForPort(child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Chrome exited with ${child.exitCode}`);
    try {
      const content = await readFile(path.join(profile, "DevToolsActivePort"), "utf8");
      return Number(content.split(/\r?\n/)[0]);
    } catch { await sleep(100); }
  }
  throw new Error("Chrome DevTools port did not appear");
}

async function openPage(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error(`Could not open Chrome tab: ${response.status}`);
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
      const handler = pending.get(message.id);
      pending.delete(message.id);
      message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result);
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
  const once = (name) => new Promise((resolve) => events.set(name, resolve));
  return { socket, send, once };
}

await mkdir(outputDir, { recursive: true });
const child = spawn(chrome, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });

try {
  const port = await waitForPort(child);
  for (const entry of cases) {
    const page = await openPage(port);
    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: entry.width, height: entry.height, deviceScaleFactor: 1, mobile: entry.width < 600,
      });
      const url = new URL(entry.route, baseUrl).href;
      const loaded = page.once("Page.loadEventFired");
      await page.send("Page.navigate", { url });
      await loaded;
      let state;
      for (let attempt = 0; attempt < 40; attempt++) {
        const result = await page.send("Runtime.evaluate", {
          expression: "({url:location.href,h1:document.querySelector('h1')?.textContent?.trim(),title:document.title,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,images:[...document.querySelectorAll('main img')].map(x=>({alt:x.alt,loaded:x.complete&&x.naturalWidth>0}))})",
          returnByValue: true,
        });
        state = result.result.value;
        if (state?.h1 && state.images.length && state.images.every((item) => item.loaded)) break;
        await sleep(150);
      }
      if (!state?.h1 || !state.images.length || state.scrollWidth > state.width + 2 || state.images.some((item) => !item.loaded || !item.alt)) {
        throw new Error(`${entry.name} failed visual DOM checks: ${JSON.stringify(state)}`);
      }
      const shot = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      const file = path.join(outputDir, `${entry.name}.png`);
      await writeFile(file, Buffer.from(shot.data, "base64"));
      console.log(`[seo:visual] ${entry.route} ${entry.width}x${entry.height}: no horizontal overflow; ${state.images.length} loaded images; ${file}`);
    } finally {
      page.socket.close();
    }
  }
} finally {
  child.kill();
  const tempRoot = path.resolve(tmpdir()) + path.sep;
  if (path.resolve(profile).startsWith(tempRoot) && path.basename(profile).startsWith("mysession-seo-qa-")) {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
