(() => {
  const params = new URLSearchParams(location.search);
  const android = params.get("platform") === "android";
  // The page never receives tokens or a PKCE verifier, only a short-lived code.
  history.replaceState(null, "", location.pathname);
  const state = params.get("desktop_state");
  const code = params.get("code");
  const status = document.getElementById("status");
  if (!/^[a-f0-9]{64}$/.test(state || "") || !code || code.length > 2048 || params.has("error")) {
    status.textContent = android
      ? "Sign-in did not complete. Return to MySession on Android and try again."
      : "Sign-in did not complete. Return to the desktop app and try again.";
    return;
  }
  const target = new URL(android ? "mysession-android://oauth/callback" : "mysession://oauth/callback");
  if (android) { document.title = "Return to MySession Android"; document.querySelector("h1").textContent = "MySession Android"; }
  target.searchParams.set("state", state);
  target.searchParams.set("code", code);
  const link = document.getElementById("return");
  link.href = android
    ? `intent://oauth/callback${target.search}#Intent;scheme=mysession-android;package=club.mysession.nativeapp;end`
    : target.href;
  link.hidden = false;
  status.textContent = android
    ? "Tap Return to MySession to finish signing in."
    : "Open MySession when your browser asks. You can close this tab afterwards.";
  if (android) {
    // Chrome handles the explicit intent on tap. Other Android browsers can
    // use the original scheme if they don't handle intent URLs.
    if (!/\bChrome\//i.test(navigator.userAgent)) link.href = target.href;
  } else {
    location.href = target.href;
  }
})();
