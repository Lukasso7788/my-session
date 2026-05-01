import React from "react";

type RoomTheme = "dark" | "light";
type FxMode = "off" | "blur" | "bg";

type SinkAudioElement = HTMLAudioElement & {
    setSinkId?: (sinkId: string) => Promise<void>;
    srcObject?: MediaStream | null;
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
                            ? "bg-blue-600 border-blue-600"
                            : "bg-emerald-500 border-emerald-500"
                        : isLight
                            ? "bg-black/5 border-black/10"
                            : "bg-white/5 border-white/10",
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
                    isLight ? "bg-white border-black/10 text-black/85" : "bg-[#0b1220] border-white/10 text-white/90",
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
                    isLight ? "border-black/10 bg-black/5" : "border-white/10 bg-[#0b1220]",
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

    const applyMicProcessingToActiveTestTrack = React.useCallback(
        async (reason = "settings-change") => {
            const stream = micStreamRef.current;
            const track = stream?.getAudioTracks?.()[0];

            if (!track || track.readyState !== "live") return false;

            if (typeof track.applyConstraints !== "function") {
                setMicProcessingStatus("This browser cannot update mic processing while testing.");
                return false;
            }

            try {
                setMicProcessingStatus("Applying mic processing…");

                await track.applyConstraints({
                    echoCancellation: echoCancellationEnabled,
                    noiseSuppression: noiseSuppressionEnabled,
                    autoGainControl: autoGainControlEnabled,
                } as MediaTrackConstraints);

                const settings =
                    typeof track.getSettings === "function"
                        ? track.getSettings()
                        : null;

                setMicProcessingStatus(
                    settings
                        ? `Applied live: echo ${settings.echoCancellation ? "on" : "off"}, noise ${settings.noiseSuppression ? "on" : "off"}, gain ${settings.autoGainControl ? "on" : "off"}`
                        : "Mic processing applied live."
                );

                return true;
            } catch (err) {
                const message = err instanceof Error ? err.message : "Could not apply mic processing live.";
                setMicProcessingStatus(`Could not apply live mic processing: ${message}`);
                console.warn("[RoomSettingsModalLiveKit] apply mic processing failed", reason, err);
                return false;
            }
        },
        [echoCancellationEnabled, noiseSuppressionEnabled, autoGainControlEnabled]
    );

    const stopMicTest = React.useCallback(() => {
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

        setMicTesting(false);
        setMicLevel(0);
        setMicTestStatus("");
        setMicProcessingStatus("");
    }, []);

    React.useEffect(() => {
        return () => {
            stopMicTest();
        };
    }, [stopMicTest]);

    React.useEffect(() => {
        if (!micTesting || !micStreamRef.current) return;

        void applyMicProcessingToActiveTestTrack("processing-props-changed");
    }, [
        micTesting,
        echoCancellationEnabled,
        noiseSuppressionEnabled,
        autoGainControlEnabled,
        applyMicProcessingToActiveTestTrack,
    ]);

    React.useEffect(() => {
        const gain = micMonitorGainRef.current;
        if (!gain) return;

        const next = Math.max(0, Math.min(1, micMonitorVolume / 100));

        try {
            if (micAudioContextRef.current) {
                gain.gain.setTargetAtTime(next, micAudioContextRef.current.currentTime, 0.015);
            } else {
                gain.gain.value = next;
            }
        } catch { }
    }, [micMonitorVolume]);

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
            stopMicTest();
            setMicTestError("");
            setMicProcessingStatus("");
            setMicTestStatus("Requesting microphone…");

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: selectedAudioInputId ? { exact: selectedAudioInputId } : undefined,
                    echoCancellation: echoCancellationEnabled,
                    noiseSuppression: noiseSuppressionEnabled,
                    autoGainControl: autoGainControlEnabled,
                },
                video: false,
            });

            const AudioContextCtor =
                window.AudioContext ||
                (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

            if (!AudioContextCtor) {
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
            setMicTestStatus(
                micMonitorEnabled
                    ? "Speak now. You should see the level and hear your own voice."
                    : "Speak now and watch the level."
            );

            void applyMicProcessingToActiveTestTrack("start-mic-test");

            tick();
        } catch (err) {
            const message = err instanceof Error ? err.message : "Could not start microphone test.";
            setMicTestError(message);
            setMicTesting(false);
            setMicLevel(0);
            setMicTestStatus("");
            setMicProcessingStatus("");
        }
    }, [
        autoGainControlEnabled,
        echoCancellationEnabled,
        noiseSuppressionEnabled,
        selectedAudioInputId,
        selectedAudioOutputId,
        micMonitorEnabled,
        micMonitorVolume,
        stopMicTest,
        applyMicProcessingToActiveTestTrack,
    ]);

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

                <div className="border-t border-white/10 pt-5">
                    <div className={`text-[13px] font-semibold ${isLight ? "text-black/85" : "text-white/90"}`}>
                        Test microphone
                    </div>
                    <div className={`mt-1 text-[12px] ${subtleText}`}>
                        Uses your currently selected microphone and current mic-processing settings. Processing changes apply live while the test is running.
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
                    </div>

                    <div className="mt-4">
                        <div
                            className={[
                                "h-3 rounded-full overflow-hidden border",
                                isLight ? "bg-black/5 border-black/10" : "bg-white/5 border-white/10",
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
    if (!open) return null;

    const isLight = theme === "light";
    const isCustomBackground = !!bgImageUrl && !FX_BG_PRESETS.some((p) => p.url === bgImageUrl);

    const overlay =
        "fixed inset-0 z-[1001] flex items-stretch sm:items-center justify-center " +
        "px-0 sm:px-3 py-0 sm:py-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]";

    const backdrop = "absolute inset-0 bg-black/60";

    const card = [
        "relative w-full sm:max-w-[1100px] rounded-none sm:rounded-3xl shadow-2xl overflow-hidden",
        "max-h-[100dvh] sm:max-h-[92vh] flex flex-col",
        isLight ? "bg-white text-black border border-black/10" : "bg-[#020617] text-white border border-white/10",
    ].join(" ");

    const sectionCls = isLight ? "bg-black/5 border border-black/10" : "bg-white/5 border border-white/10";
    const ghostBtn = isLight ? "bg-black/5 hover:bg-black/10 text-black/80" : "bg-white/5 hover:bg-white/10 text-white/85";
    const activeBtn = isLight ? "bg-blue-600 text-white" : "bg-emerald-500 text-[#03110a]";
    const subtleText = isLight ? "text-black/60" : "text-white/60";

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

    const isDesktopFx =
        typeof window === "undefined" || !window.matchMedia
            ? true
            : window.matchMedia("(min-width: 1024px)").matches;

    const disableFxControls = hideBackgroundFx || !isDesktopFx;
    const effectivePreviewFilterCss = colorCorrectionEnabled ? (previewVideoFilterCss || "") : "";

    return (
        <div className={overlay} data-theme={theme} style={{ colorScheme: theme }}>
            <div className={backdrop} onClick={onClose} />

            <div className={card}>
                <div className={`px-5 sm:px-6 py-4 sm:py-5 border-b ${isLight ? "border-black/10" : "border-white/10"}`}>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="font-semibold text-[16px]">Settings</div>
                            <div className={`text-[12px] mt-1 ${subtleText}`}>
                                Camera, mic, speakers and room tools.
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
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
                        <div className="flex flex-col gap-5 min-w-0">
                            <div className={`rounded-2xl p-4 ${sectionCls}`}>
                                <div className="text-[13px] font-semibold mb-4">Devices</div>

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

                            <div className={`rounded-2xl p-4 ${sectionCls}`}>
                                <div className="text-[13px] font-semibold mb-4">Microphone processing</div>

                                <div className="flex flex-col gap-4">
                                    <ToggleRow
                                        label="Echo cancellation"
                                        description="Reduce echo from speakers going back into the mic. If mic test is running, this applies live."
                                        checked={echoCancellationEnabled}
                                        onChange={(v) => {
                                            void onChangeEchoCancellation(v);
                                        }}
                                        isLight={isLight}
                                    />

                                    <ToggleRow
                                        label="Noise suppression"
                                        description="Reduce keyboard noise, fan noise and room hum. If mic test is running, this applies live."
                                        checked={noiseSuppressionEnabled}
                                        onChange={(v) => {
                                            void onChangeNoiseSuppression(v);
                                        }}
                                        isLight={isLight}
                                    />

                                    <ToggleRow
                                        label="Auto gain control"
                                        description="Automatically normalize mic loudness. If mic test is running, this applies live."
                                        checked={autoGainControlEnabled}
                                        onChange={(v) => {
                                            void onChangeAutoGainControl(v);
                                        }}
                                        isLight={isLight}
                                    />
                                </div>
                            </div>

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

                                    <div className="border-t border-white/10 pt-4">
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
                                                onClick={() => void onApplyMode("off")}
                                                className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "off" ? activeBtn : ghostBtn}`}
                                                disabled={fxApplying}
                                                type="button"
                                            >
                                                FX off
                                            </button>

                                            <button
                                                onClick={() => void onApplyMode("blur")}
                                                className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "blur" ? activeBtn : ghostBtn}`}
                                                disabled={fxApplying}
                                                type="button"
                                            >
                                                Blur
                                            </button>

                                            <button
                                                onClick={() => void onApplyMode("bg")}
                                                className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "bg" ? activeBtn : ghostBtn}`}
                                                disabled={fxApplying}
                                                type="button"
                                            >
                                                Background image
                                            </button>
                                        </div>

                                        <div className={`mt-3 text-[12px] ${subtleText}`}>
                                            {fxApplying ? "Applying effect…" : fxStatusText || "Ready"}
                                        </div>

                                        {fxError ? <div className="mt-2 text-[12px] text-red-500 break-words">{fxError}</div> : null}
                                    </div>

                                    <div className={`rounded-2xl p-4 ${sectionCls}`}>
                                        <SliderField
                                            label="Blur strength"
                                            description="Used when Blur mode is active."
                                            min={4}
                                            max={30}
                                            step={1}
                                            value={blurStrength}
                                            onChange={onBlurStrengthChange}
                                            isLight={isLight}
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
                                                    disabled={fxApplying || !bgImageUrl}
                                                    type="button"
                                                >
                                                    Clear
                                                </button>
                                            </div>
                                        </div>

                                        <div
                                            className={[
                                                "rounded-2xl overflow-hidden border",
                                                isLight ? "border-black/10 bg-white" : "border-white/10 bg-[#0b1220]",
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
                                                        onClick={() => onSetBgImageUrl(p.url)}
                                                        className={
                                                            "rounded-2xl overflow-hidden border text-left " +
                                                            (selected
                                                                ? isLight
                                                                    ? "border-blue-500 ring-2 ring-blue-300"
                                                                    : "border-emerald-400 ring-2 ring-emerald-300/25"
                                                                : isLight
                                                                    ? "border-black/10"
                                                                    : "border-white/10")
                                                        }
                                                        title={p.label}
                                                        disabled={fxApplying}
                                                        type="button"
                                                    >
                                                        <div className="aspect-video w-full">
                                                            <img src={p.url} alt={p.label} className="w-full h-full object-cover" />
                                                        </div>
                                                        <div className={`px-2 py-2 text-[12px] ${isLight ? "bg-white" : "bg-[#0b1220]"}`}>{p.label}</div>
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

                <div className={`px-5 sm:px-6 py-4 border-t flex items-center justify-end gap-3 ${isLight ? "border-black/10" : "border-white/10"}`}>
                    <button
                        onClick={onClose}
                        className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${ghostBtn}`}
                        type="button"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

export default RoomSettingsModalLiveKit;