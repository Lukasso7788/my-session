const ALLOWED_ORIGINS = new Set(["https://mysession.club", "https://www.mysession.club"]);
const PROVIDERS = new Set(["google", "discord", "facebook"]);

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
  if (host === "cxqgzcjsjyszcbcbdusp.supabase.co" && url.pathname === "/auth/v1/callback") return "callback";
  if (host === "cxqgzcjsjyszcbcbdusp.supabase.co" && url.pathname === "/auth/v1/authorize") {
    const provider = url.searchParams.get("provider");
    return PROVIDERS.has(provider) ? provider : null;
  }
  if (host === "accounts.google.com") return "google";
  if (host === "discord.com" && (
    url.pathname.startsWith("/api/oauth2/") ||
    url.pathname === "/oauth2/authorize" ||
    url.pathname === "/login" ||
    url.pathname === "/register" ||
    url.pathname === "/login/reset"
  )) return "discord";
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
  accountUrl,
  authWindowDecision,
  isMySessionUrl,
  providerFromNavigation,
};
