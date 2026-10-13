import { useEffect, useState } from "react";
import RoomJoiningIndicator from "./RoomJoiningIndicator";
import { PRODUCTIVITY_TIPS, pickProductivityTipIndex } from "../data/productivityTips";
import "./room-joining-tip.css";

type Props = {
  theme: "light" | "dark";
  /** Connection status; announced to screen readers and shown under the tip. */
  status: string;
};

// The tip shown last, kept in memory only so the next join never repeats it.
let lastShownTipIndex: number | null = null;

/**
 * Joining screen for coworking rooms: one random productivity tip as the main
 * message, with the existing loader and the connection status underneath.
 * The room mounts this only while a join attempt is in progress, so each
 * mount is one attempt: the tip is picked once on mount and stays the same
 * through re-renders and in-place connection retries.
 */
export default function RoomJoiningTip({ theme, status }: Props) {
  const [tipIndex] = useState(() => pickProductivityTipIndex(lastShownTipIndex));

  useEffect(() => {
    // Recorded after commit so a discarded render cannot skip a tip.
    lastShownTipIndex = tipIndex;
  }, [tipIndex]);

  return (
    <div className="ms-room-joining-tip" data-theme={theme}>
      <p className="ms-room-joining-tip-text">{PRODUCTIVITY_TIPS[tipIndex]}</p>
      <div className="ms-room-joining-tip-status">
        <RoomJoiningIndicator theme={theme} label={status} word={status} />
      </div>
    </div>
  );
}
