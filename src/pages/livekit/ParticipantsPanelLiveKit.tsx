import React from "react";
import type { RoomTheme } from "./LiveKitUI";

export type ParticipantsPanelTile = {
  id: string;
  kind?: "camera" | "screen";
  label: string;
  status?: string | null;
  isLocal?: boolean;
  participantUserId?: string;
  participantIdentity?: string;
};

type Props = {
  theme: RoomTheme;
  isLight: boolean;
  participantsCount: number;
  participants: ParticipantsPanelTile[];
  search: string;
  onSearchChange: (next: string) => void;
  onClose: () => void;
  onEditName: () => void;
  rolesError?: string;
  renderParticipantRow: (tile: ParticipantsPanelTile) => React.ReactNode;
  roomPanelHeaderClass?: string;
};

export default function ParticipantsPanelLiveKit({
  theme,
  isLight,
  participantsCount,
  participants,
  search,
  onSearchChange,
  onClose,
  onEditName,
  rolesError = "",
  renderParticipantRow,
  roomPanelHeaderClass = "px-3 py-2",
}: Props) {
  return (
    <div
      className={theme === "dark" ? "dark h-full min-h-0 flex flex-col" : "h-full min-h-0 flex flex-col"}
      data-theme={theme}
      style={{ colorScheme: theme }}
    >
      <div
        className={`${roomPanelHeaderClass} border-b flex items-center justify-between ${
          isLight ? "border-black/10" : "border-white/5"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold truncate`}>
            Participants
          </span>
          <span className={`${isLight ? "text-black/50" : "text-white/55"} text-sm`}>
            ({participantsCount})
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onEditName}
            className={`px-3 h-9 rounded-xl text-[12px] font-semibold border transition ${
              isLight
                ? "bg-black/5 border-black/10 hover:bg-black/10 text-black/70"
                : "bg-white/5 border-white/10 hover:bg-white/10 text-white/85"
            }`}
            title="Edit my name"
            type="button"
          >
            Edit my name
          </button>

          <button
            onClick={onClose}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${
              isLight
                ? "bg-black/5 hover:bg-black/10 text-black/60"
                : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
            }`}
            title="Close"
            type="button"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="p-4">
        <div
          className={`rounded-xl px-3 py-2 ${
            isLight ? "bg-black/5 border border-black/10" : "bg-[#0B1220]/70 border border-white/10"
          }`}
        >
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search participants..."
            className={`w-full bg-transparent outline-none text-[13px] placeholder:opacity-60 ${
              isLight ? "text-black/80 placeholder:text-black/40" : "text-white/85 placeholder:text-white/35"
            }`}
          />
        </div>

        {rolesError ? (
          <div className={`mt-2 text-[12px] ${isLight ? "text-red-600" : "text-red-300"}`}>
            {rolesError}
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        <div className="flex flex-col gap-2">
          {participants.map((p) => (
            <React.Fragment key={p.id}>{renderParticipantRow(p)}</React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
