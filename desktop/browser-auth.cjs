const crypto = require("node:crypto");
const AUTH_ORIGIN = "https://cxqgzcjsjyszcbcbdusp.supabase.co";
const APP_ORIGIN = "https://mysession.club";

function createBrowserAuth({ fetchConfig, exchange, openExternal, adopt, failed, now = Date.now }) {
  let pending = null;
  let starting = false;
  let generation = 0;
  async function start() {
    if (starting) return;
    starting = true;
    const attempt = ++generation;
    pending = null;
    try {
      const config = await fetchConfig();
      if (attempt !== generation) return;
      if (config.url !== AUTH_ORIGIN || typeof config.anonKey !== "string") throw new Error("config");
      const verifier = crypto.randomBytes(32).toString("base64url");
      const state = crypto.randomBytes(32).toString("hex");
      const redirect = new URL("/desktop-auth.html", APP_ORIGIN);
      redirect.searchParams.set("desktop_state", state);
      const url = new URL("/auth/v1/authorize", AUTH_ORIGIN);
      url.searchParams.set("provider", "google");
      url.searchParams.set("redirect_to", redirect.href);
      url.searchParams.set("code_challenge", crypto.createHash("sha256").update(verifier).digest("base64url"));
      url.searchParams.set("code_challenge_method", "s256");
      pending = { state, verifier, config, generation: attempt, expires: now() + 5 * 60_000 };
      await openExternal(url.href);
    } catch {
      pending = null;
      failed("Could not start Google sign-in. Check your connection and try again.");
    } finally { starting = false; }
  }
  async function receive(value) {
    let url;
    try { url = new URL(value); } catch { return false; }
    if (url.protocol !== "mysession:" || url.hostname !== "oauth" || url.pathname !== "/callback" || url.username || url.password || url.port || url.hash) return false;
    const current = pending;
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code");
    if (!current || current.expires <= now() || state !== current.state || !code || code.length > 2048) return false;
    pending = null; // Consume before the first await: no replay/racing callbacks.
    try {
      const tokens = await exchange(current.config, code, current.verifier);
      if (current.generation !== generation) return true;
      if (!tokens.access_token || !tokens.refresh_token) throw new Error("session");
      await adopt(tokens);
    } catch {
      failed("Google sign-in did not complete. Start a new sign-in from MySession.");
    }
    return true;
  }
  return { start, receive, cancel: () => { generation++; pending = null; } };
}
module.exports = { createBrowserAuth, AUTH_ORIGIN, APP_ORIGIN };
