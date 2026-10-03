import type { CSSProperties } from "react";
import type { RoomPolicies } from "../lib/roomPolicies";
import { getSessionCardPolicyState } from "../lib/sessionCardIndicators";

type Props = {
  policies: RoomPolicies;
  color: string;
  background: string;
};

export default function SessionRoomPolicyIndicator({ policies, color, background }: Props) {
  const { camera, screen, chat, either, label, count } = getSessionCardPolicyState(policies);
  if (count === 0) return null;

  const iconStyle = (asset: string): CSSProperties => ({
    backgroundColor: color,
    mask: `url('${asset}') center / contain no-repeat`,
    WebkitMask: `url('${asset}') center / contain no-repeat`,
  });

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex h-[26px] shrink-0 items-center gap-[6px] rounded-full border px-[9px]"
      style={{ color, backgroundColor: background, borderColor: color }}
    >
      {camera && <span aria-hidden="true" className="h-[16px] w-[17px]" style={iconStyle("/icons/camera-on-dark.svg")} />}
      {either && <span aria-hidden="true" className="text-[8px] font-bold leading-none">or</span>}
      {screen && <span aria-hidden="true" className="h-[16px] w-[17px]" style={iconStyle("/icons/screen-share-dark.svg")} />}
      {chat && <span aria-hidden="true" className="h-[17px] w-[18px]" style={iconStyle("/icons/session-no-chat.svg")} />}
    </span>
  );
}
