import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

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

function getRequestBody(req: VercelRequest): any {
  const body = req.body;

  if (!body) return {};
  if (typeof body === "string") return safeJsonParse(body) || {};
  if (typeof body === "object") return body;

  return {};
}

async function handleAiHost(req: VercelRequest, res: VercelResponse) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

  const body = getRequestBody(req);

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
    console.warn("[api/templates ai-host] Missing GEMINI_API_KEY");
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
    model
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
      console.error("[api/templates ai-host] Gemini failed:", {
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
    console.error("[api/templates ai-host] Gemini error:", error);
    return res.status(200).json(fallback);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const body = getRequestBody(req);

  if (req.method === "POST") {
    if (body?.action === "ai-host-respond") {
      return handleAiHost(req, res);
    }

    return res.status(400).json({
      error: "Unknown POST action",
      receivedAction: body?.action || null,
    });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { data, error } = await supabase
      .from("session_templates")
      .select("*")
      .order("total_duration", { ascending: true });

    if (error) {
      console.error("Supabase error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data || []);
  } catch (err: any) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}