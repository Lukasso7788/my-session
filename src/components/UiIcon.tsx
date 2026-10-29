import type { CSSProperties } from "react";
import {
  CalendarDays,
  CalendarPlus,
  Clock3,
  Globe2,
  Info,
  Layers,
  Lock,
  MessageSquareOff,
  Pencil,
  Repeat,
  ScreenShare,
  Sparkles,
  Target,
  Users,
  UsersRound,
  Video,
  Zap,
  type LucideIcon,
} from "lucide-react";

// UI icons for the create session form, by name (lucide-react SVGs).
const ICONS = {
  "arrows-repeat": Repeat,
  bolt: Zap,
  bullseye: Target,
  calendar: CalendarDays,
  "calendar-plus": CalendarPlus,
  "clock-three": Clock3,
  "comment-slash": MessageSquareOff,
  "earth-americas": Globe2,
  info: Info,
  layers: Layers,
  lock: Lock,
  pencil: Pencil,
  screencast: ScreenShare,
  sparkles: Sparkles,
  users: Users,
  "users-alt": UsersRound,
  webcam: Video,
} satisfies Record<string, LucideIcon>;

// Filled versions drawn for this form (24x24, currentColor; the plus is cut out).
const FILLED = {
  "calendar-plus-filled": (
    <path
      fillRule="evenodd"
      d="M8 2a1 1 0 0 1 1 1v1h6V3a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1Zm4 8a1 1 0 0 0-1 1v2H9a1 1 0 1 0 0 2h2v2a1 1 0 1 0 2 0v-2h2a1 1 0 1 0 0-2h-2v-2a1 1 0 0 0-1-1Z"
    />
  ),
  "users-filled": (
    <>
      <circle cx="9" cy="7.5" r="3.75" />
      <path d="M2 18.5C2 15.46 4.69 13 8 13h2c3.31 0 6 2.46 6 5.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 2 19v-.5Z" />
      <circle cx="17" cy="8.5" r="3" />
      <path d="M17.5 13.5c2.5.2 4.5 2.2 4.5 4.7v.6a1.2 1.2 0 0 1-1.2 1.2h-3.1c.2-.4.3-.8.3-1.3v-.5c0-1.7-.7-3.3-1.9-4.5.4-.1.9-.2 1.4-.2Z" />
    </>
  ),
};

export type UiIconName = keyof typeof ICONS | keyof typeof FILLED;

export default function UiIcon({ name, size = 18, className = "", style }: { name: UiIconName; size?: number; className?: string; style?: CSSProperties }) {
  if (name in FILLED) {
    return (
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={`shrink-0 ${className}`} style={style}>
        {FILLED[name as keyof typeof FILLED]}
      </svg>
    );
  }
  const Icon = ICONS[name as keyof typeof ICONS];
  return <Icon aria-hidden="true" size={size} strokeWidth={2} className={`shrink-0 ${className}`} style={style} />;
}
