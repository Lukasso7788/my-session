import React, { useEffect, useRef, useState } from "react";
import { AudioLines, ChevronUp, ImagePlus, Sparkles } from "lucide-react";
import {
    Icon,
    reactionEmoji,
    type ReactionType,
    type RoomTheme,
} from "./LiveKitUI";

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
    "clover",
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

function LayoutIcon({
    isLight,
    className = "w-5 h-5",
}: {
    isLight: boolean;
    className?: string;
}) {
    return (
        <img
            src={isLight ? "/icons/layout-light.svg" : "/icons/layout-dark.svg"}
            alt="Layout"
            className={className}
            draggable={false}
        />
    );
}

function BugReportIcon({
    isLight,
    className = "w-5 h-5",
}: {
    isLight: boolean;
    className?: string;
}) {
    return (
        <img
            src={
                isLight
                    ? "/icons/bug-report-light.svg"
                    : "/icons/bug-report-dark.svg"
            }
            alt="Report a problem"
            className={className}
            draggable={false}
        />
    );
}

function SoundscapeIcon({
    isLight,
    active = false,
    className = "w-5 h-5",
}: {
    isLight: boolean;
    active?: boolean;
    className?: string;
}) {
    const iconIsLight = active ? false : isLight;
    return (
        <img
            src={iconIsLight ? "/icons/soundscape-light.svg" : "/icons/soundscape-dark.svg"}
            alt=""
            className={`${className} object-contain`}
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
    voiceUiMode?: "off" | "always" | "hotkey";
    unreadChat?: number;

    showPiP?: boolean;
    pipActive?: boolean;
    onTogglePiP?: () => void;

    showAIHost?: boolean;
    aiHostOpen?: boolean;
    onOpenAIHost?: () => void;

    showLayoutControls?: boolean;
    onOpenLayoutControls?: () => void;

    soundscapeActive?: boolean;
    onOpenSoundscapes?: () => void;

    onToggleMic: () => void;
    onToggleCam: () => void;
    audioInputs?: MediaDeviceInfo[];
    videoInputs?: MediaDeviceInfo[];
    selectedAudioInputId?: string;
    selectedVideoInputId?: string;
    onChangeAudioInput?: (deviceId: string) => void | Promise<void>;
    onChangeVideoInput?: (deviceId: string) => void | Promise<void>;
    videoFxMode?: "off" | "blur" | "bg";
    blurStrength?: number;
    onBlurStrengthChange?: (strength: number) => void;
    backgroundPresets?: Array<{ id: string; label: string; url: string }>;
    selectedBackgroundUrl?: string;
    backgroundFxDisabled?: boolean;
    onApplyVideoFx?: (mode: "off" | "blur" | "bg", backgroundUrl?: string, blurStrength?: number) => void | Promise<void>;
    onUploadBackground?: (file: File) => void | Promise<void>;
    onToggleScreenShare: () => void;
    onToggleVoiceUi?: () => void;
    onLeave: () => void;

    onOpenParticipants: () => void;
    onOpenChat: () => void;
    onOpenTasks: () => void;
    onOpenSettings: () => void;

    onOpenBugReport?: () => void;

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
        voiceUiMode = "off",
        unreadChat = 0,

        showPiP = false,
        pipActive = false,
        onTogglePiP,

        showAIHost = false,
        aiHostOpen = false,
        onOpenAIHost,

        showLayoutControls = true,
        onOpenLayoutControls,

        soundscapeActive = false,
        onOpenSoundscapes,

        onToggleMic,
        onToggleCam,
        audioInputs = [],
        videoInputs = [],
        selectedAudioInputId = "",
        selectedVideoInputId = "",
        onChangeAudioInput,
        onChangeVideoInput,
        videoFxMode = "off",
        blurStrength = 12,
        onBlurStrengthChange,
        backgroundPresets = [],
        selectedBackgroundUrl = "",
        backgroundFxDisabled = false,
        onApplyVideoFx,
        onUploadBackground,
        onToggleScreenShare,
        onToggleVoiceUi,
        onLeave,
        onOpenParticipants,
        onOpenChat,
        onOpenTasks,
        onOpenSettings,
        onOpenBugReport,
        onSendReaction,
    } = props;

    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const [blurDraft, setBlurDraft] = useState(blurStrength);
    const moreMenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => setBlurDraft(blurStrength), [blurStrength]);

    const [showReactionsMenu, setShowReactionsMenu] = useState(false);
    const reactionsMenuRef = useRef<HTMLDivElement | null>(null);
    const [mediaMenu, setMediaMenu] = useState<"mic" | "camera" | null>(null);
    const mediaMenuRef = useRef<HTMLDivElement | null>(null);
    const backgroundUploadRef = useRef<HTMLInputElement | null>(null);

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
        if (!mediaMenu) return;
        const onDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && !mediaMenuRef.current?.contains(target)) setMediaMenu(null);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [mediaMenu]);

    const menuSurface = isLight
        ? "border border-black/10 bg-[#F7F7F7] text-[#2F2F2F]"
        : "border border-white/10 bg-[#222222] text-white";
    const menuItem = isLight
        ? "hover:bg-black/[0.055]"
        : "hover:bg-white/[0.07]";
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

    const labeledControlClass = "h-10 min-w-10 px-1.5 rounded-2xl flex flex-col items-center justify-center gap-[5px] transition md:h-12 md:min-w-12 md:px-2.5 md:py-1.5";
    const controlLabelClass = "hidden md:block text-[10px] font-normal leading-none";

    const aiHostBtnClass =
        labeledControlClass + " " +
        (aiHostOpen
            ? isLight
                ? "bg-[#242424] hover:bg-[#2E2E2E] text-white"
                : "bg-[#242424] hover:bg-[#2E2E2E] text-white"
            : ctlBtnBase);

    const bugReportDesktopBtn = onOpenBugReport ? (
        <button
            onClick={onOpenBugReport}
            className={`${labeledControlClass} ${ctlBtnBase}`}
            title="Report a problem"
            type="button"
        >
            <BugReportIcon isLight={isLight} className="w-[20px] h-[20px]" />
            <span className={controlLabelClass}>Report</span>
        </button>
    ) : null;

    const layoutDesktopBtn =
        showLayoutControls && onOpenLayoutControls ? (
            <button
                onClick={onOpenLayoutControls}
                className={`${labeledControlClass} ${ctlBtnBase}`}
                title="Video layout"
                type="button"
            >
                <LayoutIcon isLight={isLight} className="w-[20px] h-[20px]" />
                <span className={controlLabelClass}>Layout</span>
            </button>
        ) : null;

    const chatBtn = (
        <button onClick={onOpenChat} className={`relative ${labeledControlClass} ${ctlBtnBase}`} title="Chat" type="button">
            <Icon name="chat" theme={theme} className="w-[20px] h-[20px]" />
            <span className={controlLabelClass}>Chat</span>
            {unreadChat > 0 && (
                <span className={["absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center", isLight ? "bg-[#1B1B1B] text-white" : "bg-[#1B1B1B] text-white"].join(" ")}>
                    {unreadChat > 99 ? "99+" : unreadChat}
                </span>
            )}
        </button>
    );

    const participantsBtn = (
        <button onClick={onOpenParticipants} className={`${labeledControlClass} ${ctlBtnBase}`} title="Participants" type="button">
            <Icon name="participants" theme={theme} className="w-[20px] h-[20px]" />
            <span className={controlLabelClass}>People</span>
        </button>
    );

    const tasksBtn = (
        <button onClick={onOpenTasks} className={`${labeledControlClass} ${ctlBtnBase}`} title="Tasks" type="button">
            <Icon name="tasks" theme={theme} className="w-[20px] h-[20px]" />
            <span className={controlLabelClass}>Tasks</span>
        </button>
    );

    const soundscapesBtn = onOpenSoundscapes ? (
        <button onClick={onOpenSoundscapes} className={"relative " + labeledControlClass + " " + (soundscapeActive ? "bg-[#242424] hover:bg-[#2E2E2E] text-white" : ctlBtnBase)} title={soundscapeActive ? "Background sounds playing" : "Background sounds"} type="button">
            <SoundscapeIcon isLight={isLight} active={soundscapeActive} className="w-[20px] h-[20px]" />
            <span className={controlLabelClass}>Music</span>
            {soundscapeActive ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#7EE787]" /> : null}
        </button>
    ) : null;

    const settingsBtn = (
        <button onClick={onOpenSettings} className={`${labeledControlClass} ${ctlBtnBase}`} title="Settings" type="button">
            <Icon name="settings" theme={theme} className="w-[20px] h-[20px]" />
            <span className={controlLabelClass}>Settings</span>
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
                <AIHostIcon isLight={aiHostOpen ? false : isLight} className="w-[20px] h-[20px]" />
                <span className={controlLabelClass}>AI Host</span>
            </button>
        ) : null;

    const pipDesktopBtn =
        showPiP && onTogglePiP ? (
            <button
                onClick={onTogglePiP}
                className={
                    labeledControlClass + " " +
                    (pipActive
                        ? isLight
                            ? "bg-[#242424] hover:bg-[#2E2E2E] text-white"
                            : "bg-[#242424] hover:bg-[#2E2E2E] text-white"
                        : ctlBtnBase)
                }
                title={
                    pipActive ? "Close picture-in-picture" : "Open picture-in-picture"
                }
                type="button"
            >
                <Icon name="pip" theme={pipIconTheme} className="w-[20px] h-[20px]" />
                <span className={controlLabelClass}>PiP</span>
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
                                className={`${labeledControlClass} ${ctlBtnBase}`}
                                title="Menu"
                                type="button"
                            >
                                <span className={isLight ? "text-black/70" : "text-white/85"}>
                                    ⋯
                                </span>
                            </button>

                            {showMoreMenu && (
                                <div className="absolute bottom-[76px] sm:bottom-[86px] left-0">
                                    <div
                                        className={`w-[240px] rounded-2xl shadow-2xl overflow-hidden ${isLight
                                            ? "bg-[#F3F1F1] border border-[#D8D0D0]"
                                            : "bg-[#1B1B1B] border border-transparent"
                                            }`}
                                    >
                                        {onOpenBugReport ? (
                                            <button
                                                onClick={() => {
                                                    onOpenBugReport();
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight
                                                    ? "text-black/75 hover:bg-[#E1E3E6]"
                                                    : "text-white/85 hover:bg-[#F2F3F5]/5"
                                                    }`}
                                                type="button"
                                            >
                                                <BugReportIcon
                                                    isLight={isLight}
                                                    className="w-4 h-4 opacity-90"
                                                />
                                                <span>Report a problem</span>
                                            </button>
                                        ) : null}

                                        {showAIHost && onOpenAIHost ? (
                                            <button
                                                onClick={() => {
                                                    onOpenAIHost();
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${aiHostOpen
                                                    ? isLight
                                                        ? "bg-[#1B1B1B] text-white"
                                                        : "bg-[#1B1B1B] text-white"
                                                    : isLight
                                                        ? "text-black/75 hover:bg-[#E1E3E6]"
                                                        : "text-white/85 hover:bg-[#F2F3F5]/5"
                                                    }`}
                                                type="button"
                                            >
                                                <AIHostIcon
                                                    isLight={aiHostOpen ? false : isLight}
                                                    className="w-4 h-4 opacity-90"
                                                />
                                                <span>
                                                    {aiHostOpen ? "AI Host open" : "Open AI Host"}
                                                </span>
                                            </button>
                                        ) : null}

                                        {showLayoutControls && onOpenLayoutControls ? (
                                            <button
                                                onClick={() => {
                                                    onOpenLayoutControls();
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight
                                                    ? "text-black/75 hover:bg-[#E1E3E6]"
                                                    : "text-white/85 hover:bg-[#F2F3F5]/5"
                                                    }`}
                                                type="button"
                                            >
                                                <LayoutIcon
                                                    isLight={isLight}
                                                    className="w-4 h-4 opacity-90"
                                                />
                                                <span>Layout</span>
                                            </button>
                                        ) : null}

                                        <button
                                            onClick={() => {
                                                onOpenParticipants();
                                                setShowMoreMenu(false);
                                            }}
                                            className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight
                                                ? "text-black/75 hover:bg-[#E1E3E6]"
                                                : "text-white/85 hover:bg-[#F2F3F5]/5"
                                                }`}
                                            type="button"
                                        >
                                            <Icon
                                                name="participants"
                                                theme={theme}
                                                className="w-4 h-4 opacity-90"
                                            />
                                            <span>Participants</span>
                                        </button>

                                        <button
                                            onClick={() => {
                                                onOpenChat();
                                                setShowMoreMenu(false);
                                            }}
                                            className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight
                                                ? "text-black/75 hover:bg-[#E1E3E6]"
                                                : "text-white/85 hover:bg-[#F2F3F5]/5"
                                                }`}
                                            type="button"
                                        >
                                            <Icon
                                                name="chat"
                                                theme={theme}
                                                className="w-4 h-4 opacity-90"
                                            />
                                            <span>Chat</span>
                                            {unreadChat > 0 ? (
                                                <span
                                                    className={[
                                                        "ml-auto min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center",
                                                        isLight
                                                            ? "bg-[#1B1B1B] text-white"
                                                            : "bg-[#1B1B1B] text-white",
                                                    ].join(" ")}
                                                >
                                                    {unreadChat > 99 ? "99+" : unreadChat}
                                                </span>
                                            ) : null}
                                        </button>

                                        <button
                                            onClick={() => {
                                                onOpenTasks();
                                                setShowMoreMenu(false);
                                            }}
                                            className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight
                                                ? "text-black/75 hover:bg-[#E1E3E6]"
                                                : "text-white/85 hover:bg-[#F2F3F5]/5"
                                                }`}
                                            type="button"
                                        >
                                            <Icon
                                                name="tasks"
                                                theme={theme}
                                                className="w-4 h-4 opacity-90"
                                            />
                                            <span>Tasks</span>
                                        </button>

                                        <div
                                            className={
                                                isLight ? "h-px bg-black/10" : "h-px bg-white/10"
                                            }
                                        />

                                        <button
                                            onClick={() => {
                                                onOpenSettings();
                                                setShowMoreMenu(false);
                                            }}
                                            className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight
                                                ? "text-black/75 hover:bg-[#E1E3E6]"
                                                : "text-white/85 hover:bg-[#F2F3F5]/5"
                                                }`}
                                            type="button"
                                        >
                                            <Icon
                                                name="settings"
                                                theme={theme}
                                                className="w-4 h-4 opacity-90"
                                            />
                                            <span>Settings</span>
                                        </button>

                                        {onOpenSoundscapes ? (
                                            <button
                                                onClick={() => {
                                                    onOpenSoundscapes();
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${soundscapeActive
                                                    ? "bg-[#242424] text-white"
                                                    : isLight
                                                        ? "text-black/75 hover:bg-[#E1E3E6]"
                                                        : "text-white/85 hover:bg-[#F2F3F5]/5"
                                                    }`}
                                                type="button"
                                            >
                                                <SoundscapeIcon
                                                    isLight={isLight}
                                                    active={soundscapeActive}
                                                    className="w-4 h-4"
                                                />
                                                <span>Background sounds</span>
                                                {soundscapeActive ? (
                                                    <span className="ml-auto h-2 w-2 rounded-full bg-[#7EE787]" />
                                                ) : null}
                                            </button>
                                        ) : null}

                                        {showPiP && onTogglePiP ? (
                                            <button
                                                onClick={() => {
                                                    onTogglePiP();
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${pipActive
                                                    ? isLight
                                                        ? "bg-[#1B1B1B] text-white"
                                                        : "bg-[#1B1B1B] text-white"
                                                    : isLight
                                                        ? "text-black/75 hover:bg-[#E1E3E6]"
                                                        : "text-white/85 hover:bg-[#F2F3F5]/5"
                                                    }`}
                                                type="button"
                                            >
                                                <Icon
                                                    name="pip"
                                                    theme={pipIconTheme}
                                                    className="w-4 h-4 opacity-90"
                                                />
                                                <span>{pipActive ? "Close PiP" : "Open PiP"}</span>
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="hidden md:flex items-center gap-2">
                            {bugReportDesktopBtn}
                            {aiHostDesktopBtn}
                            {layoutDesktopBtn}
                            {settingsBtn}
                        </div>
                    </div>

                    <div className="flex items-center justify-center gap-2 sm:gap-3">
                        <div className="relative" ref={mediaMenu === "mic" ? mediaMenuRef : undefined}>
                            <div className="relative">
                                <button onClick={onToggleMic} disabled={!connected} className={labeledControlClass + " disabled:opacity-50 " + (!micOn ? "bg-[#F65252] text-white hover:bg-[#E64545]" : ctlBtnBase)} title="Toggle microphone" type="button">
                                    <Icon name={!micOn ? "mic-off" : "mic-on"} theme={!micOn ? "dark" : theme} className="h-[20px] w-[20px]" />
                                    <span className={controlLabelClass}>{micOn ? "Mic on" : "Mic off"}</span>
                                </button>
                                <button onClick={() => setMediaMenu((current) => current === "mic" ? null : "mic")} disabled={!connected} className={`absolute -right-1.5 -top-1.5 z-10 flex h-[19px] w-[19px] items-center justify-center rounded-full shadow-sm ring-2 transition hover:scale-105 disabled:opacity-30 bg-[#2F2F2F] text-white hover:bg-[#383838] ${isLight ? "ring-[#F3F1F1]" : "ring-[#191919]"}`} title="Choose microphone" aria-label="Choose microphone" aria-expanded={mediaMenu === "mic"} type="button">
                                    <ChevronUp className="h-2.5 w-2.5" strokeWidth={2.4} />
                                </button>
                            </div>
                            {mediaMenu === "mic" ? (
                                <div className={`absolute bottom-[54px] left-1/2 z-[80] w-[280px] -translate-x-1/2 overflow-hidden rounded-2xl p-2 shadow-2xl ${menuSurface}`}>
                                    <div className="px-2 pb-2 pt-1 text-[11px] font-semibold opacity-55">Microphone</div>
                                    <div className="max-h-[230px] overflow-y-auto">
                                        {(audioInputs.length ? audioInputs : [{ deviceId: "", label: "Default microphone" } as MediaDeviceInfo]).map((device, index) => {
                                            const deviceId = device.deviceId || "";
                                            const selected = deviceId === selectedAudioInputId || (!selectedAudioInputId && index === 0);
                                            return (
                                                <button key={deviceId || `mic-${index}`} type="button" onClick={() => { void onChangeAudioInput?.(deviceId); setMediaMenu(null); }} className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12px] transition ${selected ? "bg-[#2F2F2F] text-white" : menuItem}`}>
                                                    <span className="min-w-0 flex-1 truncate">{device.label || `Microphone ${index + 1}`}</span>
                                                    {selected ? <span className="text-[11px]">✓</span> : null}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <div className="relative" ref={mediaMenu === "camera" ? mediaMenuRef : undefined}>
                            <div className="relative">
                                <button onClick={onToggleCam} disabled={!connected} className={labeledControlClass + " disabled:opacity-50 " + (!camOn ? "bg-[#F65252] text-white hover:bg-[#E64545]" : ctlBtnBase)} title="Toggle camera" type="button">
                                    <Icon name={!camOn ? "camera-off" : "camera-on"} theme={!camOn ? "dark" : theme} className="h-[20px] w-[20px]" />
                                    <span className={controlLabelClass}>{camOn ? "Camera" : "Cam off"}</span>
                                </button>
                                <button onClick={() => setMediaMenu((current) => current === "camera" ? null : "camera")} disabled={!connected} className={`absolute -right-1.5 -top-1.5 z-10 flex h-[19px] w-[19px] items-center justify-center rounded-full shadow-sm ring-2 transition hover:scale-105 disabled:opacity-30 bg-[#2F2F2F] text-white hover:bg-[#383838] ${isLight ? "ring-[#F3F1F1]" : "ring-[#191919]"}`} title="Camera and background" aria-label="Choose camera and background" aria-expanded={mediaMenu === "camera"} type="button">
                                    <ChevronUp className="h-2.5 w-2.5" strokeWidth={2.4} />
                                </button>
                            </div>
                            {mediaMenu === "camera" ? (
                                <div className={`absolute bottom-[54px] left-1/2 z-[80] max-h-[min(560px,calc(100dvh-90px))] w-[320px] -translate-x-1/2 overflow-y-auto rounded-2xl p-2 shadow-2xl ${menuSurface}`}>
                                    <div className="px-2 pb-2 pt-1 text-[11px] font-semibold opacity-55">Camera</div>
                                    <div className="max-h-[160px] overflow-y-auto">
                                        {(videoInputs.length ? videoInputs : [{ deviceId: "", label: "Default camera" } as MediaDeviceInfo]).map((device, index) => {
                                            const deviceId = device.deviceId || "";
                                            const selected = deviceId === selectedVideoInputId || (!selectedVideoInputId && index === 0);
                                            return (
                                                <button key={deviceId || `camera-${index}`} type="button" onClick={() => void onChangeVideoInput?.(deviceId)} className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12px] transition ${selected ? "bg-[#2F2F2F] text-white" : menuItem}`}>
                                                    <span className="min-w-0 flex-1 truncate">{device.label || `Camera ${index + 1}`}</span>
                                                    {selected ? <span className="text-[11px]">✓</span> : null}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {!backgroundFxDisabled && onApplyVideoFx ? (
                                        <>
                                            <div className={`mx-2 my-2 h-px ${isLight ? "bg-black/10" : "bg-white/10"}`} />
                                            <div className="flex items-center justify-between px-2 pb-2 pt-1">
                                                <span className="text-[11px] font-semibold opacity-55">Background</span>
                                                <Sparkles className="h-3.5 w-3.5 opacity-45" />
                                            </div>
                                            <div className="grid grid-cols-3 gap-1.5">
                                                <button type="button" onClick={() => void onApplyVideoFx("off")} className={`rounded-xl px-2 py-2 text-[10px] font-semibold transition ${videoFxMode === "off" ? "bg-[#2F2F2F] text-white" : menuItem}`}>None</button>
                                                <button type="button" onClick={() => void onApplyVideoFx("blur", undefined, blurDraft)} className={`rounded-xl px-2 py-2 text-[10px] font-semibold transition ${videoFxMode === "blur" ? "bg-[#2F2F2F] text-white" : menuItem}`}>Blur</button>
                                                <button type="button" onClick={() => backgroundUploadRef.current?.click()} className={`flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-[10px] font-semibold transition ${menuItem}`}><ImagePlus className="h-3.5 w-3.5" />Custom</button>
                                            </div>
                                            {videoFxMode === "blur" ? (
                                                <div className={`mt-2 rounded-xl px-2.5 py-2 ${isLight ? "bg-black/[0.04]" : "bg-white/[0.06]"}`}>
                                                    <div className="flex items-center justify-between gap-3 text-[10px]">
                                                        <span className="font-medium opacity-60">Blur strength</span>
                                                        <span className="font-semibold">{blurDraft}</span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min={4}
                                                        max={30}
                                                        step={1}
                                                        value={blurDraft}
                                                        aria-label="Blur strength"
                                                        className="mt-2 w-full accent-[#5286F6]"
                                                        onChange={(event) => {
                                                            const value = Number(event.currentTarget.value);
                                                            setBlurDraft(value);
                                                            onBlurStrengthChange?.(value);
                                                        }}
                                                        onPointerUp={(event) => void onApplyVideoFx("blur", undefined, Number(event.currentTarget.value))}
                                                        onKeyUp={(event) => void onApplyVideoFx("blur", undefined, Number(event.currentTarget.value))}
                                                    />
                                                    <div className="mt-0.5 flex justify-between text-[9px] opacity-40">
                                                        <span>Soft</span>
                                                        <span>Strong</span>
                                                    </div>
                                                </div>
                                            ) : null}
                                            <input ref={backgroundUploadRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void onUploadBackground?.(file); }} />
                                            <div className="mt-2 grid grid-cols-2 gap-1.5">
                                                {backgroundPresets.map((preset) => {
                                                    const selected = videoFxMode === "bg" && selectedBackgroundUrl === preset.url;
                                                    return (
                                                        <button key={preset.id} type="button" onClick={() => void onApplyVideoFx("bg", preset.url)} className={`group overflow-hidden rounded-xl text-left transition ${selected ? "ring-2 ring-[#5286F6]" : "ring-1 ring-black/10"}`}>
                                                            <img src={preset.url} alt="" className="aspect-[16/7] w-full object-cover transition group-hover:scale-[1.03]" />
                                                            <span className="block truncate px-2 py-1.5 text-[10px] font-semibold">{preset.label}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                        <button
                            onClick={onToggleScreenShare}
                            disabled={!connected}
                            className={
                                labeledControlClass + " disabled:opacity-50 " +
                                (screenShareOn
                                    ? "bg-[#5286F6] hover:bg-[#4678E4] text-white"
                                    : ctlBtnBase)
                            }
                            title="Share screen"
                            type="button"
                        >
                            <Icon
                                name="screen-share"
                                theme={screenShareOn ? "dark" : theme}
                                className="w-[20px] h-[20px]"
                            />
                            <span className={controlLabelClass}>Share</span>
                        </button>

                        {onToggleVoiceUi ? (
                            <button
                                onClick={onToggleVoiceUi}
                                disabled={!connected}
                                className={
                                    "relative " + labeledControlClass + " disabled:opacity-50 " +
                                    (voiceUiMode === "always"
                                        ? "bg-[#5286F6] hover:bg-[#4678E4] text-white"
                                        : voiceUiMode === "hotkey"
                                            ? "bg-[#6657D9] hover:bg-[#594BC7] text-white"
                                            : ctlBtnBase)
                                }
                                title={voiceUiMode === "off" ? "Voice controls off — click for always listening" : voiceUiMode === "always" ? "Always listening — click for hotkey mode" : "Hotkey mode — click to turn off"}
                                aria-pressed={voiceUiMode !== "off"}
                                type="button"
                            >
                                <AudioLines
                                    aria-hidden="true"
                                    className={`h-[20px] w-[20px] ${voiceUiMode !== "off" ? "text-white" : isLight ? "text-[#2F2F2F]" : "text-white"}`}
                                    strokeWidth={2}
                                />
                                {voiceUiMode === "hotkey" ? (
                                    <span className="absolute right-1 top-1 rounded bg-white/20 px-1 text-[7px] font-bold leading-3 text-white" aria-hidden="true">H</span>
                                ) : null}
                                <span className={controlLabelClass}>Voice UI</span>
                            </button>
                        ) : null}

                        <div className="relative" ref={reactionsMenuRef}>
                            <button
                                onClick={() => setShowReactionsMenu((v) => !v)}
                                className={`${labeledControlClass} ${ctlBtnBase}`}
                                title="Reactions"
                                type="button"
                            >
                                <Icon name="reaction" theme={theme} className="w-[20px] h-[20px]" />
                                <span className={controlLabelClass}>React</span>
                            </button>

                            {showReactionsMenu && (
                                <div
                                    className={`absolute bottom-[54px] sm:bottom-[58px] left-1/2 -translate-x-1/2 rounded-2xl px-3 py-2 flex items-center gap-2 text-[26px] shadow-xl whitespace-nowrap ${isLight
                                        ? "bg-[#F3F1F1] border border-[#D8D0D0]"
                                        : "bg-[#1B1B1B] border border-transparent"
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

                        <div className="hidden md:block">
                            {pipDesktopBtn}
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                        <div className="hidden md:flex items-center gap-2">
                            {participantsBtn}
                            {chatBtn}
                            {tasksBtn}
                            {soundscapesBtn}
                        </div>

                        <button
                            onClick={onLeave}
                            className="hidden sm:flex h-11 px-6 rounded-2xl font-semibold items-center justify-center gap-2 bg-[#F65252] hover:bg-[#E64545] text-white transition"
                            title="Leave"
                            type="button"
                        >
                            <Icon name="leave" theme="dark" className="w-5 h-5" />
                            <span className="text-[14px]">Leave</span>
                        </button>

                        <button
                            onClick={onLeave}
                            className="sm:hidden w-10 h-10 rounded-2xl bg-[#F65252] hover:bg-[#E64545] text-white flex items-center justify-center transition"
                            title="Leave"
                            type="button"
                        >
                            <Icon name="leave" theme="dark" className="w-5 h-5" />
                            <span className="sr-only">Leave room</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
