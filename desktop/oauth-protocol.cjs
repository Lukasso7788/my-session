const ALLOWED_ORIGINS = new Set(["https://mysession.club", "https://www.mysession.club"]);
const PROVIDERS = new Set(["google", "discord", "facebook"]);
const AUTH_WINDOW_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function isMySessionUrl(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && ALLOWED_ORIGINS.has(url.origin);
  } catch {
    return false;
  }
}

function providerFromNavigation(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host.endsWith(".supabase.co") && url.pathname === "/auth/v1/authorize") {
    const provider = url.searchParams.get("provider");
    return PROVIDERS.has(provider) ? provider : null;
  }
  if (host === "accounts.google.com") return "google";
  if (host === "discord.com" && url.pathname.startsWith("/api/oauth2/")) return "discord";
  if ((host === "facebook.com" || host === "www.facebook.com") && url.pathname.includes("/dialog/oauth")) {
    return "facebook";
  }
  return null;
}

function authWindowDecision(value) {
  if (isMySessionUrl(value)) return "app";
  if (providerFromNavigation(value)) return "provider";
  return "block";
}

function accountUrl(currentUrl, kind) {
  if (kind !== "login" && kind !== "register") throw new Error("Unknown account page.");
  const origin = isMySessionUrl(currentUrl) ? new URL(currentUrl).origin : "https://mysession.club";
  return `${origin}/${kind}`;
}

module.exports = {
  ALLOWED_ORIGINS,
  AUTH_WINDOW_USER_AGENT,
  accountUrl,
  authWindowDecision,
  isMySessionUrl,
  providerFromNavigation,
};
