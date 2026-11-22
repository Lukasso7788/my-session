// Renders the real session AI panel, Focus Shield panel, and bottom controls.
// Usage: node scripts/session-panels-browser.mjs [screenshot-dir]
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const root = process.cwd();
const port = 4198;
const outputDir = path.resolve(process.argv[2] || path.join(tmpdir(), "mysession-session-panels"));
const chrome = process.env.CHROME_PATH || "google-chrome";
const mockId = "\0session-panels-mock";

const supabaseMock = `
const result = (data) => Promise.resolve({ data, error: null });
class Query {
  constructor(table) { this.table = table; this.payload = null; }
  select() { return this; }
  eq() { return this; }
  insert(payload) { this.payload = payload; return this; }
  upsert(payload) { this.payload = payload; return this; }
  maybeSingle() { return result(this.table === "focus_shield_policies" ? null : { id: "task-1" }); }
  single() { return this.maybeSingle(); }
  then(resolve, reject) { return result(this.payload ? { id: "saved-1" } : []).then(resolve, reject); }
}
export const supabase = { from: (table) => new Query(table) };
`;

const server = await createServer({
  root,
  configFile: false,
  envDir: path.join(root, "scripts/fixtures"),
  logLevel: "error",
  server: { host: "127.0.0.1", port, strictPort: true },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom/client", "lucide-react"] },
  plugins: [
    {
      name: "session-panels-preview",
      enforce: "pre",
      resolveId(id) {
        if (/(?:^|\/)lib\/supabase(?:\.ts)?$/.test(id)) return mockId;
      },
      load(id) {
        if (id === mockId) return supabaseMock;
      },
      configureServer(viteServer) {
        viteServer.middlewares.use(async (req, res, next) => {
          if (req.url?.split("?")[0] !== "/") return next();
          const html = await viteServer.transformIndexHtml(
            "/",
            "<html><head><title>Session panels</title></head><body><div id=\"root\"></div><script type=\"module\" src=\"/scripts/fixtures/session-panels-harness.tsx\"></script></body></html>",
          );
          res.setHeader("Content-Type", "text/html");
          res.end(html);
        });
      },
    },
    react(),
  ],
});

await server.listen();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = await mkdtemp(path.join(tmpdir(), "mysession-panels-"));
const browser = spawn(
  chrome,
  ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
  { stdio: "ignore" },
);
const failures = [];

try {
  let devtoolsPort = 0;
  for (let attempt = 0; attempt < 100 && !devtoolsPort; attempt += 1) {
    try {
      devtoolsPort = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0]);
    } catch {
      await sleep(100);
    }
  }
  const target = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/new?about:blank`, { method: "PUT" })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const check = (name, ok) => {
    console.log(`${ok ? "ok" : "FAIL"} - ${name}`);
    if (!ok) failures.push(name);
  };
  const shot = async (name) => {
    await mkdir(outputDir, { recursive: true });
    const data = (await send("Page.captureScreenshot", { format: "png" })).result.data;
    await writeFile(path.join(outputDir, name), Buffer.from(data, "base64"));
  };

  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate('!!document.querySelector("[aria-label=\\"AI reply preview\\"]")')) break;
    await sleep(150);
  }

  check("bottom controls include AI and Focus Shield", await evaluate('!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "AI") && !![...document.querySelectorAll("button")].find((button) => button.title === "Focus Shield" || button.textContent.trim() === "Shield")'));
  await evaluate(`(() => {
    const field = document.querySelector("textarea");
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setValue.call(field, "Finish the outline");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await evaluate('[...document.querySelectorAll("button")].find((button) => button.textContent === "Preview reply").click()');
  await sleep(200);
  check("AI preview appears before anything is posted", await evaluate('document.querySelector("[aria-label=\\"AI reply preview\\"]").innerText.includes("Ada") && document.querySelector("[aria-label=\\"AI reply preview\\"]").innerText.includes("Finish the outline")'));
  await shot("ai-panel-preview.png");

  await evaluate('[...document.querySelectorAll("button")].find((button) => button.title === "Focus Shield").click()');
  await sleep(200);
  check("Focus Shield opens from the bottom controls", await evaluate('!!document.querySelector("[aria-label=\\"Blocked page preview\\"]")'));
  await evaluate('[...document.querySelectorAll("button")].find((button) => button.textContent === "YouTube").click()');
  await sleep(100);
  check("blocked page preview names the selected site", await evaluate('document.querySelector("[aria-label=\\"Blocked page preview\\"]").innerText.includes("youtube.com")'));
  await shot("focus-shield-preview.png");
  socket.close();
} finally {
  browser.kill();
  await server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(failures.length ? `${failures.length} check(s) failed` : `All checks passed; screenshots in ${outputDir}`);
process.exitCode = failures.length ? 1 : 0;
