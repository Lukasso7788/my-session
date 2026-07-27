import {
  ROOM_SOUNDSCAPE_OPTIONS,
  type RoomSoundscapeId,
} from "../../lib/roomSoundscapes";

export function RoomSoundscapePanel({
  open,
  isLight,
  activeId,
  volume,
  busy,
  error,
  onSelect,
  onVolumeChange,
  onStop,
  onClose,
}: {
  open: boolean;
  isLight: boolean;
  activeId: RoomSoundscapeId | null;
  volume: number;
  busy: boolean;
  error: string | null;
  onSelect: (id: RoomSoundscapeId) => void;
  onVolumeChange: (value: number) => void;
  onStop: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  const panel = isLight
    ? "border-[#D8D0D0] bg-[#F8F7F7] text-[#171717]"
    : "border-[#343434] bg-[#1B1B1B] text-white";
  const muted = isLight ? "text-black/55" : "text-white/55";

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 p-3 pb-[calc(92px+env(safe-area-inset-bottom))] sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`w-full max-w-[520px] rounded-[24px] border p-4 shadow-[0_18px_55px_rgba(0,0,0,0.24)] sm:p-5 ${panel}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-soundscape-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${isLight ? "text-[#369746]" : "text-[#7EE787]"}`}>
              Focus sound
            </div>
            <h2 id="room-soundscape-title" className="mt-1 text-[19px] font-semibold">
              Background sounds
            </h2>
            <p className={`mt-1 text-[12px] ${muted}`}>
              Plays only for you. It is never sent to your microphone.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`h-9 w-9 shrink-0 rounded-xl text-xl transition ${isLight ? "bg-black/5 hover:bg-black/10" : "bg-white/5 hover:bg-white/10"}`}
            aria-label="Close background sounds"
          >
            ×
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {ROOM_SOUNDSCAPE_OPTIONS.map((option) => {
            const selected = activeId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={busy}
                onClick={() => onSelect(option.id)}
                className={`min-h-[84px] rounded-2xl border p-3 text-left transition disabled:opacity-60 ${selected
                  ? isLight
                    ? "border-[#57D668] bg-[#EAF9ED]"
                    : "border-[#62D873] bg-[#17351D]"
                  : isLight
                    ? "border-black/10 bg-white hover:border-black/20"
                    : "border-white/10 bg-[#242424] hover:border-white/20"
                  }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[22px]" aria-hidden="true">{option.emoji}</span>
                  {selected ? (
                    <span className="rounded-full bg-[#62D873] px-2 py-0.5 text-[10px] font-semibold text-[#102313]">
                      Playing
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-[13px] font-semibold">{option.label}</div>
                <div className={`mt-0.5 text-[10px] leading-snug ${muted}`}>{option.description}</div>
              </button>
            );
          })}
        </div>

        <div className={`mt-4 rounded-2xl border p-3 ${isLight ? "border-black/10 bg-white" : "border-white/10 bg-[#242424]"}`}>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="room-soundscape-volume" className="text-[12px] font-medium">
              Volume
            </label>
            <span className={`text-[11px] tabular-nums ${muted}`}>{volume}%</span>
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

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className={`text-[11px] ${muted}`}>
            {busy ? "Starting audio…" : activeId ? "Sound continues when this panel closes." : "Choose a sound to begin."}
          </span>
          {activeId ? (
            <button
              type="button"
              onClick={onStop}
              className={`shrink-0 rounded-xl px-4 py-2 text-[12px] font-semibold transition ${isLight ? "bg-[#1B1B1B] text-white hover:bg-black" : "bg-[#F3F3F3] text-black hover:bg-white"}`}
            >
              Pause
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default RoomSoundscapePanel;
