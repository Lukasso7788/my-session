const APP_PRESETS = [
  { id: "messaging", icon: "💬", title: "Messaging", detail: "Telegram, WhatsApp, Discord", apps: ["telegram.exe", "whatsapp.exe", "discord.exe"] },
  { id: "game-launchers", icon: "🎮", title: "Game launchers", detail: "Steam, Epic, Battle.net", apps: ["steam.exe", "epicgameslauncher.exe", "battle.net.exe", "riotclientservices.exe"] },
  { id: "video", icon: "▶", title: "Video players", detail: "VLC, MPV, PotPlayer", apps: ["vlc.exe", "mpv.exe", "potplayer.exe", "potplayermini64.exe"] },
  { id: "social", icon: "◎", title: "Social apps", detail: "TikTok, Instagram clients", apps: ["tiktok.exe", "instagram.exe"] },
];
const WEB_PRESETS = ["youtube.com", "reddit.com", "x.com", "facebook.com", "instagram.com", "tiktok.com", "twitch.tv"];
const HYPER_ALWAYS_ALLOWED = ["mysession.club", "my-session.vercel.app"];
const HYPER_SERVICES = [
  { id: "instagram", label: "Instagram", domains: ["instagram.com"] },
  { id: "facebook", label: "Facebook", domains: ["facebook.com", "messenger.com"] },
  { id: "linkedin", label: "LinkedIn", domains: ["linkedin.com"] },
  { id: "reddit", label: "Reddit", domains: ["reddit.com"] },
  { id: "discord", label: "Discord", domains: ["discord.com"] },
  { id: "youtube", label: "YouTube", domains: ["youtube.com"] },
];

