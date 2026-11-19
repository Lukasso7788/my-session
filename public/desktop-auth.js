(() => {
  const params = new URLSearchParams(location.search);
  // The page never receives tokens or a PKCE verifier, only a short-lived code.
  history.replaceState(null, "", location.pathname);
  const state = params.get("desktop_state");
  const code = params.get("code");
  const status = document.getElementById("status");
  if (!/^[a-f0-9]{64}$/.test(state || "") || !code || code.length > 2048 || params.has("error")) {
    status.textContent = "Sign-in did not complete. Return to the desktop app and try again.";
    return;
  }
  const target = new URL("mysession://oauth/callback");
  target.searchParams.set("state", state);
  target.searchParams.set("code", code);
  const link = document.getElementById("return");
  link.href = target.href;
  link.hidden = false;
  status.textContent = "Open MySession when your browser asks. You can close this tab afterwards.";
  location.href = target.href;
})();
