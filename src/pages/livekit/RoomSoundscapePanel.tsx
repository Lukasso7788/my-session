import { useRef } from "react";
import {
  ROOM_SOUNDSCAPE_OPTIONS,
  type RoomSoundscapeId,
} from "../../lib/roomSoundscapes";

export function RoomSoundscapePanel({
  isLight,
  activeId,
  playing,
  volume,
  personalMuted,
  canControl,
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
  isLight: boolean;
  activeId: RoomSoundscapeId | null;
  playing: boolean;
  volume: number;
  personalMuted: boolean;
  canControl: boolean;
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
  const mutedText = isLight ? "text-black/55" : "text-white/55";
  const border = isLight ? "border-[#D8D0D0]" : "border-[#343434]";

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className={`flex items-center justify-between border-b px-4 py-3 ${border} ${isLight ? "bg-[#F3F1F1]" : "bg-[#202020]"}`}>
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isLight ? "bg-[#E5F8E8] text-[#2C8A3A]" : "bg-[#19391F] text-[#7EE787]"}`}>
            ♪
          </div>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold">Room music</div>
            <div className={`truncate text-[10px] ${mutedText}`}>
              Shared with everyone in the room
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`h-9 w-9 shrink-0 rounded-xl text-lg transition ${isLight ? "bg-[#E6E6E6] text-black/60 hover:bg-[#DCDCDC]" : "bg-white/5 text-white/65 hover:bg-white/10"}`}
          aria-label="Close music panel"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className={`rounded-2xl border p-3 ${border} ${isLight ? "bg-white" : "bg-[#242424]"}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[12px] font-semibold">
                {activeId
                  ? activeId === "custom"
                    ? customTrackLabel || "Custom track"
                    : ROOM_SOUNDSCAPE_OPTIONS.find((item) => item.id === activeId)?.label
                  : "Nothing playing"}
              </div>
              <div className={`mt-0.5 text-[10px] ${mutedText}`}>
                {personalMuted
                  ? "Muted for you"
                  : playing
                    ? "Playing for the room"
                    : activeId
                      ? "Paused for the room"
                      : "A host can start a soundtrack"}
              </div>
            </div>
            <span className={`h-2.5 w-2.5 rounded-full ${playing && !personalMuted ? "bg-[#62D873] shadow-[0_0_0_4px_rgba(98,216,115,0.13)]" : isLight ? "bg-black/20" : "bg-white/20"}`} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!activeId}
              onClick={onToggleMute}
              className={`h-9 rounded-xl border text-[11px] font-semibold transition disabled:opacity-40 ${personalMuted
                ? "border-[#F65252]/40 bg-[#F65252]/10 text-[#F65252]"
                : isLight
                  ? "border-black/10 bg-[#F5F5F5] hover:bg-[#EBEBEB]"
                  : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
            >
              {personalMuted ? "Unmute for me" : "Mute for me"}
            </button>
            <button
              type="button"
              disabled={!canControl || !activeId || busy}
              onClick={onStop}
              className={`h-9 rounded-xl border text-[11px] font-semibold transition disabled:opacity-40 ${isLight ? "border-black/10 bg-[#1B1B1B] text-white hover:bg-black" : "border-white/10 bg-[#F3F3F3] text-black hover:bg-white"}`}
            >
              {playing ? "Pause for everyone" : "Resume for everyone"}
            </button>
          </div>
        </div>

        <div className="mt-5 flex items-end justify-between gap-3">
          <div>
            <div className="text-[12px] font-semibold">Soundscapes</div>
            <div className={`mt-0.5 text-[10px] ${mutedText}`}>
              {canControl ? "Your selection updates the whole room." : "The current host controls the room soundtrack."}
            </div>
          </div>
          {!canControl ? (
            <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold ${isLight ? "bg-black/5 text-black/55" : "bg-white/5 text-white/55"}`}>
              Listen only
            </span>
          ) : null}
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
                className={`min-h-[96px] rounded-2xl border p-3 text-left transition disabled:cursor-default ${selected
                  ? isLight
                    ? "border-[#57D668] bg-[#EAF9ED]"
                    : "border-[#62D873] bg-[#17351D]"
                  : isLight
                    ? "border-black/10 bg-white hover:border-black/20 disabled:opacity-65"
                    : "border-white/10 bg-[#242424] hover:border-white/20 disabled:opacity-65"
                  }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[22px]" aria-hidden="true">{option.emoji}</span>
                  {selected ? (
                    <span className="rounded-full bg-[#62D873] px-2 py-0.5 text-[9px] font-semibold text-[#102313]">
                      {playing ? "Playing" : "Selected"}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-[12px] font-semibold">{option.label}</div>
                <div className={`mt-0.5 text-[10px] leading-snug ${mutedText}`}>{option.description}</div>
              </button>
            );
          })}
        </div>

        <div className={`mt-3 rounded-2xl border border-dashed p-3 ${border} ${isLight ? "bg-white" : "bg-[#242424]"}`}>
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
              <div className="truncate text-[11px] font-semibold">
                {activeId === "custom" ? customTrackLabel || "Custom track" : "Upload your track"}
              </div>
              <div className={`mt-0.5 text-[9px] leading-snug ${mutedText}`}>
                MP3, M4A, OGG or WebM · maximum 3 MB · shared with the room
              </div>
            </div>
            <button
              type="button"
              disabled={!canControl || uploading || busy}
              onClick={() => fileInputRef.current?.click()}
              className={`h-9 shrink-0 rounded-xl px-3 text-[10px] font-semibold transition disabled:opacity-40 ${isLight ? "bg-[#1B1B1B] text-white hover:bg-black" : "bg-[#F3F3F3] text-black hover:bg-white"}`}
            >
              {uploading ? "Uploading…" : "Choose file"}
            </button>
          </div>
        </div>

        <div className={`mt-4 rounded-2xl border p-3 ${border} ${isLight ? "bg-white" : "bg-[#242424]"}`}>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="room-soundscape-volume" className="text-[11px] font-medium">
              Your music volume
            </label>
            <span className={`text-[10px] tabular-nums ${mutedText}`}>{volume}%</span>
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
        </div>

        {error ? (
          <div className="mt-3 rounded-xl border border-[#F65252]/40 bg-[#F65252]/10 px-3 py-2 text-[11px] text-[#F65252]">
            {error}
          </div>
        ) : null}

        <p className={`mt-4 text-[10px] leading-relaxed ${mutedText}`}>
          Music is synchronized through the room and loaded directly on each device, so it stays clear and does not enter anyone&apos;s microphone.
        </p>
      </div>
    </div>
  );
}

export default RoomSoundscapePanel;
