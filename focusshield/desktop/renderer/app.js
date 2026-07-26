const APP_PRESETS = [
  { id: "messaging", icon: "💬", title: "Messaging", detail: "Telegram, WhatsApp, Discord", apps: ["telegram.exe", "whatsapp.exe", "discord.exe"] },
  { id: "game-launchers", icon: "🎮", title: "Game launchers", detail: "Steam, Epic, Battle.net", apps: ["steam.exe", "epicgameslauncher.exe", "battle.net.exe", "riotclientservices.exe"] },
  { id: "video", icon: "▶", title: "Video players", detail: "VLC, MPV, PotPlayer", apps: ["vlc.exe", "mpv.exe", "potplayer.exe", "potplayermini64.exe"] },
  { id: "social", icon: "◎", title: "Social apps", detail: "TikTok, Instagram clients", apps: ["tiktok.exe", "instagram.exe"] },
];
const WEB_PRESETS = ["youtube.com", "reddit.com", "x.com", "facebook.com", "instagram.com", "tiktok.com", "twitch.tv"];

const selectedPresetIds = new Set();
const selectedWeb = new Set();
const customApps = new Set();
const pickerSelection = new Set();
let installedApps = [];
let hydratedPolicyUpdatedAt = null;
let state = null;
let toastTimer = null;

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value || "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const normalizeApp = (value) => {
  const name = String(value || "").trim().split(/[\\/]/).pop().toLowerCase();
  return !name ? "" : name.includes(".") ? name : `${name}.exe`;
};
const formatRemaining = (endAt) => {
  const diff = Math.max(0, Number(endAt || 0) - Date.now());
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  return hours ? `${hours}:${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}` : `${minutes}:${String(seconds).padStart(2,"0")}`;
};

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 3200);
}

function renderPresets() {
  $("appPresets").innerHTML = APP_PRESETS.map((preset) => `
    <label class="preset ${selectedPresetIds.has(preset.id) ? "selected" : ""}" data-app-preset="${preset.id}">
      <input type="checkbox" ${selectedPresetIds.has(preset.id) ? "checked" : ""}/>
      <span class="preset-icon">${preset.icon}</span><span class="preset-copy"><b>${preset.title}</b><small>${preset.detail}</small></span>
    </label>`).join("");
  document.querySelectorAll("[data-app-preset]").forEach((element) => {
    element.onclick = () => {
      const id = element.dataset.appPreset;
      selectedPresetIds.has(id) ? selectedPresetIds.delete(id) : selectedPresetIds.add(id);
      renderPresets();
    };
  });
  $("webPresets").innerHTML = WEB_PRESETS.map((domain) => `<label class="web-chip ${selectedWeb.has(domain) ? "selected" : ""}" data-domain="${domain}"><input type="checkbox"/>${domain}</label>`).join("");
  document.querySelectorAll("[data-domain]").forEach((element) => {
    element.onclick = () => {
      const domain = element.dataset.domain;
      selectedWeb.has(domain) ? selectedWeb.delete(domain) : selectedWeb.add(domain);
      renderPresets();
    };
  });
}

function renderCustomApps() {
  $("customAppChips").innerHTML = [...customApps].map((name) => `<button class="chip" data-custom-app="${escapeHtml(name)}" title="Remove">${escapeHtml(name)}</button>`).join("");
  document.querySelectorAll("[data-custom-app]").forEach((element) => element.onclick = () => {
    customApps.delete(element.dataset.customApp);
    renderCustomApps();
  });
}

function hydrateFromPolicy(policy) {
  const updatedAt = Number(policy?.updatedAt || 0);
  if (hydratedPolicyUpdatedAt === updatedAt) return;
  hydratedPolicyUpdatedAt = updatedAt;
  selectedPresetIds.clear();
  customApps.clear();
  (policy?.desktop?.applications || []).map(normalizeApp).filter(Boolean).forEach((name) => customApps.add(name));
  selectedWeb.clear();
  const customSites = [];
  (policy?.web?.domains || []).forEach((domain) => {
    if (WEB_PRESETS.includes(domain)) selectedWeb.add(domain);
    else customSites.push(domain);
  });
  customSites.push(...(policy?.web?.urls || []));
  $("customSites").value = customSites.join("\n");
  renderPresets();
  renderCustomApps();
}

