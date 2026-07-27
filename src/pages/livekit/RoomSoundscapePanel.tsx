import { useEffect, useRef, useState } from "react";
import {
  ROOM_SOUNDSCAPE_OPTIONS,
  type RoomSoundscapeId,
} from "../../lib/roomSoundscapes";

function formatTrackTime(rawSeconds: number) {
  const seconds = Math.max(0, Math.round(Number(rawSeconds || 0)));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function TrackIcon({ src, label }: { src: string; label: string }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#DED8D8] bg-[#F7F5F5]">
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
  onSelect,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onUpload,
  onStop,
  onClose,
}: {
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
  const activeLabel = activeId === "custom"
    ? customTrackLabel || "Custom track"
    : activeOption?.label || "Nothing playing";
  const shownPosition = seekDraft ?? currentTime;
  const timelineMax = Math.max(1, duration);
  const canSeek = !!activeId && duration > 0 && canControl && (activeId !== "custom" || canUpload);

  useEffect(() => {
    setSeekDraft(null);
  }, [activeId]);

  const commitSeek = (position: number) => {
    if (!canSeek) return;
    const next = Math.max(0, Math.min(timelineMax, position));
    setSeekDraft(null);
    onSeek(next);
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-[#F8F7F7] text-[#171717]">
      <header className="flex min-h-[60px] items-center justify-between gap-3 border-b border-[#D8D0D0] bg-[#F3F1F1] px-5 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <img src="/icons/soundscape-light.svg" alt="" className="h-4 w-4 shrink-0" draggable={false} />
          <span className="truncate text-[14px] font-semibold text-black/85">Room music</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E6E6E6] text-black/60 transition hover:bg-[#DCDCDC]"
          aria-label="Close music panel"
          title="Close"
        >
          ✕
        </button>
      </header>

      <div className="ms-chat-panel-scrollbars min-h-0 flex-1 overflow-y-auto p-4">
        <section className="rounded-[20px] border border-[#D8D0D0] bg-white p-4 shadow-[0_4px_16px_rgba(20,20,20,0.04)]">
          <div className="flex items-center gap-3">
            <TrackIcon
              src={activeOption?.icon || "/icons/music-custom.svg"}
              label={activeLabel}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-black/85">{activeLabel}</div>
              <div className="mt-0.5 text-[10px] text-black/50">
                {personalMuted
                  ? "Muted for you"
                  : playing
                    ? "Playing for the room"
                    : activeId
                      ? "Paused for the room"
                      : "Choose a track below"}
              </div>
            </div>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${playing && !personalMuted ? "bg-[#62D873] shadow-[0_0_0_4px_rgba(98,216,115,0.13)]" : "bg-black/20"}`} />
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
              onBlur={(event) => {
                if (seekDraft !== null) commitSeek(Number(event.currentTarget.value));
              }}
              className="ms-room-music-timeline w-full cursor-pointer accent-[#62D873] disabled:cursor-default disabled:opacity-40"
              aria-label="Track position"
            />
            <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-black/45">
              <span>{formatTrackTime(shownPosition)}</span>
              <span>{formatTrackTime(duration)}</span>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!activeId}
              onClick={onToggleMute}
              className={`h-9 rounded-xl border text-[11px] font-semibold transition disabled:opacity-40 ${personalMuted ? "border-[#F65252]/40 bg-[#F65252]/10 text-[#C63F3F]" : "border-black/10 bg-[#F5F5F5] text-black/75 hover:bg-[#EBEBEB]"}`}
            >
              {personalMuted ? "Unmute for me" : "Mute for me"}
            </button>
            <button
              type="button"
              disabled={!canControl || !activeId || busy || (activeId === "custom" && !canUpload)}
              onClick={onStop}
              className="h-9 rounded-xl bg-[#1B1B1B] text-[11px] font-semibold text-white transition hover:bg-black disabled:opacity-40"
            >
              {playing ? "Pause" : "Play"}
            </button>
          </div>
        </section>

        <div className="mb-2 mt-5 flex items-end justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold text-black/85">Playlist</div>
            <div className="mt-0.5 text-[10px] text-black/50">Choose a track for everyone in the room.</div>
          </div>
          <span className="text-[10px] text-black/40">{ROOM_SOUNDSCAPE_OPTIONS.length} tracks</span>
        </div>

        <div className="overflow-hidden rounded-[18px] border border-[#D8D0D0] bg-white">
          {ROOM_SOUNDSCAPE_OPTIONS.map((option, index) => {
            const selected = activeId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={!canControl || busy}
                onClick={() => onSelect(option.id)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition disabled:opacity-45 ${index ? "border-t border-[#E7E2E2]" : ""} ${selected ? "bg-[#ECF9EE]" : "hover:bg-[#F7F5F5]"}`}
              >
                <TrackIcon src={option.icon} label={option.label} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[12px] font-semibold text-black/85">{option.label}</span>
                    {selected ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#55C968]" /> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[9px] text-black/45">{option.description}</span>
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-black/40">{formatTrackTime(option.durationSeconds)}</span>
              </button>
            );
          })}
        </div>

        <section className="mt-3 rounded-[18px] border border-dashed border-[#CFC7C7] bg-white p-3">
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
          <div className="flex items-center gap-3">
            <TrackIcon src="/icons/music-custom.svg" label="Custom track" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-semibold text-black/85">
                {activeId === "custom" ? customTrackLabel || "Custom track" : "Upload your track"}
              </div>
              <div className="mt-0.5 text-[9px] text-black/45">MP3, M4A, OGG or WebM · maximum 3 MB</div>
            </div>
            <button
              type="button"
              disabled={!canUpload || uploading || busy}
              onClick={() => fileInputRef.current?.click()}
              className="h-9 shrink-0 rounded-xl bg-[#1B1B1B] px-3 text-[10px] font-semibold text-white transition hover:bg-black disabled:opacity-40"
              title={canUpload ? "Upload a room track" : "Only a host or moderator can upload audio"}
            >
              {uploading ? "Uploading…" : "Choose"}
            </button>
          </div>
        </section>

        <section className="mt-4 rounded-[18px] border border-[#D8D0D0] bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="room-soundscape-volume" className="text-[11px] font-medium text-black/75">Your music volume</label>
            <span className="text-[10px] tabular-nums text-black/50">{volume}%</span>
          </div>
          <input
            id="room-soundscape-volume"
            type="range"
            min="0"
            max="100"
            step="1"
            value={volume}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
            className="mt-2 w-full accent-[#62D873]"
          />
        </section>

        {error ? <div className="mt-3 rounded-xl border border-[#F65252]/40 bg-[#F65252]/10 px-3 py-2 text-[11px] text-[#C63F3F]">{error}</div> : null}
      </div>
    </div>
  );
}

export default RoomSoundscapePanel;
