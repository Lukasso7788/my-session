import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AccessToken } from "livekit-server-sdk";

type Body = {
  roomName?: string;
  identity?: string;
  name?: string;
  isHost?: boolean;
};

function asBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  if (typeof v === "number") return v === 1;
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const { roomName, identity, name, isHost } = (req.body || {}) as Body;

    if (!roomName || !identity) {
      return res.status(400).json({ error: "roomName_and_identity_required" });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return res.status(500).json({ error: "livekit_keys_missing" });
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity: String(identity),
      name: name ? String(name) : undefined,
    });

    const host = asBool(isHost);

    // базовые права всем
    const grant: any = {
      room: String(roomName),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    };

    // админские права только хосту
    if (host) {
      grant.roomAdmin = true; // если TS ругнется на поле — скажи, подгоню под твою версию SDK
    }

    at.addGrant(grant);

    // ❌ НЕ трогаем ttl, потому что в твоей версии SDK это ломает exp (ставит "21600")
    const token = await at.toJwt();

    return res.status(200).json({ token, isHost: host });
  } catch (e) {
    console.error("livekit token error:", e);
    return res.status(500).json({ error: "token_generation_failed" });
  }
}