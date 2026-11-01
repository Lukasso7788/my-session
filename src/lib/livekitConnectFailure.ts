export type LiveKitConnectFailureKind =
  | "not_allowed"
  | "cancelled"
  | "timeout"
  | "server_unreachable"
  | "pc_connection"
  | "other";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "");
  }
  return String(error || "");
}

/**
 * Groups a failed first LiveKit connection. livekit-client ConnectionErrorReason
 * values: 0 NotAllowed, 1 ServerUnreachable, 3 Cancelled, 5 Timeout. Messages
 * cover the room's own timeout and SDK errors without a reason code.
 */
export function classifyLiveKitConnectFailure(error: unknown): LiveKitConnectFailureKind {
  const reason = Number((error as { reason?: unknown } | null)?.reason);
  const message = errorMessage(error).toLowerCase();
  if (reason === 0 || /not allowed|unauthori|invalid token|token is expired|\b40[13]\b/.test(message)) {
    return "not_allowed";
  }
  if (reason === 3 || message.includes("cancel") || message.includes("abort") || message.includes("client initiated")) {
    return "cancelled";
  }
  if (reason === 5 || message.includes("timed out") || message.includes("timeout")) return "timeout";
  if (reason === 1 || message.includes("unreachable") || message.includes("websocket")) return "server_unreachable";
  if (message.includes("pc connection") || message.includes("peer connection") || message.includes("ice")) {
    return "pc_connection";
  }
  return "other";
}

/**
 * Signalling reached the server but the media connection never formed. In
 * practice that is a VPN, proxy extension or filtered network blocking WebRTC.
 */
export const NETWORK_BLOCKED_CONNECT_MESSAGE =
  "Your network is blocking the video connection. If you use a VPN or a VPN/proxy browser extension, turn it off and try again. On work or school Wi-Fi, try another network or a phone hotspot.";

export function connectFailureUserMessage(kind: LiveKitConnectFailureKind, rawMessage: string): string {
  return kind === "pc_connection" ? NETWORK_BLOCKED_CONNECT_MESSAGE : rawMessage;
}
