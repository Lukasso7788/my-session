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

function makeFallback(phase: string, userName: string, debugReason?: string) {
  const base =
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

  return debugReason ? { ...base, debugReason } : base;
}

async function handleAiHost(req: VercelRequest, res: VercelResponse) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const model = String(process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();

  const body = getRequestBody(req);
  const phase = cleanText(body.phase, "intention");
  const userName = cleanText(body.userName, "there");
  const text = cleanText(body.text);

  if (!apiKey) {
    return res.status(200).json(makeFallback(phase, userName, "missing_openai_api_key"));
  }

  const systemPrompt = `
You are the AI host of a MySession AI-hosted body-doubling focus room.

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

  const userPrompt = `
User: ${userName}
Phase: ${phase}
User text: ${text}
`.trim();

  try {
    const openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: 320,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const raw = await openAiRes.text();

    if (!openAiRes.ok) {
      console.error("[api/templates ai-host] OpenAI failed:", {
        status: openAiRes.status,
        raw: raw.slice(0, 1000),
        model,
        hasKey: Boolean(apiKey),
      });

      return res.status(200).json(makeFallback(phase, userName, `openai_http_${openAiRes.status}`));
    }

    const data = safeJsonParse(raw);
    const answerText = data?.choices?.[0]?.message?.content || "";
    const parsed = safeJsonParse(answerText);

    const publicSpoken = cleanText(parsed?.publicSpoken);
    const privateAdvice = Array.isArray(parsed?.privateAdvice)
      ? parsed.privateAdvice.map((x: unknown) => cleanText(x)).filter(Boolean).slice(0, 3)
      : [];

    if (!publicSpoken && privateAdvice.length === 0) {
      return res.status(200).json(makeFallback(phase, userName, "openai_unusable_json"));
    }

    return res.status(200).json({
      publicSpoken:
        publicSpoken ||
        (phase === "checkin"
          ? `Nice check-in, ${userName}. Choose the next small step.`
          : `Got it, ${userName}. Start with one small step.`),
      privateAdvice: privateAdvice.length ? privateAdvice : ["Choose one concrete next action."],
      source: "openai",
      debugReason: null,
    });
  } catch (error: any) {
    console.error("[api/templates ai-host] OpenAI exception:", {
      message: error?.message || String(error),
      model,
      hasKey: Boolean(apiKey),
    });

    return res.status(200).json(makeFallback(phase, userName, "openai_exception"));
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const body = getRequestBody(req);

  if (req.method === "POST") {
    if (body?.action === "ai-host-respond") return handleAiHost(req, res);

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

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json(data || []);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}