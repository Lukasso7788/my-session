import { useState } from "react";
import { AlarmClock, VideoOff, X } from "lucide-react";
import { Icon } from "./LiveKitUI";

// Gentle camera reminder for every room that does not require cameras.
// Shown after the camera has been off for a while; it never disconnects
// anyone (camera-required rooms keep their own stricter reminders).
// Same visual language as the room's "Camera required" notice, but as a
// small card above the bottom bar instead of a blocking modal.

export const CAMERA_OFF_REMINDER_DELAY_MS = 5 * 60_000;
const CAMERA_OFF_MASK = "url('/icons/camera-off-light.svg') center / contain no-repeat";

type Props = {
  theme: "light" | "dark";
  minutesOff: number;
  onRemindLater: () => void;
  onTurnOn: () => void;
  onStayOff: () => void;
  onClose: () => void;
};

export default function CameraOffReminder({ theme, minutesOff, onRemindLater, onTurnOn, onStayOff, onClose }: Props) {
  const isLight = theme === "light";
  const [whyOpen, setWhyOpen] = useState(false);
  const ghostButton = `inline-flex h-10 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] border px-3 text-[13px] font-normal transition sm:flex-1 ${isLight
    ? "border-black/[0.06] bg-white text-black/60 hover:bg-[#EFEFEF] hover:text-black/80"
    : "border-white/[0.06] bg-white/[0.05] text-white/60 hover:bg-white/[0.09] hover:text-white/85"
    }`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`camera-off-reminder pointer-events-auto w-full overflow-hidden rounded-[26px] border font-inter shadow-[0_24px_80px_rgba(0,0,0,0.24)] ${isLight
        ? "border-black/[0.08] bg-white text-[#2F2F2F]"
        : "border-white/[0.09] bg-[#1D1D1D] text-white"
        }`}
    >
      <div className="p-5 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] ${isLight ? "bg-[#EAF3FF] text-[#377FE8]" : "bg-[#377FE8]/15 text-[#72A9FF]"}`}
              aria-hidden="true"
            >
              {/* The room's camera-off icon, tinted with the tile's blue in both themes. */}
              <span className="block h-[22px] w-[22px]" style={{ backgroundColor: "currentColor", mask: CAMERA_OFF_MASK, WebkitMask: CAMERA_OFF_MASK }} />
            </div>
            <div className="min-w-0">
              <div className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${isLight ? "bg-[#EAF3FF] text-[#377FE8]" : "bg-[#377FE8]/15 text-[#72A9FF]"}`}>
                Camera off for {minutesOff} min
              </div>
              <div className="mt-1 text-[17px] font-medium leading-[1.3]">Ready to turn your camera back on?</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera reminder"
            title="Close"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${isLight
              ? "bg-[#F2F2F2] text-black/55 hover:bg-[#E8E8E8] hover:text-black/75"
              : "bg-white/[0.07] text-white/60 hover:bg-white/[0.11] hover:text-white/85"
              }`}
          >
            <X size={17} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

        <p className={`mt-3 text-[14px] leading-[1.55] ${isLight ? "text-black/60" : "text-white/60"}`}>
          Seeing each other helps everyone stay focused, and it makes the room feel alive for the people working with you.
          Keeping it off is fine too, if that works best for you.{" "}
          <button
            type="button"
            onClick={() => setWhyOpen((open) => !open)}
            aria-expanded={whyOpen}
            className={`font-medium underline underline-offset-2 ${isLight ? "text-[#377FE8]" : "text-[#72A9FF]"}`}
          >
            Why?
          </button>
        </p>

        {whyOpen ? (
          <p className={`mt-2 rounded-[14px] px-3 py-2 text-[13px] leading-5 ${isLight ? "bg-[#F7F7F7] text-black/60" : "bg-white/[0.05] text-white/60"}`}>
            Body doubling works because people can see each other working. A visible partner makes it easier for everyone to
            start and to keep going. Nobody is watching you closely; a camera that is simply on is enough.
          </p>
        ) : null}
      </div>

      <div className={`flex flex-col-reverse gap-2 px-4 py-3 sm:flex-row sm:items-stretch ${isLight ? "bg-[#F7F7F7]" : "bg-white/[0.035]"}`}>
        <button type="button" onClick={onStayOff} className={ghostButton}>
          <VideoOff size={16} strokeWidth={1.9} aria-hidden="true" />
          Stay off this session
        </button>
        <button type="button" onClick={onRemindLater} className={ghostButton}>
          <AlarmClock size={16} strokeWidth={1.9} aria-hidden="true" />
          Remind me in 5 min
        </button>
        <button
          type="button"
          onClick={onTurnOn}
          className="inline-flex h-10 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] bg-[#377FE8] px-4 text-[13px] font-semibold text-white transition hover:bg-[#2F72D5] sm:flex-1"
        >
          <Icon name="camera-on" theme="dark" className="h-[17px] w-[17px]" alt="" />
          Turn camera on
        </button>
      </div>
    </div>
  );
}
