import type { VercelRequest, VercelResponse } from '@vercel/node';

let sessions: any[] = [];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json(sessions);
  }

  if (req.method === 'POST') {
    try {
      const { title, host, duration_minutes, format, scheduled_at, focus_blocks } = req.body;

      if (!process.env.DAILY_API_KEY) {
        return res.status(500).json({ error: "Missing DAILY_API_KEY in environment" });
      }

      const roomName = `session-${Date.now()}`;

      const resp = await fetch("https://api.daily.co/v1/rooms", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.DAILY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: roomName,
          privacy: "public",
          properties: {
            enable_screenshare: true,
            enable_chat: true,
            enable_recording: "cloud",
            exp: Math.floor(Date.now() / 1000) + 86400, // expires in 24h
          },
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error("Daily API error:", errText);
        return res.status(resp.status).json({ error: `Daily API error: ${errText}` });
      }

      const room = await resp.json();

      const newSession = {
        id: Date.now().toString(),
        title,
        host,
        duration_minutes,
        format,
        focus_blocks,
        daily_room_url: room.url,
        created_at: new Date().toISOString(),
        scheduled_at,
      };

      sessions.push(newSession);
      return res.status(200).json(newSession);
    } catch (err: any) {
      console.error("Server error creating session:", err);
      return res.status(500).json({ error: err.message || "Server error creating session" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
