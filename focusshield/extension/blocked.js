const params = new URLSearchParams(location.search);
const endAt = Number(params.get("endAt"));

function render() {
    const timer = document.getElementById("timer");

    if (!endAt) {
        timer.textContent = "Focus mode active";
        return;
    }

    const ms = Math.max(0, endAt - Date.now());
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);

    timer.textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;

    if (ms <= 0) {
        timer.textContent = "Done";
    }
}

render();
setInterval(render, 1000);