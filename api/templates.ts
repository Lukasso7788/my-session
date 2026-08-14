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

function getBearerToken(req: VercelRequest) {
  const authorization = String(req.headers.authorization || "").trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function extractResponseText(payload: any) {
  const direct = cleanText(payload?.output_text);
  if (direct) return direct;

  const parts = Array.isArray(payload?.output)
    ? payload.output.flatMap((item: any) =>
        Array.isArray(item?.content) ? item.content : [],
      )
    : [];

  return cleanText(
    parts
      .map((part: any) => part?.text || part?.content || "")
      .filter(Boolean)
      .join("\n"),
  );
}

async function hasPaidTaskAiAccess(userId: string, token: string) {
  const scopedSupabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await scopedSupabase
    .from("user_entitlements")
    .select("plan,status,current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.status !== "active") return false;

  const paidPlan = ["pro_monthly", "pro_yearly", "lifetime"].includes(
    String(data.plan || "").toLowerCase(),
  );
  if (!paidPlan) return false;

  if (data.plan === "lifetime" || !data.current_period_end) return true;
  const accessEndsAt = new Date(data.current_period_end);
  return !Number.isNaN(accessEndsAt.getTime()) && accessEndsAt.getTime() > Date.now();
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

async function handleTaskAiSuggestions(req: VercelRequest, res: VercelResponse) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "Authentication required" });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return res.status(401).json({ error: "Invalid session" });
  }

  try {
    const hasPaidAccess = await hasPaidTaskAiAccess(authData.user.id, token);
    if (!hasPaidAccess) {
      return res.status(402).json({
        error: "payment_required",
        message: "AI Suggestions are available on a paid plan.",
      });
    }
  } catch (error: any) {
    console.error("[api/templates task-ai-suggestions] entitlement check failed:", {
      message: error?.message || String(error),
      userId: authData.user.id,
    });
    return res.status(503).json({ error: "Could not verify AI feature access" });
  }

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const model = String(
    process.env.OPENAI_TASK_SUGGESTIONS_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
  ).trim();
  const task = cleanText(getRequestBody(req).task).slice(0, 1000);

  if (!task) return res.status(400).json({ error: "Task text is required" });
  if (!apiKey) return res.status(503).json({ error: "AI suggestions are not configured" });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const openAiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 700,
        instructions: [
          "You are a concise productivity coach inside MySession.",
          "Help the user execute the task, not merely think about it.",
          "Give concrete, low-friction steps that can be started immediately.",
          "Do not provide therapy, diagnosis, judgment, or generic encouragement.",
          "Match the language used in the task.",
        ].join(" "),
        input: `Task: ${task}`,
        text: {
          format: {
            type: "json_schema",
            name: "task_ai_suggestions",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                summary: { type: "string" },
                firstAction: { type: "string" },
                nextSteps: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 2,
                  maxItems: 5,
                },
                likelyObstacle: { type: "string" },
                focusMinutes: { type: "integer", minimum: 5, maximum: 120 },
              },
              required: [
                "summary",
                "firstAction",
                "nextSteps",
                "likelyObstacle",
                "focusMinutes",
              ],
            },
          },
        },
      }),
    });

    const raw = await openAiRes.text();
    const payload = safeJsonParse(raw);
    if (!openAiRes.ok) {
      console.error("[api/templates task-ai-suggestions] OpenAI failed:", {
        status: openAiRes.status,
        model,
        hasKey: Boolean(apiKey),
      });
      return res.status(502).json({ error: "AI suggestions are temporarily unavailable" });
    }

    const parsed = safeJsonParse(extractResponseText(payload));
    const summary = cleanText(parsed?.summary).slice(0, 500);
    const firstAction = cleanText(parsed?.firstAction).slice(0, 500);
    const nextSteps = Array.isArray(parsed?.nextSteps)
      ? parsed.nextSteps.map((value: unknown) => cleanText(value).slice(0, 500)).filter(Boolean).slice(0, 5)
      : [];
    const likelyObstacle = cleanText(parsed?.likelyObstacle).slice(0, 500);
    const focusMinutes = Math.max(5, Math.min(120, Number(parsed?.focusMinutes) || 25));

    if (!summary || !firstAction || nextSteps.length < 2) {
      return res.status(502).json({ error: "AI returned an incomplete suggestion" });
    }

    return res.status(200).json({
      suggestion: { summary, firstAction, nextSteps, likelyObstacle, focusMinutes },
      source: "openai",
    });
  } catch (error: any) {
    console.error("[api/templates task-ai-suggestions] exception:", {
      message: error?.message || String(error),
      model,
    });
    return res.status(502).json({ error: "AI suggestions are temporarily unavailable" });
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const body = getRequestBody(req);

  if (req.method === "POST") {
    if (body?.action === "ai-host-respond") return handleAiHost(req, res);
    if (body?.action === "task-ai-suggestions") {
      return handleTaskAiSuggestions(req, res);
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

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json(data || []);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}