// Read-only network details for room diagnostics: which browser this really
// is (Brave, Edge and Chrome share one user agent), which TURN/STUN servers
// LiveKit handed the client, and how the media connection was actually made
// (direct, through TURN, over UDP or TCP). No addresses or credentials.

type BrandEntry = { brand?: unknown; version?: unknown };

export function getBrowserBrands(nav: unknown = typeof navigator !== "undefined" ? navigator : undefined): string[] {
  const brands = (nav as { userAgentData?: { brands?: BrandEntry[] } } | undefined)?.userAgentData?.brands;
  if (!Array.isArray(brands)) return [];
  return brands
    .map((entry) => `${String(entry?.brand || "").trim()} ${String(entry?.version || "").trim()}`.trim())
    .filter((label) => label && !/not.?a.?brand/i.test(label));
}

/** URLs only, e.g. "turns:turn-next.example:443?transport=tcp". */
export function describeIceServerUrls(joinResponse: unknown): string[] {
  const servers = (joinResponse as { iceServers?: Array<{ urls?: unknown }> } | undefined)?.iceServers;
  if (!Array.isArray(servers)) return [];
  return servers.flatMap((server) => (Array.isArray(server?.urls) ? server.urls : [server?.urls]))
    .map((url) => String(url || "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

export type SelectedCandidatePair = {
  localType: string | null;
  localProtocol: string | null;
  relayProtocol: string | null;
  networkType: string | null;
  remoteType: string | null;
  remoteProtocol: string | null;
  rttMs: number | null;
};

type StatEntry = Record<string, unknown> & { id?: string; type?: string };

function statsEntries(report: unknown): StatEntry[] {
  if (!report || typeof (report as { forEach?: unknown }).forEach !== "function") return [];
  const entries: StatEntry[] = [];
  (report as { forEach: (fn: (value: StatEntry) => void) => void }).forEach((value) => entries.push(value));
  return entries;
}

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

export function readSelectedCandidatePair(report: unknown): SelectedCandidatePair | null {
  const entries = statsEntries(report);
  const byId = new Map(entries.map((entry) => [String(entry.id || ""), entry]));
  const transport = entries.find((entry) => entry.type === "transport" && entry.selectedCandidatePairId);
  const pair =
    (transport && byId.get(String(transport.selectedCandidatePairId))) ||
    entries.find((entry) => entry.type === "candidate-pair" && entry.state === "succeeded" && (entry.selected || entry.nominated));
  if (!pair) return null;
  const local = byId.get(String(pair.localCandidateId || ""));
  const remote = byId.get(String(pair.remoteCandidateId || ""));
  const rtt = Number(pair.currentRoundTripTime);
  return {
    localType: text(local?.candidateType),
    localProtocol: text(local?.protocol),
    relayProtocol: text(local?.relayProtocol),
    networkType: text(local?.networkType),
    remoteType: text(remote?.candidateType),
    remoteProtocol: text(remote?.protocol),
    rttMs: Number.isFinite(rtt) ? Math.round(rtt * 1000) : null,
  };
}

type TransportLike = { getStats?: () => Promise<unknown> };
type RoomLike = {
  engine?: {
    latestJoinResponse?: unknown;
    pcManager?: { publisher?: TransportLike; subscriber?: TransportLike };
  };
};

async function pairFor(transport: TransportLike | undefined) {
  if (!transport?.getStats) return null;
  try {
    return readSelectedCandidatePair(await transport.getStats());
  } catch {
    return null;
  }
}

/** Uses livekit-client internals defensively; every field may be null. */
export async function collectRoomTransportDiagnostics(room: unknown) {
  const engine = (room as RoomLike | null)?.engine;
  const [publisher, subscriber] = await Promise.all([
    pairFor(engine?.pcManager?.publisher),
    pairFor(engine?.pcManager?.subscriber),
  ]);
  return {
    iceServerUrls: describeIceServerUrls(engine?.latestJoinResponse),
    publisherPair: publisher,
    subscriberPair: subscriber,
  };
}
