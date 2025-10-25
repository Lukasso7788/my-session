import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // ⚠️ обязательно SERVICE ROLE ключ
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    try {
      const { title, host, templateId, scheduled_at } = req.body;

      // 1️⃣ Загружаем шаблон
      const { data: template, error: tplError } = await supabase
        .from("session_templates")
        .select("*")
        .eq("id", templateId)
        .single();

      if (tplError || !template)
        return res.status(400).json({ error: "Template not found" });

      // 2️⃣ Создаём комнату в Daily
      const roomName = `session-${Date.now()}`;
      const response = await fetch("https://api.daily.co/v1/rooms", {
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
            exp: Math.floor(Date.now() / 1000) + 7200, // 2 часа
          },
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Daily API error: ${err}`);
      }

      const room = await response.json();

      // 3️⃣ Сохраняем сессию в Supabase
      const { data: session, error: sessErr } = await supabase
        .from("sessions")
        .insert([
          {
            title,
            host,
            template_id: template.id,
            duration_minutes: template.total_duration,
            format: template.name,
            schedule: template.blocks,
            daily_room_url: room.url,
            start_time: scheduled_at,
            status: "planned",
          },
        ])
        .select()
        .single();

      if (sessErr) throw sessErr;

      return res.status(200).json(session);
    } catch (err: any) {
      console.error("Error creating session:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "GET") {
    const { data, error } = await supabase.from("sessions").select("*");
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  res.status(405).json({ error: "Method not allowed" });
}
