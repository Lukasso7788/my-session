function formatRemaining(endAt) {
    if (!endAt) return "";

    const ms = Math.max(0, endAt - Date.now());
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function getPolicy() {
    return new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "GET_POLICY" }, response => {
            resolve(response.policy);
        });
    });
}

async function render() {
    const policy = await getPolicy();
    const status = document.getElementById("status");

    if (!policy.active) {
        status.textContent = "Shield is inactive.";
        return;
    }

    status.textContent = `Shield active${policy.locked ? " 🔒" : ""}. Remaining: ${formatRemaining(policy.endAt)}`;
}

document.getElementById("start").addEventListener("click", async () => {
    const preset = document.getElementById("preset").value;
    const minutes = Number(document.getElementById("duration").value);
    const locked = document.getElementById("locked").checked;

    chrome.runtime.sendMessage({
        type: "ACTIVATE_PRESET",
        preset,
        minutes,
        locked
    }, () => {
        render();
    });
});

document.getElementById("stop").addEventListener("click", async () => {
    chrome.runtime.sendMessage({ type: "STOP_SHIELD" }, response => {
        if (response && response.error === "locked") {
            document.getElementById("status").textContent = "Locked mode is active. You cannot stop it yet.";
            document.getElementById("status").classList.add("danger");
            return;
        }

        render();
    });
});

render();
setInterval(render, 1000);