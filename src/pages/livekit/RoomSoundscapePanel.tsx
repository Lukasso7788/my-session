import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Pause,
  Play,
  RadioTower,
  SkipBack,
  SkipForward,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  ROOM_SOUNDSCAPE_OPTIONS,
  type RoomSoundscapeId,
} from "../../lib/roomSoundscapes";

type ListeningMode = "room" | "personal";
type PanelTheme = "light" | "dark";

function formatTrackTime(rawSeconds: number) {
  const seconds = Math.max(0, Math.round(Number(rawSeconds || 0)));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function TrackIcon({ src, label, dark }: { src: string; label: string; dark: boolean }) {
  return (
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[11px] ${dark ? "bg-[#353535]" : "bg-[#F0EEEE]"}`}>
      <img
        src={src}
        alt=""
        className={`h-[18px] w-[18px] object-contain ${dark ? "brightness-0 invert opacity-90" : "opacity-80"}`}
        draggable={false}
        onError={(event) => {
          if (!event.currentTarget.src.endsWith("/icons/soundscape-light.svg")) {
            event.currentTarget.src = "/icons/soundscape-light.svg";
          }
        }}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function RoomSoundscapePanel({
  theme = "light",
  listeningMode,
  activeId,
  playing,
  currentTime,
  duration,
  volume,
  personalMuted,
  canControl,
  canUpload,
  canShareTabMusic,
  sharingTabMusic,
  tabMusicShareBusy,
  tabMusicShareError,
  onShareTabMusic,
  onStopTabMusicShare,
  customTrackLabel,
  busy,
  uploading,
  error,
  onListeningModeChange,
  onSelect,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onUpload,
  onStop,
  onClose,
}: {
  theme?: PanelTheme;
  listeningMode: ListeningMode;
  activeId: RoomSoundscapeId | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  personalMuted: boolean;
  canControl: boolean;
  canUpload: boolean;
  canShareTabMusic: boolean;
  sharingTabMusic: boolean;
  tabMusicShareBusy: boolean;
  tabMusicShareError: string | null;
  onShareTabMusic: () => void;
  onStopTabMusicShare: () => void;
  customTrackLabel: string | null;
  busy: boolean;
  uploading: boolean;
  error: string | null;
  onListeningModeChange: (mode: ListeningMode) => void;
  onSelect: (id: RoomSoundscapeId) => void;
  onSeek: (positionSeconds: number) => void;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
  onUpload: (file: File) => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isDark = theme === "dark";
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const activeOption = ROOM_SOUNDSCAPE_OPTIONS.find((item) => item.id === activeId);
  const activeLabel =
    activeId === "custom"
      ? customTrackLabel || "Custom track"
      : activeOption?.label || "Choose a track";
  const shownPosition = seekDraft ?? currentTime;
  const timelineMax = Math.max(1, duration);
  const canSeek = !!activeId && duration > 0 && canControl;
  const selectedIndex = ROOM_SOUNDSCAPE_OPTIONS.findIndex(
    (option) => option.id === activeId,
  );

  useEffect(() => setSeekDraft(null), [activeId, listeningMode]);

  const commitSeek = (position: number) => {
    if (!canSeek) return;
    setSeekDraft(null);
    onSeek(Math.max(0, Math.min(timelineMax, position)));
  };

  const selectRelative = (offset: number) => {
    if (!canControl || busy) return;
    const count = ROOM_SOUNDSCAPE_OPTIONS.length;
    const start = selectedIndex >= 0 ? selectedIndex : offset > 0 ? -1 : 0;
    const nextIndex = (start + offset + count) % count;
    onSelect(ROOM_SOUNDSCAPE_OPTIONS[nextIndex].id);
  };

  return (
    <div className={`flex h-full min-h-0 flex-col ${isDark ? "bg-[#1B1B1B] text-[#F4F5F6]" : "bg-[#F8F7F7] text-[#2F2F2F]"}`}>
      <header className={`flex min-h-[44px] items-center justify-between gap-3 px-3 py-1.5 ${isDark ? "bg-[#232323]" : "bg-[#F8F7F7]"}`}>
        <div className="flex min-w-0 items-center gap-2">
          <img
            src={isDark ? "/icons/soundscape-dark.svg" : "/icons/soundscape-light.svg"}
            alt=""
            className="h-3.5 w-3.5 object-contain"
            draggable={false}
          />
          <span className={`truncate text-[12px] font-semibold ${isDark ? "text-[#F4F5F6]" : "text-[#2F2F2F]"}`}>Music</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`flex h-8 w-8 items-center justify-center rounded-[10px] transition ${isDark ? "text-[#CBD2DA] hover:bg-[#353535] hover:text-white" : "text-[#2F2F2F]/50 hover:bg-[#ECEAEA] hover:text-[#2F2F2F]"}`}
          aria-label="Close music panel"
        >
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </header>

      <div className="ms-chat-panel-scrollbars min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pt-2">
          <div className={`grid grid-cols-2 rounded-[13px] p-1 ${isDark ? "bg-[#303030]" : "bg-[#ECEAEA]"}`}>
            {(["room", "personal"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onListeningModeChange(mode)}
                className={`h-9 rounded-[10px] text-[11px] font-medium transition ${
                  listeningMode === mode
                    ? isDark ? "bg-[#5286F6] text-[#FFFFFF]" : "bg-[#2F2F2F] text-white"
                    : isDark ? "text-[#CBD2DA] hover:text-white" : "text-[#2F2F2F]/60 hover:text-[#2F2F2F]"
                }`}
              >
                {mode === "room" ? "Room" : "For me"}
              </button>
            ))}
          </div>
          <p className={`mt-2 px-1 text-[9px] leading-4 ${isDark ? "text-[#B5BCC6]" : "text-[#2F2F2F]/45"}`}>
            {listeningMode === "room"
              ? canControl
                ? "You control the soundtrack everyone can hear."
                : "Listen to the soundtrack selected by the host."
              : "Your private soundtrack. No one else will hear it."}
          </p>
        </div>

        <section className="px-5 pb-5 pt-5 text-center">
          <div className={`${isDark ? "text-[10px] text-[#B5BCC6]" : "text-[8px] text-[#2F2F2F]/40"} font-semibold uppercase tracking-[0.22em]`}>
            {listeningMode === "room" ? "Room mix" : "Playing for me"}
          </div>
          <h2 className={`mt-2 truncate text-[22px] font-semibold leading-tight ${isDark ? "text-[#F4F5F6]" : "text-[#2F2F2F]"}`}>
            {activeLabel}
          </h2>
          <div className={`mt-1 truncate text-[10px] ${isDark ? "text-[#B5BCC6]" : "text-[#2F2F2F]/45"}`}>
            {activeOption?.description || (activeId ? "Uploaded room audio" : "Select from the playlist")}
          </div>

          <div className={`relative mt-4 overflow-hidden rounded-[18px] ${isDark ? "bg-[#303030]" : "bg-[#ECEAEA]"}`}>
            <img
              src={activeOption?.artwork || "/images/room-music/ambient-focus.svg"}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
            <div className={`absolute inset-0 ${isDark ? "bg-black/25" : "bg-white/10"}`} />
            <div className="relative flex items-center justify-center gap-3 py-5">
              <button
                type="button"
                disabled={!canControl || busy}
                onClick={() => selectRelative(-1)}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 text-[#2F2F2F] transition hover:bg-white disabled:opacity-40"
                aria-label="Previous track"
              >
                <SkipBack className="h-[18px] w-[18px]" fill="currentColor" strokeWidth={1.6} />
              </button>
              <button
                type="button"
                disabled={!canControl || !activeId || busy}
                onClick={onStop}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2F2F2F] text-white transition hover:bg-[#252525] disabled:opacity-40"
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? (
                  <Pause className="h-5 w-5" fill="currentColor" strokeWidth={1.8} />
                ) : (
                  <Play className="ml-0.5 h-5 w-5" fill="currentColor" strokeWidth={1.8} />
                )}
              </button>
              <button
                type="button"
                disabled={!canControl || busy}
                onClick={() => selectRelative(1)}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 text-[#2F2F2F] transition hover:bg-white disabled:opacity-40"
                aria-label="Next track"
              >
                <SkipForward className="h-[18px] w-[18px]" fill="currentColor" strokeWidth={1.6} />
              </button>
            </div>
          </div>

          <div className="mt-4">
            <input
              type="range"
              min="0"
              max={timelineMax}
              step="0.1"
              value={Math.min(timelineMax, shownPosition)}
              disabled={!canSeek}
              onChange={(event) => setSeekDraft(Number(event.currentTarget.value))}
              onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
              onKeyUp={(event) => commitSeek(Number(event.currentTarget.value))}
              onBlur={(event) => seekDraft !== null && commitSeek(Number(event.currentTarget.value))}
              className="ms-room-music-slider w-full cursor-pointer disabled:cursor-default disabled:opacity-35"
              style={{
                "--ms-slider-progress": `${Math.min(100, (shownPosition / timelineMax) * 100)}%`,
              } as CSSProperties}
              aria-label="Track position"
            />
            <div className={`mt-1 flex justify-between text-[9px] tabular-nums ${isDark ? "text-[#B5BCC6]" : "text-[#2F2F2F]/40"}`}>
              <span>{formatTrackTime(shownPosition)}</span>
              <span>{formatTrackTime(duration)}</span>
            </div>
          </div>

          <div className={`mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2 ${isDark ? "bg-[#303030]" : "bg-[#F0EEEE]"}`}>
            <Volume2 className={`h-3.5 w-3.5 shrink-0 ${isDark ? "text-[#D8DDE3]" : "text-[#2F2F2F]/55"}`} strokeWidth={1.8} />
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              disabled={!canControl}
              onChange={(event) => onVolumeChange(Number(event.target.value))}
              className="ms-room-music-slider min-w-0 flex-1 cursor-pointer disabled:cursor-default disabled:opacity-45"
              style={{ "--ms-slider-progress": `${volume}%` } as CSSProperties}
              aria-label="Your music volume"
            />
            <span className={`w-7 text-right text-[9px] tabular-nums ${isDark ? "text-[#C6CDD5]" : "text-[#2F2F2F]/45"}`}>{volume}%</span>
          </div>

          <button
            type="button"
            disabled={!activeId}
            onClick={onToggleMute}
            className={`mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-xl text-[11px] font-medium transition disabled:opacity-35 ${
              personalMuted
                ? isDark ? "bg-[#3A5541] text-[#D9F9DC] hover:bg-[#44664D]" : "bg-[#2F2F2F] text-white hover:bg-[#252525]"
                : isDark ? "bg-[#303030] text-[#E3E7EB] hover:bg-[#3C3C3C]" : "bg-[#ECEAEA] text-[#555] hover:bg-[#E3E0E0]"
            }`}
          >
            {personalMuted ? (
              <Volume2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            ) : (
              <VolumeX className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
            {personalMuted ? "Unmute for me" : "Mute for me"}
          </button>

          {canShareTabMusic ? (
            <div className={`mt-3 rounded-[14px] border p-2.5 text-left ${isDark ? "border-[#484848] bg-[#252525]" : "border-[#DEDADA] bg-white"}`}>
              <button
                type="button"
                disabled={tabMusicShareBusy}
                onClick={sharingTabMusic ? onStopTabMusicShare : onShareTabMusic}
                className={`flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[10px] font-semibold transition disabled:cursor-wait disabled:opacity-55 ${
                  sharingTabMusic
                    ? isDark ? "bg-[#4A292B] text-[#FFB5B8] hover:bg-[#5B3033]" : "bg-[#FFF0F0] text-[#B54444] hover:bg-[#FFE7E7]"
                    : isDark ? "bg-[#5286F6] text-[#FFFFFF] hover:bg-[#6B98FA]" : "bg-[#2F2F2F] text-white hover:bg-[#252525]"
                }`}
              >
                <RadioTower className="h-3.5 w-3.5" strokeWidth={1.8} />
                {tabMusicShareBusy
                  ? "Opening Chrome…"
                  : sharingTabMusic
                    ? "Stop sharing tab music"
                    : "Share music from tab"}
              </button>
              <p className={`mt-2 px-1 leading-4 ${isDark ? "text-[10px] text-[#B5BCC6]" : "text-[8px] text-[#2F2F2F]/45"}`}>
                Choose a Chrome tab such as YouTube or Spotify Web and enable Share tab audio. Only its audio is sent to the room.
              </p>
              {tabMusicShareError ? (
                <p className={`mt-1.5 px-1 leading-4 ${isDark ? "text-[10px] text-[#FFB5B8]" : "text-[8px] text-[#B54444]"}`}>
                  {tabMusicShareError}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className={`mx-2 mb-2 rounded-[18px] px-2 pb-3 pt-3 ${isDark ? "bg-[#252525]" : "bg-white"}`}>
          <div className="mb-2 flex items-center justify-between px-1">
            <div className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${isDark ? "text-[#E3E7EB]" : "text-[#2F2F2F]/55"}`}>Playlist</div>
            <span className={`${isDark ? "text-[10px] text-[#B5BCC6]" : "text-[9px] text-[#2F2F2F]/35"}`}>{ROOM_SOUNDSCAPE_OPTIONS.length} tracks</span>
          </div>

          <div>
            {ROOM_SOUNDSCAPE_OPTIONS.map((option, index) => {
              const selected = activeId === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={!canControl || busy}
                  onClick={() => onSelect(option.id)}
                  className={`group flex w-full items-center gap-3 rounded-[13px] px-2 py-2 text-left transition disabled:cursor-default ${
                    selected ? isDark ? "bg-[#353F39]" : "bg-[#EDEBEB]" : isDark ? "hover:bg-[#303030]" : "hover:bg-[#F5F3F3]"
                  } ${!canControl ? "opacity-65" : ""}`}
                >
                  <span className={`w-5 shrink-0 text-center tabular-nums ${isDark ? "text-[10px] text-[#AEB6BF]" : "text-[9px] text-[#2F2F2F]/30"}`}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <TrackIcon src={option.icon} label={option.label} dark={isDark} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`truncate font-semibold ${isDark ? "text-[12px] text-[#F4F5F6]" : "text-[11px] text-[#2F2F2F]"}`}>{option.label}</span>
                      {selected ? <span className="h-1.5 w-1.5 rounded-full bg-[#61D874]" /> : null}
                    </span>
                    <span className={`mt-0.5 block truncate ${isDark ? "text-[10px] text-[#B5BCC6]" : "text-[8px] text-[#2F2F2F]/40"}`}>{option.description}</span>
                  </span>
                  <span className={`tabular-nums ${isDark ? "text-[10px] text-[#B5BCC6]" : "text-[9px] text-[#2F2F2F]/35"}`}>{formatTrackTime(option.durationSeconds)}</span>
                </button>
              );
            })}
          </div>

          {listeningMode === "room" && canUpload ? (
            <div className="mt-3 px-1">
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp3,.m4a,.ogg,.webm,audio/mpeg,audio/mp4,audio/ogg,audio/webm"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) onUpload(file);
                }}
              />
              <button
                type="button"
                disabled={uploading || busy}
                onClick={() => fileInputRef.current?.click()}
                className={`flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[10px] font-semibold transition disabled:opacity-40 ${isDark ? "bg-[#353535] text-[#F4F5F6] hover:bg-[#444B53]" : "bg-[#ECEAEA] text-[#2F2F2F] hover:bg-[#E2DFDF]"}`}
              >
                <Upload className="h-3.5 w-3.5" strokeWidth={1.8} />
                {uploading ? "Uploading…" : "Upload room track · max 30 MB"}
              </button>
            </div>
          ) : null}

          {error ? (
            <div className={`mt-3 rounded-xl px-3 py-2 text-[10px] ${isDark ? "bg-[#F65252]/15 text-[#FFB5B8]" : "bg-[#F65252]/8 text-[#B83D3D]"}`}>{error}</div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export default RoomSoundscapePanel;
