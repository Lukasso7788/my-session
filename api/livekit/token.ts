import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AccessToken } from "livekit-server-sdk";

type Body = {
  roomName?: string;
  identity?: string;
  name?: string;

  // from client
  isHost?: boolean;
  sessionId?: string;
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

    // базовые права всем участникам
    const baseGrant: any = {
      room: String(roomName),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true, // полезно для чата/сигналов
    };

    // админские права только хосту
    // NOTE: в зависимости от версии SDK поле может называться roomAdmin.
    // Если TS ругнётся — скажи, я адаптирую под твою версию.
    const hostGrant: any = host
      ? {
          ...baseGrant,
          roomAdmin: true,

          // опционально: хост может публиковать любые source (camera/screen/mic)
          // если у тебя политика ограничений появится — это пригодится
          // canPublishSources: ["camera", "microphone", "screen_share"],
        }
      : baseGrant;

    at.addGrant(hostGrant);

    // желательно ограничить срок жизни токена
    // (иначе токен может жить дефолтно долго)
    // 6 часов — норм для сессии
    at.ttl = 60 * 60 * 6;

    const token = await at.toJwt();
    return res.status(200).json({ token, isHost: host });
  } catch (e) {
    console.error("livekit token error:", e);
    return res.status(500).json({ error: "token_generation_failed" });
  }
}