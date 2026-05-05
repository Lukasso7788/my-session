const RULE_ID_START = 1000;

const DEFAULT_POLICY = {
    active: false,
    locked: false,
    endAt: null,
    web: {
        preset: "custom",
        domains: [],
        urls: [],
        allow: []
    },
    apps: {
        preset: "messengers",
        targets: ["telegram", "discord", "whatsapp"]
    }
};

const BLOCK_OPTIONS = {
    amazon: ["amazon.com"],
    apple_news: ["news.apple.com"],
    discord: ["discord.com"],
    ebay: ["ebay.com"],
    facebook: ["facebook.com"],
    gmail: ["mail.google.com", "gmail.com"],
    instagram: ["instagram.com"],
    linkedin: ["linkedin.com"],
    netflix: ["netflix.com"],
    ny_times: ["nytimes.com"],
    pinterest: ["pinterest.com"],
    reddit: ["reddit.com"],
    slack: ["slack.com"],
    snapchat: ["snapchat.com"],
    spotify: ["spotify.com"],
    telegram: ["web.telegram.org", "t.me"],
    tiktok: ["tiktok.com"],
    tumblr: ["tumblr.com"],
    twitter: ["x.com", "twitter.com"],
    whatsapp: ["web.whatsapp.com"],
    youtube: ["youtube.com", "youtu.be"],

    category_social: [
        "facebook.com",
        "instagram.com",
        "x.com",
        "twitter.com",
        "reddit.com",
        "tiktok.com",
        "snapchat.com",
        "tumblr.com",
        "pinterest.com"
    ],
    category_meta: [
        "facebook.com",
        "instagram.com",
        "threads.net",
        "messenger.com"
    ],
    category_messaging: [
        "discord.com",
        "slack.com",
        "web.telegram.org",
        "t.me",
        "web.whatsapp.com",
        "messenger.com"
    ],
    category_search_engines: [
        "google.com",
        "bing.com",
        "duckduckgo.com",
        "yahoo.com"
    ],
    category_news: [
        "cnn.com",
        "bbc.com",
        "nytimes.com",
        "theguardian.com",
        "washingtonpost.com",
        "reuters.com",
        "apnews.com",
        "news.ycombinator.com",
        "news.apple.com"
    ],
    category_politics: [
        "politico.com",
        "thehill.com",
        "foxnews.com",
        "msnbc.com"
    ],
    category_shopping: [
        "amazon.com",
        "ebay.com",
        "aliexpress.com",
        "etsy.com",
        "walmart.com",
        "target.com"
    ],
    category_tv_video: [
        "youtube.com",
        "youtu.be",
        "netflix.com",
        "twitch.tv",
        "hulu.com",
        "disneyplus.com",
        "primevideo.com"
    ],
    category_sports: [
        "espn.com",
        "nba.com",
        "nfl.com",
        "mlb.com",
        "nhl.com",
        "skysports.com"
    ],
    category_blogs: [
        "medium.com",
        "substack.com",
        "tumblr.com",
        "blogger.com"
    ],
    category_food_delivery: [
        "ubereats.com",
        "doordash.com",
        "grubhub.com",
        "deliveroo.com"
    ],
    category_games: [
        "steampowered.com",
        "epicgames.com",
        "roblox.com",
        "minecraft.net",
        "twitch.tv"
    ],
    category_time_wasters: [
        "youtube.com",
        "reddit.com",
        "x.com",
        "twitter.com",
        "tiktok.com",
        "instagram.com",
        "facebook.com",
        "9gag.com",
        "buzzfeed.com"
    ],
    category_dating: [
        "tinder.com",
        "bumble.com",
        "hinge.co",
        "match.com"
    ],
    category_gambling: [
        "stake.com",
        "bet365.com",
        "draftkings.com",
        "fanduel.com"
    ],
    category_adult: [
        "pornhub.com",
        "xvideos.com",
        "xnxx.com",
        "redtube.com"
    ]
};

async function getPolicy() {
    const data = await chrome.storage.local.get(["policy"]);
    return normalizePolicy(data.policy || DEFAULT_POLICY);
}

function normalizePolicy(policy) {
    return {
        ...DEFAULT_POLICY,
        ...policy,
        web: {
            ...DEFAULT_POLICY.web,
            ...(policy?.web || {}),
            domains: Array.isArray(policy?.web?.domains) ? policy.web.domains : [],
            urls: Array.isArray(policy?.web?.urls) ? policy.web.urls : [],
            allow: Array.isArray(policy?.web?.allow) ? policy.web.allow : []
        }
    };
}

function normalizeDomain(domain) {
    return String(domain)
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/.*$/, "")
        .toLowerCase();
}

function normalizeUrl(url) {
    try {
        const parsed = new URL(url);
        parsed.hash = "";
        return parsed.toString().replace(/\/$/, "");
    } catch {
        return String(url).trim();
    }
}

function normalizeCustomInputLine(line) {
    const value = String(line).trim();
    if (!value) return null;

    if (value.startsWith("http://") || value.startsWith("https://")) {
        return { type: "url", value: normalizeUrl(value) };
    }

    if (value.includes("/")) {
        return { type: "url", value: normalizeUrl(`https://${value}`) };
    }

    return { type: "domain", value: normalizeDomain(value) };
}

