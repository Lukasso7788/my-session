// What each room status means for the host. Shared by the host guide and the
// statuses page. Labels and badge colors match the real tile badge
// (getStatusLabel / getStatusClass in VideoTileLiveKitLegacy, dark tiles).
export type StatusGuide = {
  key: string;
  label: string;
  menu: string; // how it reads in the status menu
  badgeClass: string;
  meaning: string;
  host: string;
  exception?: string;
};

export const STATUS_GUIDE: StatusGuide[] = [
  {
    key: "skip",
    label: "Skip me",
    menu: "Skip me",
    badgeClass: "bg-purple-400/15 text-purple-200 border-purple-300/25",
    meaning: "They're here to work, not to talk. Some also mute the room's audio, so they may not hear you at all.",
    host: "Leave them out of intentions, check-ins and the recap. Don't call on them, don't comment on them. Just go to the next person.",
  },
  {
    key: "call",
    label: "On a call",
    menu: "On a call",
    badgeClass: "bg-white/10 text-white/80 border-[#2B2B2B]",
    meaning: "They're on another call right now.",
    host: "Don't involve them or comment. Skip them until the status is gone.",
  },
  {
    key: "eating",
    label: "Eating",
    menu: "Eating",
    badgeClass: "bg-orange-400/15 text-orange-200 border-orange-300/25",
    meaning: "They're having a meal.",
    host: "Don't involve them or comment.",
    exception: "In a private session you may ask them for a check-in.",
  },
  {
    key: "break",
    label: "Break",
    menu: "Taking a break",
    badgeClass: "bg-yellow-400/15 text-yellow-200 border-yellow-300/25",
    meaning: "They've stepped away for a short break.",
    host: "Don't involve them or comment.",
    exception: "In a private session you may ask them for a check-in.",
  },
  {
    key: "afk",
    label: "AFK",
    menu: "AFK",
    badgeClass: "bg-white/10 text-white/80 border-[#2B2B2B]",
    meaning: "Away from keyboard.",
    host: "Don't call on them or comment while the status is on.",
  },
];

export const STATUS_RULE = "A status means hands off. Go around only the people without one.";

// The badge exactly as the tile draws it.
export function StatusBadge({ status }: { status: StatusGuide }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-[1px] text-[10px] leading-none ${status.badgeClass}`}>
      <span>{status.label}</span>
    </span>
  );
}
