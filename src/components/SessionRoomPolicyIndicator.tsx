import type { CSSProperties } from "react";
import type { RoomPolicies } from "../lib/roomPolicies";
import { getSessionCardPolicyState } from "../lib/sessionCardIndicators";

type Props = {
  policies: RoomPolicies;
  color: string;
  background: string;
};

function PolicyIcon({ asset, label, color }: { asset: string; label: string; color: string }) {
  const mask: CSSProperties = {
    backgroundColor: color,
    mask: `url('${asset}') center / contain no-repeat`,
    WebkitMask: `url('${asset}') center / contain no-repeat`,
  };

  return (
    <span
      role="img"
      aria-label={label}
      tabIndex={0}
      className="group relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ outlineColor: color }}
    >
      <span aria-hidden="true" className="h-[17px] w-[17px]" style={mask} />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[#2F2F2F] px-2.5 py-1.5 font-inter text-[11px] font-medium leading-none text-white shadow-lg group-hover:block group-focus:block"
      >
        {label}
      </span>
    </span>
  );
}

export default function SessionRoomPolicyIndicator({ policies, color, background }: Props) {
  const { camera, screen, chat, either, label, count } = getSessionCardPolicyState(policies);
  if (count === 0) return null;
  const cameraIcon = camera && <PolicyIcon asset="/icons/camera-on-dark.svg" label={either ? "Camera option — camera or screen share required" : "Camera required"} color={color} />;
  const screenIcon = screen && <PolicyIcon asset="/icons/screen-share-dark.svg" label={either ? "Screen share option — camera or screen share required" : "Screen share required"} color={color} />;

  return (
    <span
      role="group"
      aria-label={label}
      className="relative inline-flex h-[26px] shrink-0 items-center gap-[6px] rounded-full border px-[9px] hover:z-50 focus-within:z-50"
      style={{ color, backgroundColor: background, borderColor: color }}
    >
      {either ? (
        <span className="inline-flex items-center gap-[2px]">
          {cameraIcon}
          <span aria-hidden="true" className="font-inter text-[16px] font-bold leading-none" style={{ color }}>/</span>
          {screenIcon}
        </span>
      ) : (
        <>{cameraIcon}{screenIcon}</>
      )}
      {chat && <PolicyIcon asset="/icons/session-no-chat.svg" label="Public chat disabled" color={color} />}
    </span>
  );
}
