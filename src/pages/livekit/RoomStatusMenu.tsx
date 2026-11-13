import { Check, Coffee, Eraser, EyeOff, LogOut, Phone, SkipForward, Utensils, VolumeX } from "lucide-react";

const statusOptions = [
  { value: null, label: "Clear status", Icon: Eraser },
  { value: "afk", label: "AFK", Icon: LogOut },
  { value: "break", label: "Taking a break", Icon: Coffee },
  { value: "skip", label: "Skip me", Icon: SkipForward },
  { value: "skip_deafened", label: "Skip me (muted)", Icon: VolumeX },
  { value: "call", label: "On a call", Icon: Phone },
  { value: "eating", label: "Eating", Icon: Utensils },
  { value: "private", label: "Private", Icon: EyeOff },
] as const;

export function RoomStatusMenu({
  isLight,
  currentStatus,
  onSelect,
}: {
  isLight: boolean;
  currentStatus: string | null;
  onSelect: (status: string | null) => void;
}) {
  return (
    <>
      <div className={`px-4 pb-1 pt-2 font-inter text-[12px] font-bold ${isLight ? "text-black/55" : "text-white/55"}`}>
        Status
      </div>
      {statusOptions.map(({ value, label, Icon }) => {
        const selected = value !== null && value === currentStatus;
        return (
          <button
            key={value ?? "clear"}
            type="button"
            aria-pressed={value === null ? undefined : selected}
            onClick={() => onSelect(selected ? null : value)}
            className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] transition ${selected
              ? isLight ? "bg-[#DCEBFF] text-[#184E94]" : "bg-[#243B57] text-[#B8D8FF]"
              : isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
          >
            <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-75" />
            {label}
            {selected && <Check aria-hidden="true" className="ml-auto h-3.5 w-3.5 shrink-0" />}
          </button>
        );
      })}
    </>
  );
}
