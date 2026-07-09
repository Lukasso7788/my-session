import React from "react";

type RoomTheme = "dark" | "light";
type FxMode = "off" | "blur" | "bg";
type VideoTileLayoutPreset = "auto" | "one" | "two" | "three" | "four" | "five" | "six" | "strip";

type SinkAudioElement = HTMLAudioElement & {
    setSinkId?: (sinkId: string) => Promise<void>;
    srcObject?: MediaStream | null;
    // HTMLAudioElement supports the same inline-playback assignment at runtime on modern browsers,
    // but some DOM typings only expose playsInline on HTMLVideoElement. Keep it optional here
    // so hidden test audio elements do not trigger TypeScript errors.
    playsInline?: boolean;
};

function makeBgPresetDataUrl(a: string, b: string, c: string, d: string) {
    return (
        "data:image/svg+xml;utf8," +
        encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/>
      <stop offset="0.5" stop-color="${b}"/>
      <stop offset="1" stop-color="${c}"/>
    </linearGradient>
    <radialGradient id="r" cx="25%" cy="25%" r="80%">
      <stop offset="0" stop-color="${d}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <rect width="1280" height="720" fill="url(#r)"/>
  <circle cx="1030" cy="170" r="230" fill="#ffffff" opacity="0.04"/>
  <circle cx="360" cy="520" r="310" fill="#ffffff" opacity="0.03"/>
</svg>
`)
    );
}

const FX_BG_PRESETS = [
    {
        id: "ocean",
        label: "Ocean",
        url: makeBgPresetDataUrl("#081226", "#123a76", "#031019", "#38bdf8"),
    },
    {
        id: "forest",
        label: "Forest",
        url: makeBgPresetDataUrl("#07160f", "#124b2c", "#040d08", "#22c55e"),
    },
    {
        id: "violet",
        label: "Violet",
        url: makeBgPresetDataUrl("#120a22", "#3b2378", "#090512", "#a78bfa"),
    },
    {
        id: "sunset",
        label: "Sunset",
        url: makeBgPresetDataUrl("#1c0d10", "#7c2d12", "#11070a", "#fb7185"),
    },
];

function isFirefoxLike() {
    if (typeof navigator === "undefined") return false;
    return /firefox|fxios/i.test(String(navigator.userAgent || ""));
}

function normalizeBlurDraft(raw: number, firefoxSafe = false) {
    const n = Math.max(4, Math.min(30, Math.round(Number(raw || 12))));

    if (firefoxSafe) {
        if (n <= 4) return 4;
        if (n >= 30) return 30;
        return Math.max(4, Math.min(30, Math.round(n / 4) * 4));
    }

    if (n <= 4) return 4;
    if (n >= 30) return 30;
    return Math.max(4, Math.min(30, Math.round(n / 2) * 2));
}

function ToggleRow(props: {
    label: string;
    description?: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
    isLight: boolean;
}) {
    const { label, description, checked, onChange, disabled, isLight } = props;

    return (
        <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
                <div className={`text-[13px] font-semibold ${isLight ? "text-black/85" : "text-white/90"}`}>{label}</div>
                {description ? (
                    <div className={`mt-1 text-[12px] ${isLight ? "text-black/55" : "text-white/55"}`}>{description}</div>
                ) : null}
            </div>

            <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(!checked)}
                className={[
                    "relative shrink-0 w-[50px] h-[30px] rounded-full transition border disabled:opacity-50",
                    checked
                        ? isLight
                            ? "bg-[#81DB86] border-[#81DB86]"
                            : "bg-[#81DB86] border-[#81DB86]"
                        : isLight
                            ? "bg-[#F3F1F1] border-[#D8D0D0]"
                            : "bg-[#3F3F46] border-[#3F3F46]",
                ].join(" ")}
                aria-pressed={checked}
                title={label}
            >
                <span
                    className="absolute top-[2px] left-[2px] w-[24px] h-[24px] rounded-full bg-white shadow-md transition-transform"
                    style={{
                        transform: checked ? "translateX(20px)" : "translateX(0px)",
                    }}
                />
            </button>
        </div>
    );
}

function SelectField(props: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
    isLight: boolean;
}) {
    const { label, value, onChange, options, isLight } = props;

    return (
        <div>
            <div className={`text-[13px] font-semibold mb-2 ${isLight ? "text-black/85" : "text-white/90"}`}>{label}</div>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={[
                    "w-full h-11 rounded-xl px-3 outline-none border text-[13px]",
                    isLight ? "bg-[#F3F1F1] border-[#D8D0D0] text-black/85" : "bg-[#27272A] border-[#3F3F46] text-white/90",
                ].join(" ")}
            >
                {options.map((opt) => (
                    <option key={`${label}-${opt.value}`} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
        </div>
    );
}

function SliderField(props: {
    label: string;
    description?: string;
    min: number;
    max: number;
    step?: number;
    value: number;
    onChange: (v: number) => void;
    disabled?: boolean;
    isLight: boolean;
    valueSuffix?: string;
}) {
    const { label, description, min, max, step = 1, value, onChange, disabled, isLight, valueSuffix = "" } = props;

    return (
        <div>
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className={`text-[13px] font-semibold ${isLight ? "text-black/85" : "text-white/90"}`}>{label}</div>
                    {description ? (
                        <div className={`mt-1 text-[12px] ${isLight ? "text-black/55" : "text-white/55"}`}>{description}</div>
                    ) : null}
                </div>
                <div className={`text-[13px] font-semibold ${isLight ? "text-black/70" : "text-white/80"}`}>
                    {value}
                    {valueSuffix}
                </div>
            </div>

            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full mt-3"
            />
        </div>
    );
}


type RecoveryGuideKey = "quick" | "camera" | "microphone" | "speakers" | "firefox";

type RecoveryGuideContent = {
    title: string;
    eyebrow: string;
    intro: string;
    steps: string[];
    note?: string;
};

const RECOVERY_GUIDES: Record<RecoveryGuideKey, RecoveryGuideContent> = {
    quick: {
        eyebrow: "Fast recovery",
        title: "Quick rescue if audio or video feels broken",
        intro: "Use this when something worked a minute ago, then camera, mic, or speaker output suddenly stopped.",
        steps: [
            "Check the lock icon near the address bar and make sure Camera and Microphone are allowed for MySession.",
            "Choose a real camera and microphone from the dropdowns instead of leaving everything on Default.",
            "Turn camera or mic off and on once from the room controls after changing a device.",
            "Close Zoom, Google Meet, OBS, Discord, or any other app that may be using the camera or microphone.",
            "If Firefox still looks stuck, reload the room once after permissions are allowed.",
        ],
        note: "You can stay in the room while fixing devices. A failed camera or mic should not force you to leave the session.",
    },
    camera: {
        eyebrow: "Camera help",
        title: "Camera is not turning on",
        intro: "Most camera failures are permission, wrong-device, or camera-busy problems rather than a room failure.",
        steps: [
            "Click the browser lock icon and allow Camera for this site.",
            "Pick the exact camera from the Camera dropdown. Avoid Default if Firefox keeps choosing the wrong one.",
            "Close other video apps or browser tabs that may be using the same camera.",
            "Turn camera off and on again from the bottom bar after changing the selected camera.",
            "If the preview remains black, refresh devices or reload the room after permissions are allowed.",
        ],
        note: "On Firefox, permission labels may stay vague until the browser has been allowed to access the camera once.",
    },
    microphone: {
        eyebrow: "Microphone help",
        title: "Microphone is silent or not detected",
        intro: "Use the mic test to confirm whether the browser can hear you before debugging LiveKit audio.",
        steps: [
            "Click the browser lock icon and allow Microphone for this site.",
            "Pick the exact microphone from the Microphone dropdown, especially if you use Bluetooth or a headset.",
            "Start the mic test and speak. The input level should move even if other people cannot hear you yet.",
            "Try turning Noise suppression or Auto gain control off and on if your voice sounds heavily filtered.",
            "After changing the mic, toggle the room microphone off and on once.",
        ],
        note: "If you see input level in the test, your browser is receiving mic audio. Then the next step is room mic toggle / selected device sync.",
    },
    speakers: {
        eyebrow: "Speaker help",
        title: "You cannot hear other people",
        intro: "Speaker output depends on browser autoplay, selected output device, system volume, and whether the room audio was unlocked by a click.",
        steps: [
            "Click Play test sound. If you hear it, your selected output device works.",
            "Select Default speakers first, then try your headset or external speakers again.",
            "Check system volume, browser tab mute, and Bluetooth headset output mode.",
            "Click anywhere in the room, then ask someone to speak again. Some browsers require a user gesture before audio plays.",
            "If using Firefox, reload once after selecting the right output if sound routing feels stuck.",
        ],
        note: "Some browsers do not support choosing a specific output device. In that case, MySession must use the system default output.",
    },
    firefox: {
        eyebrow: "Firefox-specific",
        title: "Firefox camera / mic recovery",
        intro: "Firefox is more sensitive to one-time permissions, device labels, and stale device IDs. This guide is for laptop users on Firefox.",
        steps: [
            "Click the lock icon in the address bar and remove old blocked camera/mic permissions if needed.",
            "Allow Camera and Microphone again when Firefox asks.",
            "Choose exact devices in Settings instead of Default.",
            "Avoid changing blur/background repeatedly while debugging camera startup. First get raw camera working.",
            "If Firefox still keeps a stale device, reload the room after selecting permissions and devices.",
        ],
        note: "The safest recovery order is: permissions → exact device → camera/mic toggle → reload only if still stuck.",
    },
};

function HelpButton(props: {
    children: React.ReactNode;
    onClick: () => void;
    isLight: boolean;
    compact?: boolean;
}) {
    const { children, onClick, isLight, compact = false } = props;

    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                "rounded-xl border font-semibold transition inline-flex items-center gap-1.5",
                compact ? "h-8 px-2.5 text-[11px]" : "h-9 px-3 text-[12px]",
                isLight
                    ? "bg-white hover:bg-black/5 border-black/10 text-black/75"
                    : "bg-white/5 hover:bg-white/10 border-white/10 text-white/80",
            ].join(" ")}
        >
            <span aria-hidden="true">?</span>
            <span>{children}</span>
        </button>
    );
}

function RecoveryGuideModal(props: {
    guideKey: RecoveryGuideKey | null;
    onClose: () => void;
    isLight: boolean;
}) {
    const { guideKey, onClose, isLight } = props;
    if (!guideKey) return null;

    const guide = RECOVERY_GUIDES[guideKey];
    const panelCls = isLight
        ? "bg-white text-black border-black/10"
        : "bg-[#06101f] text-white border-white/10";
    const subtleText = isLight ? "text-black/55" : "text-white/55";
    const stepCls = isLight ? "bg-white border-[#D8D0D0]" : "bg-[#27272A] border-[#3F3F46]";

    return (
        <div className="fixed inset-0 z-[1010] flex items-center justify-center px-4 py-6">
            <div className="absolute inset-0 bg-black/55" onClick={onClose} />
            <div className={`relative w-full max-w-[560px] rounded-3xl border shadow-2xl overflow-hidden ${panelCls}`}>
                <div className={`px-5 py-4 border-b ${isLight ? "border-[#D8D0D0]" : "border-[#3F3F46]"}`}>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${subtleText}`}>
                                {guide.eyebrow}
                            </div>
                            <div className="mt-1 text-[17px] font-semibold">{guide.title}</div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className={[
                                "w-9 h-9 rounded-2xl shrink-0 transition",
                                isLight ? "bg-black/5 hover:bg-black/10" : "bg-white/5 hover:bg-white/10",
                            ].join(" ")}
                            title="Close guide"
                        >
                            ✕
                        </button>
                    </div>
                    <div className={`mt-3 text-[13px] leading-5 ${subtleText}`}>{guide.intro}</div>
                </div>

                <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
                    <div className="flex flex-col gap-2.5">
                        {guide.steps.map((step, index) => (
                            <div key={`${guideKey}-${index}`} className={`rounded-2xl border px-3.5 py-3 ${stepCls}`}>
                                <div className="flex gap-3">
                                    <div
                                        className={[
                                            "mt-0.5 w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[12px] font-bold",
                                            isLight ? "bg-[#5286F6] text-white" : "bg-[#81DB86] text-[#0D2610]",
                                        ].join(" ")}
                                    >
                                        {index + 1}
                                    </div>
                                    <div className="text-[13px] leading-5">{step}</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {guide.note ? (
                        <div
                            className={[
                                "mt-4 rounded-2xl border px-4 py-3 text-[12px] leading-5",
                                isLight
                                    ? "bg-[#5286F6]/10 border-[#5286F6]/25 text-[#244E9E]"
                                    : "bg-[#27272A] border-[#3F3F46] text-white/80",
                            ].join(" ")}
                        >
                            {guide.note}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function VideoPreviewBox(props: {
    track?: {
        attach?: () => HTMLMediaElement;
        detach?: (element?: HTMLMediaElement) => void;
    } | null;
    filterCss?: string;
    isLight: boolean;
    label?: string;
    mirrored?: boolean;
}) {
    const { track, filterCss, isLight, label = "Camera preview", mirrored = true } = props;
    const hostRef = React.useRef<HTMLDivElement | null>(null);
    const mediaElRef = React.useRef<HTMLMediaElement | null>(null);

    React.useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        host.innerHTML = "";

        if (!track || typeof track.attach !== "function") return;

        const attached = track.attach();
        if (!attached) return;

        const media = attached as HTMLMediaElement & {
            playsInline?: boolean;
        };

        media.muted = true;
        media.autoplay = true;
        media.playsInline = true;
        media.style.width = "100%";
        media.style.height = "100%";
        media.style.objectFit = "cover";
        media.style.transform = mirrored ? "scaleX(-1)" : "scaleX(1)";
        media.style.filter = filterCss || "";

        host.appendChild(media);
        mediaElRef.current = media;

        return () => {
            try {
                if (track && typeof track.detach === "function" && mediaElRef.current) {
                    track.detach(mediaElRef.current);
                }
            } catch { }

            try {
                if (mediaElRef.current && mediaElRef.current.parentNode) {
                    mediaElRef.current.parentNode.removeChild(mediaElRef.current);
                }
            } catch { }

            mediaElRef.current = null;
        };
    }, [track, filterCss, mirrored]);

    return (
        <div>
            <div className={`text-[13px] font-semibold mb-3 ${isLight ? "text-black/85" : "text-white/90"}`}>
                {label}
            </div>

            <div
                className={[
                    "rounded-2xl overflow-hidden border aspect-video w-full",
                    isLight ? "border-[#D8D0D0] bg-white" : "border-[#3F3F46] bg-[#27272A]",
                ].join(" ")}
            >
                {track ? (
                    <div ref={hostRef} className="w-full h-full" />
                ) : (
                    <div
                        className={`w-full h-full flex items-center justify-center text-[12px] ${isLight ? "text-black/55" : "text-white/55"
                            }`}
                    >
                        Camera preview is not available
                    </div>
                )}
            </div>
        </div>
    );
}

function SoundTestSection(props: {
    isLight: boolean;
    sectionCls: string;
    ghostBtn: string;
    subtleText: string;
    selectedAudioInputId: string;
    selectedAudioOutputId: string;
    echoCancellationEnabled: boolean;
    noiseSuppressionEnabled: boolean;
    autoGainControlEnabled: boolean;
}) {
    const {
        isLight,
        sectionCls,
        ghostBtn,
        subtleText,
        selectedAudioInputId,
        selectedAudioOutputId,
        echoCancellationEnabled,
        noiseSuppressionEnabled,
        autoGainControlEnabled,
    } = props;

    const [speakerTesting, setSpeakerTesting] = React.useState(false);
    const [speakerTestError, setSpeakerTestError] = React.useState("");
    const [speakerTestStatus, setSpeakerTestStatus] = React.useState("");

    const [micTesting, setMicTesting] = React.useState(false);
    const [micRestarting, setMicRestarting] = React.useState(false);
    const [micLevel, setMicLevel] = React.useState(0);
    const [micTestError, setMicTestError] = React.useState("");
    const [micTestStatus, setMicTestStatus] = React.useState("");
    const [micProcessingStatus, setMicProcessingStatus] = React.useState("");

    const [micMonitorEnabled, setMicMonitorEnabled] = React.useState(true);
    const [micMonitorVolume, setMicMonitorVolume] = React.useState(70);

    const micStreamRef = React.useRef<MediaStream | null>(null);
    const micAudioContextRef = React.useRef<AudioContext | null>(null);
    const micAnalyserRef = React.useRef<AnalyserNode | null>(null);
    const micFrameRef = React.useRef<number | null>(null);

    const micMonitorGainRef = React.useRef<GainNode | null>(null);
    const micMonitorDestRef = React.useRef<MediaStreamAudioDestinationNode | null>(null);
    const micMonitorAudioElRef = React.useRef<SinkAudioElement | null>(null);
    const micMonitorSourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);

    const restartTimerRef = React.useRef<number | null>(null);
    const restartSeqRef = React.useRef(0);

    const stopMicGraph = React.useCallback((opts?: { resetUi?: boolean }) => {
        const resetUi = opts?.resetUi !== false;

        if (micFrameRef.current != null) {
            cancelAnimationFrame(micFrameRef.current);
            micFrameRef.current = null;
        }

        try {
            micAnalyserRef.current?.disconnect();
        } catch { }

        try {
            micMonitorSourceRef.current?.disconnect();
        } catch { }

        try {
            micMonitorGainRef.current?.disconnect();
        } catch { }

        try {
            if (micMonitorAudioElRef.current) {
                micMonitorAudioElRef.current.pause();
                micMonitorAudioElRef.current.srcObject = null;
                micMonitorAudioElRef.current.remove();
            }
        } catch { }

        try {
            micAudioContextRef.current?.close();
        } catch { }

        try {
            micStreamRef.current?.getTracks().forEach((t) => t.stop());
        } catch { }

        micAnalyserRef.current = null;
        micAudioContextRef.current = null;
        micStreamRef.current = null;
        micMonitorGainRef.current = null;
        micMonitorDestRef.current = null;
        micMonitorAudioElRef.current = null;
        micMonitorSourceRef.current = null;

        setMicLevel(0);

        if (resetUi) {
            setMicTesting(false);
            setMicRestarting(false);
            setMicTestStatus("");
            setMicProcessingStatus("");
        }
    }, []);

    const stopMicTest = React.useCallback(() => {
        if (restartTimerRef.current != null) {
            window.clearTimeout(restartTimerRef.current);
            restartTimerRef.current = null;
        }

        restartSeqRef.current += 1;
        stopMicGraph({ resetUi: true });
    }, [stopMicGraph]);

    React.useEffect(() => {
        return () => {
            stopMicTest();
        };
    }, [stopMicTest]);

    const createMicGraph = React.useCallback(
        async (opts?: { restart?: boolean }) => {
            const isRestart = opts?.restart === true;
            const seq = restartSeqRef.current;

            if (isRestart) {
                setMicRestarting(true);
                setMicProcessingStatus("Restarting mic test with new processing…");
            } else {
                setMicTestError("");
                setMicProcessingStatus("");
                setMicTestStatus("Requesting microphone…");
            }

            stopMicGraph({ resetUi: false });

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: selectedAudioInputId ? { exact: selectedAudioInputId } : undefined,
                    echoCancellation: echoCancellationEnabled,
                    noiseSuppression: noiseSuppressionEnabled,
                    autoGainControl: autoGainControlEnabled,
                },
                video: false,
            });

            if (seq !== restartSeqRef.current) {
                try {
                    stream.getTracks().forEach((t) => t.stop());
                } catch { }
                return;
            }

            const AudioContextCtor =
                window.AudioContext ||
                (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

            if (!AudioContextCtor) {
                try {
                    stream.getTracks().forEach((t) => t.stop());
                } catch { }
                throw new Error("AudioContext is not supported in this browser.");
            }

            const ctx = new AudioContextCtor();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.8;

            const source = ctx.createMediaStreamSource(stream);
            source.connect(analyser);

            micStreamRef.current = stream;
            micAudioContextRef.current = ctx;
            micAnalyserRef.current = analyser;
            micMonitorSourceRef.current = source;

            if (micMonitorEnabled) {
                const dest = ctx.createMediaStreamDestination();
                const gain = ctx.createGain();
                const initialGain = Math.max(0, Math.min(1, micMonitorVolume / 100));

                gain.gain.value = initialGain;

                source.connect(gain);
                gain.connect(dest);

                const audioEl = document.createElement("audio") as SinkAudioElement;
                audioEl.autoplay = true;
                audioEl.playsInline = true;
                audioEl.muted = false;
                audioEl.srcObject = dest.stream;
                audioEl.style.display = "none";
                document.body.appendChild(audioEl);

                if (
                    selectedAudioOutputId &&
                    selectedAudioOutputId !== "default" &&
                    typeof audioEl.setSinkId === "function"
                ) {
                    await audioEl.setSinkId(selectedAudioOutputId);
                }

                await audioEl.play().catch(() => { });

                micMonitorGainRef.current = gain;
                micMonitorDestRef.current = dest;
                micMonitorAudioElRef.current = audioEl;
            }

            const track = stream.getAudioTracks()[0];
            const settings =
                track && typeof track.getSettings === "function"
                    ? track.getSettings()
                    : null;

            const data = new Uint8Array(analyser.fftSize);

            const tick = () => {
                if (!micAnalyserRef.current) return;

                micAnalyserRef.current.getByteTimeDomainData(data);

                let sumSquares = 0;
                for (let i = 0; i < data.length; i += 1) {
                    const normalized = (data[i] - 128) / 128;
                    sumSquares += normalized * normalized;
                }

                const rms = Math.sqrt(sumSquares / data.length);
                const boosted = Math.min(100, Math.max(0, Math.round(rms * 260)));
                setMicLevel(boosted);
                micFrameRef.current = requestAnimationFrame(tick);
            };

            setMicTesting(true);
            setMicRestarting(false);
            setMicTestError("");
            setMicTestStatus(
                micMonitorEnabled
                    ? "Speak now. You should see the level and hear your own voice."
                    : "Speak now and watch the level."
            );

            setMicProcessingStatus(
                settings
                    ? `Active test stream: echo ${settings.echoCancellation ? "on" : "off"}, noise ${settings.noiseSuppression ? "on" : "off"}, gain ${settings.autoGainControl ? "on" : "off"}`
                    : "Mic test stream started with current processing settings."
            );

            tick();
        },
        [
            autoGainControlEnabled,
            echoCancellationEnabled,
            noiseSuppressionEnabled,
            selectedAudioInputId,
            selectedAudioOutputId,
            micMonitorEnabled,
            micMonitorVolume,
            stopMicGraph,
        ]
    );

    const restartMicTestWithNewProcessing = React.useCallback(
        (reason = "processing-change") => {
            if (!micTesting && !micStreamRef.current) return;

            if (restartTimerRef.current != null) {
                window.clearTimeout(restartTimerRef.current);
            }

            setMicRestarting(true);
            setMicProcessingStatus("Re-applying mic processing…");

            restartTimerRef.current = window.setTimeout(() => {
                restartTimerRef.current = null;
                restartSeqRef.current += 1;

                void createMicGraph({ restart: true }).catch((err) => {
                    const message = err instanceof Error ? err.message : "Could not restart microphone test.";
                    console.warn("[RoomSettingsModalLiveKit] mic test restart failed", reason, err);
                    setMicTestError(message);
                    setMicRestarting(false);
                    setMicProcessingStatus(`Could not re-apply processing: ${message}`);
                });
            }, 80);
        },
        [createMicGraph, micTesting]
    );

    React.useEffect(() => {
        if (!micTesting || !micStreamRef.current) return;

        restartMicTestWithNewProcessing("processing-props-changed");
    }, [
        echoCancellationEnabled,
        noiseSuppressionEnabled,
        autoGainControlEnabled,
        restartMicTestWithNewProcessing,
        micTesting,
    ]);

    React.useEffect(() => {
        const gain = micMonitorGainRef.current;
        if (!gain) return;

        const next = micMonitorEnabled ? Math.max(0, Math.min(1, micMonitorVolume / 100)) : 0;

        try {
            if (micAudioContextRef.current) {
                gain.gain.setTargetAtTime(next, micAudioContextRef.current.currentTime, 0.015);
            } else {
                gain.gain.value = next;
            }
        } catch { }
    }, [micMonitorEnabled, micMonitorVolume]);

    React.useEffect(() => {
        const audioEl = micMonitorAudioElRef.current;
        if (!audioEl) return;

        if (
            selectedAudioOutputId &&
            selectedAudioOutputId !== "default" &&
            typeof audioEl.setSinkId === "function"
        ) {
            audioEl.setSinkId(selectedAudioOutputId).catch(() => { });
        }
    }, [selectedAudioOutputId]);

    const startMicTest = React.useCallback(async () => {
        try {
            restartSeqRef.current += 1;
            await createMicGraph({ restart: false });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Could not start microphone test.";
            setMicTestError(message);
            setMicTesting(false);
            setMicRestarting(false);
            setMicLevel(0);
            setMicTestStatus("");
            setMicProcessingStatus("");
        }
    }, [createMicGraph]);

    const playSpeakerTest = React.useCallback(async () => {
        let ctx: AudioContext | null = null;
        let streamDest: MediaStreamAudioDestinationNode | null = null;
        let oscillator: OscillatorNode | null = null;
        let gain: GainNode | null = null;
        let audioEl: SinkAudioElement | null = null;
        let cleanupTimer: number | null = null;

        const cleanup = async () => {
            if (cleanupTimer != null) {
                window.clearTimeout(cleanupTimer);
                cleanupTimer = null;
            }

            try {
                oscillator?.stop();
            } catch { }

            try {
                oscillator?.disconnect();
            } catch { }

            try {
                gain?.disconnect();
            } catch { }

            try {
                if (audioEl) {
                    audioEl.pause();
                    audioEl.srcObject = null;
                    audioEl.remove();
                }
            } catch { }

            try {
                await ctx?.close();
            } catch { }
        };

        try {
            setSpeakerTesting(true);
            setSpeakerTestError("");
            setSpeakerTestStatus("Playing test sound…");

            const AudioContextCtor =
                window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

            if (!AudioContextCtor) {
                throw new Error("AudioContext is not supported in this browser.");
            }

            ctx = new AudioContextCtor();
            streamDest = ctx.createMediaStreamDestination();
            oscillator = ctx.createOscillator();
            gain = ctx.createGain();

            oscillator.type = "sine";
            oscillator.frequency.value = 880;

            const now = ctx.currentTime;
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.16, now + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);

            oscillator.connect(gain);
            gain.connect(streamDest);

            audioEl = document.createElement("audio") as SinkAudioElement;
            audioEl.autoplay = true;
            audioEl.playsInline = true;
            audioEl.muted = false;
            audioEl.srcObject = streamDest.stream;
            audioEl.style.display = "none";
            document.body.appendChild(audioEl);

            if (
                selectedAudioOutputId &&
                selectedAudioOutputId !== "default" &&
                typeof audioEl.setSinkId === "function"
            ) {
                await audioEl.setSinkId(selectedAudioOutputId);
            }

            await audioEl.play();

            oscillator.start(now);
            oscillator.stop(now + 1.05);

            cleanupTimer = window.setTimeout(() => {
                void cleanup();
                setSpeakerTesting(false);
                setSpeakerTestStatus("Done.");
            }, 1200);
        } catch (err) {
            await cleanup();
            const message = err instanceof Error ? err.message : "Could not play test sound.";
            setSpeakerTestError(message);
            setSpeakerTesting(false);
            setSpeakerTestStatus("");
        }
    }, [selectedAudioOutputId]);

    const meterGradient = isLight
        ? "linear-gradient(90deg, #22c55e 0%, #84cc16 45%, #eab308 75%, #f97316 88%, #ef4444 100%)"
        : "linear-gradient(90deg, #34d399 0%, #a3e635 45%, #facc15 75%, #fb923c 88%, #f87171 100%)";

    return (
        <div className={`rounded-2xl p-4 ${sectionCls}`}>
            <div className="text-[13px] font-semibold mb-4">Sound test</div>

            <div className="flex flex-col gap-5">
                <div>
                    <div className={`text-[13px] font-semibold ${isLight ? "text-black/85" : "text-white/90"}`}>
                        Test speakers / output
                    </div>
                    <div className={`mt-1 text-[12px] ${subtleText}`}>
                        Plays a short test tone through the currently selected output device when the browser allows it.
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void playSpeakerTest()}
                            disabled={speakerTesting}
                            className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${ghostBtn} disabled:opacity-60`}
                        >
                            {speakerTesting ? "Playing…" : "Play test sound"}
                        </button>
                    </div>

                    {speakerTestStatus ? (
                        <div className={`mt-2 text-[12px] ${subtleText}`}>{speakerTestStatus}</div>
                    ) : null}

                    {speakerTestError ? (
                        <div className="mt-2 text-[12px] text-red-500 break-words">{speakerTestError}</div>
                    ) : null}
                </div>

                <div className="border-t border-[#3F3F46] pt-5">
                    <div className={`text-[13px] font-semibold ${isLight ? "text-black/85" : "text-white/90"}`}>
                        Test microphone
                    </div>
                    <div className={`mt-1 text-[12px] ${subtleText}`}>
                        Uses your selected microphone. Processing changes restart the test stream automatically while the test is running.
                    </div>

                    <div className="mt-4 flex flex-col gap-4">
                        <ToggleRow
                            label="Hear my voice while testing"
                            description="Routes your microphone back to your selected speakers while the mic test is running. Headphones are recommended to avoid feedback."
                            checked={micMonitorEnabled}
                            onChange={setMicMonitorEnabled}
                            isLight={isLight}
                        />

                        <SliderField
                            label="Monitor volume"
                            description="How loud your own monitored voice plays back during the mic test."
                            min={0}
                            max={100}
                            step={1}
                            value={micMonitorVolume}
                            onChange={setMicMonitorVolume}
                            disabled={!micMonitorEnabled}
                            isLight={isLight}
                            valueSuffix="%"
                        />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        {!micTesting ? (
                            <button
                                type="button"
                                onClick={() => void startMicTest()}
                                className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${ghostBtn}`}
                            >
                                Start mic test
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={stopMicTest}
                                className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${ghostBtn}`}
                            >
                                Stop mic test
                            </button>
                        )}

                        {micRestarting ? (
                            <div className={`text-[12px] ${subtleText}`}>Restarting…</div>
                        ) : null}
                    </div>

                    <div className="mt-4">
                        <div
                            className={[
                                "h-3 rounded-full overflow-hidden border",
                                isLight ? "bg-[#F3F1F1] border-[#D8D0D0]" : "bg-[#27272A] border-[#3F3F46]",
                            ].join(" ")}
                        >
                            <div
                                className="h-full rounded-full transition-[width] duration-100"
                                style={{
                                    width: `${Math.max(2, micLevel)}%`,
                                    background: meterGradient,
                                }}
                            />
                        </div>

                        <div className={`mt-2 text-[12px] ${subtleText}`}>
                            Input level: <span className="font-semibold">{micLevel}%</span>
                        </div>

                        {micTestStatus ? (
                            <div className={`mt-2 text-[12px] ${subtleText}`}>{micTestStatus}</div>
                        ) : null}

                        {micProcessingStatus ? (
                            <div className={`mt-2 text-[12px] ${subtleText}`}>{micProcessingStatus}</div>
                        ) : null}

                        {micTestError ? (
                            <div className="mt-2 text-[12px] text-red-500 break-words">{micTestError}</div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

export function RoomSettingsModalLiveKit({
    open,
    theme,
    mode,
    blurStrength,
    onBlurStrengthChange,
    bgImageUrl,
    onSetBgImageUrl,
    defaultRemoteVolumePct,
    onDefaultRemoteVolumePctChange,
    onResetAllParticipantVolumes,
    onApplyMode,
    onClose,
    fxError,
    fxApplying,
    fxStatusText,
    previewTrack,
    previewVideoFilterCss,
    previewMirrored,
    onTogglePreviewMirrored,
    onUploadBg,
    onResetBg,

    videoTileLayoutPreset = "auto",
    videoTileLayoutColumns = 0,
    videoTileLayoutRows = 0,
    onChangeVideoTileLayoutPreset,
    onChangeVideoTileLayoutColumns,
    onChangeVideoTileLayoutRows,
    showMobileLayoutSwitcher = true,
    onChangeShowMobileLayoutSwitcher,

    devices,
    selectedAudioInputId,
    selectedVideoInputId,
    selectedAudioOutputId,
    onChangeAudioInput,
    onChangeVideoInput,
    onChangeAudioOutput,

    echoCancellationEnabled,
    noiseSuppressionEnabled,
    autoGainControlEnabled,
    onChangeEchoCancellation,
    onChangeNoiseSuppression,
    onChangeAutoGainControl,

    roomSoundsEnabled,
    roomSoundsVolume,
    onToggleRoomSounds,
    onChangeRoomSoundsVolume,

    colorCorrectionEnabled,
    brightness,
    contrast,
    saturate,
    onToggleColorCorrection,
    onChangeBrightness,
    onChangeContrast,
    onChangeSaturate,

    hideBackgroundFx = false,
}: {
    open: boolean;
    theme: RoomTheme;
    mode: FxMode;
    blurStrength: number;
    onBlurStrengthChange: (v: number) => void;
    bgImageUrl: string;
    onSetBgImageUrl: (url: string) => void;

    defaultRemoteVolumePct: number;
    onDefaultRemoteVolumePctChange: (value: number) => void;
    onResetAllParticipantVolumes: () => void;

    onApplyMode: (m: FxMode) => void | Promise<void>;
    onClose: () => void;
    fxError: string;
    fxApplying: boolean;
    fxStatusText: string;
    previewTrack?: {
        attach?: () => HTMLMediaElement;
        detach?: (element?: HTMLMediaElement) => void;
    } | null;
    previewVideoFilterCss?: string;
    previewMirrored: boolean;
    onTogglePreviewMirrored: (v: boolean) => void;
    onUploadBg: (file: File) => void;
    onResetBg: () => void;

    videoTileLayoutPreset?: VideoTileLayoutPreset;
    videoTileLayoutColumns?: number;
    videoTileLayoutRows?: number;
    onChangeVideoTileLayoutPreset?: (v: VideoTileLayoutPreset) => void;
    onChangeVideoTileLayoutColumns?: (v: number) => void;
    onChangeVideoTileLayoutRows?: (v: number) => void;
    showMobileLayoutSwitcher?: boolean;
    onChangeShowMobileLayoutSwitcher?: (v: boolean) => void;


    devices: {
        videoInputs: MediaDeviceInfo[];
        audioInputs: MediaDeviceInfo[];
        audioOutputs: MediaDeviceInfo[];
    };
    selectedAudioInputId: string;
    selectedVideoInputId: string;
    selectedAudioOutputId: string;
    onChangeAudioInput: (v: string) => void | Promise<void>;
    onChangeVideoInput: (v: string) => void | Promise<void>;
    onChangeAudioOutput: (v: string) => void;

    echoCancellationEnabled: boolean;
    noiseSuppressionEnabled: boolean;
    autoGainControlEnabled: boolean;
    onChangeEchoCancellation: (v: boolean) => void | Promise<void>;
    onChangeNoiseSuppression: (v: boolean) => void | Promise<void>;
    onChangeAutoGainControl: (v: boolean) => void | Promise<void>;

    roomSoundsEnabled: boolean;
    roomSoundsVolume: number;
    onToggleRoomSounds: () => void;
    onChangeRoomSoundsVolume: (v: number) => void;

    colorCorrectionEnabled: boolean;
    brightness: number;
    contrast: number;
    saturate: number;
    onToggleColorCorrection: (v: boolean) => void;
    onChangeBrightness: (v: number) => void;
    onChangeContrast: (v: number) => void;
    onChangeSaturate: (v: number) => void;

    hideBackgroundFx?: boolean;
}) {
    const isLight = theme === "light";
    const firefoxSafeUi = React.useMemo(() => isFirefoxLike(), []);

    const isDesktopFx =
        typeof window === "undefined" || !window.matchMedia
            ? true
            : window.matchMedia("(min-width: 1024px)").matches;

    const disableFxControls = hideBackgroundFx;

    const [blurDraft, setBlurDraft] = React.useState(() =>
        normalizeBlurDraft(blurStrength, firefoxSafeUi)
    );
    const [localFxApplying, setLocalFxApplying] = React.useState(false);
    const [recoveryGuideOpen, setRecoveryGuideOpen] = React.useState<RecoveryGuideKey | null>(null);
    const applyModeInFlightRef = React.useRef(false);
    const pendingApplyRef = React.useRef<{ mode: FxMode; reason: string } | null>(null);
    const blurApplyTimerRef = React.useRef<number | null>(null);

    const effectiveFxApplying = !!fxApplying || localFxApplying;

    React.useEffect(() => {
        setBlurDraft(normalizeBlurDraft(blurStrength, firefoxSafeUi));
    }, [blurStrength, firefoxSafeUi]);

    React.useEffect(() => {
        return () => {
            if (blurApplyTimerRef.current != null) {
                window.clearTimeout(blurApplyTimerRef.current);
                blurApplyTimerRef.current = null;
            }
        };
    }, []);

    const safeApplyMode = React.useCallback(
        async (nextMode: FxMode, reason = "") => {
            if (disableFxControls && nextMode !== "off") return;

            if (applyModeInFlightRef.current) {
                pendingApplyRef.current = { mode: nextMode, reason };
                return;
            }

            applyModeInFlightRef.current = true;
            setLocalFxApplying(true);

            try {
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                await onApplyMode(nextMode);
            } catch {
                // Parent owns fxError/fxStatusText.
            } finally {
                applyModeInFlightRef.current = false;
                setLocalFxApplying(false);

                const pending = pendingApplyRef.current;
                pendingApplyRef.current = null;

                if (pending) {
                    window.setTimeout(() => {
                        void safeApplyMode(pending.mode, pending.reason);
                    }, firefoxSafeUi ? 180 : 60);
                }
            }
        },
        [disableFxControls, onApplyMode, firefoxSafeUi]
    );

    const scheduleBlurChange = React.useCallback(
        (raw: number) => {
            const next = normalizeBlurDraft(raw, firefoxSafeUi);
            setBlurDraft(next);
            onBlurStrengthChange(next);

            if (blurApplyTimerRef.current != null) {
                window.clearTimeout(blurApplyTimerRef.current);
            }

            if (disableFxControls || mode !== "blur") return;

            blurApplyTimerRef.current = window.setTimeout(() => {
                blurApplyTimerRef.current = null;
                void safeApplyMode("blur", "blur-slider");
            }, firefoxSafeUi ? 700 : 300);
        },
        [disableFxControls, firefoxSafeUi, mode, onBlurStrengthChange, safeApplyMode]
    );

    if (!open) return null;

    const isCustomBackground = !!bgImageUrl && !FX_BG_PRESETS.some((p) => p.url === bgImageUrl);

    const overlay =
        "fixed inset-0 z-[1001] flex items-stretch sm:items-center justify-center " +
        "px-0 sm:px-3 py-0 sm:py-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]";

    const backdrop = "absolute inset-0 bg-black/60";

    const card = [
        "relative w-full sm:max-w-[1100px] rounded-none sm:rounded-3xl shadow-2xl overflow-hidden",
        "max-h-[100dvh] sm:max-h-[92vh] flex flex-col",
        isLight ? "bg-[#F5F5F5] text-black border border-[#D8D0D0]" : "bg-[#18181B] text-white border border-[#3F3F46]",
    ].join(" ");

    const sectionCls = isLight ? "bg-white border border-[#D8D0D0]" : "bg-[#27272A] border border-[#3F3F46]";
    const ghostBtn = isLight ? "border border-[#D8D0D0] bg-[#F3F1F1] hover:bg-[#ECEAEA] text-black/80" : "border border-[#3F3F46] bg-[#3F3F46] hover:bg-[#52525B] text-white/85";
    const activeBtn = isLight ? "bg-[#1F1F1F] text-white" : "bg-white text-[#18181B]";
    const subtleText = isLight ? "text-black/55" : "text-white/55";

    const audioInputOptions = [
        { value: "", label: devices.audioInputs?.length ? "Default microphone" : "No microphones found" },
        ...(devices.audioInputs || []).map((d, idx) => ({
            value: d.deviceId,
            label: d.label || `Microphone ${idx + 1}`,
        })),
    ];

    const videoInputOptions = [
        { value: "", label: devices.videoInputs?.length ? "Default camera" : "No cameras found" },
        ...(devices.videoInputs || []).map((d, idx) => ({
            value: d.deviceId,
            label: d.label || `Camera ${idx + 1}`,
        })),
    ];

    const audioOutputOptions = [
        { value: "default", label: "Default speakers" },
        ...(devices.audioOutputs || []).map((d, idx) => ({
            value: d.deviceId,
            label: d.label || `Output ${idx + 1}`,
        })),
    ];

    const layoutPresetOptions: Array<{ value: string; label: string }> = [
        { value: "auto", label: "Auto — MySession decides" },
        { value: "one", label: "1 column" },
        { value: "two", label: "2 columns" },
        { value: "three", label: "3 columns" },
        { value: "four", label: "4 columns" },
        { value: "five", label: "5 columns" },
        { value: "six", label: "6 columns" },
        { value: "strip", label: "Horizontal strip / swipe" },
    ];

    const layoutCountOptions: Array<{ value: string; label: string }> = [
        { value: "0", label: "Auto" },
        { value: "1", label: "1" },
        { value: "2", label: "2" },
        { value: "3", label: "3" },
        { value: "4", label: "4" },
        { value: "5", label: "5" },
        { value: "6", label: "6" },
    ];

    const effectivePreviewFilterCss = colorCorrectionEnabled ? (previewVideoFilterCss || "") : "";

    return (
        <div className={overlay} data-theme={theme} style={{ colorScheme: theme }}>
            <div className={backdrop} onClick={onClose} />

            <div className={card}>
                <div className={`px-5 sm:px-6 py-4 sm:py-5 border-b ${isLight ? "border-[#D8D0D0]" : "border-[#3F3F46]"}`}>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="font-semibold text-[16px]">Settings</div>
                            <div className={`text-[12px] mt-1 ${subtleText}`}>
                                Camera, mic, speakers and room tools. Use the recovery guides if audio or video gets stuck.
                            </div>
                        </div>

                        <button
                            onClick={onClose}
                            className={`w-9 h-9 rounded-2xl ${ghostBtn}`}
                            type="button"
                            title="Close"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                <div className="px-5 sm:px-6 py-4 sm:py-5 flex-1 overflow-y-auto overscroll-contain">
                    <div className={`mb-5 rounded-2xl p-4 ${sectionCls}`}>
                        <div className="flex items-start justify-between gap-3 mb-4">
                            <div className="min-w-0">
                                <div className="text-[13px] font-semibold">Video tile layout</div>
                                <div className={`mt-1 text-[12px] leading-5 ${subtleText}`}>
                                    If the room grid looks broken on your device, override the tile layout here. These settings are saved on this browser.
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => {
                                    onChangeVideoTileLayoutPreset?.("auto");
                                    onChangeVideoTileLayoutColumns?.(0);
                                    onChangeVideoTileLayoutRows?.(0);
                                }}
                                className={`h-9 px-3 rounded-xl text-[12px] font-semibold ${ghostBtn}`}
                            >
                                Reset layout
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <SelectField
                                label="Layout preset"
                                value={videoTileLayoutPreset}
                                onChange={(v) => onChangeVideoTileLayoutPreset?.(v as VideoTileLayoutPreset)}
                                options={layoutPresetOptions}
                                isLight={isLight}
                            />

                            <SelectField
                                label="Force columns"
                                value={String(videoTileLayoutColumns || 0)}
                                onChange={(v) => onChangeVideoTileLayoutColumns?.(Number(v) || 0)}
                                options={layoutCountOptions}
                                isLight={isLight}
                            />

                            <SelectField
                                label="Force rows"
                                value={String(videoTileLayoutRows || 0)}
                                onChange={(v) => onChangeVideoTileLayoutRows?.(Number(v) || 0)}
                                options={layoutCountOptions}
                                isLight={isLight}
                            />
                        </div>

                        <div className={`mt-3 text-[12px] leading-5 ${subtleText}`}>
                            Columns win first. If columns are Auto, forced rows can rebalance the grid. Horizontal strip is useful for narrow phones and landscape mode.
                        </div>
                        <div className={`mt-4 pt-4 border-t ${isLight ? "border-[#D8D0D0]" : "border-[#3F3F46]"}`}>
                            <ToggleRow
                                label="Show mobile layout switcher"
                                description="Shows the floating Auto / 1 / 2 layout buttons on phones and tablets."
                                checked={showMobileLayoutSwitcher}
                                onChange={(v) => onChangeShowMobileLayoutSwitcher?.(v)}
                                isLight={isLight}
                            />
                        </div>
                    </div>

                    <div className={`mb-5 rounded-2xl p-4 ${sectionCls}`}>
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                            <div className="min-w-0">
                                <div className="text-[13px] font-semibold">Audio / video rescue</div>
                                <div className={`mt-1 text-[12px] leading-5 ${subtleText}`}>
                                    If a first-time user cannot start camera, mic, or sound, follow these guided recovery steps before leaving the room.
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <HelpButton isLight={isLight} onClick={() => setRecoveryGuideOpen("quick")}>Quick rescue</HelpButton>
                                <HelpButton isLight={isLight} onClick={() => setRecoveryGuideOpen("camera")}>Camera</HelpButton>
                                <HelpButton isLight={isLight} onClick={() => setRecoveryGuideOpen("microphone")}>Mic</HelpButton>
                                <HelpButton isLight={isLight} onClick={() => setRecoveryGuideOpen("speakers")}>Sound</HelpButton>
                                {firefoxSafeUi ? (
                                    <HelpButton isLight={isLight} onClick={() => setRecoveryGuideOpen("firefox")}>Firefox</HelpButton>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
                        <div className="flex flex-col gap-5 min-w-0">
                            <div className={`rounded-2xl p-4 ${sectionCls}`}>
                                <div className="flex items-center justify-between gap-3 mb-4">
                                    <div className="text-[13px] font-semibold">Devices</div>
                                    <div className="flex items-center gap-2">
                                        <HelpButton compact isLight={isLight} onClick={() => setRecoveryGuideOpen("camera")}>Camera</HelpButton>
                                        <HelpButton compact isLight={isLight} onClick={() => setRecoveryGuideOpen("microphone")}>Mic</HelpButton>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <SelectField
                                        label="Microphone"
                                        value={selectedAudioInputId}
                                        onChange={(v) => {
                                            void onChangeAudioInput(v);
                                        }}
                                        options={audioInputOptions}
                                        isLight={isLight}
                                    />

                                    <SelectField
                                        label="Camera"
                                        value={selectedVideoInputId}
                                        onChange={(v) => {
                                            void onChangeVideoInput(v);
                                        }}
                                        options={videoInputOptions}
                                        isLight={isLight}
                                    />

                                    <div className="md:col-span-2">
                                        <SelectField
                                            label="Speakers / output"
                                            value={selectedAudioOutputId}
                                            onChange={onChangeAudioOutput}
                                            options={audioOutputOptions}
                                            isLight={isLight}
                                        />
                                    </div>
                                </div>
                            </div>

                            {firefoxSafeUi ? (
                                <div className={`rounded-2xl p-4 ${sectionCls}`}>
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="text-[13px] font-semibold">Firefox laptop tip</div>
                                            <div className={`mt-1 text-[12px] leading-5 ${subtleText}`}>
                                                If camera or mic does not start, allow permissions from the lock icon, choose exact devices, then toggle camera/mic once.
                                            </div>
                                        </div>
                                        <HelpButton compact isLight={isLight} onClick={() => setRecoveryGuideOpen("firefox")}>Guide</HelpButton>
                                    </div>
                                </div>
                            ) : null}

                            <div className={`rounded-2xl p-4 ${sectionCls}`}>
                                <div className="flex items-center justify-between gap-3 mb-4">
                                    <div className="text-[13px] font-semibold">Microphone processing</div>
                                    <HelpButton compact isLight={isLight} onClick={() => setRecoveryGuideOpen("microphone")}>Mic guide</HelpButton>
                                </div>

                                <div className="flex flex-col gap-4">
                                    <ToggleRow
                                        label="Echo cancellation"
                                        description="Reduce echo from speakers going back into the mic."
                                        checked={echoCancellationEnabled}
                                        onChange={(v) => {
                                            void onChangeEchoCancellation(v);
                                        }}
                                        isLight={isLight}
                                    />

                                    <ToggleRow
                                        label="Noise suppression"
                                        description="Reduce keyboard noise, fan noise and room hum."
                                        checked={noiseSuppressionEnabled}
                                        onChange={(v) => {
                                            void onChangeNoiseSuppression(v);
                                        }}
                                        isLight={isLight}
                                    />

                                    <ToggleRow
                                        label="Auto gain control"
                                        description="Automatically normalize mic loudness."
                                        checked={autoGainControlEnabled}
                                        onChange={(v) => {
                                            void onChangeAutoGainControl(v);
                                        }}
                                        isLight={isLight}
                                    />
                                </div>
                            </div>

                            <div className="relative">
                                <SoundTestSection
                                    isLight={isLight}
                                    sectionCls={sectionCls}
                                    ghostBtn={ghostBtn}
                                    subtleText={subtleText}
                                    selectedAudioInputId={selectedAudioInputId}
                                    selectedAudioOutputId={selectedAudioOutputId}
                                    echoCancellationEnabled={echoCancellationEnabled}
                                    noiseSuppressionEnabled={noiseSuppressionEnabled}
                                    autoGainControlEnabled={autoGainControlEnabled}
                                />
                                <div className="absolute right-4 top-4 flex items-center gap-2">
                                    <HelpButton compact isLight={isLight} onClick={() => setRecoveryGuideOpen("speakers")}>Sound guide</HelpButton>
                                </div>
                            </div>

                            <div className={`rounded-2xl p-4 ${sectionCls}`}>
                                <div className="text-[13px] font-semibold mb-4">Room tools</div>

                                <div className="flex flex-col gap-4">
                                    <ToggleRow
                                        label="Room sounds"
                                        description="Enable join / leave and other room UI sounds."
                                        checked={roomSoundsEnabled}
                                        onChange={() => onToggleRoomSounds()}
                                        isLight={isLight}
                                    />

                                    <SliderField
                                        label="Stage sounds volume"
                                        description="Controls how loud local stage sounds play in this room."
                                        min={0}
                                        max={100}
                                        step={1}
                                        value={roomSoundsVolume}
                                        onChange={onChangeRoomSoundsVolume}
                                        disabled={!roomSoundsEnabled}
                                        isLight={isLight}
                                        valueSuffix="%"
                                    />

                                    <div className="border-t border-[#3F3F46] pt-4">
                                        <SliderField
                                            label="Default remote volume"
                                            description="Boost everyone at once, then fine-tune individual people separately."
                                            min={25}
                                            max={300}
                                            step={5}
                                            value={defaultRemoteVolumePct}
                                            onChange={onDefaultRemoteVolumePctChange}
                                            isLight={isLight}
                                            valueSuffix="%"
                                        />

                                        <div className="mt-3 flex flex-wrap items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => onDefaultRemoteVolumePctChange(100)}
                                                className={`h-9 px-3 rounded-xl text-[12px] ${ghostBtn}`}
                                            >
                                                100%
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => onDefaultRemoteVolumePctChange(125)}
                                                className={`h-9 px-3 rounded-xl text-[12px] ${ghostBtn}`}
                                            >
                                                125%
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => onDefaultRemoteVolumePctChange(150)}
                                                className={`h-9 px-3 rounded-xl text-[12px] ${ghostBtn}`}
                                            >
                                                150%
                                            </button>

                                            <button
                                                type="button"
                                                onClick={onResetAllParticipantVolumes}
                                                className={`h-9 px-3 rounded-xl text-[12px] ${ghostBtn}`}
                                            >
                                                Reset people volumes
                                            </button>
                                        </div>
                                    </div>

                                    <ToggleRow
                                        label="Mirror camera preview"
                                        description="Flip your local preview horizontally like a typical selfie view."
                                        checked={previewMirrored}
                                        onChange={onTogglePreviewMirrored}
                                        isLight={isLight}
                                    />
                                </div>
                            </div>

                            {!isDesktopFx && (
                                <div className={`rounded-2xl p-4 ${sectionCls}`}>
                                    <div className={`text-[13px] font-semibold ${isLight ? "text-black/85" : "text-white/90"}`}>
                                        FX unavailable on mobile / tablet
                                    </div>
                                    <div className={`mt-2 text-[12px] ${subtleText}`}>
                                        Blur, background replacement and color correction are disabled on mobile and tablet for stability.
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col gap-5 min-w-0 xl:sticky xl:top-0">
                            <div className={`rounded-2xl p-4 ${sectionCls}`}>
                                <VideoPreviewBox
                                    track={previewTrack}
                                    filterCss={effectivePreviewFilterCss}
                                    isLight={isLight}
                                    label="Live preview"
                                    mirrored={previewMirrored}
                                />
                            </div>

                            {!disableFxControls && (
                                <>
                                    <div className={`rounded-2xl p-4 ${sectionCls}`}>
                                        <div className="text-[13px] font-semibold mb-3">Video effect mode</div>

                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                onClick={() => void safeApplyMode("off", "mode-button")}
                                                className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "off" ? activeBtn : ghostBtn}`}
                                                disabled={effectiveFxApplying}
                                                type="button"
                                            >
                                                FX off
                                            </button>

                                            <button
                                                onClick={() => void safeApplyMode("blur", "mode-button")}
                                                className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "blur" ? activeBtn : ghostBtn}`}
                                                disabled={effectiveFxApplying}
                                                type="button"
                                            >
                                                Blur
                                            </button>

                                            <button
                                                onClick={() => void safeApplyMode("bg", "mode-button")}
                                                className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "bg" ? activeBtn : ghostBtn}`}
                                                disabled={effectiveFxApplying}
                                                type="button"
                                            >
                                                Background image
                                            </button>
                                        </div>

                                        <div className={`mt-3 text-[12px] ${subtleText}`}>
                                            {effectiveFxApplying ? "Applying effect…" : fxStatusText || "Ready"}
                                        </div>

                                        {fxError ? <div className="mt-2 text-[12px] text-red-500 break-words">{fxError}</div> : null}
                                    </div>

                                    <div className={`rounded-2xl p-4 ${sectionCls}`}>
                                        <SliderField
                                            label="Blur strength"
                                            description="Used when Blur mode is active."
                                            min={4}
                                            max={30}
                                            step={2}
                                            value={blurDraft}
                                            onChange={scheduleBlurChange}
                                            disabled={disableFxControls || mode !== "blur"}
                                            isLight={isLight}
                                            valueSuffix="px"
                                        />
                                    </div>

                                    <div className={`rounded-2xl p-4 ${sectionCls}`}>
                                        <div className="flex items-center justify-between gap-3 mb-3">
                                            <div>
                                                <div className="text-[13px] font-semibold">Custom background</div>
                                                <div className={`text-[12px] mt-1 ${subtleText}`}>
                                                    Upload your own image and use it in Background image mode.
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <label className={`h-9 px-3 rounded-xl text-[12px] ${ghostBtn} cursor-pointer flex items-center`}>
                                                    Upload
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            const f = e.target.files?.[0];
                                                            if (!f) return;
                                                            onUploadBg(f);
                                                            e.currentTarget.value = "";
                                                        }}
                                                    />
                                                </label>

                                                <button
                                                    onClick={onResetBg}
                                                    className={`h-9 px-3 rounded-xl text-[12px] ${ghostBtn}`}
                                                    disabled={effectiveFxApplying || !bgImageUrl}
                                                    type="button"
                                                >
                                                    Clear
                                                </button>
                                            </div>
                                        </div>

                                        <div
                                            className={[
                                                "rounded-2xl overflow-hidden border",
                                                isLight ? "border-[#D8D0D0] bg-white" : "border-[#3F3F46] bg-[#27272A]",
                                            ].join(" ")}
                                        >
                                            <div className="aspect-video w-full">
                                                {bgImageUrl ? (
                                                    <img src={bgImageUrl} alt="Custom background preview" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className={`w-full h-full flex items-center justify-center text-[12px] ${subtleText}`}>
                                                        No custom background selected
                                                    </div>
                                                )}
                                            </div>

                                            <div className={`px-3 py-2 text-[12px] ${subtleText}`}>
                                                {bgImageUrl
                                                    ? isCustomBackground
                                                        ? "Custom uploaded background selected"
                                                        : "Preset background selected"
                                                    : "Upload an image to use your own background"}
                                            </div>
                                        </div>

                                        <div className={`mt-3 text-[12px] ${subtleText}`}>
                                            Tip: after upload, switch to <span className="font-semibold">Background image</span> mode if it is not active already.
                                        </div>
                                    </div>

                                    <div className={`rounded-2xl p-4 ${sectionCls}`}>
                                        <div className="flex items-center justify-between gap-3 mb-3">
                                            <div>
                                                <div className="text-[13px] font-semibold">Background presets</div>
                                                <div className={`text-[12px] mt-1 ${subtleText}`}>
                                                    Quick built-in backgrounds for Background image mode.
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            {FX_BG_PRESETS.map((p) => {
                                                const selected = bgImageUrl === p.url;

                                                return (
                                                    <button
                                                        key={p.id}
                                                        onClick={() => {
                                                            onSetBgImageUrl(p.url);
                                                            if (mode === "bg") {
                                                                void safeApplyMode("bg", "background-preset");
                                                            }
                                                        }}
                                                        className={
                                                            "rounded-2xl overflow-hidden border text-left " +
                                                            (selected
                                                                ? isLight
                                                                    ? "border-blue-500 ring-2 ring-blue-300"
                                                                    : "border-emerald-400 ring-2 ring-emerald-300/25"
                                                                : isLight
                                                                    ? "border-[#D8D0D0]"
                                                                    : "border-[#3F3F46]")
                                                        }
                                                        title={p.label}
                                                        disabled={effectiveFxApplying}
                                                        type="button"
                                                    >
                                                        <div className="aspect-video w-full">
                                                            <img src={p.url} alt={p.label} className="w-full h-full object-cover" />
                                                        </div>
                                                        <div className={`px-2 py-2 text-[12px] ${isLight ? "bg-white" : "bg-[#27272A]"}`}>{p.label}</div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className={`rounded-2xl p-4 ${sectionCls}`}>
                                        <div className="text-[13px] font-semibold mb-4">Color correction</div>

                                        <div className="flex flex-col gap-4">
                                            <ToggleRow
                                                label="Enable color correction"
                                                description="Applies CSS video correction in the room UI. This is visual and local."
                                                checked={colorCorrectionEnabled}
                                                onChange={onToggleColorCorrection}
                                                isLight={isLight}
                                            />

                                            <SliderField
                                                label="Brightness"
                                                min={50}
                                                max={150}
                                                step={1}
                                                value={brightness}
                                                onChange={onChangeBrightness}
                                                disabled={!colorCorrectionEnabled}
                                                isLight={isLight}
                                            />

                                            <SliderField
                                                label="Contrast"
                                                min={50}
                                                max={150}
                                                step={1}
                                                value={contrast}
                                                onChange={onChangeContrast}
                                                disabled={!colorCorrectionEnabled}
                                                isLight={isLight}
                                            />

                                            <SliderField
                                                label="Saturation"
                                                min={50}
                                                max={180}
                                                step={1}
                                                value={saturate}
                                                onChange={onChangeSaturate}
                                                disabled={!colorCorrectionEnabled}
                                                isLight={isLight}
                                            />
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className={`px-5 sm:px-6 py-4 border-t flex items-center justify-end gap-3 ${isLight ? "border-[#D8D0D0]" : "border-[#3F3F46]"}`}>
                    <button
                        onClick={onClose}
                        className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${ghostBtn}`}
                        type="button"
                    >
                        Close
                    </button>
                </div>
            </div>

            <RecoveryGuideModal
                guideKey={recoveryGuideOpen}
                onClose={() => setRecoveryGuideOpen(null)}
                isLight={isLight}
            />
        </div>
    );
}

export default RoomSettingsModalLiveKit;