function renderState(nextState = state) {
  if (nextState) state = nextState;
  if (!state) return;
  const policy = state.policy;
  hydrateFromPolicy(policy);
  $("bridgeStatus").textContent = state.bridgeOnline ? "connected" : "offline";
  const account = state.account || { connected: false };
  $("accountButton").textContent = account.connected ? `${account.name || account.email} · Sync` : "Connect MySession";
  $("accountButton").classList.toggle("connected", Boolean(account.connected));
  $("accountButton").title = account.connected
    ? "Click to sync now. Shift-click to disconnect this device."
    : "Connect this computer to your MySession account";
  $("launchAtLogin").checked = Boolean(state.settings?.launchAtLogin);
  $("statusLabel").textContent = policy.active ? (policy.locked ? "Shield active · Locked" : "Shield active") : "Shield inactive";
  $("timer").textContent = policy.active ? formatRemaining(policy.endAt) : `${$("duration").value}:00`;
  $("statusHint").textContent = policy.active ? `${policy.desktop?.applications?.length || 0} apps · ${policy.web?.domains?.length || 0} sites blocked` : "Choose what to block, then start.";
  $("start").disabled = Boolean(policy.active);
  $("stop").disabled = !policy.active || (policy.locked && Date.now() < policy.endAt);
}

function renderInstalledApps() {
  const query = $("installedAppSearch").value.trim().toLowerCase();
  const filtered = installedApps.filter((item) =>
    !query || item.name.toLowerCase().includes(query) || item.executable.includes(query),
  );
  $("installedAppsList").innerHTML = filtered.length ? filtered.map((item) => {
    const selected = pickerSelection.has(item.executable);
    return `<button class="installed-app-row ${selected ? "selected" : ""}" data-installed-exe="${escapeHtml(item.executable)}">
      <span class="installed-app-icon">${escapeHtml(item.name.slice(0, 2))}</span>
      <span class="installed-app-copy"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.executable)} · ${escapeHtml(item.source)}</small></span>
      <span class="app-check">✓</span>
    </button>`;
  }).join("") : `<div class="picker-empty">${query ? "No applications match your search." : "No installed applications were found. Use a custom .exe name instead."}</div>`;
  document.querySelectorAll("[data-installed-exe]").forEach((element) => element.onclick = () => {
    const executable = element.dataset.installedExe;
    pickerSelection.has(executable) ? pickerSelection.delete(executable) : pickerSelection.add(executable);
    renderInstalledApps();
  });
  $("installedSelectedCount").textContent = `${pickerSelection.size} app${pickerSelection.size === 1 ? "" : "s"} selected`;
}

async function openInstalledAppPicker(force = false) {
  $("installedAppsModal").classList.remove("hidden");
  $("installedAppsList").innerHTML = '<div class="picker-empty">Reading installed applications…</div>';
  pickerSelection.clear();
  collectApps().forEach((name) => pickerSelection.add(name));
  try {
    installedApps = await window.focusShield.listInstalledApps(force);
    renderInstalledApps();
    $("installedAppSearch").focus();
  } catch {
    $("installedAppsList").innerHTML = '<div class="picker-empty">Windows did not return the installed-app list. You can still add an .exe manually.</div>';
  }
}

function closeInstalledAppPicker() {
  $("installedAppsModal").classList.add("hidden");
}

