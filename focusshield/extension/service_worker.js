const RULE_ID_START = 1000;
const DESKTOP_BRIDGE_URL = "http://127.0.0.1:43117/v1/policy";
const DESKTOP_COMMAND_URL = "http://127.0.0.1:43117/v1/commands";
const QUICK_BLOCK_PROTECTED_DOMAINS = ["mysession.club", "my-session.vercel.app"];
let desktopSyncPromise = null;
let desktopCommandLoopStarted = false;

const DEFAULT_POLICY = {
    active: false,
    locked: false,
    mode: "blocklist",
    task: "",
    startedAt: null,
    endAt: null,
    updatedAt: null,
    source: "extension",
    web: {
        domains: [],
        urls: [],
        allow: []
    },
    desktop: {
        applications: []
    },
    savedLists: []
};

function uniqueStrings(value) {
    return [...new Set((Array.isArray(value) ? value : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean))];
}

function normalizeSavedLists(value) {
    return (Array.isArray(value) ? value : [])
        .slice(0, 30)
        .map((item, index) => ({
            id: String(item?.id || `list-${index + 1}`).slice(0, 80),
            name: String(item?.name || `Block list ${index + 1}`).trim().slice(0, 48),
            createdAt: Number(item?.createdAt) || Date.now(),
            updatedAt: Number(item?.updatedAt) || Date.now(),
            web: {
                domains: uniqueStrings(item?.web?.domains).map(normalizeDomain),
                urls: uniqueStrings(item?.web?.urls).map(normalizeUrl),
                allow: uniqueStrings(item?.web?.allow).map(normalizeDomain)
            },
            desktop: {
                applications: uniqueStrings(item?.desktop?.applications)
            }
        }))
        .filter((item) => item.name);
}

function deactivatePolicy(policy, source = "extension") {
    return {
        ...policy,
        active: false,
        locked: false,
        startedAt: null,
        endAt: null,
        updatedAt: Date.now(),
        source,
        web: policy?.web || DEFAULT_POLICY.web,
        desktop: policy?.desktop || DEFAULT_POLICY.desktop
    };
}

async function readDesktopPolicy() {
    try {
        const response = await fetch(DESKTOP_BRIDGE_URL, {
            method: "GET",
            cache: "no-store",
            signal: AbortSignal.timeout(1200)
        });
        if (!response.ok) return null;
        const body = await response.json();
        return body?.policy || null;
    } catch {
        return null;
    }
}

async function pushDesktopPolicy(policy) {
    try {
        const response = await fetch(DESKTOP_BRIDGE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ policy }),
            signal: AbortSignal.timeout(1200)
        });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        // Desktop is optional: website blocking continues independently.
        return null;
    }
}

async function syncFromDesktopOnce() {
    const desktopPolicy = await readDesktopPolicy();
    if (!desktopPolicy) return false;
    const localPolicy = await getPolicy();
    const localUpdatedAt = Number(localPolicy?.updatedAt || 0);
    const desktopUpdatedAt = Number(desktopPolicy?.updatedAt || 0);

    if (localUpdatedAt > desktopUpdatedAt) {
        await pushDesktopPolicy(localPolicy);
        return true;
    }

    await chrome.storage.local.set({ policy: desktopPolicy });
    await applyPolicy(desktopPolicy);
    return true;
}

async function syncFromDesktop() {
    if (!desktopSyncPromise) {
        desktopSyncPromise = syncFromDesktopOnce()
            .finally(() => { desktopSyncPromise = null; });
    }
    return await desktopSyncPromise;
}

