const RULE_ID_START = 1000;

const DEFAULT_POLICY = {
    active: false,
    locked: false,
    endAt: null,
    web: {
        preset: "social",
        domains: [],
        allow: []
    }
};

const PRESETS = {
    social: [
        "youtube.com",
        "reddit.com",
        "x.com",
        "twitter.com",
        "instagram.com",
        "facebook.com",
        "tiktok.com"
    ],
    video: [
        "youtube.com",
        "twitch.tv",
        "netflix.com"
    ],
    news: [
        "cnn.com",
        "bbc.com",
        "nytimes.com",
        "theguardian.com",
        "news.ycombinator.com"
    ]
};

async function getPolicy() {
    const data = await chrome.storage.local.get(["policy"]);
    return data.policy || DEFAULT_POLICY;
}

function normalizeDomain(domain) {
    return String(domain)
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/.*$/, "")
        .toLowerCase();
}

function buildRules(policy) {
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

async function applyPolicy(policy) {
    await clearRules();

    if (!policy.active) return;

    if (policy.endAt && Date.now() > policy.endAt) {
        await chrome.storage.local.set({
            policy: DEFAULT_POLICY
        });
        return;
    }

    const rules = buildRules(policy);

    if (rules.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: rules
        });
    }
}

async function activatePreset(preset, minutes = 60, locked = true) {
    const domains = PRESETS[preset] || PRESETS.social;

    const policy = {
        active: true,
        locked,
        endAt: Date.now() + minutes * 60 * 1000,
        web: {
            preset,
            domains,
            allow: []
        },
        apps: {
            preset: "messengers",
            targets: ["telegram", "discord", "whatsapp"]
        }
    };

    await chrome.storage.local.set({ policy });
    await applyPolicy(policy);
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
    await chrome.storage.local.set({ policy: DEFAULT_POLICY });

    chrome.alarms.create("focusshield_tick", {
        periodInMinutes: 1
    });
});

chrome.alarms.onAlarm.addListener(async alarm => {
    if (alarm.name !== "focusshield_tick") return;

    const policy = await getPolicy();
    await applyPolicy(policy);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        if (message.type === "GET_POLICY") {
            sendResponse({ policy: await getPolicy() });
            return;
        }

        if (message.type === "ACTIVATE_PRESET") {
            await activatePreset(message.preset, message.minutes, message.locked);
            sendResponse({ ok: true });
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