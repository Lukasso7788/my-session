import { supabase } from "./supabase";

export type LivekitServerRow = {
  id: string;
  code: string;
  ws_url: string;
  enabled: boolean;
  soft_user_cap: number;
  hard_user_cap: number;
  role: string;
  region: string | null;
  sort_order: number;
};

export type SessionPlacementInput = {
  sessionFormatType?: string | null;
  maxParticipants?: number | null;
};

export type ServerScoreBreakdown = {
  serverId: string;
  code: string;
  liveUsersNow: number;
  reservedRoomWeight: number;
  activeRoomCount: number;
  roomCountPenalty: number;
  currentScore: number;
  projectedScore: number;
  softUserCap: number;
  hardUserCap: number;
};

export type PlacementResult = {
  server: LivekitServerRow;
  placementWeight: number;
  score: ServerScoreBreakdown;
};

function normalizeFormatType(raw: unknown): "group" | "infinite" | "body" {
  const s = String(raw || "").trim().toLowerCase();

  if (s === "infinite") return "infinite";
  if (s === "body") return "body";
  return "group";
}

function clampParticipantCap(raw: unknown, fallback = 8): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(16, Math.round(n)));
}

export function getPlacementWeight(input: SessionPlacementInput): number {
  const format = normalizeFormatType(input.sessionFormatType);
  const cap = clampParticipantCap(input.maxParticipants, format === "infinite" ? 8 : 8);

  if (format === "infinite") {
    if (cap <= 4) return 2;
    return 4;
  }

  if (format === "body") {
    if (cap <= 4) return 1;
    if (cap <= 8) return 2;
    if (cap <= 12) return 4;
    return 6;
  }

  if (cap <= 4) return 1;
  if (cap <= 8) return 2;
  if (cap <= 12) return 4;
  return 6;
}

async function getEnabledServers(): Promise<LivekitServerRow[]> {
  const { data, error } = await supabase
    .from("livekit_servers")
    .select("*")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("getEnabledServers error:", error);
    throw error;
  }

  return (data || []) as LivekitServerRow[];
}

/**
 * Пока у нас нет columns вроде sessions.live_count,
 * возвращаем 0 по всем серверам.
 *
 * Потом можно заменить это на реальный расчёт по attendance / room presence.
 */
async function getLiveUsersByServer(): Promise<Record<string, number>> {
  return {};
}

async function getReservedWeightsByServer(): Promise<
  Record<string, { weight: number; rooms: number }>
> {
  const { data, error } = await supabase
    .from("sessions")
    .select("assigned_server_id, placement_weight, status")
    .not("assigned_server_id", "is", null);

  if (error) {
    console.error("getReservedWeightsByServer error:", error);
    throw error;
  }

  const out: Record<string, { weight: number; rooms: number }> = {};

  for (const row of data || []) {
    const serverId = String((row as any).assigned_server_id || "");
    if (!serverId) continue;

    const status = String((row as any).status || "").trim().toLowerCase();
    if (status === "cancelled" || status === "canceled") continue;

    const weight = Number((row as any).placement_weight || 0);

    if (!out[serverId]) {
      out[serverId] = { weight: 0, rooms: 0 };
    }

    out[serverId].weight += Number.isFinite(weight) ? weight : 0;
    out[serverId].rooms += 1;
  }

  return out;
}

export async function assignServerForSession(
  input: SessionPlacementInput
): Promise<PlacementResult> {
  const servers = await getEnabledServers();

  if (!servers.length) {
    throw new Error("No enabled LiveKit servers available");
  }

  const placementWeight = getPlacementWeight(input);
  const liveUsersByServer = await getLiveUsersByServer();
  const reservedByServer = await getReservedWeightsByServer();

  const scored = servers.map((server) => {
    const liveUsersNow = liveUsersByServer[server.id] || 0;
    const reserved = reservedByServer[server.id] || { weight: 0, rooms: 0 };
    const roomCountPenalty = reserved.rooms * 0.5;
    const currentScore = liveUsersNow + reserved.weight + roomCountPenalty;
    const projectedScore = currentScore + placementWeight;

    return {
      server,
      placementWeight,
      score: {
        serverId: server.id,
        code: server.code,
        liveUsersNow,
        reservedRoomWeight: reserved.weight,
        activeRoomCount: reserved.rooms,
        roomCountPenalty,
        currentScore,
        projectedScore,
        softUserCap: server.soft_user_cap,
        hardUserCap: server.hard_user_cap,
      } satisfies ServerScoreBreakdown,
    };
  });

  if (!scored.length) {
    throw new Error("No enabled LiveKit servers available");
  }

  scored.sort((a, b) => {
    const aOverSoft = a.score.projectedScore >= a.server.soft_user_cap ? 1 : 0;
    const bOverSoft = b.score.projectedScore >= b.server.soft_user_cap ? 1 : 0;

    if (aOverSoft !== bOverSoft) return aOverSoft - bOverSoft;
    if (a.score.projectedScore !== b.score.projectedScore) {
      return a.score.projectedScore - b.score.projectedScore;
    }
    return a.server.sort_order - b.server.sort_order;
  });

  return scored[0];
}