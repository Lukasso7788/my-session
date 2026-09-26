import { useCallback, useLayoutEffect, useRef } from "react";

// Stable listener identity, fresh committed state. Useful for long-lived SDK /
// Realtime subscriptions and memoized children; never hides changed UI props.
export function useLatestCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => { callbackRef.current = callback; });
  return useCallback((...args: Args) => callbackRef.current(...args), []);
}
