import { useEffect, useRef, useState } from "react";
import {
  ROOM_SOUNDSCAPE_OPTIONS,
  type RoomSoundscapeId,
} from "../../lib/roomSoundscapes";

type ListeningMode = "room" | "personal";

function formatTrackTime(rawSeconds: number) {
  const seconds = Math.max(0, Math.round(Number(rawSeconds || 0)));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function TrackIcon({ src, label }: { src: string; label: string }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-[#E2DEDE] bg-[#F5F3F3]">
      <img
        src={src}
        alt=""
        className="h-5 w-5 object-contain"
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
  listeningMode,
  activeId,
  playing,
  currentTime,
  duration,
  volume,
  personalMuted,
  canControl,
  canUpload,
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
  listeningMode: ListeningMode;
  activeId: RoomSoundscapeId | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  personalMuted: boolean;
  canControl: boolean;
  canUpload: boolean;
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
    <div className="flex h-full min-h-0 flex-col bg-[#FAF9F9] text-[#2F2F2F]">
      <header className="flex min-h-[60px] items-center justify-between gap-3 border-b border-[#DDD8D8] bg-white px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src="/icons/soundscape-light.svg" alt="" className="h-4 w-4" />
          <span className="truncate text-[14px] font-semibold">Music</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F0EEEE] text-[#2F2F2F]/60 transition hover:bg-[#E5E2E2]"
          aria-label="Close music panel"
        >
          ✕
        </button>
      </header>

      <div className="ms-chat-panel-scrollbars min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pt-4">
          <div className="grid grid-cols-2 rounded-[14px] border border-[#DEDADA] bg-[#F1EFEF] p-1">
            {(["room", "personal"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onListeningModeChange(mode)}
                className={`h-9 rounded-[10px] text-[11px] font-medium transition ${
                  listeningMode === mode
                    ? "bg-[#2F2F2F] text-white shadow-sm"
                    : "text-[#2F2F2F]/60 hover:text-[#2F2F2F]"
                }`}
              >
                {mode === "room" ? "Room" : "For me"}
              </button>
            ))}
          </div>
          <p className="mt-2 px-1 text-[9px] leading-4 text-[#2F2F2F]/45">
            {listeningMode === "room"
              ? canControl
                ? "You control the soundtrack everyone can hear."
                : "Listen to the soundtrack selected by the host."
              : "Your private soundtrack. No one else will hear it."}
          </p>
        </div>

        <section className="px-5 pb-5 pt-6 text-center">
          <div className="text-[8px] font-semibold uppercase tracking-[0.22em] text-[#2F2F2F]/40">
            {listeningMode === "room" ? "Room mix" : "Playing for me"}
          </div>
          <h2 className="mt-2 truncate text-[22px] font-semibold leading-tight text-[#2F2F2F]">
            {activeLabel}
          </h2>
          <div className="mt-1 truncate text-[10px] text-[#2F2F2F]/45">
            {activeOption?.description || (activeId ? "Uploaded room audio" : "Select from the playlist")}
          </div>

          <div className="mt-5 flex items-center justify-center gap-7">
            <button
              type="button"
              disabled={!canControl || busy}
              onClick={() => selectRelative(-1)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-[#2F2F2F] transition hover:bg-[#EEECEC] disabled:opacity-25"
              aria-label="Previous track"
            >
              ◀
            </button>
            <button
              type="button"
              disabled={!canControl || !activeId || busy}
              onClick={onStop}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2F2F2F] text-[17px] text-white shadow-[0_7px_18px_rgba(47,47,47,0.22)] transition hover:scale-[1.03] hover:bg-[#252525] disabled:opacity-35"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? "Ⅱ" : "▶"}
            </button>
            <button
              type="button"
              disabled={!canControl || busy}
              onClick={() => selectRelative(1)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-[#2F2F2F] transition hover:bg-[#EEECEC] disabled:opacity-25"
              aria-label="Next track"
            >
              ▶
            </button>
          </div>

          <div className="mt-5">
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
              className="ms-room-music-timeline w-full cursor-pointer accent-[#2F2F2F] disabled:cursor-default disabled:opacity-35"
              aria-label="Track position"
            />
            <div className="mt-1 flex justify-between text-[9px] tabular-nums text-[#2F2F2F]/40">
              <span>{formatTrackTime(shownPosition)}</span>
              <span>{formatTrackTime(duration)}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-[#F0EEEE] px-3 py-2">
            <img src="/icons/soundscape-light.svg" alt="Volume" className="h-3.5 w-3.5 opacity-55" />
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(event) => onVolumeChange(Number(event.target.value))}
              className="min-w-0 flex-1 cursor-pointer accent-[#2F2F2F]"
              aria-label="Your music volume"
            />
            <span className="w-7 text-right text-[9px] tabular-nums text-[#2F2F2F]/45">{volume}%</span>
          </div>

          <button
            type="button"
            disabled={!activeId}
            onClick={onToggleMute}
            className={`mt-3 h-9 w-full rounded-xl border text-[11px] font-medium transition disabled:opacity-35 ${
              personalMuted
                ? "border-[#2F2F2F] bg-[#2F2F2F] text-white hover:bg-[#252525]"
                : "border-[#CBC6C6] bg-[#F1EFEF] text-[#555] hover:bg-[#E9E6E6]"
            }`}
          >
            {personalMuted ? "Unmute for me" : "Mute for me"}
          </button>
        </section>

        <section className="border-t border-[#E4E0E0] bg-white px-4 pb-4 pt-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2F2F2F]/55">Playlist</div>
            <span className="text-[9px] text-[#2F2F2F]/35">{ROOM_SOUNDSCAPE_OPTIONS.length} tracks</span>
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
                    selected ? "bg-[#F0EEEE]" : "hover:bg-[#F7F5F5]"
                  } ${!canControl ? "opacity-65" : ""}`}
                >
                  <span className="w-5 shrink-0 text-center text-[9px] tabular-nums text-[#2F2F2F]/30">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <TrackIcon src={option.icon} label={option.label} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[11px] font-semibold text-[#2F2F2F]">{option.label}</span>
                      {selected ? <span className="h-1.5 w-1.5 rounded-full bg-[#61D874]" /> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[8px] text-[#2F2F2F]/40">{option.description}</span>
                  </span>
                  <span className="text-[9px] tabular-nums text-[#2F2F2F]/35">{formatTrackTime(option.durationSeconds)}</span>
                </button>
              );
            })}
          </div>

          {listeningMode === "room" && canUpload ? (
            <div className="mt-3 border-t border-[#E7E3E3] pt-3">
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
                className="flex h-10 w-full items-center justify-center rounded-xl border border-[#2F2F2F] bg-white text-[10px] font-semibold text-[#2F2F2F] transition hover:bg-[#F1EFEF] disabled:opacity-40"
              >
                {uploading ? "Uploading…" : "Upload room track · max 3 MB"}
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-xl border border-[#F65252]/35 bg-[#F65252]/8 px-3 py-2 text-[10px] text-[#B83D3D]">{error}</div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export default RoomSoundscapePanel;
