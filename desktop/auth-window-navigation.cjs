const { authWindowDecision } = require("./oauth-protocol.cjs");

// Modern Electron exposes navigation URL on the event details; older releases
// also supplied a second argument. Never log callback URLs or OAuth codes.
function createAuthNavigationHandler({ finish, blocked }) {
  return (event, legacyUrl) => {
    if (event.isMainFrame === false) return;
    const url = event.url || legacyUrl;
    const decision = authWindowDecision(url);
    if (decision === "provider") return;
    event.preventDefault();
    if (decision === "app") finish(url);
    else blocked();
  };
}
module.exports = { createAuthNavigationHandler };
