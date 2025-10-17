import type { VercelRequest, VercelResponse } from '@vercel/node'

let sessions: any[] = []

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json(sessions)
  }

  if (req.method === 'POST') {
    try {
      const { title, host, duration_minutes, format, scheduled_at } = req.body

      const roomName = `session-${Date.now()}`

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
            exp: Math.floor(Date.now() / 1000) + 86400, // 24 часа
          },
        }),
      })

      const room = await resp.json()

      const newSession = {
        id: Date.now().toString(),
        title,
        host,
        duration_minutes,
        format,
        daily_room_url: room.url,
        created_at: new Date().toISOString(),
        scheduled_at,
      }

      sessions.push(newSession)
      return res.status(200).json(newSession)
    } catch (err: any) {
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(405).json({ error: "Method not allowed" })
}
