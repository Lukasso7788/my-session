import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

type AiHostStage = {
    name?: string;
    type?: string;
    title?: string;
    kind?: string;
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

type SpeechRecognitionLike = {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    maxAlternatives: number;
    start: () => void;
    stop: () => void;
    abort: () => void;
    onstart: null | (() => void);
    onend: null | (() => void);
    onerror: null | ((event: any) => void);
    onresult: null | ((event: any) => void);
};

type AiMode = "intention" | "checkin";

type AiReply = {
    publicSpoken: string;
    privateAdvice: string[];
    source?: "gemini" | "fallback";
};

const SESSION_INTENTIONS_TABLE = "intentions";
const AI_PREFIX = "🤖 AI Host:";

function getSpeechRecognitionConstructor(): any | null {
    if (typeof window === "undefined") return null;
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

function canUseSpeechRecognition() {
    return !!getSpeechRecognitionConstructor();
}

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

function getStageText(stage: AiHostStage) {
    return [stage?.type, stage?.name, stage?.title, stage?.kind]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
}

function isCheckinLikeStage(stage: AiHostStage) {
    const text = getStageText(stage);

    return (
        text.includes("check") ||
        text.includes("break") ||
        text.includes("intention") ||
        text.includes("recap")
    );
}

function isFreshCheckin(lastCheckinAt: string | null) {
    if (!lastCheckinAt) return false;

    const time = new Date(lastCheckinAt).getTime();
    if (!Number.isFinite(time)) return false;

    return Date.now() - time < 1000 * 60 * 2;
}

async function loadAiRoomState(args: {
    sessionId: string;
    currentUserId: string;
}) {
    const { data, error } = await supabase
        .from("ai_room_participant_state")
        .select("intention_collected,last_intention_at,last_checkin_at")
        .eq("session_id", args.sessionId)
        .eq("user_id", args.currentUserId)
        .maybeSingle();

    if (error) {
        console.warn("[AI HOST] state load failed:", error);
        return null;
    }

    return data as {
        intention_collected?: boolean | null;
        last_intention_at?: string | null;
        last_checkin_at?: string | null;
    } | null;
}

async function writeAiRoomState(args: {
    sessionId: string;
    currentUserId: string;
    intentionCollected?: boolean;
    checkinCollected?: boolean;
}) {
    const nowIso = new Date().toISOString();

    const payload: any = {
        session_id: args.sessionId,
        user_id: args.currentUserId,
        updated_at: nowIso,
    };

    if (args.intentionCollected) {
        payload.intention_collected = true;
        payload.last_intention_at = nowIso;
    }

    if (args.checkinCollected) {
        payload.last_checkin_at = nowIso;
    }

    const { error } = await supabase.from("ai_room_participant_state").upsert(payload, {
        onConflict: "session_id,user_id",
    });

    if (error) {
        console.warn("[AI HOST] ai_room_participant_state upsert failed:", error);
    }
}

async function upsertSessionIntention(args: {
    sessionId: string;
    currentUserId: string;
    text: string;
}) {
    const text = String(args.text || "").trim();
    if (!text) return;

    const { data: existing, error: findError } = await supabase
        .from(SESSION_INTENTIONS_TABLE)
        .select("id")
        .eq("session_id", args.sessionId)
        .eq("user_id", args.currentUserId)
        .order("created_at", { ascending: false })
        .limit(1);

    if (findError) {
        console.warn("[AI HOST] intention lookup failed:", findError);
    }

    const existingId = Array.isArray(existing) ? existing[0]?.id : null;

    if (existingId) {
        const { error } = await supabase
            .from(SESSION_INTENTIONS_TABLE)
            .update({ text, completed: false })
            .eq("id", existingId)
            .eq("session_id", args.sessionId)
            .eq("user_id", args.currentUserId);

        if (error) throw error;
        return;
    }

    const { error } = await supabase.from(SESSION_INTENTIONS_TABLE).insert({
        session_id: args.sessionId,
        user_id: args.currentUserId,
        text,
        completed: false,
    });

    if (error) throw error;
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

    const body = args.isAi ? `${AI_PREFIX} ${text}` : text;

    const { error } = await supabase.from(args.chatTable).insert({
        session_id: args.sessionId,
        user_id: args.currentUserId,
        body: body.slice(0, 1900),
        scope: "general",
    });

    if (error) {
        console.warn("[AI HOST] chat insert failed:", error);
    }
}

function buildLocalAiReply(args: {
    mode: AiMode;
    name: string;
}): AiReply {
    if (args.mode === "checkin") {
        return {
            publicSpoken: `Nice check-in, ${args.name}. Keep going with one small next step.`,
            privateAdvice: [
                "Summarize only the real progress, not the whole story.",
                "Pick one concrete next action for the next block.",
                "Keep the next step small enough to start immediately.",
            ],
            source: "fallback",
        };
    }

    return {
        publicSpoken: `Got it, ${args.name}. Start with the first small visible step.`,
        privateAdvice: [
            "Make the first action very small.",
            "Use the first 15-minute block only to start.",
        ],
        source: "fallback",
    };
}

async function callAiHostGemini(args: {
    mode: AiMode;
    name: string;
    text: string;
}): Promise<AiReply> {
    console.log("[AI HOST] calling /api/templates", args);

    const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "ai-host-respond",
            phase: args.mode,
            userName: args.name,
            text: args.text,
        }),
    });

    console.log("[AI HOST] /api/templates status", res.status);

    if (!res.ok) {
        throw new Error(`AI host failed: ${res.status}`);
    }

    const data = await res.json();

    console.log("[AI HOST] /api/templates response", data);

    return {
        publicSpoken: String(data?.publicSpoken || "").trim(),
        privateAdvice: Array.isArray(data?.privateAdvice)
            ? data.privateAdvice
                .map((x: unknown) => String(x || "").trim())
                .filter(Boolean)
                .slice(0, 3)
            : [],
        source: data?.source === "gemini" ? "gemini" : "fallback",
    };
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
    const [open] = useState(true);
    const [closing, setClosing] = useState(false);
    const [minimized, setMinimized] = useState(false);
    const [hydrated, setHydrated] = useState(false);

    const [expanded, setExpanded] = useState(false);
    const [mode, setMode] = useState<AiMode>("intention");
    const [inputText, setInputText] = useState("");
    const [intentionSaved, setIntentionSaved] = useState(false);
    const [checkinActive, setCheckinActive] = useState(false);

    const [saving, setSaving] = useState(false);
    const [errorText, setErrorText] = useState("");
    const [aiReply, setAiReply] = useState("");
    const [privateAdvice, setPrivateAdvice] = useState<string[]>([]);
    const [replySource, setReplySource] = useState<"gemini" | "fallback" | "">("");
    const [listening, setListening] = useState(false);
    const [voiceSupported, setVoiceSupported] = useState(false);
    const [voiceHint, setVoiceHint] = useState("");

    const greetedRef = useRef(false);
    const checkinAskedRef = useRef(false);
    const lastCheckinAtRef = useRef<string | null>(null);
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const spokenBodiesRef = useRef<Set<string>>(new Set());

    const cleanName = useMemo(() => {
        const name = String(currentUserName || "").trim();
        if (!name || name.toLowerCase() === "there") return "there";
        return name.split(/\s+/)[0] || "there";
    }, [currentUserName]);

    const greetingText = useMemo(() => {
        return `Hi ${cleanName}. Welcome to the AI-hosted focus room. What are you going to work on now?`;
    }, [cleanName]);

    const currentPrompt = useMemo(() => {
        if (mode === "checkin") {
            return `Summarize your progress for the previous block, ${cleanName}. How did it go?`;
        }

        return aiReply || greetingText;
    }, [aiReply, cleanName, greetingText, mode]);

    useEffect(() => {
        setVoiceSupported(canUseSpeechRecognition());

        console.log("[AI HOST] mounted", {
            sessionId,
            currentUserId,
            currentUserName,
            tilesCount: tiles.length,
            currentStage,
            chatTable,
            theme,
            voiceSupported: canUseSpeechRecognition(),
        });

        return () => {
            try {
                recognitionRef.current?.abort();
            } catch {
                // ignore
            }

            console.log("[AI HOST] unmounted", { sessionId });
        };
    }, [sessionId, currentUserId, currentUserName, tiles.length, currentStage, chatTable, theme]);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            const state = await loadAiRoomState({ sessionId, currentUserId });
            if (cancelled) return;

            const collected = Boolean(state?.intention_collected);
            const lastCheckinAt = state?.last_checkin_at || null;

            lastCheckinAtRef.current = lastCheckinAt;
            setIntentionSaved(collected);

            if (collected) {
                greetedRef.current = true;
                setMinimized(true);
                setExpanded(false);
                setMode("intention");
                setAiReply("Your intention is already saved. I’ll ask for a progress summary during check-in.");
            }

            setHydrated(true);
        })();

        return () => {
            cancelled = true;
        };
    }, [currentUserId, sessionId]);

    useEffect(() => {
        if (!hydrated) return;
        if (greetedRef.current) return;
        if (intentionSaved) return;

        greetedRef.current = true;

        const timer = window.setTimeout(() => {
            speak(greetingText);

            const body = `${AI_PREFIX} ${greetingText}`;
            spokenBodiesRef.current.add(body);

            void writeChatMessage({
                chatTable,
                sessionId,
                currentUserId,
                text: greetingText,
                isAi: true,
            });
        }, 900);

        return () => window.clearTimeout(timer);
    }, [chatTable, currentUserId, greetingText, hydrated, intentionSaved, sessionId]);

    useEffect(() => {
        const channel = supabase
            .channel(`ai_host_voice_${sessionId}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: chatTable,
                    filter: `session_id=eq.${sessionId}`,
                },
                (payload: any) => {
                    const body = String(payload?.new?.body || "").trim();
                    if (!body.startsWith(AI_PREFIX)) return;

                    if (spokenBodiesRef.current.has(body)) return;
                    spokenBodiesRef.current.add(body);

                    const spoken = body.replace(AI_PREFIX, "").trim();
                    if (spoken) speak(spoken);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [chatTable, sessionId]);

    useEffect(() => {
        if (!hydrated) return;
        if (!intentionSaved) return;

        const isCheckin = isCheckinLikeStage(currentStage);

        if (!isCheckin) {
            checkinAskedRef.current = false;
            setCheckinActive(false);
            return;
        }

        if (checkinAskedRef.current) return;
        if (isFreshCheckin(lastCheckinAtRef.current)) return;

        checkinAskedRef.current = true;

        const delayMs = 2500 + Math.floor(Math.random() * 1200);

        const timer = window.setTimeout(() => {
            const prompt = `Summarize your progress for the previous block, ${cleanName}. How did it go?`;

            setMode("checkin");
            setInputText("");
            setAiReply("");
            setPrivateAdvice([]);
            setReplySource("");
            setErrorText("");
            setVoiceHint("");
            setCheckinActive(true);
            setMinimized(false);
            setExpanded(true);

            speak(prompt);

            const body = `${AI_PREFIX} ${prompt}`;
            spokenBodiesRef.current.add(body);

            void writeChatMessage({
                chatTable,
                sessionId,
                currentUserId,
                text: prompt,
                isAi: true,
            });
        }, delayMs);

        return () => window.clearTimeout(timer);
    }, [chatTable, cleanName, currentStage, currentUserId, hydrated, intentionSaved, sessionId]);

    const startVoiceInput = () => {
        if (saving || listening) return;

        const SpeechRecognitionConstructor = getSpeechRecognitionConstructor();

        if (!SpeechRecognitionConstructor) {
            setVoiceHint("Voice input is not supported in this browser. Try Chrome or Edge.");
            setExpanded(true);
            setMinimized(false);
            return;
        }

        try {
            window.speechSynthesis?.cancel?.();

            const recognition = new SpeechRecognitionConstructor() as SpeechRecognitionLike;
            recognition.lang = "en-US";
            recognition.interimResults = true;
            recognition.continuous = false;
            recognition.maxAlternatives = 1;

            recognition.onstart = () => {
                setListening(true);
                setExpanded(true);
                setMinimized(false);
                setVoiceHint(
                    mode === "checkin"
                        ? "Listening… summarize your progress."
                        : "Listening… say your intention."
                );
            };

            recognition.onerror = (event: any) => {
                console.warn("[AI HOST] speech recognition error:", event);
                setListening(false);

                const code = String(event?.error || "").trim();
                if (code === "not-allowed" || code === "service-not-allowed") {
                    setVoiceHint("Microphone permission was blocked. Allow mic access and try again.");
                } else if (code === "no-speech") {
                    setVoiceHint("I did not catch anything. Try again or type it.");
                } else {
                    setVoiceHint("Voice input failed. Try again or type it.");
                }
            };

            recognition.onend = () => {
                setListening(false);
            };

            recognition.onresult = (event: any) => {
                let finalText = "";
                let interimText = "";

                for (let i = event.resultIndex; i < event.results.length; i += 1) {
                    const result = event.results[i];
                    const transcript = String(result?.[0]?.transcript || "").trim();

                    if (!transcript) continue;

                    if (result.isFinal) finalText += `${transcript} `;
                    else interimText += `${transcript} `;
                }

                const nextText = `${finalText || interimText}`.trim();

                if (nextText) {
                    setInputText(nextText);
                }

                if (finalText.trim()) {
                    setVoiceHint(mode === "checkin" ? "Got it. Press Save check-in." : "Got it. Press Start.");
                }
            };

            recognitionRef.current = recognition;
            recognition.start();
        } catch (e: any) {
            console.error("[AI HOST] start voice input failed:", e);
            setListening(false);
            setVoiceHint(String(e?.message || "Could not start voice input."));
        }
    };

    const stopVoiceInput = () => {
        try {
            recognitionRef.current?.stop();
        } catch {
            // ignore
        }

        setListening(false);
        setVoiceHint((prev) => prev || "Stopped listening.");
    };

    const handleClose = () => {
        setClosing(true);

        window.setTimeout(() => {
            setClosing(false);
            setMinimized(true);
            setExpanded(false);
        }, 220);
    };

    const handleSubmit = async () => {
        const value = inputText.trim();

        console.log("[AI HOST] submit clicked", { mode, value, saving });

        if (!value || saving) return;

        try {
            stopVoiceInput();

            setSaving(true);
            setErrorText("");
            setExpanded(true);
            setMinimized(false);

            let reply = buildLocalAiReply({
                mode,
                name: cleanName,
            });

            try {
                console.log("[AI HOST] calling Gemini", { mode, value });

                const gemini = await callAiHostGemini({
                    mode,
                    name: cleanName,
                    text: value,
                });

                console.log("[AI HOST] Gemini response", gemini);

                if (gemini.publicSpoken) {
                    reply = {
                        publicSpoken: gemini.publicSpoken,
                        privateAdvice: gemini.privateAdvice.length ? gemini.privateAdvice : reply.privateAdvice,
                        source: gemini.source,
                    };
                }
            } catch (e) {
                console.warn("[AI HOST] Gemini fallback:", e);
            }

            if (mode === "intention") {
                await writeAiRoomState({
                    sessionId,
                    currentUserId,
                    intentionCollected: true,
                });

                await upsertSessionIntention({
                    sessionId,
                    currentUserId,
                    text: value,
                });

                await writeChatMessage({
                    chatTable,
                    sessionId,
                    currentUserId,
                    text: `${cleanName} is working on: ${value}`,
                    isAi: false,
                });

                setIntentionSaved(true);
                setInputText("");
            } else {
                await writeAiRoomState({
                    sessionId,
                    currentUserId,
                    checkinCollected: true,
                });

                lastCheckinAtRef.current = new Date().toISOString();

                await writeChatMessage({
                    chatTable,
                    sessionId,
                    currentUserId,
                    text: `${cleanName} progress summary: ${value}`,
                    isAi: false,
                });

                setCheckinActive(false);
                setInputText("");
            }

            setAiReply(reply.publicSpoken);
            setPrivateAdvice(reply.privateAdvice);
            setReplySource(reply.source || "fallback");
            setMinimized(false);
            setExpanded(true);

            speak(reply.publicSpoken);

            const body = `${AI_PREFIX} ${reply.publicSpoken}`;
            spokenBodiesRef.current.add(body);

            await writeChatMessage({
                chatTable,
                sessionId,
                currentUserId,
                text: reply.publicSpoken,
                isAi: true,
            });
        } catch (e: any) {
            console.error("[AI HOST] submit failed:", e);
            setErrorText(String(e?.message || e || "Failed to save."));
            setMinimized(false);
            setExpanded(true);
        } finally {
            setSaving(false);
        }
    };

    if (!open) return null;

    const isLight = theme === "light";
    const showCompact = minimized;

    return (
        <div
            className={[
                "pointer-events-none fixed inset-x-0 bottom-[92px] z-[230] flex justify-center px-4 transition-all duration-200",
                closing ? "translate-y-3 opacity-0" : "translate-y-0 opacity-100",
            ].join(" ")}
        >
            <div
                className={[
                    "pointer-events-auto w-full transition-all duration-300 ease-out",
                    showCompact ? "max-w-[360px]" : "max-w-[820px]",
                ].join(" ")}
                onMouseEnter={() => !showCompact && setExpanded(true)}
                onMouseLeave={() => {
                    if (!inputText && !intentionSaved && !listening && !checkinActive && !privateAdvice.length) {
                        setExpanded(false);
                    }
                }}
            >
                <div
                    className={[
                        "overflow-hidden border shadow-[0_18px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-all duration-300",
                        showCompact ? "rounded-full px-3 py-2" : "rounded-[28px]",
                        isLight ? "border-black/10 bg-white/92 text-black" : "border-white/12 bg-[#0b1220]/92 text-white",
                        !showCompact && (expanded || inputText || intentionSaved || listening || checkinActive || privateAdvice.length) ? "p-4" : "",
                        !showCompact && !(expanded || inputText || intentionSaved || listening || checkinActive || privateAdvice.length) ? "p-3" : "",
                    ].join(" ")}
                >
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => {
                                setMinimized(false);
                                setExpanded(true);
                            }}
                            className={[
                                "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[22px] transition",
                                listening ? "bg-red-500/20" : "bg-violet-500/15",
                            ].join(" ")}
                            title="Open AI host"
                        >
                            {listening ? "🎙️" : "🤖"}
                        </button>

                        <div
                            className="min-w-0 flex-1 cursor-pointer"
                            onClick={() => {
                                setMinimized(false);
                                setExpanded(true);
                            }}
                        >
                            <div className="flex items-center gap-2">
                                <div className="truncate text-[13px] font-bold">MySession AI Host</div>

                                <div
                                    className={[
                                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                        isLight ? "bg-violet-50 text-violet-700" : "bg-violet-400/15 text-violet-200",
                                    ].join(" ")}
                                >
                                    {mode === "checkin" ? "Check-in" : "15/3"}
                                </div>

                                {replySource ? (
                                    <div
                                        className={[
                                            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                            replySource === "gemini"
                                                ? "bg-emerald-500/15 text-emerald-300"
                                                : "bg-yellow-500/15 text-yellow-300",
                                        ].join(" ")}
                                    >
                                        {replySource}
                                    </div>
                                ) : null}

                                {listening ? (
                                    <div className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                                        Listening
                                    </div>
                                ) : null}
                            </div>

                            {!showCompact ? (
                                <div className={["mt-0.5 truncate text-[13px]", isLight ? "text-black/55" : "text-white/55"].join(" ")}>
                                    {mode === "checkin"
                                        ? "Summarize your progress for the previous block."
                                        : intentionSaved
                                            ? "Intention saved. I’ll ask for progress summaries during check-ins."
                                            : listening
                                                ? "Say what you’re going to work on."
                                                : "Type or say what you’re working on."}
                                </div>
                            ) : null}
                        </div>

                        {!showCompact ? (
                            <button
                                type="button"
                                onClick={() => setMinimized(true)}
                                className={[
                                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[16px] transition",
                                    isLight ? "text-black/45 hover:bg-black/5 hover:text-black" : "text-white/45 hover:bg-white/10 hover:text-white",
                                ].join(" ")}
                                aria-label="Collapse AI host"
                                title="Collapse"
                            >
                                —
                            </button>
                        ) : null}

                        <button
                            type="button"
                            onClick={handleClose}
                            className={[
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[16px] transition",
                                isLight ? "text-black/45 hover:bg-black/5 hover:text-black" : "text-white/45 hover:bg-white/10 hover:text-white",
                            ].join(" ")}
                            aria-label="Hide AI host"
                            title="Hide"
                        >
                            ×
                        </button>
                    </div>

                    {!showCompact ? (
                        <div
                            className={[
                                "grid transition-all duration-300 ease-out",
                                expanded || inputText || !intentionSaved || listening || checkinActive || privateAdvice.length
                                    ? "grid-rows-[1fr] opacity-100"
                                    : "grid-rows-[0fr] opacity-0",
                            ].join(" ")}
                        >
                            <div className="min-h-0 overflow-hidden">
                                <div
                                    className={[
                                        "mt-4 rounded-2xl px-4 py-3 text-[14px] leading-6",
                                        isLight ? "bg-black/[0.035] text-black/70" : "bg-white/[0.06] text-white/75",
                                    ].join(" ")}
                                >
                                    {currentPrompt}
                                </div>

                                <div className="mt-3 flex gap-2">
                                    <input
                                        value={inputText}
                                        onChange={(e) => setInputText(e.target.value)}
                                        onFocus={() => setExpanded(true)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") void handleSubmit();
                                        }}
                                        disabled={saving}
                                        placeholder={mode === "checkin" ? "Progress summary for the last block..." : "I’m going to work on..."}
                                        className={[
                                            "h-12 min-w-0 flex-1 rounded-2xl border px-4 text-[14px] outline-none transition",
                                            isLight
                                                ? "border-black/10 bg-white text-black placeholder:text-black/35 focus:ring-2 focus:ring-violet-500/20"
                                                : "border-white/10 bg-white/[0.07] text-white placeholder:text-white/35 focus:ring-2 focus:ring-violet-300/20",
                                        ].join(" ")}
                                    />

                                    <button
                                        type="button"
                                        onClick={listening ? stopVoiceInput : startVoiceInput}
                                        disabled={saving || !voiceSupported}
                                        className={[
                                            "h-12 shrink-0 rounded-2xl px-4 text-[15px] font-bold transition disabled:cursor-not-allowed disabled:opacity-45",
                                            listening
                                                ? "bg-red-600 text-white hover:bg-red-700"
                                                : isLight
                                                    ? "border border-black/10 bg-white text-black hover:bg-black/[0.04]"
                                                    : "border border-white/10 bg-white/[0.08] text-white hover:bg-white/[0.12]",
                                        ].join(" ")}
                                    >
                                        {listening ? "Stop" : "🎙️"}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => void handleSubmit()}
                                        disabled={!inputText.trim() || saving}
                                        className="h-12 shrink-0 rounded-2xl bg-violet-600 px-5 text-[14px] font-bold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-45"
                                    >
                                        {saving ? "Saving..." : mode === "checkin" ? "Save check-in" : "Start"}
                                    </button>
                                </div>

                                {voiceHint ? (
                                    <div className={["mt-2 text-[12px]", listening ? "text-red-300" : isLight ? "text-black/45" : "text-white/40"].join(" ")}>
                                        {voiceHint}
                                    </div>
                                ) : null}

                                {privateAdvice.length ? (
                                    <div
                                        className={[
                                            "mt-3 rounded-2xl border px-4 py-3",
                                            isLight
                                                ? "border-violet-100 bg-violet-50 text-violet-950"
                                                : "border-violet-300/15 bg-violet-400/10 text-violet-100",
                                        ].join(" ")}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="text-[12px] font-bold uppercase tracking-[0.12em] opacity-70">
                                                Private suggestion
                                            </div>

                                            {replySource ? (
                                                <div className="text-[11px] opacity-60">
                                                    source: {replySource}
                                                </div>
                                            ) : null}
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

                                <div className={["mt-2 text-[12px]", isLight ? "text-black/40" : "text-white/35"].join(" ")}>
                                    Public AI messages are spoken for everyone through room chat. Private suggestions stay visible only here.
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}