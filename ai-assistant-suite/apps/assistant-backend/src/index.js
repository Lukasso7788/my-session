import express from "express";
import cors from "cors";
import multer from "multer";
import OpenAI from "openai";

const app = express();
app.use(cors({ origin: true }));

// ===== ENV CONFIG =====
// PROVIDERS: stub | openai | openrouter
// (DeepSeek через OpenRouter: MODEL="deepseek/deepseek-chat")
const PROVIDER = process.env.AI_PROVIDER || "stub";
const API_KEY = process.env.AI_API_KEY || "";

// Optional OpenRouter "app identity" headers (nice-to-have)
const APP_URL = process.env.AI_APP_URL || "http://localhost";
const APP_TITLE = process.env.AI_APP_TITLE || "Assistant Dev";

// Optional overrides
const BASE_URL = process.env.AI_BASE_URL || "";
const MODEL = process.env.AI_MODEL || "";

// multer handles multipart/form-data
const upload = multer({ storage: multer.memoryStorage() });

app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        provider: PROVIDER,
        model: getModel(),
        baseURL: getBaseURL(),
    });
});

function getBaseURL() {
    if (BASE_URL) return BASE_URL;

    if (PROVIDER === "openrouter") {
        // OpenRouter OpenAI-compatible base URL
        return "https://openrouter.ai/api/v1";
    }

    // OpenAI default
    return "https://api.openai.com/v1";
}

function getModel() {
    if (MODEL) return MODEL;

    // Default suggestions:
    if (PROVIDER === "openrouter") {
        // DeepSeek via OpenRouter:
        // (OpenRouter uses provider/model naming like "deepseek/deepseek-chat") :contentReference[oaicite:1]{index=1}
        return "deepseek/deepseek-chat";
    }

    // OpenAI default
    return "gpt-4o-mini";
}

function getClient() {
    if (!API_KEY) return null;

    const baseURL = getBaseURL();

    // OpenAI SDK supports OpenAI-compatible baseURL
    // OpenRouter also supports optional headers: HTTP-Referer, X-Title :contentReference[oaicite:2]{index=2}
    const defaultHeaders =
        PROVIDER === "openrouter"
            ? {
                "HTTP-Referer": APP_URL,
                "X-Title": APP_TITLE,
            }
            : undefined;

    return new OpenAI({
        apiKey: API_KEY,
        baseURL,
        defaultHeaders,
    });
}

async function runLLM({ text }) {
    if (PROVIDER === "stub") {
        return `✅ STUB LLM\n\nYou said: ${text}`;
    }

    const client = getClient();
    if (!client) {
        return "❌ AI_API_KEY is missing on backend";
    }

    const model = getModel();

    const resp = await client.chat.completions.create({
        model,
        messages: [
            {
                role: "system",
                content:
                    "You are a helpful realtime assistant. Be concise and actionable.",
            },
            { role: "user", content: text || "" },
        ],
        temperature: 0.2,
    });

    return resp.choices?.[0]?.message?.content ?? "(empty)";
}

// Receive context pack
app.post("/api/assistant/send", upload.any(), async (req, res) => {
    try {
        const text = req.body?.text ?? "";
        const explainMode = req.body?.explainMode ?? "";
        const clipCount = Number(req.body?.clipCount ?? "0");

        const files = (req.files ?? []).map((f) => ({
            fieldname: f.fieldname,
            originalname: f.originalname,
            mimetype: f.mimetype,
            sizeKb: Math.round(f.size / 1024),
        }));

        const assistantText = await runLLM({ text });

        res.json({
            ok: true,
            assistantText,
            received: {
                textLen: text.length,
                explainMode,
                clipCount,
                fileCount: files.length,
                files,
            },
        });
    } catch (e) {
        res.status(500).json({
            ok: false,
            error: e?.message || String(e),
        });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`assistant-backend listening on http://localhost:${PORT}`);
    console.log(`provider=${PROVIDER}`);
    console.log(`baseURL=${getBaseURL()}`);
    console.log(`model=${getModel()}`);
});
