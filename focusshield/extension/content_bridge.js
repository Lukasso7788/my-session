// Lets a MySession page turn FocusShield on. The page posts
// { source: "mysession-focus-shield", requestId, message } and this bridge
// answers with { source: "mysession-focus-shield-result", requestId, response }.
const PAGE_SOURCE = "mysession-focus-shield";
const PAGE_RESULT = "mysession-focus-shield-result";

window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== PAGE_SOURCE || !data.requestId || !data.message) return;

    chrome.runtime.sendMessage(data.message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        window.postMessage({
            source: PAGE_RESULT,
            requestId: data.requestId,
            response: runtimeError ? { ok: false, error: runtimeError.message } : response
        }, window.location.origin);
    });
});
