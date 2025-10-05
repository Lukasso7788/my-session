export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { title, host, duration_minutes, format } = req.body || {};

    // Проверка обязательных полей
    if (!title || !host || !duration_minutes || !format) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Проверим, есть ли API-ключ Daily
    if (!process.env.DAILY_API_KEY) {
      throw new Error("Missing DAILY_API_KEY in environment");
    }

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
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Daily API error:", data);
      throw new Error(data?.error || "Failed to create Daily room");
    }

    res.status(200).json({
      title,
      host,
      duration_minutes,
      format,
      daily_room_url: data.url,
    });
  } catch (err) {
    console.error("API Error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
}
