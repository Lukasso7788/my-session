export default async function handler(req, res) {
  if (req.method === "POST") {
    const response = await fetch("https://api.daily.co/v1/rooms", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.DAILY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          enable_chat: true,
          enable_screenshare: true,
          enable_recording: "cloud",
        },
      }),
    });

    const data = await response.json();
    return res.status(200).json(data);
  }

  res.status(405).json({ message: "Method not allowed" });
}
