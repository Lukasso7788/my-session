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

export type UiIconName = keyof typeof ICONS;

export default function UiIcon({ name, size = 18, className = "", style }: { name: UiIconName; size?: number; className?: string; style?: CSSProperties }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" size={size} strokeWidth={2} className={`shrink-0 ${className}`} style={style} />;
}
