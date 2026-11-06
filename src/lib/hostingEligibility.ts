// Who may create a PUBLIC session: someone who has attended at least
// PUBLIC_HOSTING_MIN_ATTENDED sessions (the canonical lifetime attendance
// count), or an admin. Private sessions (direct link only) need nothing.
export const PUBLIC_HOSTING_MIN_ATTENDED = 10;

export type PublicHostingState = {
  /** Lifetime attended sessions; null while loading or when it failed to load. */
  attended: number | null;
  isAdmin: boolean;
};

export function canCreatePublicSession({ attended, isAdmin }: PublicHostingState): boolean {
  if (isAdmin) return true;
  // An unknown count does not lock anyone out of the form; the server-side
  // check, when enabled, still decides.
  if (attended === null) return true;
  return attended >= PUBLIC_HOSTING_MIN_ATTENDED;
}

/** How many more sessions until public hosting opens (0 when already open). */
export function sessionsUntilPublicHosting(attended: number | null): number {
  if (attended === null) return 0;
  return Math.max(0, PUBLIC_HOSTING_MIN_ATTENDED - Math.floor(attended));
}
