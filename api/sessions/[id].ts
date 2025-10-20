import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") {
    try {
      const response = await fetch("https://api.daily.co/v1/rooms", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.DAILY_API_KEY || ""}`,
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

      if (!response.ok) {
        return res.status(response.status).json({
          error: data?.error || "Failed to create Daily.co room",
        });
      }

      return res.status(200).json(data);
    } catch (error) {
      console.error("Error creating Daily.co room:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }

  return res.status(405).json({ message: "Method not allowed" });
}
