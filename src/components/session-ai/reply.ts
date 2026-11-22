export type SessionAiPhase = "intention" | "checkin" | "next";

export type SessionAiPreview = {
  publicSpoken: string;
  privateAdvice: string[];
  source: "openai" | "fallback";
  taskText: string;
};

function firstLine(text: string) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const cut = cleaned.split(/[.!?\n]/)[0]?.trim() || cleaned;
  return cut.slice(0, 180);
}

export function buildLocalAiPreview(args: {
  phase: SessionAiPhase;
  name: string;
  text: string;
}): SessionAiPreview {
  const name = String(args.name || "").trim() || "there";
  const step = firstLine(args.text) || "Start with the smallest visible step.";

  if (args.phase === "checkin") {
    return {
      publicSpoken: `Nice check-in, ${name}. Keep the next block to one small step.`,
      privateAdvice: [
        "Name what actually moved in the last block.",
        "Pick one next action you can start in under two minutes.",
        "Leave the rest of the list for later.",
      ],
      source: "fallback",
      taskText: step,
    };
  }

  if (args.phase === "next") {
    return {
      publicSpoken: `Next step is ready, ${name}. Start there and leave the rest for later.`,
      privateAdvice: [
        step,
        "Do only that step before checking anything else.",
        "If it takes more than 15 minutes, split it again.",
      ],
      source: "fallback",
      taskText: step,
    };
  }

  return {
    publicSpoken: `Got it, ${name}. Start with the first small visible step.`,
    privateAdvice: [
      step,
      "Use the first 15 minutes only to begin.",
    ],
    source: "fallback",
    taskText: step,
  };
}

export async function requestSessionAiPreview(args: {
  phase: SessionAiPhase;
  name: string;
  text: string;
  accessToken?: string;
}): Promise<SessionAiPreview> {
  const local = buildLocalAiPreview(args);
  try {
    const response = await fetch("/api/templates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(args.accessToken ? { Authorization: `Bearer ${args.accessToken}` } : {}),
      },
      body: JSON.stringify({
        action: "ai-host-respond",
        phase: args.phase,
        userName: args.name,
        text: args.text,
      }),
    });
    if (!response.ok) return local;
    const data = await response.json();
    const publicSpoken = String(data?.publicSpoken || "").trim();
    const privateAdvice = Array.isArray(data?.privateAdvice)
      ? data.privateAdvice.map((item: unknown) => String(item || "").trim()).filter(Boolean).slice(0, 3)
      : [];
    if (!publicSpoken && privateAdvice.length === 0) return local;
    return {
      publicSpoken: publicSpoken || local.publicSpoken,
      privateAdvice: privateAdvice.length ? privateAdvice : local.privateAdvice,
      source: data?.source === "openai" ? "openai" : "fallback",
      taskText: privateAdvice[0] || local.taskText,
    };
  } catch {
    return local;
  }
}
