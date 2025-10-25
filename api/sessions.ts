import { createClient } from "@supabase/supabase-js";
import type { NextApiRequest, NextApiResponse } from "next";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return res.status(200).json(data);
    } catch (err: any) {
      console.error("GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { title, host, template_id, scheduled_at } = req.body;
      if (!title || !host || !template_id) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // 1️⃣ Получаем шаблон сессии из Supabase
      const { data: template, error: templateError } = await supabase
        .from("session_templates")
        .select("*")
        .eq("id", template_id)
        .single();

      if (templateError || !template) {
        console.error("Template not found:", templateError);
        return res.status(400).json({ error: "Template not found" });
      }

      // 2️⃣ Создаём комнату в Daily.co
      const roomName = `session-${Date.now()}`;
      const dailyRes = await fetch("https://api.daily.co/v1/rooms", {
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
            exp: Math.floor(Date.now() / 1000) + 7200, // срок жизни 2 часа
          },
        }),
      });

      if (!dailyRes.ok) {
        const text = await dailyRes.text();
        console.error("Daily API error:", text);
        return res.status(500).json({ error: "Daily.co API failed" });
      }

      const room = await dailyRes.json();

      // 3️⃣ Записываем сессию в Supabase
      const { data, error } = await supabase
        .from("sessions")
        .insert([
          {
            title,
            host,
            duration_minutes: template.total_duration,
            format: template.name,
            template_id,
            schedule: template.blocks,
            daily_room_url: room.url,
            start_time: scheduled_at,
            status: "planned",
          },
        ])
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json(data);
    } catch (err: any) {
      console.error("POST error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
