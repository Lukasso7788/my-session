import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

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

async function hasPaidTaskAiAccess(userId: string) {
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  // Authentication is verified before this function is called. Use the
  // server-only key for the entitlement lookup so RLS cannot turn a valid
  // paid row into an indistinguishable `null` result.
  const serviceSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await serviceSupabase
    .from("user_entitlements")
    .select("plan,status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return false;

  const status = String(data.status || "").toLowerCase();
  if (status !== "active" && status !== "trialing") return false;

  const plan = String(data.plan || "").toLowerCase();
  const hasProAccess = [
    "pro_monthly",
    "pro_yearly",
    "lifetime",
    "founding_free",
  ].includes(plan);
  if (!hasProAccess) return false;

  // `status` is the canonical access flag across MySession. Billing lifecycle
  // code is responsible for changing it when access ends; period timestamps
  // can remain historical between synchronization runs.
  return true;
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
    const hasPaidAccess = await hasPaidTaskAiAccess(authData.user.id);
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

function isTaskListDraft(value: any): value is { title: string; tasks: string[] } {
  return typeof value?.title === "string" && !!value.title.trim() && value.title.length <= 120 &&
    Array.isArray(value.tasks) && value.tasks.length >= 1 && value.tasks.length <= 30 &&
    value.tasks.every((task: unknown) => typeof task === "string" && !!task.trim() && task.length <= 300);
}

async function handleGenerateTaskList(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "Please log in to generate a task list." });
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth.user) return res.status(401).json({ error: "Your session expired. Please log in again." });
  try {
    if (!(await hasPaidTaskAiAccess(auth.user.id))) {
      return res.status(403).json({ error: "Task list generation is available with MySession Pro." });
    }
  } catch {
    return res.status(503).json({ error: "Could not verify Pro access. Please try again." });
  }
  const body = getRequestBody(req);
  const approving = body.action === "task-list-approve";
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  const adjustment = typeof body.adjustment === "string" ? body.adjustment.trim() : "";
  const planId = typeof body.requestId === "string" ? body.requestId : "";
  if (approving ? (!isTaskListDraft(body.draft) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(planId))
      : (goal.length < 10 || goal.length > 2000 || adjustment.length > 2000 ||
        (body.draft != null && (!isTaskListDraft(body.draft) || !adjustment)))) {
    return res.status(400).json({ error: approving
      ? "A title (up to 120 characters) and 1–30 non-empty tasks (up to 300 characters each) are required."
      : "Describe your goal in 10–2000 characters and provide valid adjustment instructions." });
  }
  // All task writes use the caller's JWT and existing ownership RLS, never the service role.
  const db = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    // Stable request IDs recover a saved result after a lost HTTP response.
    const existing = approving
      ? await db.from("focus_plans").select("*").eq("id", planId).eq("user_id", auth.user.id).maybeSingle()
      : { data: null, error: null };
    if (existing.error) throw existing.error;
    if (existing.data) {
      const saved = await db.from("focus_plan_items").select("*").eq("plan_id", planId).eq("user_id", auth.user.id).order("sort_order");
      if (saved.error) throw saved.error;
      if (saved.data?.length) return res.status(200).json({ plan: existing.data, items: saved.data });
      // Recover an empty parent left by an interrupted save. Deterministic item
      // IDs below make concurrent recovery safe without duplicating tasks.
    }
    let parsed = body.draft;
    if (!approving) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "AI generation is not configured yet." });
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: process.env.OPENAI_TASK_SUGGESTIONS_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
          store: false,
          max_output_tokens: 4000,
          instructions: "Turn the user's goal into a practical task list. Use the user's language. Give a short descriptive title and 1–30 concrete, ordered, achievable tasks (usually 3–12, more when requested). Start with a small actionable step. When given a current draft and adjustment, revise that draft according to the adjustment, preserving unaffected tasks and manual edits unless the user asks to replace the whole plan. Respect their purpose, constraints and desired outcome. Do not claim to have performed the tasks. No markdown, vague encouragement or invented deadlines.",
          input: JSON.stringify({ goal, ...(body.draft ? { currentDraft: body.draft, adjustment } : {}) }),
          text: { format: {
            type: "json_schema", name: "generated_task_list", strict: true,
            schema: {
              type: "object", additionalProperties: false,
              properties: {
                title: { type: "string", minLength: 1, maxLength: 120 },
                tasks: { type: "array", minItems: 1, maxItems: 30, items: { type: "string", minLength: 1, maxLength: 300 } },
              },
              required: ["title", "tasks"],
            },
          } },
        }),
      });
      if (!response.ok) return res.status(502).json({ error: "AI generation is temporarily unavailable. Please retry." });
      const payload = await response.json();
      const parts = (payload.output || []).flatMap((item: any) => item.content || []);
      parsed = safeJsonParse(parts.filter((part: any) => part.type === "output_text").map((part: any) => part.text).join(""));
      if (payload.status !== "completed" || !isTaskListDraft(parsed)) {
        return res.status(502).json({ error: "AI could not produce a complete plan. Please retry or clarify your goal." });
      }
      // Generation and regeneration are read-only: only explicit approval saves.
      return res.status(200).json({ draft: { title: parsed.title.trim(), tasks: parsed.tasks.map((task: string) => task.trim()) } });
    }
    const plan = existing.data ? { data: existing.data, error: null } : await db.from("focus_plans").insert({
      id: planId, user_id: auth.user.id, title: parsed.title.trim(),
    }).select("*").single();
    if (plan.error) {
      if (plan.error.code === "23505") return res.status(409).json({ error: "This list is already being saved. Wait a moment and retry." });
      throw plan.error;
    }
    const rows = parsed.tasks.map((text: string, index: number) => {
      const hash = createHash("sha256").update(`${planId}:${index}`).digest("hex");
      const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      return {
      id,
      plan_id: planId, user_id: auth.user.id, text: text.trim(),
      completed: false, sort_order: index, target_date: null, session_id: null,
      };
    });
    const items = await db.from("focus_plan_items").upsert(rows, { onConflict: "id", ignoreDuplicates: true }).select("*");
    if (items.error) {
      // The bulk INSERT is atomic; remove the empty parent on a confirmed failure.
      // Never delete on a transport error: the INSERT might have committed.
      if (!existing.data && /^[0-9A-Z]{5}$/.test(items.error.code || "")) {
        const cleanup = await db.from("focus_plans").delete().eq("id", planId).eq("user_id", auth.user.id);
        if (cleanup.error) console.error("[task-list-generate] empty list cleanup failed", { code: cleanup.error.code });
      }
      throw items.error;
    }
    // A simultaneous retry may have inserted some of the same deterministic IDs.
    if (items.data?.length !== rows.length) {
      const saved = await db.from("focus_plan_items").select("*").eq("plan_id", planId).eq("user_id", auth.user.id).order("sort_order");
      if (saved.error || !saved.data?.length) throw saved.error || new Error("Save not confirmed");
      return res.status(200).json({ plan: plan.data, items: saved.data });
    }
    return res.status(200).json({ plan: plan.data, items: items.data });
  } catch {
    return res.status(502).json({ error: "Could not generate or save the list. Please retry; your request will not create a duplicate list." });
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const body = getRequestBody(req);

  if (req.method === "POST") {
    if (body?.action === "task-list-generate" || body?.action === "task-list-approve") return handleGenerateTaskList(req, res);
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
