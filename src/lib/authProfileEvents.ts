export const AUTH_PROFILE_READY_EVENT = "mysession:auth-profile-ready";

export function notifyAuthProfileReady(userId: string) {
  window.dispatchEvent(
    new CustomEvent(AUTH_PROFILE_READY_EVENT, { detail: { userId } })
  );
}
