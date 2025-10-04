// project/api/sessions.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Генерация уникального имени комнаты
function generateRoomName() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `focus-session-${timestamp}-${random}`;
}

// Создание Daily комнаты
async function createDailyRoom(roomName: string) {
  const resp = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DAILY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: roomName,
      privacy: 'public',
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // живёт 24 часа
      properties: {
        enable_screenshare: true,
        enable_chat: true,
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Daily API error: ${resp.status} ${text}`);
  }

  return await resp.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    try {
      const { title, host } = req.body;

      // генерим уникальное имя комнаты
      const roomName = generateRoomName();

      // создаём комнату в Daily
      const dailyRoom = await createDailyRoom(roomName);

      // возвращаем данные клиенту
      return res.status(201).json({
        id: roomName,
        title,
        host,
        daily_room_url: dailyRoom.url,
      });
    } catch (err: any) {
      console.error('Error creating session:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
