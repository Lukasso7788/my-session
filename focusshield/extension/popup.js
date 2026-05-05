function formatRemaining(endAt) {
    if (!endAt) return "";

    const ms = Math.max(0, endAt - Date.now());
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getCheckedOptionIds() {
    return [...document.querySelectorAll('input[type="checkbox"][value]:checked')]
        .filter(input => input.id !== "locked")
        .map(input => input.value);
}

function getCustomLines() {
    return document
        .getElementById("customInput")
        .value
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);
}

async function getPolicy() {
    return new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "GET_POLICY" }, response => {
            resolve(response.policy);
        });
    });
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

    status.classList.remove("danger");

    if (!policy.active) {
        status.textContent = "Shield is inactive.";
        renderActiveList(policy);
        return;
    }

    status.textContent = `Shield active${policy.locked ? " 🔒" : ""}. Remaining: ${formatRemaining(policy.endAt)}`;
    renderActiveList(policy);
}

document.getElementById("start").addEventListener("click", async () => {
    const selectedOptionIds = getCheckedOptionIds();
    const customLines = getCustomLines();
    const minutes = Number(document.getElementById("duration").value);
    const locked = document.getElementById("locked").checked;

    if (selectedOptionIds.length === 0 && customLines.length === 0) {
        const status = document.getElementById("status");
        status.textContent = "Choose at least one filter or add a custom site/page.";
        status.classList.add("danger");
        return;
    }

    chrome.runtime.sendMessage({
        type: "ACTIVATE_CUSTOM_POLICY",
        payload: {
            selectedOptionIds,
            customLines,
            minutes,
            locked
        }
    }, () => {
        render();
    });
});

document.getElementById("stop").addEventListener("click", async () => {
    chrome.runtime.sendMessage({ type: "STOP_SHIELD" }, response => {
        const status = document.getElementById("status");

        if (response && response.error === "locked") {
            status.textContent = "Locked mode is active. You cannot stop it yet.";
            status.classList.add("danger");
            return;
        }

        render();
    });
});

render();
setInterval(render, 1000);