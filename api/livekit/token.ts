import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AccessToken } from "livekit-server-sdk";

type Body = {
  roomName?: string;
  identity?: string;
  name?: string;
  isHost?: boolean;
  sessionId?: string;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Cache-Control", "no-store, max-age=0");

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const { roomName, identity, name, isHost } = parseBody(req);

    if (!roomName || !identity) {
      return res.status(400).json({ error: "roomName_and_identity_required" });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      console.error("livekit token error: missing env", {
        hasKey: !!apiKey,
        hasSecret: !!apiSecret,
      });
      return res.status(500).json({ error: "livekit_keys_missing" });
    }

    const host = asBool(isHost);

    const at = new AccessToken(apiKey, apiSecret, {
      identity: String(identity),
      name: name ? String(name) : undefined,
    });

    // NOTE:
    // - No TTL override here (important).
    // - In some SDK versions manual ttl can produce bad exp if passed in wrong shape.
    const grant: any = {
      room: String(roomName),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    };

    if (host) {
      // Host-only admin rights
      grant.roomAdmin = true;
    }

    at.addGrant(grant);

    const token = await at.toJwt();

    console.log("LK TOKEN GENERATED", {
      marker: "lk-token-v3-no-ttl-host",
      roomName: String(roomName),
      identity: String(identity),
      host,
      apiKeyPrefix: String(apiKey).slice(0, 6),
      tokenPreview: `${token.slice(0, 18)}...${token.slice(-10)}`,
    });

    return res.status(200).json({
      token,
      isHost: host,
    });
  } catch (e) {
    console.error("livekit token error:", e);
    return res.status(500).json({ error: "token_generation_failed" });
  }
}