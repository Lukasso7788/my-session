import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

type AiHostStage = {
    name?: string;
    type?: string;
} | null;

type AiHostTile = {
    id: string;
    label?: string;
    isLocal?: boolean;
    participantUserId?: string;
    participantIdentity?: string;
};

type Props = {
    sessionId: string;
    currentUserId: string;
    currentUserName: string;
    tiles?: AiHostTile[];
    currentStage?: AiHostStage;
    chatTable?: string;
    theme?: string;
};

type AiHostApiResponse = {
    spoken?: string;
    privateAdvice?: string[];
    source?: "gemini" | "fallback";
};

function speak(text: string) {
    if (typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) return;

    try {
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        utterance.rate = 0.95;
        utterance.pitch = 1;

        window.speechSynthesis.speak(utterance);
    } catch {
        // ignore
    }
}

async function writeAiRoomState(args: {
    sessionId: string;
    currentUserId: string;
}) {
    const nowIso = new Date().toISOString();

    const { error } = await supabase.from("ai_room_participant_state").upsert(
        {
            session_id: args.sessionId,
            user_id: args.currentUserId,
            intention_collected: true,
            last_intention_at: nowIso,
            updated_at: nowIso,
        },
        {
            onConflict: "session_id,user_id",
        }
    );

    if (error) {
        console.warn("[AI HOST] ai_room_participant_state upsert failed:", error);
    }
}

async function writeChatMessage(args: {
    chatTable: string;
    sessionId: string;
    currentUserId: string;
    text: string;
    isAi?: boolean;
}) {
    const text = String(args.text || "").trim();
    if (!text) return;

    const nowIso = new Date().toISOString();
    const prefix = args.isAi ? "🤖 AI Host: " : "";

    const variants = [
        {
            session_id: args.sessionId,
            user_id: args.currentUserId,
            message: `${prefix}${text}`,
            created_at: nowIso,
        },
        {
            session_id: args.sessionId,
            user_id: args.currentUserId,
            content: `${prefix}${text}`,
            created_at: nowIso,
        },
        {
            session_id: args.sessionId,
            user_id: args.currentUserId,
            text: `${prefix}${text}`,
            created_at: nowIso,
        },
    ];

    for (const payload of variants) {
        const { error } = await supabase.from(args.chatTable).insert(payload as any);
        if (!error) return;

        console.warn("[AI HOST] chat insert variant failed:", {
            payload,
            error,
        });
    }
}

async function callAiHostRespond(args: {
    phase: "intention" | "checkin";
    userName: string;
    intention: string;
    answer?: string;
    sessionTitle?: string;
}): Promise<AiHostApiResponse> {
    const res = await fetch("/api/ai-host/respond", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
    });

    if (!res.ok) {
        throw new Error(`AI host API failed: ${res.status}`);
    }

    return (await res.json()) as AiHostApiResponse;
}

