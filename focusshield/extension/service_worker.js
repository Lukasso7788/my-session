const RULE_ID_START = 1000;
const DESKTOP_BRIDGE_URL = "http://127.0.0.1:43117/v1/policy";

const DEFAULT_POLICY = {
    active: false,
    locked: false,
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
    }
};

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

async function syncFromDesktop() {
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

    if (allow.some((d) => isDomainMatch(hostname, normalizeDomain(d)))) return false;
    if (domains.some((d) => isDomainMatch(hostname, normalizeDomain(d)))) return true;
    if (urls.some((u) => isUrlMatch(url, normalizeUrl(u)))) return true;

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

    const rules = uniqueDomains.map((domain, i) => ({
        id: RULE_ID_START + i,
        priority: 1,
        action: {
            type: "redirect",
            redirect: {
                url: buildBlockedUrl(domain, policy)
            }
        },
        condition: {
            urlFilter: `||${domain}`,
            resourceTypes: ["main_frame"]
        }
    }));

    if (rules.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: rules
        });
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

chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    (async () => {
        if (msg.type === "ACTIVATE") {
            const minutes = Math.max(1, Number(msg.minutes || 25));
            const currentPolicy = await getPolicy();

            const policy = {
                active: true,
                locked: Boolean(msg.locked),
                startedAt: Date.now(),
                endAt: Date.now() + minutes * 60000,
                updatedAt: Date.now(),
                source: "extension",
                web: {
                    domains: (msg.domains || []).map(normalizeDomain).filter(Boolean),
                    urls: (msg.urls || []).map(normalizeUrl).filter(Boolean),
                    allow: []
                },
                desktop: currentPolicy.desktop || DEFAULT_POLICY.desktop
            };

            await chrome.storage.local.set({ policy });
            await applyPolicy(policy);
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

    const policy = await getPolicy();
    const url = changeInfo.url || tab.url;

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
