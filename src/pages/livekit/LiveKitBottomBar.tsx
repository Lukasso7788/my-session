import React, { useEffect, useRef, useState } from "react";
import { Icon, reactionEmoji, type ReactionType, type RoomTheme } from "./LiveKitUI";

const REACTION_MENU_ITEMS: ReactionType[] = [
    "fire",
    "laugh",
    "thumbsUp",
    "thumbsDown",
    "heart",
    "clap",
    "ok",
    "wave",
    "celebrate",
];

function AIHostIcon({
    isLight,
    className = "w-5 h-5",
}: {
    isLight: boolean;
    className?: string;
}) {
    return (
        <img
            src={isLight ? "/icons/ai-host-light.svg" : "/icons/ai-host-dark.svg"}
            alt="AI Host"
            className={className}
            draggable={false}
        />
    );
}

export function LiveKitBottomBar(props: {
    theme: RoomTheme;
    isLight: boolean;

    bottomBarBg: string;
    ctlBtnBase: string;

    connected: boolean;
    micOn: boolean;
    camOn: boolean;
    screenShareOn: boolean;
    unreadChat?: number;

    showPiP?: boolean;
    pipActive?: boolean;
    onTogglePiP?: () => void;

    showAIHost?: boolean;
    aiHostOpen?: boolean;
    onOpenAIHost?: () => void;

    onToggleMic: () => void;
    onToggleCam: () => void;
    onToggleScreenShare: () => void;
    onLeave: () => void;

    onOpenParticipants: () => void;
    onOpenChat: () => void;
    onOpenIntentions: () => void;
    onOpenSettings: () => void;

    onSendReaction: (type: ReactionType) => void;
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
        unreadChat = 0,

        showPiP = false,
        pipActive = false,
        onTogglePiP,

        showAIHost = false,
        aiHostOpen = false,
        onOpenAIHost,

        onToggleMic,
        onToggleCam,
        onToggleScreenShare,
        onLeave,
        onOpenParticipants,
        onOpenChat,
        onOpenIntentions,
        onOpenSettings,
        onSendReaction,
    } = props;

    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const moreMenuRef = useRef<HTMLDivElement | null>(null);

    const [showReactionsMenu, setShowReactionsMenu] = useState(false);
    const reactionsMenuRef = useRef<HTMLDivElement | null>(null);

    const emitReaction = (type: ReactionType) => {
        onSendReaction(type);
    };

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

    const pipIconTheme: RoomTheme = pipActive
        ? isLight
            ? "dark"
            : "light"
        : theme;

    const aiHostBtnClass =
        "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
        (aiHostOpen
            ? isLight
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-violet-500 hover:bg-violet-600 text-white"
            : ctlBtnBase);

    const chatBtn = (
        <button
            onClick={onOpenChat}
            className={`relative w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
            title="Chat"
            type="button"
        >
            <Icon name="chat" theme={theme} className="w-5 h-5" />
            {unreadChat > 0 && (
                <span
                    className={[
                        "absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center",
                        isLight ? "bg-blue-600 text-white" : "bg-emerald-500 text-[#02140B]",
                    ].join(" ")}
                >
                    {unreadChat > 99 ? "99+" : unreadChat}
                </span>
            )}
        </button>
    );

    const aiHostDesktopBtn =
        showAIHost && onOpenAIHost ? (
            <button
                onClick={onOpenAIHost}
                className={aiHostBtnClass}
                title={aiHostOpen ? "AI Host is open" : "Open AI Host"}
                type="button"
            >
                <AIHostIcon isLight={aiHostOpen ? false : isLight} />
                <span className="sr-only">Open AI Host</span>
            </button>
        ) : null;

    const pipDesktopBtn =
        showPiP && onTogglePiP ? (
            <button
                onClick={onTogglePiP}
                className={
                    "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                    (pipActive
                        ? isLight
                            ? "bg-blue-600 hover:bg-blue-700 text-white"
                            : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                        : ctlBtnBase)
                }
                title={pipActive ? "Close picture-in-picture" : "Open picture-in-picture"}
                type="button"
            >
                <Icon name="pip" theme={pipIconTheme} className="w-5 h-5" />
                <span className="sr-only">
                    {pipActive ? "Close picture-in-picture" : "Open picture-in-picture"}
                </span>
            </button>
        ) : null;

    return (
        <div className="fixed inset-x-0 bottom-0 z-50">
            <div className="w-full px-2 sm:px-4 pb-[calc(8px+env(safe-area-inset-bottom))]">
                <div
                    className={`h-[64px] sm:h-[74px] rounded-2xl shadow-2xl backdrop-blur grid grid-cols-[auto,1fr,auto] items-center px-2 sm:px-4 ${bottomBarBg}`}
                >
                    <div className="flex items-center gap-2" ref={moreMenuRef}>
                        <div className="md:hidden relative">
                            <button
                                onClick={() => setShowMoreMenu((v) => !v)}
                                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                title="Menu"
                                type="button"
                            >
                                <span className={isLight ? "text-black/70" : "text-white/85"}>⋯</span>
                            </button>

                            {showMoreMenu && (
                                <div className="absolute bottom-[76px] sm:bottom-[86px] left-0">
                                    <div
                                        className={`w-[240px] rounded-2xl shadow-2xl overflow-hidden ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"
                                            }`}
                                    >
                                        {showAIHost && onOpenAIHost ? (
                                            <button
                                                onClick={() => {
                                                    onOpenAIHost();
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${aiHostOpen
                                                        ? isLight
                                                            ? "bg-blue-600 text-white"
                                                            : "bg-violet-500 text-white"
                                                        : isLight
                                                            ? "text-black/75 hover:bg-black/5"
                                                            : "text-white/85 hover:bg-white/5"
                                                    }`}
                                                type="button"
                                            >
                                                <AIHostIcon isLight={aiHostOpen ? false : isLight} className="w-4 h-4 opacity-90" />
                                                <span>{aiHostOpen ? "AI Host open" : "Open AI Host"}</span>
                                            </button>
                                        ) : null}

                                        <button
                                            onClick={() => {
                                                onOpenParticipants();
                                                setShowMoreMenu(false);
                                            }}
                                            className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                                                }`}
                                            type="button"
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
                                            type="button"
                                        >
                                            <Icon name="chat" theme={theme} className="w-4 h-4 opacity-90" />
                                            <span>Chat</span>
                                            {unreadChat > 0 ? (
                                                <span
                                                    className={[
                                                        "ml-auto min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center",
                                                        isLight ? "bg-blue-600 text-white" : "bg-emerald-500 text-[#02140B]",
                                                    ].join(" ")}
                                                >
                                                    {unreadChat > 99 ? "99+" : unreadChat}
                                                </span>
                                            ) : null}
                                        </button>

                                        <button
                                            onClick={() => {
                                                onOpenIntentions();
                                                setShowMoreMenu(false);
                                            }}
                                            className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                                                }`}
                                            type="button"
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
                                            type="button"
                                        >
                                            <Icon name="settings" theme={theme} className="w-4 h-4 opacity-90" />
                                            <span>Settings</span>
                                        </button>

                                        {showPiP && onTogglePiP ? (
                                            <button
                                                onClick={() => {
                                                    onTogglePiP();
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${pipActive
                                                        ? isLight
                                                            ? "bg-blue-600 text-white"
                                                            : "bg-emerald-500 text-[#02140B]"
                                                        : isLight
                                                            ? "text-black/75 hover:bg-black/5"
                                                            : "text-white/85 hover:bg-white/5"
                                                    }`}
                                                type="button"
                                            >
                                                <Icon name="pip" theme={pipIconTheme} className="w-4 h-4 opacity-90" />
                                                <span>{pipActive ? "Close PiP" : "Open PiP"}</span>
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="hidden md:flex items-center gap-2">
                            {aiHostDesktopBtn}

                            <button
                                onClick={onOpenParticipants}
                                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                title="Participants"
                                type="button"
                            >
                                <Icon name="participants" theme={theme} className="w-5 h-5" />
                            </button>

                            {chatBtn}

                            <button
                                onClick={onOpenIntentions}
                                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                title="Intentions"
                                type="button"
                            >
                                <Icon name="intentions" theme={theme} className="w-5 h-5" />
                            </button>

                            <button
                                onClick={onOpenSettings}
                                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                title="Settings"
                                type="button"
                            >
                                <Icon name="settings" theme={theme} className="w-5 h-5" />
                            </button>

                            {pipDesktopBtn}
                        </div>
                    </div>

                    <div className="flex items-center justify-center gap-2 sm:gap-3">
                        <button
                            onClick={onToggleMic}
                            disabled={!connected}
                            className={
                                "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition disabled:opacity-50 " +
                                (!micOn ? "bg-red-600 hover:bg-red-700 text-white" : ctlBtnBase)
                            }
                            title="Toggle mic"
                            type="button"
                        >
                            <Icon
                                name={!micOn ? "mic-off" : "mic-on"}
                                theme={!micOn ? "dark" : theme}
                                className="w-5 h-5"
                            />
                        </button>

                        <button
                            onClick={onToggleCam}
                            disabled={!connected}
                            className={
                                "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition disabled:opacity-50 " +
                                (!camOn ? "bg-red-600 hover:bg-red-700 text-white" : ctlBtnBase)
                            }
                            title="Toggle camera"
                            type="button"
                        >
                            <Icon
                                name={!camOn ? "camera-off" : "camera-on"}
                                theme={!camOn ? "dark" : theme}
                                className="w-5 h-5"
                            />
                        </button>

                        <button
                            onClick={onToggleScreenShare}
                            disabled={!connected}
                            className={
                                "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition disabled:opacity-50 " +
                                (screenShareOn ? "bg-blue-600 hover:bg-blue-700 text-white" : ctlBtnBase)
                            }
                            title="Share screen"
                            type="button"
                        >
                            <Icon
                                name="screen-share"
                                theme={screenShareOn ? "dark" : theme}
                                className="w-5 h-5"
                            />
                        </button>

                        <div className="relative" ref={reactionsMenuRef}>
                            <button
                                onClick={() => setShowReactionsMenu((v) => !v)}
                                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                title="Reactions"
                                type="button"
                            >
                                <Icon name="reaction" theme={theme} className="w-5 h-5" />
                            </button>

                            {showReactionsMenu && (
                                <div
                                    className={`absolute bottom-[54px] sm:bottom-[58px] left-1/2 -translate-x-1/2 rounded-2xl px-3 py-2 flex items-center gap-2 text-[26px] shadow-xl whitespace-nowrap ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"
                                        }`}
                                >
                                    {REACTION_MENU_ITEMS.map((t) => (
                                        <button
                                            key={t}
                                            onClick={() => {
                                                emitReaction(t);
                                            }}
                                            className="hover:scale-[1.06] transition"
                                            title={t}
                                            type="button"
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
                            type="button"
                        >
                            <Icon name="leave" theme="dark" className="w-5 h-5" />
                            <span className="text-[14px]">Leave</span>
                        </button>

                        <button
                            onClick={onLeave}
                            className="sm:hidden w-10 h-10 rounded-2xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center"
                            title="Leave"
                            type="button"
                        >
                            <Icon name="leave" theme="dark" className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}