const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { normalizeExecutable } = require("./policy.cjs");

const execFileAsync = promisify(execFile);

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

class ProcessBlocker {
  constructor({ getPolicy, onBlocked }) {
    this.getPolicy = getPolicy;
    this.onBlocked = onBlocked;
    this.timer = null;
    this.running = false;
    this.recentlyBlocked = new Map();
  }

  start() {
    if (this.timer || process.platform !== "win32") return;
    this.timer = setInterval(() => void this.tick(), 1200);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async listProcesses() {
    if (process.platform !== "win32") return [];
    const { stdout } = await execFileAsync("tasklist.exe", ["/fo", "csv", "/nh"], {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return String(stdout)
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseCsvLine)
      .map((columns) => ({
        name: normalizeExecutable(columns[0]),
        pid: Number(columns[1]) || 0,
      }))
      .filter((item) => item.name && item.pid > 0 && item.pid !== process.pid);
  }

  async tick() {
    if (this.running) return;
    const policy = this.getPolicy();
    const blocked = new Set(policy?.desktop?.applications || []);
    if (!policy?.active || blocked.size === 0) return;

    this.running = true;
    try {
      const processes = await this.listProcesses();
      const matches = processes.filter((item) => blocked.has(item.name));
      for (const item of matches) {
        try {
          await execFileAsync("taskkill.exe", ["/pid", String(item.pid), "/t", "/f"], {
            windowsHide: true,
          });
          const last = this.recentlyBlocked.get(item.name) || 0;
          if (Date.now() - last > 5000) {
            this.recentlyBlocked.set(item.name, Date.now());
            this.onBlocked?.(item);
          }
        } catch {
          // The process may have closed between tasklist and taskkill.
        }
      }
    } finally {
      this.running = false;
    }
  }
}

module.exports = { ProcessBlocker };
