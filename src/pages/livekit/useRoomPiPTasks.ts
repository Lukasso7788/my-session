import { useCallback, useState } from "react";

export function useRoomPiPTasks() {
  const [status, setStatus] = useState<"idle" | "expanded" | "collapsed">("idle");

  const reset = useCallback(() => setStatus("idle"), []);
  const collapse = useCallback(() => {
    setStatus((current) => current === "expanded" ? "collapsed" : current);
  }, []);

  const toggle = useCallback(() => {
    setStatus((current) => current === "expanded" ? "collapsed" : "expanded");
  }, []);

  return { expanded: status === "expanded", mounted: status !== "idle", reset, collapse, toggle };
}