function getHostnameFromUrl(url) {
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
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isUrlMatch(currentUrl, blockedUrl) {
    const normalizedCurrent = normalizeUrl(currentUrl);
    const normalizedBlocked = normalizeUrl(blockedUrl);

    return (
        normalizedCurrent === normalizedBlocked ||
        normalizedCurrent.startsWith(`${normalizedBlocked}?`) ||
        normalizedCurrent.startsWith(`${normalizedBlocked}/`)
    );
}

function isBlockedUrl(url, policy) {
    if (!url || !policy?.active) return false;
    if (isInternalUrl(url)) return false;

    const hostname = getHostnameFromUrl(url);
    if (!hostname) return false;

    const domains = (policy.web?.domains || []).map(normalizeDomain).filter(Boolean);
    const urls = (policy.web?.urls || []).map(normalizeUrl).filter(Boolean);
    const allow = (policy.web?.allow || []).map(normalizeDomain).filter(Boolean);

    if (allow.some(domain => isDomainMatch(hostname, domain))) return false;
    if (domains.some(domain => isDomainMatch(hostname, domain))) return true;
    if (urls.some(blockedUrl => isUrlMatch(url, blockedUrl))) return true;

    return false;
}

function buildBlockedUrl(originalUrl, policy) {
    const endAt = policy.endAt || "";
    const hostname = getHostnameFromUrl(originalUrl);

    return chrome.runtime.getURL(
        `blocked.html?domain=${encodeURIComponent(hostname)}&endAt=${encodeURIComponent(endAt)}`
    );
}

function buildDomainRules(policy) {
    const domains = (policy.web?.domains || []).map(normalizeDomain).filter(Boolean);
    const uniqueDomains = [...new Set(domains)];

    return uniqueDomains.map((domain, index) => {
        const endAt = policy.endAt || "";
        const redirectUrl = chrome.runtime.getURL(
            `blocked.html?domain=${encodeURIComponent(domain)}&endAt=${encodeURIComponent(endAt)}`
        );

        return {
            id: RULE_ID_START + index,
            priority: 1,
            action: {
                type: "redirect",
                redirect: { url: redirectUrl }
            },
            condition: {
                urlFilter: `||${domain}`,
                resourceTypes: ["main_frame"]
            }
        };
    });
}

async function clearRules() {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const ids = existing.map(rule => rule.id);

    if (ids.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: ids
        });
    }
}

async function sweepOpenTabs(policy) {
    if (!policy?.active) return;

    const tabs = await chrome.tabs.query({});

    for (const tab of tabs) {
        if (!tab.id || !tab.url) continue;

        if (isBlockedUrl(tab.url, policy)) {
            await chrome.tabs.update(tab.id, {
                url: buildBlockedUrl(tab.url, policy)
            });
        }
    }
}

async function applyPolicy(policy) {
    const normalizedPolicy = normalizePolicy(policy);

    await clearRules();

    if (!normalizedPolicy.active) return;

    if (normalizedPolicy.endAt && Date.now() > normalizedPolicy.endAt) {
        await chrome.storage.local.set({ policy: DEFAULT_POLICY });
        await clearRules();
        return;
    }

    const rules = buildDomainRules(normalizedPolicy);

    if (rules.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: rules
        });
    }

    await sweepOpenTabs(normalizedPolicy);
}

async function activateCustomPolicy(payload) {
    const selectedOptionIds = Array.isArray(payload.selectedOptionIds)
        ? payload.selectedOptionIds
        : [];

    const customLines = Array.isArray(payload.customLines)
        ? payload.customLines
        : [];

    const selectedDomains = selectedOptionIds.flatMap(id => BLOCK_OPTIONS[id] || []);

    const customItems = customLines.map(normalizeCustomInputLine).filter(Boolean);

    const customDomains = customItems
        .filter(item => item.type === "domain")
        .map(item => item.value);

    const customUrls = customItems
        .filter(item => item.type === "url")
        .map(item => item.value);

    const domains = [...new Set([...selectedDomains, ...customDomains].map(normalizeDomain).filter(Boolean))];
    const urls = [...new Set(customUrls.map(normalizeUrl).filter(Boolean))];

    const policy = {
        active: true,
        locked: Boolean(payload.locked),
        endAt: Date.now() + Number(payload.minutes || 60) * 60 * 1000,
        web: {
            preset: "custom",
            domains,
            urls,
            allow: []
        },
        apps: {
            preset: "messengers",
            targets: ["telegram", "discord", "whatsapp"]
        }
    };

    await chrome.storage.local.set({ policy });
    await applyPolicy(policy);

    return { ok: true, policy };
}

async function stopShield() {
    const policy = await getPolicy();

    if (policy.locked && policy.endAt && Date.now() < policy.endAt) {
        return { ok: false, error: "locked" };
    }

    await chrome.storage.local.set({ policy: DEFAULT_POLICY });
    await clearRules();

    return { ok: true };
}

chrome.runtime.onInstalled.addListener(async () => {
    const existing = await getPolicy();
    await chrome.storage.local.set({ policy: existing || DEFAULT_POLICY });

    chrome.alarms.create("focusshield_tick", {
        periodInMinutes: 1
    });
});

chrome.runtime.onStartup.addListener(async () => {
    const policy = await getPolicy();
    await applyPolicy(policy);
});

chrome.alarms.onAlarm.addListener(async alarm => {
    if (alarm.name !== "focusshield_tick") return;

    const policy = await getPolicy();
    await applyPolicy(policy);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" && !changeInfo.url) return;

    const policy = await getPolicy();
    if (!policy.active) return;

    const url = changeInfo.url || tab.url;
    if (!url) return;

    if (isBlockedUrl(url, policy)) {
        await chrome.tabs.update(tabId, {
            url: buildBlockedUrl(url, policy)
        });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        if (message.type === "GET_POLICY") {
            sendResponse({ policy: await getPolicy() });
            return;
        }

        if (message.type === "ACTIVATE_CUSTOM_POLICY") {
            sendResponse(await activateCustomPolicy(message.payload || {}));
            return;
        }

        if (message.type === "STOP_SHIELD") {
            sendResponse(await stopShield());
            return;
        }

        sendResponse({ ok: false, error: "unknown_message" });
    })();

    return true;
});