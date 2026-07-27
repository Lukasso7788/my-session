import { useRef } from "react";
import {
  ROOM_SOUNDSCAPE_OPTIONS,
  type RoomSoundscapeId,
} from "../../lib/roomSoundscapes";

export function RoomSoundscapePanel({
  activeId,
  playing,
  volume,
  personalMuted,
  canControl,
  canUpload,
  customTrackLabel,
  busy,
  uploading,
  error,
  onSelect,
  onVolumeChange,
  onToggleMute,
  onUpload,
  onStop,
  onClose,
}: {
  activeId: RoomSoundscapeId | null;
  playing: boolean;
  volume: number;
  personalMuted: boolean;
  canControl: boolean;
  canUpload: boolean;
  customTrackLabel: string | null;
  busy: boolean;
  uploading: boolean;
  error: string | null;
  onSelect: (id: RoomSoundscapeId) => void;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
  onUpload: (file: File) => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeLabel = activeId
    ? activeId === "custom"
      ? customTrackLabel || "Custom track"
      : ROOM_SOUNDSCAPE_OPTIONS.find((item) => item.id === activeId)?.label
    : "Nothing playing";

  return (
    <div className="h-full min-h-0 flex flex-col bg-[#F8F7F7] text-[#171717]">
      <header className="flex min-h-[60px] items-center justify-between gap-3 border-b border-[#D8D0D0] bg-[#F3F1F1] px-5 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <img
            src="/icons/soundscape-light.svg"
            alt=""
            className="h-4 w-4 shrink-0"
            draggable={false}
          />
          <span className="truncate text-[14px] font-semibold text-black/85">
            Room music
          </span>
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
        <section className="rounded-2xl border border-[#D8D0D0] bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold">{activeLabel}</div>
              <div className="mt-0.5 text-[10px] text-black/55">
                {personalMuted
                  ? "Muted for you"
                  : playing
                    ? "Playing for the room"
                    : activeId
                      ? "Paused for the room"
                      : "Choose a soundtrack below"}
              </div>
            </div>
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                playing && !personalMuted
                  ? "bg-[#62D873] shadow-[0_0_0_4px_rgba(98,216,115,0.13)]"
                  : "bg-black/20"
              }`}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!activeId}
              onClick={onToggleMute}
              className={`h-9 rounded-xl border text-[11px] font-semibold transition disabled:opacity-40 ${
                personalMuted
                  ? "border-[#F65252]/40 bg-[#F65252]/10 text-[#C63F3F]"
                  : "border-black/10 bg-[#F5F5F5] text-black/75 hover:bg-[#EBEBEB]"
              }`}
            >
              {personalMuted ? "Unmute for me" : "Mute for me"}
            </button>
            <button
              type="button"
              disabled={
                !canControl ||
                !activeId ||
                busy ||
                (activeId === "custom" && !canUpload)
              }
              onClick={onStop}
              className="h-9 rounded-xl border border-[#1B1B1B] bg-[#1B1B1B] text-[11px] font-semibold text-white transition hover:bg-black disabled:opacity-40"
            >
              {playing ? "Pause for everyone" : "Resume for everyone"}
            </button>
          </div>
        </section>

        <div className="mt-5">
          <div className="text-[13px] font-semibold text-black/85">Soundscapes</div>
          <div className="mt-0.5 text-[10px] text-black/50">
            Choose a soundtrack for everyone. Each person controls their own volume.
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {ROOM_SOUNDSCAPE_OPTIONS.map((option) => {
            const selected = activeId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={!canControl || busy}
                onClick={() => onSelect(option.id)}
                className={`min-h-[96px] rounded-2xl border p-3 text-left transition disabled:opacity-45 ${
                  selected
                    ? "border-[#57D668] bg-[#EAF9ED] shadow-[0_0_0_1px_rgba(87,214,104,0.1)]"
                    : "border-[#D8D0D0] bg-white hover:border-[#BEB6B6] hover:bg-[#FCFBFB]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[22px]" aria-hidden="true">
                    {option.emoji}
                  </span>
                  {selected ? (
                    <span className="rounded-full bg-[#62D873] px-2 py-0.5 text-[9px] font-semibold text-[#102313]">
                      {playing ? "Playing" : "Selected"}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-[12px] font-semibold text-black/85">
                  {option.label}
                </div>
                <div className="mt-0.5 text-[10px] leading-snug text-black/50">
                  {option.description}
                </div>
              </button>
            );
          })}
        </div>

        <section className="mt-3 rounded-2xl border border-dashed border-[#CFC7C7] bg-white p-3">
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
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold text-black/85">
                {activeId === "custom"
                  ? customTrackLabel || "Custom track"
                  : "Upload your track"}
              </div>
              <div className="mt-0.5 text-[9px] leading-snug text-black/50">
                MP3, M4A, OGG or WebM · maximum 3 MB
              </div>
            </div>
            <button
              type="button"
              disabled={!canUpload || uploading || busy}
              onClick={() => fileInputRef.current?.click()}
              className="h-9 shrink-0 rounded-xl bg-[#1B1B1B] px-3 text-[10px] font-semibold text-white transition hover:bg-black disabled:opacity-40"
              title={canUpload ? "Upload a room track" : "Only a host or moderator can upload audio"}
            >
              {uploading ? "Uploading…" : "Choose file"}
            </button>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-[#D8D0D0] bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="room-soundscape-volume" className="text-[11px] font-medium text-black/75">
              Your music volume
            </label>
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

        {error ? (
          <div className="mt-3 rounded-xl border border-[#F65252]/40 bg-[#F65252]/10 px-3 py-2 text-[11px] text-[#C63F3F]">
            {error}
          </div>
        ) : null}

        <p className="mt-4 text-[10px] leading-relaxed text-black/45">
          Music is synchronized through the room and loaded directly on each
          device, so it stays clear and never enters anyone&apos;s microphone.
        </p>
      </div>
    </div>
  );
}

export default RoomSoundscapePanel;
