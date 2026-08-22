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
let savedLists = [];
let hydratedPolicyUpdatedAt = null;
let preserveDraftThroughPolicyUpdate = false;
let state = null;
let toastTimer = null;
let durationUnit = "minutes";
let theme = localStorage.getItem("focusshield_theme") === "light" ? "light" : "dark";

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
const getDurationMinutes = () => {
  const raw = Math.max(1, Number($("duration").value) || 25);
  const minutes = $("durationUnit").value === "hours" ? raw * 60 : raw;
  return Math.max(1, Math.min(1440, Math.round(minutes)));
};
const formatDuration = (minutes) => {
  const total = Math.max(1, Number(minutes) || 25);
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(remainder).padStart(2, "0")}:00` : `${total}:00`;
};
const renderTheme = () => {
  document.body.dataset.theme = theme;
  const isLight = theme === "light";
  $("themeIcon").src = isLight
    ? "../assets/theme-moon-light.svg"
    : "../assets/theme-sun-dark.svg";
  $("themeButton").title = isLight ? "Switch to dark mode" : "Switch to light mode";
  $("themeButton").setAttribute("aria-label", $("themeButton").title);
};
const syncDurationControls = () => {
  const input = $("duration");
  const unit = $("durationUnit").value;
  input.max = unit === "hours" ? "24" : "1440";
  input.step = unit === "hours" ? "0.25" : "1";
  const selectedMinutes = getDurationMinutes();
  document.querySelectorAll("[data-duration-minutes]").forEach((button) => {
    button.classList.toggle(
      "selected",
      Number(button.dataset.durationMinutes) === selectedMinutes,
    );
  });
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
  if (preserveDraftThroughPolicyUpdate) {
    preserveDraftThroughPolicyUpdate = false;
    return;
  }
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

function applySavedBlockList(list) {
  selectedPresetIds.clear();
  selectedWeb.clear();
  customApps.clear();

  (list?.desktop?.applications || [])
    .map(normalizeApp)
    .filter(Boolean)
    .forEach((name) => customApps.add(name));

  const customSites = [];
  (list?.web?.domains || []).forEach((domain) => {
    if (WEB_PRESETS.includes(domain)) selectedWeb.add(domain);
    else customSites.push(domain);
  });
  customSites.push(...(list?.web?.urls || []));
  $("customSites").value = customSites.join("\n");

  renderPresets();
  renderCustomApps();
  toast(`Loaded “${list.name}”. Choose a duration and start when ready.`);
}

function renderSavedBlockLists() {
  const target = $("savedBlockLists");
  if (!savedLists.length) {
    target.innerHTML = '<div class="saved-list-empty">No saved lists yet. Select your usual apps and sites, name the setup, and save it.</div>';
    return;
  }

  target.innerHTML = savedLists
    .slice()
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .map((list) => {
      const appCount = list.desktop?.applications?.length || 0;
      const siteCount = (list.web?.domains?.length || 0) + (list.web?.urls?.length || 0);
      return `<article class="saved-list-card">
        <button class="saved-list-apply" data-apply-list="${escapeHtml(list.id)}">
          <b>${escapeHtml(list.name)}</b>
          <small>${appCount} app${appCount === 1 ? "" : "s"} · ${siteCount} site${siteCount === 1 ? "" : "s"}</small>
        </button>
        <button class="saved-list-delete" data-delete-list="${escapeHtml(list.id)}" aria-label="Delete ${escapeHtml(list.name)}" title="Delete">×</button>
      </article>`;
    })
    .join("");

  document.querySelectorAll("[data-apply-list]").forEach((element) => {
    element.onclick = () => {
      const list = savedLists.find((item) => item.id === element.dataset.applyList);
      if (list) applySavedBlockList(list);
    };
  });
  document.querySelectorAll("[data-delete-list]").forEach((element) => {
    element.onclick = async () => {
      preserveDraftThroughPolicyUpdate = true;
      const result = await window.focusShield.deleteBlockList(element.dataset.deleteList);
      if (!result?.ok) {
        preserveDraftThroughPolicyUpdate = false;
        toast(result?.error || "Could not delete this list.");
        return;
      }
      toast("Saved list deleted.");
    };
  });
}

function renderState(nextState = state) {
  if (nextState) state = nextState;
  if (!state) return;
  const policy = state.policy;
  savedLists = Array.isArray(policy?.savedLists) ? policy.savedLists : [];
  hydrateFromPolicy(policy);
  renderSavedBlockLists();
  $("bridgeStatus").textContent = state.bridgeOnline ? "connected" : "offline";
  const account = state.account || { connected: false };
  $("accountButton").textContent = account.connected ? `${account.name || account.email} · Sync` : "Connect MySession";
  $("accountButton").classList.toggle("connected", Boolean(account.connected));
  $("accountButton").title = account.connected
    ? "Click to sync now. Shift-click to disconnect this device."
    : "Connect this computer to your MySession account";
  $("launchAtLogin").checked = Boolean(state.settings?.launchAtLogin);
  $("statusLabel").textContent = policy.active ? (policy.locked ? "Shield active · Locked" : "Shield active") : "Shield inactive";
  $("timer").textContent = policy.active ? formatRemaining(policy.endAt) : formatDuration(getDurationMinutes());
  $("statusHint").textContent = policy.active ? `${policy.desktop?.applications?.length || 0} apps · ${policy.web?.domains?.length || 0} sites blocked` : "Choose what to block, then start.";
  $("start").disabled = Boolean(policy.active);
  $("stop").disabled = !policy.active || (policy.locked && Date.now() < policy.endAt);
  syncDurationControls();
  renderUpdate(state.update);
}

function renderUpdate(update = {}) {
  const button = $("updateButton");
  const status = String(update.status || "idle");
  button.className = `update-button ${status}`;
  if (status === "downloading") {
    button.textContent = `Updating ${Number(update.percent || 0)}%`;
  } else if (status === "ready") {
    button.textContent = `Restart for v${update.availableVersion || "update"}`;
  } else if (status === "checking") {
    button.textContent = "Checking…";
  } else if (status === "error") {
    button.textContent = "Update retry";
  } else {
    button.textContent = `v${update.currentVersion || "0.3.0"}`;
  }
  button.title = status === "ready"
    ? "Restart FocusShield and install the downloaded update"
    : status === "error"
      ? `Update check failed: ${update.error || "unknown error"}`
      : "Check for FocusShield updates";
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

$("saveBlockList").onclick = async () => {
  const name = $("blockListName").value.trim();
  const applications = collectApps();
  const web = collectSites();
  if (!name) {
    toast("Give this block list a name.");
    $("blockListName").focus();
    return;
  }
  if (!applications.length && !web.domains.length && !web.urls.length) {
    toast("Choose at least one app or website before saving.");
    return;
  }

  preserveDraftThroughPolicyUpdate = true;
  const result = await window.focusShield.saveBlockList({
    id: crypto.randomUUID(),
    name,
    web,
    desktop: { applications },
  });
  if (!result?.ok) {
    preserveDraftThroughPolicyUpdate = false;
    toast(result?.error || "Could not save this list.");
    return;
  }
  $("blockListName").value = "";
  toast(`Saved “${name}”.`);
};
$("blockListName").onkeydown = (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("saveBlockList").click();
  }
};

$("addCustomApps").onclick = () => {
  $("customApps").value.split(/[\n,;]+/).map(normalizeApp).filter(Boolean).forEach((name) => customApps.add(name));
  $("customApps").value = "";
  renderCustomApps();
};
$("customApps").onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); $("addCustomApps").click(); } };
$("themeButton").onclick = () => {
  theme = theme === "dark" ? "light" : "dark";
  localStorage.setItem("focusshield_theme", theme);
  renderTheme();
};
$("duration").oninput = () => renderState();
$("durationUnit").onchange = () => {
  const nextUnit = $("durationUnit").value;
  const currentValue = Math.max(1, Number($("duration").value) || 1);
  if (durationUnit === "minutes" && nextUnit === "hours") {
    $("duration").value = String(Math.round((currentValue / 60) * 100) / 100);
  } else if (durationUnit === "hours" && nextUnit === "minutes") {
    $("duration").value = String(Math.round(currentValue * 60));
  }
  durationUnit = nextUnit;
  renderState();
};
document.querySelectorAll("[data-duration-minutes]").forEach((button) => {
  button.onclick = () => {
    const minutes = Number(button.dataset.durationMinutes || 25);
    if (minutes >= 120 && minutes % 60 === 0) {
      $("duration").value = String(minutes / 60);
      $("durationUnit").value = "hours";
      durationUnit = "hours";
    } else {
      $("duration").value = String(minutes);
      $("durationUnit").value = "minutes";
      durationUnit = "minutes";
    }
    renderState();
  };
});
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
$("updateButton").onclick = async () => {
  if (state?.update?.status === "ready") {
    const result = await window.focusShield.installUpdate();
    if (!result?.ok) toast("The update is not ready yet.");
    return;
  }
  renderUpdate({ ...state?.update, status: "checking" });
  const update = await window.focusShield.checkForUpdates();
  state = { ...state, update };
  renderUpdate(update);
  if (update?.status === "current") toast("FocusShield is up to date.");
  if (update?.status === "error") toast("Could not check for updates. Try again later.");
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
  const result = await window.focusShield.start({ minutes: getDurationMinutes(), locked: $("locked").checked, web, desktop: { applications } });
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
window.focusShield.onUpdateChanged((update) => {
  state = { ...state, update };
  renderUpdate(update);
  if (update?.status === "ready") toast(`FocusShield ${update.availableVersion} is ready to install.`);
});
setInterval(() => renderState(), 1000);
renderTheme();
renderPresets();
renderCustomApps();
window.focusShield.getState().then(renderState);