const selectedPresetIds = new Set();
const selectedWeb = new Set();
const customApps = new Set();
const hyperCustomApps = new Set();
const pickerSelection = new Set();
let installedApps = [];
let appPickerTarget = "standard";
let savedLists = [];
let hydratedPolicyUpdatedAt = null;
let preserveDraftThroughPolicyUpdate = false;
let selectedStopSessionId = null;
let state = null;
let toastTimer = null;
let durationUnit = "minutes";
let theme = localStorage.getItem("focusshield_theme") === "light" ? "light" : "dark";
let focusMode = "blocklist";
const selectedHyperServices = new Set(["instagram"]);

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
const normalizeAllowedDomain = (value) => String(value || "")
  .trim()
  .replace(/^https?:\/\//i, "")
  .replace(/^www\./i, "")
  .split("/")[0]
  .toLowerCase();

function renderHyperServices() {
  $("hyperServicePresets").innerHTML = HYPER_SERVICES.map((service) => `
    <button type="button" class="hyper-service ${selectedHyperServices.has(service.id) ? "selected" : ""}" data-hyper-service="${service.id}">
      <span></span>${escapeHtml(service.label)}
    </button>`).join("");
  document.querySelectorAll("[data-hyper-service]").forEach((button) => {
    button.onclick = () => {
      const id = button.dataset.hyperService;
      selectedHyperServices.has(id)
        ? selectedHyperServices.delete(id)
        : selectedHyperServices.add(id);
      renderHyperServices();
    };
  });
}

function renderFocusMode() {
  const hyper = focusMode === "hyperfocus";
  document.body.classList.toggle("hyper-focus-mode", hyper);
  $("standardMode").classList.toggle("selected", !hyper);
  $("hyperFocusMode").classList.toggle("selected", hyper);
  $("standardMode").setAttribute("aria-selected", String(!hyper));
  $("hyperFocusMode").setAttribute("aria-selected", String(hyper));
  $("hyperFocusConfig").classList.toggle("hidden", !hyper);
  $("start").innerHTML = hyper
    ? 'Start Hyper Focus <span>→</span>'
    : 'Start FocusShield <span>→</span>';
  renderHyperServices();
}

function collectHyperFocusWeb() {
  const custom = $("hyperCustomSites").value
    .split(/[\r\n,;]+/)
    .map(normalizeAllowedDomain)
    .filter(Boolean);
  const serviceDomains = HYPER_SERVICES
    .filter((service) => selectedHyperServices.has(service.id))
    .flatMap((service) => service.domains);
  return {
    domains: [],
    urls: [],
    allow: [...new Set([...HYPER_ALWAYS_ALLOWED, ...serviceDomains, ...custom])],
  };
}
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

function renderHyperCustomApps() {
  $("hyperCustomAppChips").innerHTML = [...hyperCustomApps].map((name) => `<button class="chip" data-hyper-custom-app="${escapeHtml(name)}" title="Remove">${escapeHtml(name)}</button>`).join("");
  document.querySelectorAll("[data-hyper-custom-app]").forEach((element) => element.onclick = () => {
    hyperCustomApps.delete(element.dataset.hyperCustomApp);
    renderHyperCustomApps();
  });
}
function hydrateFromPolicy(policy) {
  const updatedAt = Number(policy?.updatedAt || 0);
  if (hydratedPolicyUpdatedAt === updatedAt) return;
  const firstHydration = hydratedPolicyUpdatedAt === null;
  hydratedPolicyUpdatedAt = updatedAt;
  if (preserveDraftThroughPolicyUpdate) {
    preserveDraftThroughPolicyUpdate = false;
    return;
  }
  if (!firstHydration) return;

  const blockLayer = policy?.layers?.blocklist || (policy?.mode !== "hyperfocus" ? policy : {});
  const hyperLayer = policy?.layers?.hyperfocus || (policy?.mode === "hyperfocus" ? policy : {});
  if (firstHydration && hyperLayer?.active && !blockLayer?.active) focusMode = "hyperfocus";

  $("hyperFocusTask").value = String(hyperLayer?.task || "");
  $("hyperBlockApps").checked = Boolean(hyperLayer?.desktop?.blockOtherApplications);
  selectedHyperServices.clear();
  const allow = (hyperLayer?.web?.allow || []).map(normalizeAllowedDomain);
  HYPER_SERVICES.forEach((service) => {
    if (service.domains.some((domain) => allow.includes(domain))) selectedHyperServices.add(service.id);
  });
  const known = new Set([...HYPER_ALWAYS_ALLOWED, ...HYPER_SERVICES.flatMap((service) => service.domains)]);
  $("hyperCustomSites").value = allow.filter((domain) => !known.has(domain)).join("\n");

  selectedPresetIds.clear();
  customApps.clear();
  hyperCustomApps.clear();
  (blockLayer?.desktop?.applications || []).map(normalizeApp).filter(Boolean).forEach((name) => customApps.add(name));
  (hyperLayer?.desktop?.applications || []).map(normalizeApp).filter(Boolean).forEach((name) => hyperCustomApps.add(name));

  selectedWeb.clear();
  const customSites = [];
  (blockLayer?.web?.domains || []).forEach((domain) => {
    if (WEB_PRESETS.includes(domain)) selectedWeb.add(domain);
    else customSites.push(domain);
  });
  customSites.push(...(blockLayer?.web?.urls || []));
  $("customSites").value = customSites.join("\n");
  renderFocusMode();
  renderPresets();
  renderCustomApps();
  renderHyperCustomApps();
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

function renderActiveSessions(policy) {
  const sessions = (policy?.sessions || [])
    .filter((session) => session.active)
    .sort((a, b) => Number(a.endAt) - Number(b.endAt));
  const panel = $("activeSessionsPanel");
  panel.classList.toggle("hidden", sessions.length === 0);
  $("activeSessionsCount").textContent = `${sessions.length} active`;
  $("activeSessionsList").innerHTML = sessions.map((session) => {
    const siteCount = session.mode === "hyperfocus"
      ? (session.web?.allow?.length || 0)
      : (session.web?.domains?.length || 0) + (session.web?.urls?.length || 0);
    const appCount = session.desktop?.applications?.length || 0;
    const scope = session.mode === "hyperfocus"
      ? `${siteCount} allowed site${siteCount === 1 ? "" : "s"} · ${appCount} blocked app${appCount === 1 ? "" : "s"}`
      : `${siteCount} site${siteCount === 1 ? "" : "s"} · ${appCount} app${appCount === 1 ? "" : "s"}`;
    const locked = session.locked && Date.now() < Number(session.endAt);
    return `<article class="active-session-card ${session.mode}">
      <div class="active-session-icon">${session.mode === "hyperfocus" ? "◎" : "◆"}</div>
      <div class="active-session-copy">
        <div><b>${escapeHtml(session.name)}</b><span>${session.mode === "hyperfocus" ? "Hyper Focus" : "Block list"}</span></div>
        <small>${escapeHtml(scope)}${locked ? " · Locked" : ""}</small>
      </div>
      <strong class="active-session-timer">${formatRemaining(session.endAt)}</strong>
      <button type="button" class="active-session-stop" data-stop-session="${escapeHtml(session.id)}" ${locked ? "disabled" : ""}>
        ${locked ? "Locked" : "Stop"}
      </button>
    </article>`;
  }).join("");

  document.querySelectorAll("[data-stop-session]").forEach((button) => {
    button.onclick = async () => {
      const result = await window.focusShield.stop(button.dataset.stopSession);
      if (!result?.ok) {
        toast(`Locked until ${new Date(result.endAt).toLocaleTimeString()}`);
        return;
      }
      renderState(await window.focusShield.getState());
      toast("Blocking session stopped.");
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

  const blockLayer = policy?.layers?.blocklist || (policy?.mode !== "hyperfocus" ? policy : {});
  const hyperLayer = policy?.layers?.hyperfocus || (policy?.mode === "hyperfocus" ? policy : {});
  const sessions = (policy?.sessions || []).filter((session) => session.active);
  const blockActive = sessions.some((session) => session.mode === "blocklist");
  const hyperActive = sessions.some((session) => session.mode === "hyperfocus");
  const selectedSessions = sessions
    .filter((session) => session.mode === focusMode)
    .sort((a, b) => Number(b.startedAt) - Number(a.startedAt));
  const selectedLayer = selectedSessions[0] || (focusMode === "hyperfocus" ? hyperLayer : blockLayer);
  selectedStopSessionId = selectedSessions[0]?.id || null;
  renderActiveSessions(policy);
  $("standardMode").classList.toggle("running", blockActive);
  $("hyperFocusMode").classList.toggle("running", hyperActive);

  $("statusLabel").textContent = blockActive && hyperActive
    ? "FocusShield + Hyper Focus active"
    : hyperActive
      ? "Hyper Focus active"
      : blockActive
        ? "FocusShield active"
        : "Shield inactive";
  $("timer").textContent = selectedLayer?.active
    ? formatRemaining(selectedLayer.endAt)
    : formatDuration(getDurationMinutes());
  $("statusHint").textContent = hyperActive
    ? (hyperLayer.task || "Only the allowed workspace is available")
    : blockActive
      ? `${blockLayer.desktop?.applications?.length || 0} apps · ${blockLayer.web?.domains?.length || 0} sites blocked`
      : "Choose what to block, then start.";
  $("start").disabled = false;
  $("stop").disabled = !selectedStopSessionId || (selectedLayer.locked && Date.now() < selectedLayer.endAt);
  $("stop").textContent = selectedStopSessionId ? "Stop latest" : "Stop";
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
    button.textContent = `v${update.currentVersion || "0.4.3"}`;
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

async function openInstalledAppPicker(force = false, target = "standard") {
  appPickerTarget = target;
  $("installedAppsModal").classList.remove("hidden");
  $("installedAppsList").innerHTML = '<div class="picker-empty">Reading installed applications…</div>';
  pickerSelection.clear();
  (appPickerTarget === "hyper" ? [...hyperCustomApps] : collectApps()).forEach((name) => pickerSelection.add(name));
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

$("standardMode").onclick = () => {
  focusMode = "blocklist";
  renderFocusMode();
  renderState();
};
$("hyperFocusMode").onclick = () => {
  focusMode = "hyperfocus";
  renderFocusMode();
  renderState();
  $("hyperFocusTask").focus();
};
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
  toast(result.cloud && !result.cloud.ok
    ? `Saved “${name}” locally. Cloud sync will retry after Supabase is ready.`
    : `Saved “${name}” on this device and MySession.`);
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
$("hyperAddCustomApps").onclick = () => {
  $("hyperCustomAppsInput").value.split(/[\n,;]+/).map(normalizeApp).filter(Boolean).forEach((name) => hyperCustomApps.add(name));
  $("hyperCustomAppsInput").value = "";
  renderHyperCustomApps();
};
$("hyperCustomAppsInput").onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); $("hyperAddCustomApps").click(); } };
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
$("chooseInstalledApps").onclick = () => void openInstalledAppPicker(false, "standard");
$("hyperChooseApps").onclick = () => void openInstalledAppPicker(false, "hyper");
$("refreshInstalledApps").onclick = () => void openInstalledAppPicker(true, appPickerTarget);
$("installedAppSearch").oninput = renderInstalledApps;
$("closeAppPicker").onclick = closeInstalledAppPicker;
$("cancelAppPicker").onclick = closeInstalledAppPicker;
$("installedAppsModal").onclick = (event) => {
  if (event.target === $("installedAppsModal")) closeInstalledAppPicker();
};
$("applyInstalledApps").onclick = () => {
  if (appPickerTarget === "hyper") {
    hyperCustomApps.clear();
    pickerSelection.forEach((name) => hyperCustomApps.add(name));
    renderHyperCustomApps();
    toast(`${hyperCustomApps.size} Hyper Focus app${hyperCustomApps.size === 1 ? "" : "s"} selected.`);
  } else {
    selectedPresetIds.clear();
    customApps.clear();
    pickerSelection.forEach((name) => customApps.add(name));
    renderPresets();
    renderCustomApps();
    toast(`${customApps.size} applications selected.`);
  }
  closeInstalledAppPicker();
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
$("hyperScanProcesses").onclick = async () => {
  const target = $("hyperRunningApps");
  target.classList.remove("hidden");
  target.textContent = "Scanning…";
  try {
    const items = await window.focusShield.listProcesses();
    const unique = [...new Set(items.map((item) => item.name))].sort().slice(0, 80);
    target.innerHTML = unique.map((name) => `<div class="running-app"><span>${escapeHtml(name)}</span><button data-hyper-running-app="${escapeHtml(name)}">Block</button></div>`).join("") || "No user apps found.";
    document.querySelectorAll("[data-hyper-running-app]").forEach((element) => element.onclick = () => {
      hyperCustomApps.add(element.dataset.hyperRunningApp);
      renderHyperCustomApps();
      toast(`${element.dataset.hyperRunningApp} added to Hyper Focus.`);
    });
  } catch { target.textContent = "Could not scan running apps."; }
};
$("start").onclick = async () => {
  const hyperFocus = focusMode === "hyperfocus";
  const applications = hyperFocus ? [...hyperCustomApps] : collectApps();
  const task = $("hyperFocusTask").value.trim();
  const web = hyperFocus ? collectHyperFocusWeb() : collectSites();

  if (hyperFocus && !task) {
    toast("Name the one task you are going to finish.");
    $("hyperFocusTask").focus();
    return;
  }
  if (hyperFocus && web.allow.length <= HYPER_ALWAYS_ALLOWED.length) {
    toast("Choose at least one work service or allowed domain.");
    return;
  }
  if (!hyperFocus && !applications.length && !web.domains.length && !web.urls.length) {
    toast("Choose at least one app or website.");
    return;
  }

  const result = await window.focusShield.start({
    name: $("sessionName").value.trim(),
    minutes: getDurationMinutes(),
    locked: $("locked").checked,
    mode: hyperFocus ? "hyperfocus" : "blocklist",
    task,
    web,
    desktop: {
      applications,
      blockOtherApplications: hyperFocus && $("hyperBlockApps").checked,
    },
  });
  if (!result?.ok) { toast(result?.error || "Could not start FocusShield"); return; }
  renderState(await window.focusShield.getState());
  toast(hyperFocus
    ? "Hyper Focus is active. Only your task workspace and MySession remain available."
    : "FocusShield is active. The browser extension will sync automatically.");
};
$("stop").onclick = async () => {
  const result = await window.focusShield.stop(selectedStopSessionId);
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
renderHyperCustomApps();
renderFocusMode();
window.focusShield.getState().then(renderState);
