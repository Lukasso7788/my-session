import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Pause, Play, Volume2 } from "lucide-react";
import {
  ROOM_SOUNDSCAPE_OPTIONS,
  RoomSoundscapeEngine,
  type RoomSoundscapeId,
} from "../lib/roomSoundscapes";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function readInitialTrack(): RoomSoundscapeId {
  if (typeof window === "undefined") return "ambient";
  const requested = new URLSearchParams(window.location.search).get("track");
  const match = ROOM_SOUNDSCAPE_OPTIONS.find((option) => option.id === requested);
  return match?.id || "ambient";
}

function readInitialNumber(name: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const value = Number(new URLSearchParams(window.location.search).get(name));
  return Number.isFinite(value) ? value : fallback;
}

function formatTime(rawSeconds: number) {
  const seconds = Math.max(0, Math.round(Number(rawSeconds || 0)));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function StandaloneSoundscapePage() {
  const engineRef = useRef<RoomSoundscapeEngine | null>(null);
  const [activeId, setActiveId] = useState<RoomSoundscapeId>(() => readInitialTrack());
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(() => Math.max(0, readInitialNumber("position", 0)));
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => clamp(readInitialNumber("volume", 35), 0, 100));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeOption = useMemo(
    () => ROOM_SOUNDSCAPE_OPTIONS.find((option) => option.id === activeId) || ROOM_SOUNDSCAPE_OPTIONS[0],
    [activeId],
  );

  useEffect(() => {
    document.title = `${activeOption.label} · MySession Music`;
  }, [activeOption.label]);

  useEffect(() => {
    if (!engineRef.current) engineRef.current = new RoomSoundscapeEngine();
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      setPosition(engine.currentTime());
      setDuration(engine.duration());
    }, 400);
    return () => window.clearInterval(timer);
  }, [playing, activeId]);

  const playTrack = async (id = activeId, requestedPosition = position) => {
    if (!engineRef.current) engineRef.current = new RoomSoundscapeEngine();
    try {
      setBusy(true);
      setError(null);
      await engineRef.current.play(id, volume / 100, requestedPosition);
      setActiveId(id);
      setPlaying(true);
      setPosition(engineRef.current.currentTime());
      setDuration(engineRef.current.duration());
    } catch (playError) {
      setPlaying(false);
      setError(
        playError instanceof Error
          ? playError.message
          : "Playback was blocked. Click Play to start the music.",
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("autoplay") !== "1") return;
    void playTrack(activeId, position);
    // Initial query state only. Browsers may still require a click to play.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePlayback = async () => {
    if (playing) {
      const nextPosition = engineRef.current?.pause() || 0;
      setPosition(nextPosition);
      setPlaying(false);
      return;
    }
    await playTrack(activeId, position);
  };

  const selectTrack = async (id: RoomSoundscapeId) => {
    if (id === "custom") return;
    setPosition(0);
    await playTrack(id, 0);
  };

  const handleVolume = (nextValue: number) => {
    const next = clamp(Math.round(nextValue), 0, 100);
    setVolume(next);
    engineRef.current?.setVolume(next / 100);
  };

  const timelineMax = Math.max(1, duration || activeOption.durationSeconds || 1);
  const progress = Math.min(100, (position / timelineMax) * 100);

  return (
    <main className="min-h-screen bg-[#F4F2F2] px-4 py-5 text-[#2F2F2F] sm:px-6 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-40px)] w-full max-w-[760px] flex-col justify-center">
        <div className="rounded-[30px] border border-[#E1DEDE] bg-white p-5 shadow-[0_18px_60px_rgba(47,47,47,0.08)] sm:p-7">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <img src="/icons/soundscape-light.svg" alt="" className="h-5 w-5" />
              <div>
                <div className="text-[13px] font-semibold">MySession Music</div>
                <div className="text-[10px] text-[#777]">Standalone tab player</div>
              </div>
            </div>
            <span className="rounded-full bg-[#EFF8F0] px-3 py-1.5 text-[10px] font-semibold text-[#4F9E58]">
              Ready to share
            </span>
          </div>

          <div className="overflow-hidden rounded-[24px] bg-[#ECEAEA]">
            <div className="relative min-h-[260px] sm:min-h-[320px]">
              <img
                src={activeOption.artwork}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-black/5 to-white/5" />
              <div className="absolute inset-x-0 bottom-0 p-6 text-white sm:p-8">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">Background sound</div>
                <h1 className="mt-1 text-[28px] font-semibold leading-tight sm:text-[34px]">{activeOption.label}</h1>
                <p className="mt-1 text-[12px] text-white/75">{activeOption.description}</p>
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => void togglePlayback()}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#2F2F2F] text-white transition hover:bg-[#222] disabled:opacity-45"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause className="h-5 w-5" fill="currentColor" strokeWidth={1.7} />
              ) : (
                <Play className="ml-0.5 h-5 w-5" fill="currentColor" strokeWidth={1.7} />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <input
                type="range"
                min="0"
                max={timelineMax}
                step="0.1"
                value={Math.min(timelineMax, position)}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  setPosition(next);
                  engineRef.current?.seek(next);
                }}
                className="ms-room-music-slider w-full cursor-pointer"
                style={{ "--ms-slider-progress": `${progress}%` } as CSSProperties}
                aria-label="Track position"
              />
              <div className="mt-1 flex justify-between text-[10px] tabular-nums text-[#777]">
                <span>{formatTime(position)}</span>
                <span>{formatTime(duration || activeOption.durationSeconds)}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-[16px] bg-[#F2F0F0] px-4 py-3">
            <Volume2 className="h-4 w-4 shrink-0 text-[#666]" strokeWidth={1.8} />
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(event) => handleVolume(Number(event.currentTarget.value))}
              className="ms-room-music-slider min-w-0 flex-1 cursor-pointer"
              style={{ "--ms-slider-progress": `${volume}%` } as CSSProperties}
              aria-label="Music volume"
            />
            <span className="w-8 text-right text-[10px] tabular-nums text-[#777]">{volume}%</span>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ROOM_SOUNDSCAPE_OPTIONS.map((option) => {
              const selected = option.id === activeId;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void selectTrack(option.id)}
                  className={`flex items-center gap-3 rounded-[16px] border px-3 py-3 text-left transition ${
                    selected
                      ? "border-[#2F2F2F] bg-[#F5F3F3]"
                      : "border-[#E7E3E3] bg-white hover:bg-[#F8F7F7]"
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#F0EEEE]">
                    <img src={option.icon} alt="" className="h-[17px] w-[17px] object-contain" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-semibold">{option.label}</span>
                    <span className="mt-0.5 block truncate text-[9px] text-[#777]">{option.description}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 rounded-[20px] border border-[#D9E8DA] bg-[#F3FAF4] p-4">
            <div className="text-[12px] font-semibold text-[#315D36]">Share this tab with your session</div>
            <div className="mt-1 text-[10px] leading-5 text-[#527057]">
              Return to the MySession room, press Screen share, select this MySession Music tab, and enable <strong>Share tab audio</strong> in the browser picker.
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-[14px] bg-[#FFF1F1] px-3 py-2 text-[10px] text-[#B83D3D]">{error}</div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
