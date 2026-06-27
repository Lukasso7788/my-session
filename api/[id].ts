function cleanText(value: unknown, fallback = "") {
  return String(value || fallback).trim().slice(0, 4000);
}

function safeJsonParse(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function json(res: any, status: number, payload: any) {
  return res.status(status).json(payload);
}

function assertCronSecret(req: any) {
  const expected = String(process.env.MYSSESSION_CRON_SECRET || "").trim();

  if (!expected) {
    return true;
  }

  const got = String(req.headers["x-cron-secret"] || "").trim();
  return got === expected;
}

async function supabaseRest(path: string, opts: any = {}) {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
      ...(opts.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? safeJsonParse(text) ?? text : null;

  if (!response.ok) {
    throw new Error(
      `Supabase REST failed ${response.status}: ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`,
    );
  }

  return data;
}

async function handleDiscordPresenceBroadcast(req: any, res: any) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  const webhookUrl = String(
    process.env.DISCORD_PRESENCE_WEBHOOK_URL || "",
  ).trim();

  if (!webhookUrl) {
    return json(res, 200, { ok: false, skipped: "missing_webhook" });
  }

  const minParticipants = Number(req.body?.minParticipants || 2);
  const cooldownMinutes = Number(req.body?.cooldownMinutes || 45);

  try {
    const rooms = await supabaseRest("rpc/get_active_infinite_rooms_for_discord", {
      method: "POST",
      body: JSON.stringify({ min_participants: minParticipants }),
    });

    const list = Array.isArray(rooms) ? rooms : [];

    if (!list.length) {
      return json(res, 200, {
        ok: true,
        posted: false,
        skipped: "no_active_rooms",
      });
    }

    const picked = list[0];
    const sessionId = String(picked.session_id || picked.id || "").trim();
    const title = cleanText(picked.title || "focus room", "focus room");
    const count = Number(picked.participant_count || 0);
    const link =
      cleanText(picked.room_url) ||
      `${String(process.env.NEXT_PUBLIC_APP_URL || "https://mysession.app").replace(
        /\/$/,
        "",
      )}/sessions/${sessionId}`;

    if (!sessionId || count < minParticipants) {
      return json(res, 200, {
        ok: true,
        posted: false,
        skipped: "below_threshold",
      });
    }

    const sinceIso = new Date(
      Date.now() - cooldownMinutes * 60 * 1000,
    ).toISOString();

    const recent = await supabaseRest(
      `discord_presence_broadcasts?room_session_id=eq.${encodeURIComponent(
        sessionId,
      )}&sent_at=gte.${encodeURIComponent(
        sinceIso,
      )}&select=id,sent_at&limit=1`,
      { method: "GET" },
    );

    if (Array.isArray(recent) && recent.length > 0) {
      return json(res, 200, {
        ok: true,
        posted: false,
        skipped: "cooldown",
        sessionId,
        participantCount: count,
      });
    }

    const message =
      count >= 5
        ? `🔥 ${count} people are focusing right now in **${title}**.\nJoin us: ${link}`
        : `🟢 ${count} people are focusing right now in **${title}**.\nJoin if you want to work with us: ${link}`;

    const discordRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: message,
        allowed_mentions: { parse: [] },
      }),
    });

    const discordText = await discordRes.text();

    if (!discordRes.ok) {
      console.error("[discord_presence_broadcast] Discord failed:", {
        status: discordRes.status,
        body: discordText.slice(0, 500),
      });

      return json(res, 200, {
        ok: false,
        posted: false,
        error: "discord_failed",
        status: discordRes.status,
      });
    }

    await supabaseRest("discord_presence_broadcasts", {
      method: "POST",
      body: JSON.stringify({
        room_session_id: sessionId,
        participant_count: count,
        message,
        discord_webhook_url: webhookUrl.slice(0, 120),
      }),
    });

    return json(res, 200, {
      ok: true,
      posted: true,
      sessionId,
      title,
      participantCount: count,
      message,
    });
  } catch (error: any) {
    console.error("[discord_presence_broadcast] error:", error);
    return json(res, 500, {
      ok: false,
      error: error?.message || "Internal server error",
    });
  }
}

async function handleAiHost(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

  const body = req.body || {};
  const phase = cleanText(body.phase, "intention");
  const userName = cleanText(body.userName, "there");
  const text = cleanText(body.text);

  const fallback =
    phase === "checkin"
      ? {
          publicSpoken: `Nice check-in, ${userName}. Pick one small next step and continue.`,
          privateAdvice: [
            "Name exactly what changed in the previous block.",
            "Choose one concrete next action.",
            "Keep the next block simple.",
          ],
          source: "fallback",
        }
      : {
          publicSpoken: `Got it, ${userName}. Start with the first small visible step.`,
          privateAdvice: [
            "Make the first action very small.",
            "Start with one concrete step, not the whole task.",
          ],
          source: "fallback",
        };

  if (!apiKey) {
    return res.status(200).json(fallback);
  }

  const prompt = `
You are the AI host of a MySession AI-hosted body-doubling focus room.

User: ${userName}
Phase: ${phase}
User text: ${text}

Return JSON only:
{
  "publicSpoken": "one short sentence spoken publicly to the room",
  "privateAdvice": ["1-3 concrete private suggestions for this user"]
}

Rules:
- Public spoken message is heard by everyone in the room.
- Keep public spoken message general, encouraging, and not too specific.
- Private advice may be more specific to the user's task/progress.
- Do not sound like therapy.
- Do not be cringe.
- Be calm, direct, practical.
- For check-in, help the user choose the next action for the next block.
- For intention, help the user start with a small visible first step.
`.trim();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 320,
          responseMimeType: "application/json",
        },
      }),
    });

    const raw = await geminiRes.text();

    if (!geminiRes.ok) {
      console.error("[api/ai-host] Gemini failed:", {
        status: geminiRes.status,
        raw: raw.slice(0, 500),
      });

      return res.status(200).json(fallback);
    }

    const data = safeJsonParse(raw);
    const answerText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = safeJsonParse(answerText);

    const publicSpoken = cleanText(parsed?.publicSpoken);
    const privateAdvice = Array.isArray(parsed?.privateAdvice)
      ? parsed.privateAdvice
          .map((x: unknown) => cleanText(x))
          .filter(Boolean)
          .slice(0, 3)
      : [];

    return res.status(200).json({
      publicSpoken: publicSpoken || fallback.publicSpoken,
      privateAdvice: privateAdvice.length ? privateAdvice : fallback.privateAdvice,
      source: "gemini",
    });
  } catch (error) {
    console.error("[api/ai-host] Gemini error:", error);
    return res.status(200).json(fallback);
  }
}

export default async function handler(req: any, res: any) {
  const id = String(req.query?.id || "").trim();
  const action = String(req.body?.action || "").trim();

  if (id === "default" && action === "respond") {
    return handleAiHost(req, res);
  }

  if (id === "default" && action === "discord_presence_broadcast") {
    if (!assertCronSecret(req)) {
      return json(res, 401, { error: "Unauthorized" });
    }

    return handleDiscordPresenceBroadcast(req, res);
  }

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