function collectSites() {
  const custom = $("customSites").value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const domains = [...selectedWeb];
  const urls = [];
  custom.forEach((item) => /^https?:\/\//i.test(item) ? urls.push(item) : domains.push(item));
  return { domains: [...new Set(domains)], urls: [...new Set(urls)], allow: [] };
}

function collectApps() {
  const presetApps = APP_PRESETS.filter((item) => selectedPresetIds.has(item.id)).flatMap((item) => item.apps);
  return [...new Set([...presetApps, ...customApps])];
}

$("addCustomApps").onclick = () => {
  $("customApps").value.split(/[\n,;]+/).map(normalizeApp).filter(Boolean).forEach((name) => customApps.add(name));
  $("customApps").value = "";
  renderCustomApps();
};
$("customApps").onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); $("addCustomApps").click(); } };
$("duration").onchange = () => renderState();
$("launchAtLogin").onchange = async () => renderState(await window.focusShield.setLaunchAtLogin($("launchAtLogin").checked));
$("accountButton").onclick = async (event) => {
  if (!state?.account?.connected) {
    const result = await window.focusShield.connectAccount();
    toast(result?.ok ? "Finish connecting in the browser window." : "Could not open MySession.");
    return;
  }
  if (event.shiftKey) {
    renderState(await window.focusShield.disconnectAccount());
    toast("This computer was disconnected from MySession.");
    return;
  }
  const result = await window.focusShield.syncNow();
  renderState(result?.state);
  toast(result?.ok ? `Synced · ${result.direction}` : "Cloud sync is temporarily unavailable.");
};
$("chooseInstalledApps").onclick = () => void openInstalledAppPicker(false);
$("refreshInstalledApps").onclick = () => void openInstalledAppPicker(true);
$("installedAppSearch").oninput = renderInstalledApps;
$("closeAppPicker").onclick = closeInstalledAppPicker;
$("cancelAppPicker").onclick = closeInstalledAppPicker;
$("installedAppsModal").onclick = (event) => {
  if (event.target === $("installedAppsModal")) closeInstalledAppPicker();
};
$("applyInstalledApps").onclick = () => {
  selectedPresetIds.clear();
  customApps.clear();
  pickerSelection.forEach((name) => customApps.add(name));
  renderPresets();
  renderCustomApps();
  closeInstalledAppPicker();
  toast(`${customApps.size} applications selected.`);
};
$('installedAppsModal').onkeydown = (event) => {
  if (event.key === "Escape") closeInstalledAppPicker();
};
$("scanProcesses").onclick = async () => {
  const target = $("runningApps");
  target.classList.remove("hidden");
  target.textContent = "Scanning…";
  try {
    const items = await window.focusShield.listProcesses();
    const unique = [...new Set(items.map((item) => item.name))].sort().slice(0, 80);
    target.innerHTML = unique.map((name) => `<div class="running-app"><span>${escapeHtml(name)}</span><button data-running-app="${escapeHtml(name)}">Block</button></div>`).join("") || "No user apps found.";
    document.querySelectorAll("[data-running-app]").forEach((element) => element.onclick = () => {
      customApps.add(element.dataset.runningApp); renderCustomApps(); toast(`${element.dataset.runningApp} added`);
    });
  } catch { target.textContent = "Could not scan running apps."; }
};
$("start").onclick = async () => {
  const applications = collectApps();
  const web = collectSites();
  if (!applications.length && !web.domains.length && !web.urls.length) { toast("Choose at least one app or website."); return; }
  const result = await window.focusShield.start({ minutes: Number($("duration").value), locked: $("locked").checked, web, desktop: { applications } });
  if (!result?.ok) { toast(result?.error || "Could not start FocusShield"); return; }
  renderState(await window.focusShield.getState());
  toast("FocusShield is active. The browser extension will sync automatically.");
};
$("stop").onclick = async () => {
  const result = await window.focusShield.stop();
  if (!result?.ok) { toast(`Locked until ${new Date(result.endAt).toLocaleTimeString()}`); return; }
  renderState(await window.focusShield.getState());
};

window.focusShield.onPolicyChanged(renderState);
window.focusShield.onAppBlocked((item) => toast(`${item.name} was blocked`));
setInterval(() => renderState(), 1000);
renderPresets();
renderCustomApps();
window.focusShield.getState().then(renderState);