export default function AIHostedRoomController({
    sessionId,
    currentUserId,
    currentUserName,
    tiles = [],
    currentStage = null,
    chatTable = "session_chat_messages",
    theme = "dark",
}: Props) {
    const [open, setOpen] = useState(true);
    const [expanded, setExpanded] = useState(false);
    const [intention, setIntention] = useState("");
    const [submitted, setSubmitted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [errorText, setErrorText] = useState("");
    const [aiReply, setAiReply] = useState("");
    const [privateAdvice, setPrivateAdvice] = useState<string[]>([]);

    const greetedRef = useRef(false);

    const cleanName = useMemo(() => {
        const name = String(currentUserName || "").trim();
        if (!name || name.toLowerCase() === "there") return "there";
        return name.split(/\s+/)[0] || "there";
    }, [currentUserName]);

    const greetingText = useMemo(() => {
        return `Hi ${cleanName}. Welcome to the AI-hosted focus room. What are you going to work on now?`;
    }, [cleanName]);

    useEffect(() => {
        console.log("[AI HOST] mounted", {
            sessionId,
            currentUserId,
            currentUserName,
            tilesCount: tiles.length,
            currentStage,
            chatTable,
            theme,
        });

        return () => {
            console.log("[AI HOST] unmounted", { sessionId });
        };
    }, [sessionId, currentUserId, currentUserName, tiles.length, currentStage, chatTable, theme]);

    useEffect(() => {
        if (greetedRef.current) return;
        greetedRef.current = true;

        const timer = window.setTimeout(() => {
            speak(greetingText);

            void writeChatMessage({
                chatTable,
                sessionId,
                currentUserId,
                text: greetingText,
                isAi: true,
            });
        }, 900);

        return () => window.clearTimeout(timer);
    }, [chatTable, currentUserId, greetingText, sessionId]);

    const handleSubmit = async () => {
        const value = intention.trim();
        if (!value || saving || submitted) return;

        try {
            setSaving(true);
            setErrorText("");
            setExpanded(true);

            await writeAiRoomState({
                sessionId,
                currentUserId,
            });

            await writeChatMessage({
                chatTable,
                sessionId,
                currentUserId,
                text: `${cleanName} is working on: ${value}`,
                isAi: false,
            });

            const response = await callAiHostRespond({
                phase: "intention",
                userName: cleanName,
                intention: value,
                sessionTitle: "🤖✨ 15/3 AI Focus Room - 24/7",
            });

            const spoken =
                String(response.spoken || "").trim() ||
                `Got it, ${cleanName}. Start with the first small step.`;

            const advice = Array.isArray(response.privateAdvice)
                ? response.privateAdvice.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 3)
                : [];

            setAiReply(spoken);
            setPrivateAdvice(advice);
            setSubmitted(true);

            speak(spoken);

            await writeChatMessage({
                chatTable,
                sessionId,
                currentUserId,
                text: spoken,
                isAi: true,
            });
        } catch (e: any) {
            console.error("[AI HOST] submit failed:", e);
            setErrorText(String(e?.message || e || "Failed to save intention."));
        } finally {
            setSaving(false);
        }
    };

    if (!open) return null;

    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[230] flex justify-center px-4">
            <div
                className={[
                    "pointer-events-auto w-full max-w-[760px] transition-all duration-300 ease-out",
                    expanded || intention || submitted
                        ? "translate-y-0 opacity-100"
                        : "translate-y-1 opacity-95",
                ].join(" ")}
                onMouseEnter={() => setExpanded(true)}
                onMouseLeave={() => {
                    if (!intention && !submitted) setExpanded(false);
                }}
            >
                <div
                    className={[
                        "overflow-hidden rounded-[28px] border shadow-[0_18px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-all duration-300",
                        theme === "light"
                            ? "border-black/10 bg-white/92 text-black"
                            : "border-white/12 bg-[#0b1220]/92 text-white",
                        expanded || intention || submitted ? "p-4" : "p-3",
                    ].join(" ")}
                >
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-[22px]">
                            🤖
                        </div>

                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <div className="truncate text-[13px] font-bold">
                                    MySession AI Host
                                </div>

                                <div
                                    className={[
                                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                        theme === "light"
                                            ? "bg-violet-50 text-violet-700"
                                            : "bg-violet-400/15 text-violet-200",
                                    ].join(" ")}
                                >
                                    15/3
                                </div>
                            </div>

                            <div
                                className={[
                                    "mt-0.5 truncate text-[13px]",
                                    theme === "light" ? "text-black/55" : "text-white/55",
                                ].join(" ")}
                            >
                                {submitted
                                    ? "Intention saved. AI host is ready for check-ins."
                                    : "Tell me what you’re working on."}
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className={[
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[16px] transition",
                                theme === "light"
                                    ? "text-black/45 hover:bg-black/5 hover:text-black"
                                    : "text-white/45 hover:bg-white/10 hover:text-white",
                            ].join(" ")}
                            aria-label="Close AI host"
                        >
                            ×
                        </button>
                    </div>

                    <div
                        className={[
                            "grid transition-all duration-300 ease-out",
                            expanded || intention || submitted
                                ? "grid-rows-[1fr] opacity-100"
                                : "grid-rows-[0fr] opacity-0",
                        ].join(" ")}
                    >
                        <div className="min-h-0 overflow-hidden">
                            <div
                                className={[
                                    "mt-4 rounded-2xl px-4 py-3 text-[14px] leading-6",
                                    theme === "light"
                                        ? "bg-black/[0.035] text-black/70"
                                        : "bg-white/[0.06] text-white/75",
                                ].join(" ")}
                            >
                                {aiReply || greetingText}
                            </div>

                            <div className="mt-3 flex gap-2">
                                <input
                                    value={intention}
                                    onChange={(e) => setIntention(e.target.value)}
                                    onFocus={() => setExpanded(true)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") void handleSubmit();
                                    }}
                                    disabled={submitted || saving}
                                    placeholder="I’m going to work on..."
                                    className={[
                                        "h-12 min-w-0 flex-1 rounded-2xl border px-4 text-[14px] outline-none transition",
                                        theme === "light"
                                            ? "border-black/10 bg-white text-black placeholder:text-black/35 focus:ring-2 focus:ring-violet-500/20"
                                            : "border-white/10 bg-white/[0.07] text-white placeholder:text-white/35 focus:ring-2 focus:ring-violet-300/20",
                                        submitted ? "opacity-70" : "",
                                    ].join(" ")}
                                />

                                <button
                                    type="button"
                                    onClick={() => void handleSubmit()}
                                    disabled={!intention.trim() || submitted || saving}
                                    className="h-12 shrink-0 rounded-2xl bg-violet-600 px-5 text-[14px] font-bold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                    {saving ? "Saving..." : submitted ? "Saved" : "Start"}
                                </button>
                            </div>

                            {privateAdvice.length ? (
                                <div
                                    className={[
                                        "mt-3 rounded-2xl border px-4 py-3",
                                        theme === "light"
                                            ? "border-violet-100 bg-violet-50 text-violet-950"
                                            : "border-violet-300/15 bg-violet-400/10 text-violet-100",
                                    ].join(" ")}
                                >
                                    <div className="text-[12px] font-bold uppercase tracking-[0.12em] opacity-70">
                                        Private suggestion
                                    </div>

                                    <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-5">
                                        {privateAdvice.map((item, index) => (
                                            <li key={`${item}-${index}`}>{item}</li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}

                            {errorText ? (
                                <div className="mt-3 rounded-2xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">
                                    {errorText}
                                </div>
                            ) : null}

                            <div
                                className={[
                                    "mt-2 text-[12px]",
                                    theme === "light" ? "text-black/40" : "text-white/35",
                                ].join(" ")}
                            >
                                This saves AI-room state, writes to chat, and calls the AI host endpoint.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}