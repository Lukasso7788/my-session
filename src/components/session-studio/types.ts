export type SessionTimelineBlockKind =
  | "welcome"
  | "intentions"
  | "focus"
  | "break"
  | "checkin"
  | "recap"
  | "celebrate"
  | "outro"
  | "custom";

export type SessionTimelineBlock = {
  id: string;
  kind: SessionTimelineBlockKind;
  title: string;
  minutes: number;
  note?: string;
};