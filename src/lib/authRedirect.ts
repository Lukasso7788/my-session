export function getAuthCallbackUrl(nextPath?: string) {
  const origin = window.location.origin;

  const next =
    nextPath ||
    `${window.location.pathname}${window.location.search}${window.location.hash}`;

  const url = new URL("/auth/callback", origin);
  url.searchParams.set("next", next || "/sessions");

  return url.toString();
}