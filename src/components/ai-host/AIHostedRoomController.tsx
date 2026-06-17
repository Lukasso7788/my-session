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

const SESSION_INTENTIONS_TABLE = "intentions";

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
    return [
        stage?.type,
        stage?.name,
        stage?.title,
        stage?.kind,
    ]
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

    const { error } = await supabase.from(args.chatTable).insert({
        session_id: args.sessionId,
        user_id: args.currentUserId,
        body: args.isAi ? `🤖 AI Host: ${text}` : text,
        scope: "room",
    });

    if (error) {
        console.warn("[AI HOST] chat insert failed:", error);
    }
}

function buildLocalAiReply(args: {
    mode: AiMode;
    name: string;
    text: string;
}) {
    if (args.mode === "checkin") {
        return {
            spoken: `Nice check-in, ${args.name}. Pick one small next step and keep going.`,
            privateAdvice: [
                "Do not restart the whole plan.",
                "Choose one concrete next action.",
                "Continue with one short 15-minute block.",
            ],
        };
    }

    return {
        spoken: `Got it, ${args.name}. Start with the first small visible step.`,
        privateAdvice: [
            "Make the first action very small.",
            "Use the first 15-minute block only to start.",
        ],
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
    const [open, setOpen] = useState(true);
    const [closing, setClosing] = useState(false);
    const [minimized, setMinimized] = useState(false);

    const [expanded, setExpanded] = useState(false);
    const [mode, setMode] = useState<AiMode>("intention");
    const [inputText, setInputText] = useState("");
    const [intentionSaved, setIntentionSaved] = useState(false);
    const [checkinActive, setCheckinActive] = useState(false);

    const [saving, setSaving] = useState(false);
    const [errorText, setErrorText] = useState("");
    const [aiReply, setAiReply] = useState("");
    const [privateAdvice, setPrivateAdvice] = useState<string[]>([]);
    const [listening, setListening] = useState(false);
    const [voiceSupported, setVoiceSupported] = useState(false);
    const [voiceHint, setVoiceHint] = useState("");

    const greetedRef = useRef(false);
    const checkinAskedForStageRef = useRef<string>("");
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

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
            return `OK, ${cleanName}, it’s time for check-in. How did it go?`;
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

    useEffect(() => {
        if (!intentionSaved) return;
        if (!isCheckinLikeStage(currentStage)) return;

        const stageKey = getStageText(currentStage) || "checkin";
        if (checkinAskedForStageRef.current === stageKey) return;

        checkinAskedForStageRef.current = stageKey;

        const delayMs = 2500 + Math.floor(Math.random() * 1200);

        const timer = window.setTimeout(() => {
            const prompt = `OK, ${cleanName}, it’s time for check-in. How did it go?`;

            setMode("checkin");
            setInputText("");
            setAiReply("");
            setPrivateAdvice([]);
            setErrorText("");
            setVoiceHint("");
            setCheckinActive(true);
            setMinimized(false);
            setExpanded(true);

            speak(prompt);

            void writeChatMessage({
                chatTable,
                sessionId,
                currentUserId,
                text: prompt,
                isAi: true,
            });
        }, delayMs);

        return () => window.clearTimeout(timer);
    }, [chatTable, cleanName, currentStage, currentUserId, intentionSaved, sessionId]);

    useEffect(() => {
        if (isCheckinLikeStage(currentStage)) return;
        setCheckinActive(false);
    }, [currentStage]);

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
                setVoiceHint(mode === "checkin" ? "Listening… say how it went." : "Listening… say your intention.");
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
        window.setTimeout(() => setOpen(false), 220);
    };

    const handleSubmit = async () => {
        const value = inputText.trim();
        if (!value || saving) return;

        try {
            stopVoiceInput();

            setSaving(true);
            setErrorText("");
            setExpanded(true);
            setMinimized(false);

            const local = buildLocalAiReply({
                mode,
                name: cleanName,
                text: value,
            });

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
            } else {
                await writeAiRoomState({
                    sessionId,
                    currentUserId,
                    checkinCollected: true,
                });

                await writeChatMessage({
                    chatTable,
                    sessionId,
                    currentUserId,
                    text: `${cleanName} check-in: ${value}`,
                    isAi: false,
                });

                setCheckinActive(false);
            }

            setAiReply(local.spoken);
            setPrivateAdvice(local.privateAdvice);

            speak(local.spoken);

            await writeChatMessage({
                chatTable,
                sessionId,
                currentUserId,
                text: local.spoken,
                isAi: true,
            });
        } catch (e: any) {
            console.error("[AI HOST] submit failed:", e);
            setErrorText(String(e?.message || e || "Failed to save."));
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
                "pointer-events-none fixed inset-x-0 bottom-5 z-[230] flex justify-center px-4 transition-all duration-200",
                closing ? "translate-y-3 opacity-0" : "translate-y-0 opacity-100",
            ].join(" ")}
        >
            <div
                className={[
                    "pointer-events-auto w-full max-w-[820px] transition-all duration-300 ease-out",
                    showCompact ? "max-w-[360px]" : "",
                ].join(" ")}
                onMouseEnter={() => !showCompact && setExpanded(true)}
                onMouseLeave={() => {
                    if (!inputText && !intentionSaved && !listening && !checkinActive) setExpanded(false);
                }}
            >
                <div
                    className={[
                        "overflow-hidden border shadow-[0_18px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-all duration-300",
                        showCompact ? "rounded-full px-3 py-2" : "rounded-[28px]",
                        isLight ? "border-black/10 bg-white/92 text-black" : "border-white/12 bg-[#0b1220]/92 text-white",
                        !showCompact && (expanded || inputText || intentionSaved || listening || checkinActive) ? "p-4" : "",
                        !showCompact && !(expanded || inputText || intentionSaved || listening || checkinActive) ? "p-3" : "",
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

                                {listening ? (
                                    <div className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                                        Listening
                                    </div>
                                ) : null}
                            </div>

                            {!showCompact ? (
                                <div
                                    className={[
                                        "mt-0.5 truncate text-[13px]",
                                        isLight ? "text-black/55" : "text-white/55",
                                    ].join(" ")}
                                >
                                    {mode === "checkin"
                                        ? "Tell the AI host how it went."
                                        : intentionSaved
                                            ? "Intention saved. AI host is ready for check-ins."
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
                            aria-label="Close AI host"
                            title="Close"
                        >
                            ×
                        </button>
                    </div>

                    {!showCompact ? (
                        <div
                            className={[
                                "grid transition-all duration-300 ease-out",
                                expanded || inputText || intentionSaved || listening || checkinActive
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
                                        placeholder={mode === "checkin" ? "It went..." : "I’m going to work on..."}
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
                                        title={
                                            voiceSupported
                                                ? listening
                                                    ? "Stop listening"
                                                    : mode === "checkin"
                                                        ? "Say how it went"
                                                        : "Say your intention"
                                                : "Voice input is not supported in this browser"
                                        }
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
                                    <div
                                        className={[
                                            "mt-2 text-[12px]",
                                            listening ? "text-red-300" : isLight ? "text-black/45" : "text-white/40",
                                        ].join(" ")}
                                    >
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

                                <div className={["mt-2 text-[12px]", isLight ? "text-black/40" : "text-white/35"].join(" ")}>
                                    Voice input uses your browser speech recognition. You can edit the text before saving.
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}