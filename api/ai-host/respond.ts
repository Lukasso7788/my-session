import type { VercelRequest, VercelResponse } from "@vercel/node";

type AiHostPhase = "intention" | "checkin";

type AiHostRequestBody = {
  phase?: AiHostPhase;
  userName?: string;
  intention?: string;
  answer?: string;
  sessionTitle?: string;
};

type AiHostResponse = {
  spoken: string;
  privateAdvice: string[];
  source: "gemini" | "fallback";
};

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

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

function fallbackResponse(body: AiHostRequestBody): AiHostResponse {
  const userName = cleanText(body.userName, "there");
  const phase = body.phase || "checkin";

  if (phase === "intention") {
    return {
      spoken: `Nice, ${userName}. Keep it simple and start with the first visible step.`,
      privateAdvice: [
        "Write the smallest next action.",
        "Start with 10 minutes before expanding the task.",
      ],
      source: "fallback",
    };
  }

  return {
    spoken: `Good check-in, ${userName}. Keep going and make the next step smaller.`,
    privateAdvice: [
      "Pick one concrete next action.",
      "Avoid restarting the whole plan; continue from the smallest useful step.",
    ],
    source: "fallback",
  };
}

function buildPrompt(body: AiHostRequestBody) {
  const phase = body.phase || "checkin";
  const userName = cleanText(body.userName, "there");
  const intention = cleanText(body.intention);
  const answer = cleanText(body.answer);
  const sessionTitle = cleanText(body.sessionTitle, "MySession AI-hosted focus room");

  return `
You are the AI host of a live MySession body-doubling focus room.

Room: ${sessionTitle}
User: ${userName}
Phase: ${phase}

User intention:
${intention || "(not provided)"}

User check-in answer:
${answer || "(not provided)"}

Rules:
- Be short, calm, and practical.
- Do not sound like therapy.
- Do not overtalk.
- Spoken reply must be one short sentence.
- Private advice must be 1-3 short bullets.
- No shame, no pressure, no fake excitement.
- Return JSON only.

JSON format:
{
  "spoken": "one short spoken sentence",
  "privateAdvice": ["short bullet 1", "short bullet 2"]
}
`.trim();
}

async function callGemini(body: AiHostRequestBody): Promise<AiHostResponse> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();

  if (!apiKey) {
    return fallbackResponse(body);
  }

  const prompt = buildPrompt(body);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    DEFAULT_MODEL
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 320,
        responseMimeType: "application/json",
      },
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    console.error("[ai-host/respond] Gemini failed:", {
      status: response.status,
      text: text.slice(0, 1000),
    });

    return fallbackResponse(body);
  }

  const data = safeJsonParse(text);
  const rawAnswer =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    data?.candidates?.[0]?.content?.parts?.[0]?.inlineData ||
    "";

  const parsed =
    typeof rawAnswer === "string"
      ? safeJsonParse(rawAnswer)
      : rawAnswer && typeof rawAnswer === "object"
        ? rawAnswer
        : null;

  const spoken = cleanText(parsed?.spoken);
  const privateAdviceRaw = Array.isArray(parsed?.privateAdvice)
    ? parsed.privateAdvice
    : [];

  const privateAdvice = privateAdviceRaw
    .map((x: unknown) => cleanText(x))
    .filter(Boolean)
    .slice(0, 3);

  if (!spoken) {
    return fallbackResponse(body);
  }

  return {
    spoken,
    privateAdvice: privateAdvice.length
      ? privateAdvice
      : ["Pick one small next action and continue from there."],
    source: "gemini",
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const body = (req.body || {}) as AiHostRequestBody;

    const phase = body.phase || "checkin";

    if (phase !== "intention" && phase !== "checkin") {
      return res.status(400).json({
        error: "Invalid phase",
      });
    }

    const result = await callGemini({
      phase,
      userName: cleanText(body.userName, "there"),
      intention: cleanText(body.intention),
      answer: cleanText(body.answer),
      sessionTitle: cleanText(body.sessionTitle, "MySession AI-hosted focus room"),
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("[ai-host/respond] error:", error);

    return res.status(200).json({
      spoken: "Nice check-in. Keep the next step small and continue.",
      privateAdvice: ["Pick one concrete next action.", "Continue for one short focus block."],
      source: "fallback",
    } satisfies AiHostResponse);
  }
}