function addQuickBlockedDomain(currentPolicy, hostname) {
    const now = Date.now();
    const currentLayer = currentPolicy?.layers?.blocklist || null;
    const currentDomains = uniqueStrings(
        currentLayer?.web?.domains || currentPolicy?.web?.domains
    )
        .map(normalizeDomain)
        .filter(Boolean);
    const domains = [...new Set([...currentDomains, hostname])];

    if (Array.isArray(currentPolicy?.sessions)) {
        const quickId = "extension-quick-block";
        const existing = currentPolicy.sessions.find((session) => session.id === quickId);
        const quickSession = {
            ...(existing || {}),
            id: quickId,
            name: "Quick blocked sites",
            mode: "blocklist",
            active: true,
            locked: Boolean(existing?.locked),
            startedAt: existing?.active ? existing.startedAt : now,
            endAt: Math.max(Number(existing?.endAt || 0), now + 25 * 60_000),
            web: {
                domains: [...new Set([
                    ...uniqueStrings(existing?.web?.domains).map(normalizeDomain).filter(Boolean),
                    hostname
                ])],
                urls: uniqueStrings(existing?.web?.urls),
                allow: []
            },
            desktop: existing?.desktop || { applications: [], blockOtherApplications: false }
        };
        return {
            ...currentPolicy,
            active: true,
            endAt: Math.max(Number(currentPolicy.endAt || 0), quickSession.endAt),
            web: {
                ...(currentPolicy.web || DEFAULT_POLICY.web),
                domains: [...new Set([
                    ...uniqueStrings(currentPolicy?.web?.domains).map(normalizeDomain).filter(Boolean),
                    hostname
                ])]
            },
            sessions: [
                ...currentPolicy.sessions.filter((session) => session.id !== quickId),
                quickSession
            ],
            updatedAt: now,
            source: "quick-block"
        };
    }
    if (currentPolicy?.layers) {
        const effectiveDomains = [...new Set([
            ...uniqueStrings(currentPolicy?.web?.domains).map(normalizeDomain).filter(Boolean),
            hostname
        ])];
        return {
            ...currentPolicy,
            web: {
                ...(currentPolicy.web || DEFAULT_POLICY.web),
                domains: effectiveDomains
            },
            layers: {
                ...currentPolicy.layers,
                blocklist: {
                    ...currentLayer,
                    active: true,
                    locked: Boolean(currentLayer?.locked),
                    startedAt: currentLayer?.active ? currentLayer.startedAt : now,
                    endAt: Math.max(Number(currentLayer?.endAt || 0), now + 25 * 60_000),
                    web: {
                        domains,
                        urls: uniqueStrings(currentLayer?.web?.urls),
                        allow: []
                    },
                    desktop: currentLayer?.desktop || { applications: [] }
                }
            },
            updatedAt: now,
            source: "quick-block"
        };
    }

    return {
        ...currentPolicy,
        active: true,
        mode: "blocklist",
        locked: Boolean(currentPolicy?.locked),
        startedAt: currentPolicy?.active ? currentPolicy.startedAt : now,
        endAt: Math.max(Number(currentPolicy?.endAt || 0), now + 25 * 60_000),
        updatedAt: now,
        source: "quick-block",
        web: {
            domains,
            urls: uniqueStrings(currentPolicy?.web?.urls),
            allow: []
        }
    };
}

async function blockBrowserTab(tab) {
    const url = String(tab?.url || "");
    if (!tab?.id || !/^https?:\/\//i.test(url) || isInternalUrl(url)) {
        return { ok: false, error: "unsupported_page" };
    }

    const hostname = getHostname(url);
    if (!hostname || QUICK_BLOCK_PROTECTED_DOMAINS.some(
        (domain) => isDomainMatch(hostname, domain)
    )) {
        return { ok: false, error: "unsupported_page" };
    }

    const currentPolicy = await getPolicy();
    const nextPolicy = addQuickBlockedDomain(currentPolicy, hostname);
    await chrome.storage.local.set({ policy: nextPolicy });
    await applyPolicy(nextPolicy);

    // Blocking must not wait for the optional desktop bridge. Reconcile in the
    // background after the browser has already enforced the new domain.
    void pushDesktopPolicy(nextPolicy).then(async (desktopResult) => {
        if (!desktopResult?.policy) return;
        await chrome.storage.local.set({ policy: desktopResult.policy });
        await applyPolicy(desktopResult.policy);
    }).catch(() => {});

    return { ok: true, hostname };
}

async function blockActiveBrowserTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return await blockBrowserTab(tab);
}

