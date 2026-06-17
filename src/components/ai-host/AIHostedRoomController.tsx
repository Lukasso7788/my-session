import { useEffect, useMemo, useRef, useState } from "react";

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
        // ignore browser speech errors
    }
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
        }, 900);

        return () => window.clearTimeout(timer);
    }, [greetingText]);

    const handleSubmit = () => {
        const value = intention.trim();
        if (!value) return;

        setSubmitted(true);
        setExpanded(true);

        const reply = `Got it. I'll keep your intention in mind: ${value}`;
        speak(reply);

        console.log("[AI HOST] intention submitted", {
            sessionId,
            currentUserId,
            intention: value,
        });
    };

    if (!open) return null;

    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[230] flex justify-center px-4">
            <div
                className={[
                    "pointer-events-auto w-full max-w-[720px] transition-all duration-300 ease-out",
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
                                    ? "Intention saved locally for this MVP."
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
                                {greetingText}
                            </div>

                            <div className="mt-3 flex gap-2">
                                <input
                                    value={intention}
                                    onChange={(e) => setIntention(e.target.value)}
                                    onFocus={() => setExpanded(true)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") handleSubmit();
                                    }}
                                    disabled={submitted}
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
                                    onClick={handleSubmit}
                                    disabled={!intention.trim() || submitted}
                                    className="h-12 shrink-0 rounded-2xl bg-violet-600 px-5 text-[14px] font-bold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                    {submitted ? "Saved" : "Start"}
                                </button>
                            </div>

                            <div
                                className={[
                                    "mt-2 text-[12px]",
                                    theme === "light" ? "text-black/40" : "text-white/35",
                                ].join(" ")}
                            >
                                Next step: we’ll save this to IntentionsPanel and duplicate AI messages into chat.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}