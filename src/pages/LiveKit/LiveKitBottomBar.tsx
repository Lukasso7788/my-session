import React, { useEffect, useRef, useState } from "react";
import { Icon, reactionEmoji, ReactionType, RoomTheme } from "./LiveKitUI";

export function LiveKitBottomBar(props: {
    theme: RoomTheme;
    isLight: boolean;

    bottomBarBg: string;
    ctlBtnBase: string;

    connected: boolean;
    micOn: boolean;
    camOn: boolean;
    screenShareOn: boolean;

    onToggleMic: () => void;
    onToggleCam: () => void;
    onToggleScreenShare: () => void;
    onLeave: () => void;

    onOpenParticipants: () => void;
    onOpenChat: () => void;
    onOpenIntentions: () => void;
    onOpenSettings: () => void;
}) {
    const {
        theme,
        isLight,
        bottomBarBg,
        ctlBtnBase,
        connected,
        micOn,
        camOn,
        screenShareOn,
        onToggleMic,
        onToggleCam,
        onToggleScreenShare,
        onLeave,
        onOpenParticipants,
        onOpenChat,
        onOpenIntentions,
        onOpenSettings,
    } = props;

    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const moreMenuRef = useRef<HTMLDivElement | null>(null);

    const [showReactionsMenu, setShowReactionsMenu] = useState(false);
    const reactionsMenuRef = useRef<HTMLDivElement | null>(null);

    const [localReactions, setLocalReactions] = useState<{ id: number; type: ReactionType }[]>([]);
    const localReactionIdRef = useRef<number>(0);

    const handleSendReaction = (type: ReactionType) => {
        const rid = localReactionIdRef.current + 1;
        localReactionIdRef.current = rid;
        setLocalReactions((prev) => [...prev, { id: rid, type }]);
        setTimeout(() => {
            setLocalReactions((prev) => prev.filter((r) => r.id !== rid));
        }, 1500);
    };

    // click outside: more menu
    useEffect(() => {
        if (!showMoreMenu) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node | null;
            if (!moreMenuRef.current || !t) return;
            if (!moreMenuRef.current.contains(t)) setShowMoreMenu(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [showMoreMenu]);

    // click outside: reactions menu
    useEffect(() => {
        if (!showReactionsMenu) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node | null;
            if (!reactionsMenuRef.current || !t) return;
            if (!reactionsMenuRef.current.contains(t)) setShowReactionsMenu(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [showReactionsMenu]);

    // auto-close more menu when switching to md+
    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const mql = window.matchMedia("(min-width: 768px)");
        const onChange = () => {
            if (mql.matches) setShowMoreMenu(false);
        };
        onChange();
        try {
            mql.addEventListener("change", onChange);
            return () => mql.removeEventListener("change", onChange);
        } catch {
            // @ts-ignore
            mql.addListener(onChange);
            // @ts-ignore
            return () => mql.removeListener(onChange);
        }
    }, []);

    return (
        <>
            {localReactions.length > 0 && (
                <div className="pointer-events-none fixed inset-0 z-40 flex items-end justify-center pb-20 sm:pb-24">
                    <div className="flex items-center gap-2">
                        {localReactions.map((r) => (
                            <div key={r.id} className="text-4xl sm:text-5xl animate-bounce select-none drop-shadow-2xl" style={{ animationDuration: "700ms" }}>
                                {reactionEmoji[r.type]}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="fixed inset-x-0 bottom-0 z-50">
                <div className="w-full px-2 sm:px-4 pb-[calc(8px+env(safe-area-inset-bottom))]">
                    <div className={`h-[64px] sm:h-[74px] rounded-2xl shadow-2xl backdrop-blur grid grid-cols-[auto,1fr,auto] items-center px-2 sm:px-4 ${bottomBarBg}`}>
                        <div className="flex items-center gap-2" ref={moreMenuRef}>
                            <div className="md:hidden relative">
                                <button
                                    onClick={() => setShowMoreMenu((v) => !v)}
                                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                    title="Menu"
                                >
                                    <span className={isLight ? "text-black/70" : "text-white/85"}>⋯</span>
                                </button>

                                {showMoreMenu && (
                                    <div className="absolute bottom-[76px] sm:bottom-[86px] left-0">
                                        <div className={`w-[240px] rounded-2xl shadow-2xl overflow-hidden ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"}`}>
                                            <button
                                                onClick={() => {
                                                    onOpenParticipants();
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                                                    }`}
                                            >
                                                <Icon name="participants" theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Participants</span>
                                            </button>

                                            <button
                                                onClick={() => {
                                                    onOpenChat();
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                                                    }`}
                                            >
                                                <Icon name="chat" theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Chat</span>
                                            </button>

                                            <button
                                                onClick={() => {
                                                    onOpenIntentions();
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                                                    }`}
                                            >
                                                <Icon name="intentions" theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Intentions</span>
                                            </button>

                                            <div className={isLight ? "h-px bg-black/10" : "h-px bg-white/10"} />

                                            <button
                                                onClick={() => {
                                                    onOpenSettings();
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                                                    }`}
                                            >
                                                <Icon name="settings" theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Settings</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="hidden md:flex items-center gap-2">
                                <button onClick={onOpenParticipants} className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`} title="Participants">
                                    <Icon name="participants" theme={theme} className="w-5 h-5" />
                                </button>

                                <button onClick={onOpenChat} className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`} title="Chat">
                                    <Icon name="chat" theme={theme} className="w-5 h-5" />
                                </button>

                                <button onClick={onOpenIntentions} className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`} title="Intentions">
                                    <Icon name="intentions" theme={theme} className="w-5 h-5" />
                                </button>

                                <button onClick={onOpenSettings} className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`} title="Settings">
                                    <Icon name="settings" theme={theme} className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center justify-center gap-2 sm:gap-3">
                            <button
                                onClick={onToggleMic}
                                disabled={!connected}
                                className={
                                    "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition disabled:opacity-50 " +
                                    (!micOn ? "bg-red-600 hover:bg-red-700" : ctlBtnBase)
                                }
                                title="Toggle mic"
                            >
                                <Icon name={!micOn ? "mic-off" : "mic-on"} theme={!micOn ? "dark" : theme} className="w-5 h-5" />
                            </button>

                            <button
                                onClick={onToggleCam}
                                disabled={!connected}
                                className={
                                    "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition disabled:opacity-50 " +
                                    (!camOn ? "bg-red-600 hover:bg-red-700" : ctlBtnBase)
                                }
                                title="Toggle camera"
                            >
                                <Icon name={!camOn ? "camera-off" : "camera-on"} theme={theme} className="w-5 h-5" />
                            </button>

                            <button
                                onClick={onToggleScreenShare}
                                disabled={!connected}
                                className={
                                    "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition disabled:opacity-50 " +
                                    (screenShareOn ? "bg-blue-600 hover:bg-blue-700" : ctlBtnBase)
                                }
                                title="Share screen"
                            >
                                <Icon name="screen-share" theme={theme} className="w-5 h-5" />
                            </button>

                            <div className="relative" ref={reactionsMenuRef}>
                                <button
                                    onClick={() => setShowReactionsMenu((v) => !v)}
                                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                    title="Reactions"
                                >
                                    <Icon name="reaction" theme={theme} className="w-5 h-5" />
                                </button>

                                {showReactionsMenu && (
                                    <div
                                        className={`absolute bottom-[54px] sm:bottom-[58px] left-1/2 -translate-x-1/2 rounded-2xl px-3 py-2 flex gap-2 text-xl shadow-xl ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"
                                            }`}
                                    >
                                        {(["fire", "laugh", "clap", "heart", "thumbsUp", "thumbsDown"] as ReactionType[]).map((t) => (
                                            <button
                                                key={t}
                                                onClick={() => {
                                                    handleSendReaction(t);
                                                    setShowReactionsMenu(false);
                                                }}
                                                className="hover:scale-[1.06] transition"
                                                title={t}
                                            >
                                                {reactionEmoji[t]}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 sm:gap-3">
                            <button
                                onClick={onLeave}
                                className="hidden sm:flex h-11 px-6 rounded-2xl font-semibold items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white"
                                title="Leave"
                            >
                                <Icon name="leave" theme={theme} className="w-5 h-5" />
                                <span className="text-[14px]">Leave</span>
                            </button>

                            <button onClick={onLeave} className="sm:hidden w-10 h-10 rounded-2xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center" title="Leave">
                                <Icon name="leave" theme={theme} className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}