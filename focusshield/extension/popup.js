let manualStatusUntil = 0;

function parseLines(text) {
    return text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
}

function formatRemaining(endAt) {
    if (!endAt) return "";

    const diff = Math.max(0, endAt - Date.now());
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    return `${m}:${String(s).padStart(2, "0")}`;
}

function sendMessage(message) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(message, resolve);
    });
}

function showError(message, durationMs = 5000) {
    const status = document.getElementById("status");
    manualStatusUntil = Date.now() + durationMs;

    status.textContent = message;
    status.classList.add("danger");
}

function getSelectedPopularDomains() {
    const checked = [...document.querySelectorAll('input[type="checkbox"][value]:checked')]
        .filter((input) => input.id !== "locked");

    return checked.flatMap((input) => {
        return String(input.value)
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
    });
}

function getCustomDomainsAndUrls() {
    const lines = parseLines(document.getElementById("custom").value);

    const domains = [];
    const urls = [];

    for (const line of lines) {
        if (line.startsWith("http://") || line.startsWith("https://")) {
            urls.push(line);
        } else if (line.includes("/")) {
            urls.push("https://" + line);
        } else {
            domains.push(line);
        }
    }

    return { domains, urls };
}

function getDurationMinutes() {
    const preset = document.getElementById("durationPreset").value;

    if (preset !== "custom") {
        return Number(preset);
    }

    const custom = Number(document.getElementById("customDuration").value);

    if (!Number.isFinite(custom) || custom < 1) {
        return null;
    }

    return Math.min(custom, 1440);
}

async function getPolicy() {
    const response = await sendMessage({ type: "GET" });
    return response?.policy;
}

function renderActiveList(policy) {
    const activeList = document.getElementById("activeList");

    if (!policy?.active) {
        activeList.style.display = "none";
        activeList.textContent = "";
        return;
    }

    const domains = policy.web?.domains || [];
    const urls = policy.web?.urls || [];

    activeList.style.display = "block";
    activeList.innerHTML = `
    <strong>Currently blocking:</strong><br/>
    ${domains.length ? `Sites: ${domains.join(", ")}<br/>` : ""}
    ${urls.length ? `Pages: ${urls.join(", ")}` : ""}
  `;
}

async function render() {
    const policy = await getPolicy();
    const status = document.getElementById("status");

    if (Date.now() < manualStatusUntil) {
        renderActiveList(policy);
        return;
    }

    status.classList.remove("danger");

    if (!policy?.active) {
        status.textContent = "Shield is inactive.";
        renderActiveList(policy);
        return;
    }

    status.textContent = `Shield active${policy.locked ? " 🔒" : ""}. Remaining: ${formatRemaining(policy.endAt)}`;
    renderActiveList(policy);
}

document.getElementById("durationPreset").addEventListener("change", () => {
    const customInput = document.getElementById("customDuration");
    customInput.style.display =
        document.getElementById("durationPreset").value === "custom" ? "block" : "none";
});

document.getElementById("start").onclick = async () => {
    const selectedDomains = getSelectedPopularDomains();
    const custom = getCustomDomainsAndUrls();
    const minutes = getDurationMinutes();
    const locked = document.getElementById("locked").checked;

    const domains = [...new Set([...selectedDomains, ...custom.domains])];
    const urls = [...new Set(custom.urls)];

    const status = document.getElementById("status");
    manualStatusUntil = 0;
    status.classList.remove("danger");

    if (!minutes) {
        showError("Enter a valid custom duration in minutes.");
        return;
    }

    if (domains.length === 0 && urls.length === 0) {
        showError("Choose at least one site or add a custom page.");
        return;
    }

    await sendMessage({
        type: "ACTIVATE",
        domains,
        urls,
        minutes,
        locked
    });

    await render();
};

document.getElementById("stop").onclick = async () => {
    const response = await sendMessage({ type: "STOP" });

    if (response?.error === "locked") {
        showError(
            `You can’t stop FocusShield because Locked mode is active. Time left: ${formatRemaining(response.endAt)}.`
        );
        return;
    }

    manualStatusUntil = 0;
    await render();
};

render();
setInterval(render, 1000);