async function handleDesktopCommand(command) {
    if (command?.type === "block_active_tab") {
        return await blockActiveBrowserTab();
    }
    return { ok: false, error: "unknown_command" };
}

async function postDesktopCommandResult(id, result) {
    await fetch(`${DESKTOP_COMMAND_URL}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, result }),
        signal: AbortSignal.timeout(2500)
    });
}

async function runDesktopCommandLoop() {
    if (desktopCommandLoopStarted) return;
    desktopCommandLoopStarted = true;
    while (desktopCommandLoopStarted) {
        try {
            const response = await fetch(`${DESKTOP_COMMAND_URL}/next`, {
                method: "GET",
                cache: "no-store",
                signal: AbortSignal.timeout(24_000)
            });
            if (response.status === 204) continue;
            if (!response.ok) throw new Error(`command_http_${response.status}`);
            const body = await response.json();
            const command = body?.command;
            if (!command?.id) continue;
            const result = await handleDesktopCommand(command).catch((error) => ({
                ok: false,
                error: String(error?.message || error || "quick_block_failed")
            }));
            await postDesktopCommandResult(command.id, result).catch(() => {});
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 1200));
        }
    }
}

async function getPolicy() {
    const data = await chrome.storage.local.get(["policy"]);
    return data.policy || DEFAULT_POLICY;
}

function normalizeDomain(domain) {
    return String(domain)
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0]
        .toLowerCase();
}

function normalizeUrl(url) {
    try {
        const u = new URL(url);
        u.hash = "";
        return (u.origin + u.pathname).replace(/\/$/, "");
    } catch {
        return String(url).trim();
    }
}

function getHostname(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
        return "";
    }
}

function isInternalUrl(url) {
    return (
        !url ||
        url.startsWith("chrome-extension://") ||
        url.startsWith("chrome://") ||
        url.startsWith("edge://") ||
        url.startsWith("about:")
    );
}

function isDomainMatch(hostname, domain) {
    return hostname === domain || hostname.endsWith("." + domain);
}

function isUrlMatch(currentUrl, blockedUrl) {
    const c = normalizeUrl(currentUrl);
    const b = normalizeUrl(blockedUrl);

    return c === b || c.startsWith(b + "/") || c.startsWith(b + "?");
}

function isBlocked(url, policy) {
    if (!policy.active || isInternalUrl(url)) return false;

    const hostname = getHostname(url);
    if (!hostname) return false;

    const allow = policy.web.allow || [];
    const domains = policy.web.domains || [];
    const urls = policy.web.urls || [];

    // A regular FocusShield block always wins, even when that domain is part of
    // the narrower Hyper Focus workspace.
    if (domains.some((d) => isDomainMatch(hostname, normalizeDomain(d)))) return true;
    if (urls.some((u) => isUrlMatch(url, normalizeUrl(u)))) return true;
    if (policy.mode === "hyperfocus") {
        return !allow.some((d) => isDomainMatch(hostname, normalizeDomain(d)));
    }
    return false;
}

function buildBlockedUrl(originalUrl, policy) {
    return chrome.runtime.getURL(
        `blocked.html?url=${encodeURIComponent(originalUrl)}&endAt=${encodeURIComponent(policy.endAt || "")}`
    );
}

async function clearRules() {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const ids = existing.map((rule) => rule.id);

    if (ids.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: ids
        });
    }
}

async function sweepTabs(policy) {
    const tabs = await chrome.tabs.query({});

    for (const tab of tabs) {
        if (!tab.id || !tab.url) continue;

        if (isBlocked(tab.url, policy)) {
            await chrome.tabs.update(tab.id, {
                url: buildBlockedUrl(tab.url, policy)
            });
        }
    }
}

async function applyPolicy(policy) {
    await clearRules();

    if (!policy.active) return;

    if (policy.endAt && Date.now() > policy.endAt) {
        await chrome.storage.local.set({ policy: deactivatePolicy(policy, "expired") });
        await clearRules();
        return;
    }

    const uniqueDomains = [...new Set((policy.web.domains || []).map(normalizeDomain).filter(Boolean))];
    const allowDomains = [...new Set((policy.web.allow || []).map(normalizeDomain).filter(Boolean))];

    const hyperActive = policy.mode === "hyperfocus";
    const rules = [];
    if (hyperActive) {
        rules.push({
            id: RULE_ID_START,
            priority: 1,
            action: {
                type: "redirect",
                redirect: { url: chrome.runtime.getURL("blocked.html?mode=hyperfocus") }
            },
            condition: {
                regexFilter: "^https?://",
                ...(allowDomains.length ? { excludedRequestDomains: allowDomains } : {}),
                resourceTypes: ["main_frame"]
            }
        });
    }
    uniqueDomains.forEach((domain, i) => {
        rules.push({
            id: RULE_ID_START + i + 1,
            priority: 2,
            action: {
                type: "redirect",
                redirect: { url: buildBlockedUrl(domain, policy) }
            },
            condition: {
                urlFilter: `||${domain}`,
                resourceTypes: ["main_frame"]
            }
        });
    });

    if (rules.length > 0) {
        try {
            await chrome.declarativeNetRequest.updateDynamicRules({
                addRules: rules
            });
        } catch (error) {
            // Keep the tabs-based enforcement below as a deterministic fallback
            // for Chromium builds that reject a newer DNR condition field.
            console.warn("FocusShield dynamic rules fallback", error);
        }
    }

    await sweepTabs(policy);
}

async function stopShield() {
    const policy = await getPolicy();

    if (policy.locked && policy.endAt && Date.now() < policy.endAt) {
        return {
            ok: false,
            error: "locked",
            endAt: policy.endAt
        };
    }

    const inactive = deactivatePolicy(policy);
    await chrome.storage.local.set({ policy: inactive });
    await applyPolicy(inactive);

    return { ok: true, policy: inactive };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        if (msg.type === "ACTIVATE") {
            const minutes = Math.max(1, Number(msg.minutes || 25));
            const currentPolicy = await getPolicy();

            const now = Date.now();
            const endAt = now + minutes * 60000;
            const domains = (msg.domains || []).map(normalizeDomain).filter(Boolean);
            const urls = (msg.urls || []).map(normalizeUrl).filter(Boolean);
            const applications = Array.isArray(msg.applications)
                ? uniqueStrings(msg.applications)
                : (currentPolicy.desktop?.applications || []);
            const extensionSession = {
                id: `extension-${now}`,
                name: String(msg.name || "Browser block session").slice(0, 64),
                mode: "blocklist",
                active: true,
                locked: Boolean(msg.locked),
                startedAt: now,
                endAt,
                web: { domains, urls, allow: [] },
                desktop: { applications, blockOtherApplications: false }
            };
            const hasSessions = Array.isArray(currentPolicy.sessions);
            const policy = {
                ...(hasSessions ? currentPolicy : {}),
                active: true,
                locked: Boolean(currentPolicy.locked || msg.locked),
                mode: currentPolicy.mode === "hyperfocus" ? "hyperfocus" : "blocklist",
                startedAt: Math.min(Number(currentPolicy.startedAt || now), now),
                endAt: Math.max(Number(currentPolicy.endAt || 0), endAt),
                updatedAt: now,
                source: "extension",
                web: {
                    ...(currentPolicy.web || DEFAULT_POLICY.web),
                    domains: [...new Set([
                        ...uniqueStrings(currentPolicy.web?.domains).map(normalizeDomain).filter(Boolean),
                        ...domains
                    ])],
                    urls: [...new Set([
                        ...uniqueStrings(currentPolicy.web?.urls).map(normalizeUrl).filter(Boolean),
                        ...urls
                    ])],
                    allow: uniqueStrings(currentPolicy.web?.allow)
                },
                desktop: {
                    ...(currentPolicy.desktop || {}),
                    applications: [...new Set([
                        ...uniqueStrings(currentPolicy.desktop?.applications),
                        ...applications
                    ])]
                },
                sessions: hasSessions ? [...currentPolicy.sessions, extensionSession] : undefined,
                savedLists: normalizeSavedLists(currentPolicy.savedLists)
            };
            await chrome.storage.local.set({ policy });
            await applyPolicy(policy);
            await pushDesktopPolicy(policy);

            sendResponse({ ok: true, policy });
            return;
        }

        if (msg.type === "QUICK_BLOCK_SENDER_TAB") {
            sendResponse(await blockBrowserTab(sender?.tab));
            return;
        }

        if (msg.type === "QUICK_BLOCK") {
            sendResponse(await blockActiveBrowserTab());
            return;
        }

        if (msg.type === "SAVE_LIST") {
            const currentPolicy = await getPolicy();
            const now = Date.now();
            const id = String(msg.list?.id || crypto.randomUUID()).slice(0, 80);
            const existing = (currentPolicy.savedLists || []).find((item) => item.id === id);
            const savedLists = normalizeSavedLists([
                {
                    ...msg.list,
                    id,
                    createdAt: Number(existing?.createdAt || msg.list?.createdAt) || now,
                    updatedAt: now
                },
                ...(currentPolicy.savedLists || []).filter((item) => item.id !== id)
            ]);
            const policy = { ...currentPolicy, savedLists, updatedAt: now, source: "extension" };
            await chrome.storage.local.set({ policy });
            await pushDesktopPolicy(policy);
            sendResponse({ ok: true, policy });
            return;
        }

        if (msg.type === "DELETE_LIST") {
            const currentPolicy = await getPolicy();
            const policy = {
                ...currentPolicy,
                savedLists: (currentPolicy.savedLists || []).filter(
                    (item) => item.id !== String(msg.id || "")
                ),
                updatedAt: Date.now(),
                source: "extension"
            };
            await chrome.storage.local.set({ policy });
            await pushDesktopPolicy(policy);
            sendResponse({ ok: true, policy });
            return;
        }

        if (msg.type === "STOP") {
            const result = await stopShield();
            if (result.ok) await pushDesktopPolicy(result.policy);
            sendResponse(result);
            return;
        }

        if (msg.type === "GET") {
            sendResponse({ policy: await getPolicy() });
            return;
        }

        sendResponse({ ok: false, error: "unknown_message" });
    })();

    return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" && !changeInfo.url) return;

    // Pull the desktop policy on navigation instead of waiting for the alarm.
    // This makes Hyper Focus effective on the very first attempted website.
    await syncFromDesktop().catch(() => false);
    const policy = await getPolicy();
    const currentTab = await chrome.tabs.get(tabId).catch(() => null);
    const url = currentTab?.url || changeInfo.url || tab.url;

    if (url && isBlocked(url, policy)) {
        await chrome.tabs.update(tabId, {
            url: buildBlockedUrl(url, policy)
        });
    }
});

chrome.runtime.onInstalled.addListener(async () => {
    chrome.alarms.create("tick", { periodInMinutes: 0.5 });
    await syncFromDesktop();
});

chrome.runtime.onStartup.addListener(async () => {
    if (await syncFromDesktop()) return;
    const policy = await getPolicy();
    await applyPolicy(policy);
});

if (chrome.commands?.onCommand) {
    chrome.commands.onCommand.addListener(async (command) => {
        if (command !== "quick-block-current-site") return;
        const result = await blockActiveBrowserTab().catch(() => ({ ok: false }));
        await chrome.action.setBadgeBackgroundColor({ color: result.ok ? "#2f7d45" : "#b45309" });
        await chrome.action.setBadgeText({ text: result.ok ? "✓" : "!" });
        setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1800);
    });
}

if (chrome.runtime.id) {
    void runDesktopCommandLoop();
}

chrome.alarms.onAlarm.addListener(async () => {
    if (await syncFromDesktop()) return;
    const policy = await getPolicy();

    if (policy.active && policy.endAt && Date.now() > policy.endAt) {
        const inactive = deactivatePolicy(policy, "expired");
        await chrome.storage.local.set({ policy: inactive });
        await applyPolicy(inactive);
        return;
    }

    await applyPolicy(policy);
});
