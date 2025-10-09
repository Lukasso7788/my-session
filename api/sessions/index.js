import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('sessions').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    try {
      const { title, host, duration_minutes, format } = req.body;

      // создаём комнату в Daily.co
      const roomName = `session-${Date.now()}`;
      const resp = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.DAILY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: roomName,
          privacy: 'public',
          properties: {
            enable_screenshare: true,
            enable_chat: true,
            exp: Math.floor(Date.now() / 1000) + 86400,
          },
        }),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt);
      }

      const room = await resp.json();

      const { data, error } = await supabase
        .from('sessions')
        .insert([
          {
            title,
            host,
            duration_minutes,
            format,
            daily_room_url: room.url,
          },
        ])
        .select()
        .single();

      if (error) throw error;

      res.status(200).json(data);
    } catch (err) {
      console.error('POST /api/sessions error:', err);
      res.status(500).json({ error: err.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
