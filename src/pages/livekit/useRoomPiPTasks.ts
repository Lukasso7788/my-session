import { useCallback, useRef, useState } from "react";

export function useRoomPiPTasks(pipWindowRef: { current: Window | null }) {
  const [status, setStatus] = useState<"idle" | "expanded" | "collapsed">("idle");
  const heightBeforeTasks = useRef<number | null>(null);

  const reset = useCallback(() => {
    heightBeforeTasks.current = null;
    setStatus("idle");
  }, []);

  const resizeHeight = useCallback((height: number) => {
    const pipWindow = pipWindowRef.current;
    if (!pipWindow || pipWindow.closed || pipWindow.innerHeight === height) return;
    // Keep this within the click handler for Chrome's user activation check.
    try {
      pipWindow.resizeBy(0, height - pipWindow.innerHeight);
    } catch {
      // Tasks remains scrollable if the browser does not allow resizing.
    }
  }, [pipWindowRef]);

  const collapse = useCallback(() => {
    const height = heightBeforeTasks.current;
    heightBeforeTasks.current = null;
    if (height !== null) resizeHeight(height);
    setStatus((current) => current === "expanded" ? "collapsed" : current);
  }, [resizeHeight]);

  const toggle = useCallback(() => {
    if (heightBeforeTasks.current !== null) {
      collapse();
      return;
    }
    const pipWindow = pipWindowRef.current;
    if (!pipWindow || pipWindow.closed) return;
    heightBeforeTasks.current = pipWindow.innerHeight;
    resizeHeight(Math.max(pipWindow.innerHeight, 600));
    setStatus("expanded");
  }, [collapse, pipWindowRef, resizeHeight]);

  return { expanded: status === "expanded", mounted: status !== "idle", reset, collapse, toggle };
}
