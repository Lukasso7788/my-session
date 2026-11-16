import { useCallback, useRef, useState } from "react";

export type RoomPiPView = "gallery" | "chat" | "tasks" | "compact";

export function useRoomPiPView(pipWindowRef: { current: Window | null }) {
  const [view, setView] = useState<RoomPiPView>("gallery");
  const [tasksMounted, setTasksMounted] = useState(false);
  const currentView = useRef<RoomPiPView>("gallery");
  const galleryHeight = useRef<number | null>(null);
  const beforeTasks = useRef<"gallery" | "chat">("gallery");
  const beforeCompact = useRef<Exclude<RoomPiPView, "compact">>("gallery");

  const reset = useCallback(() => {
    galleryHeight.current = null;
    currentView.current = "gallery";
    beforeTasks.current = "gallery";
    beforeCompact.current = "gallery";
    setView("gallery");
    setTasksMounted(false);
  }, []);

  const show = useCallback((next: RoomPiPView) => {
    const current = currentView.current;
    if (current === next) return;
    if (next === "tasks") {
      if (current === "gallery" || current === "chat") beforeTasks.current = current;
      setTasksMounted(true);
    }
    if (next === "compact" && current !== "compact") beforeCompact.current = current;

    const pipWindow = pipWindowRef.current;
    if (pipWindow && !pipWindow.closed) {
      const height = pipWindow.innerHeight;
      if (current === "gallery") galleryHeight.current = height;
      const baseHeight = galleryHeight.current ?? height;
      const target = next === "gallery" ? baseHeight : next === "compact" ? 64 : Math.max(600, baseHeight);
      if (height !== target) {
        try {
          // Chrome will only resize the document PiP during a user gesture.
          pipWindow.resizeBy(0, target - height);
        } catch {
          // The requested view is still usable at the current height.
        }
      }
    }
    currentView.current = next;
    setView(next);
  }, [pipWindowRef]);

  const toggleTasks = useCallback(() => {
    show(currentView.current === "tasks" ? beforeTasks.current : "tasks");
  }, [show]);

  const toggleCompact = useCallback(() => {
    show(currentView.current === "compact" ? beforeCompact.current : "compact");
  }, [show]);

  return { view, tasksMounted, reset, show, toggleTasks, toggleCompact };
}
