import type { VercelRequest, VercelResponse } from "@vercel/node";
import { RoomServiceClient } from "livekit-server-sdk";

type AdminAction = "mute_track" | "unmute_track" | "remove_participant";

type Body = {
  action?: AdminAction;
  roomName?: string;
  participantIdentity?: string;
  trackSid?: string;
  isHost?: boolean; // ВАЖНО: сейчас это доверяем фронту (быстрое MVP). Потом лучше верифицировать на сервере.
};

function asBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  if (typeof v === "number") return v === 1;
  return false;
}

function parseBody(req: VercelRequest): Body {
  const raw = req.body as any;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Body;
    } catch {
      return {};
    }
  }
  return raw as Body;
}

function normalizeLiveKitHost(raw: string): string {
  let host = (raw || "").trim();
  if (!host) return "";

  // ws(s) -> http(s) for RoomServiceClient
  if (host.startsWith("wss://")) host = "https://" + host.slice("wss://".length);
  if (host.startsWith("ws://")) host = "http://" + host.slice("ws://".length);

  // remove trailing slash
  host = host.replace(/\/+$/, "");
  return host;
}

function getLiveKitHttpHost(): string {
  // Prefer explicit server env first
  const candidates = [
    process.env.LIVEKIT_HTTP_URL,
    process.env.LIVEKIT_URL,
    process.env.VITE_LIVEKIT_URL, // fallback if only this is set in Vercel
  ];

  for (const c of candidates) {
    const norm = normalizeLiveKitHost(String(c || ""));
    if (norm) return norm;
  }

  return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Cache-Control", "no-store, max-age=0");

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const { action, roomName, participantIdentity, trackSid, isHost } = parseBody(req);

    if (!asBool(isHost)) {
      // Быстрый guard. Ниже можно усилить проверкой через Supabase на host_id.
      return res.status(403).json({ error: "host_required" });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitHost = getLiveKitHttpHost();

    if (!apiKey || !apiSecret) {
      return res.status(500).json({ error: "livekit_keys_missing" });
    }

    if (!livekitHost) {
      return res.status(500).json({
        error: "livekit_http_host_missing",
        hint: "Set LIVEKIT_HTTP_URL (or LIVEKIT_URL / VITE_LIVEKIT_URL) in Vercel env",
      });
    }

    if (!action || !roomName) {
      return res.status(400).json({ error: "action_and_roomName_required" });
    }

    const svc = new RoomServiceClient(livekitHost, apiKey, apiSecret);

    if (action === "remove_participant") {
      if (!participantIdentity) {
        return res.status(400).json({ error: "participantIdentity_required" });
      }

      await svc.removeParticipant(String(roomName), String(participantIdentity));

      return res.status(200).json({
        ok: true,
        action,
        roomName,
        participantIdentity,
      });
    }

    if (action === "mute_track" || action === "unmute_track") {
      if (!participantIdentity || !trackSid) {
        return res.status(400).json({ error: "participantIdentity_and_trackSid_required" });
      }

      const muted = action === "mute_track";

      await svc.mutePublishedTrack(
        String(roomName),
        String(participantIdentity),
        String(trackSid),
        muted
      );

      return res.status(200).json({
        ok: true,
        action,
        roomName,
        participantIdentity,
        trackSid,
        muted,
      });
    }

    return res.status(400).json({ error: "unsupported_action" });
  } catch (e: any) {
    console.error("livekit admin error:", e);
    return res.status(500).json({
      error: "livekit_admin_failed",
      message: String(e?.message || e || "unknown_error"),
    });
  }
}