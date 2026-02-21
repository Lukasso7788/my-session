import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AccessToken } from "livekit-server-sdk";

export default async function handler(req: VercelRequest, res: VercelResponse) {
    try {
        if (req.method !== "POST") {
            res.setHeader("Allow", "POST");
            return res.status(405).json({ error: "method_not_allowed" });
        }

        const { roomName, identity, name } = (req.body || {}) as {
            roomName?: string;
            identity?: string;
            name?: string;
        };

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

        at.addGrant({
            room: String(roomName),
            roomJoin: true,
            canPublish: true,
            canSubscribe: true,
        });

        const token = await at.toJwt();
        return res.status(200).json({ token });
    } catch (e) {
        console.error("livekit token error:", e);
        return res.status(500).json({ error: "token_generation_failed" });
    }
}