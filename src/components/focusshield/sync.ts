import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { clearFocusShieldPolicy } from "./clear";
import {
  coercePolicy,
  createActivePolicy,
  isShieldLocked,
  isShieldRunning,
  newerPolicy,
  readCachedPolicy,
  writeCachedPolicy,
} from "./policy";
import {
  FOCUS_SHIELD_EVENT,
  FOCUS_SHIELD_PAGE_RESULT,
  FOCUS_SHIELD_PAGE_SOURCE,
  type FocusShieldPolicy,
} from "./focusShieldTypes";

const DESKTOP_BRIDGE_URL = "http://127.0.0.1:43117/v1/policy";
const DEVICE_KEY = "mysession_focus_shield_device_v1";

export type ShieldSyncResult = {
  policy: FocusShieldPolicy;
  extension: "applied" | "legacy" | "missing";
  saved: boolean;
  desktop: boolean;
  error?: string;
};

function deviceId() {
  if (typeof localStorage === "undefined") return "session";
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const next = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}`;
    localStorage.setItem(DEVICE_KEY, next);
    return next;
  } catch {
    return "session";
  }
}

export function publishFocusShieldPolicy(policy: FocusShieldPolicy | null) {
  writeCachedPolicy(policy);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FOCUS_SHIELD_EVENT, { detail: policy }));
}

export function callFocusShieldExtension(message: Record<string, unknown>, timeoutMs = 700) {
  if (typeof window === "undefined") return Promise.resolve(null);
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise<Record<string, unknown> | null>((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== FOCUS_SHIELD_PAGE_RESULT || data.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data.response ?? null);
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ source: FOCUS_SHIELD_PAGE_SOURCE, requestId, message }, window.location.origin);
  });
}

async function readExtensionPolicy() {
  const response = await callFocusShieldExtension({ type: "GET" }, 450);
  return coercePolicy(response?.policy);
}

async function readStoredPolicy(userId: string) {
  const { data, error } = await supabase
    .from("focus_shield_policies")
    .select("policy")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null;
  return coercePolicy(data?.policy);
}

async function saveStoredPolicy(userId: string, policy: FocusShieldPolicy) {
  const { error } = await supabase.from("focus_shield_policies").upsert(
    {
      user_id: userId,
      policy,
      device_id: deviceId(),
    },
    { onConflict: "user_id" },
  );
  return !error;
}

async function pushDesktopPolicy(policy: FocusShieldPolicy) {
  try {
    const response = await fetch(DESKTOP_BRIDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy }),
      signal: AbortSignal.timeout(1200),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function applyOnExtension(policy: FocusShieldPolicy, minutes: number) {
  const applied = await callFocusShieldExtension({ type: "APPLY_POLICY", policy });
  if (applied?.ok && applied.policy) {
    return { mode: "applied" as const, policy: coercePolicy(applied.policy) || policy };
  }
  const legacy = await callFocusShieldExtension({
    type: "ACTIVATE",
    domains: policy.web.domains,
    urls: policy.web.urls,
    minutes,
    locked: policy.locked,
  });
  if (legacy?.ok) {
    return { mode: "legacy" as const, policy: coercePolicy(legacy.policy) || policy };
  }
  return { mode: "missing" as const, policy };
}

export async function reconcileFocusShield(userId: string | null) {
  const [stored, extension] = await Promise.all([
    userId ? readStoredPolicy(userId) : Promise.resolve(null),
    readExtensionPolicy(),
  ]);
  const policy = newerPolicy(stored, extension);
  if (!policy) return null;
  publishFocusShieldPolicy(policy);
  if (userId && extension && (extension.updatedAt || 0) > (stored?.updatedAt || 0)) {
    void saveStoredPolicy(userId, extension);
  }
  return policy;
}

export async function activateFocusShield(args: {
  userId: string | null;
  domains: string[];
  urls: string[];
  minutes: number;
  locked: boolean;
}): Promise<ShieldSyncResult> {
  const draft = createActivePolicy({
    domains: args.domains,
    urls: args.urls,
    minutes: args.minutes,
    locked: args.locked,
    source: "session",
  });
  const extension = await applyOnExtension(draft, args.minutes);
  const policy = extension.policy;
  const saved = args.userId ? await saveStoredPolicy(args.userId, policy) : false;
  const desktop = await pushDesktopPolicy(policy);
  publishFocusShieldPolicy(policy);
  return {
    policy,
    extension: extension.mode,
    saved,
    desktop,
    error: extension.mode === "missing" && !saved
      ? "FocusShield is not installed in this browser, and the account save did not go through."
      : undefined,
  };
}

export async function stopFocusShield(userId: string | null, current: FocusShieldPolicy | null): Promise<ShieldSyncResult> {
  const extensionStop = await callFocusShieldExtension({ type: "STOP" });
  if (extensionStop?.error === "locked" || (!extensionStop && isShieldLocked(current))) {
    const policy = coercePolicy(extensionStop?.policy) || current || clearFocusShieldPolicy(current);
    return {
      policy,
      extension: extensionStop ? "applied" : "missing",
      saved: false,
      desktop: false,
      error: "locked",
    };
  }

  const policy = clearFocusShieldPolicy(coercePolicy(extensionStop?.policy) || current);
  if (!extensionStop) {
    await callFocusShieldExtension({ type: "APPLY_POLICY", policy });
  }
  const saved = userId ? await saveStoredPolicy(userId, policy) : false;
  const desktop = await pushDesktopPolicy(policy);
  publishFocusShieldPolicy(policy);
  return {
    policy,
    extension: extensionStop?.ok ? "applied" : "missing",
    saved,
    desktop,
  };
}

export function useFocusShieldActive(userId: string | null) {
  const [policy, setPolicy] = useState<FocusShieldPolicy | null>(() => readCachedPolicy());

  useEffect(() => {
    let cancelled = false;
    void reconcileFocusShield(userId).then((next) => {
      if (!cancelled && next) setPolicy(next);
    });
    const onChange = (event: Event) => {
      setPolicy(coercePolicy((event as CustomEvent).detail));
    };
    window.addEventListener(FOCUS_SHIELD_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(FOCUS_SHIELD_EVENT, onChange);
    };
  }, [userId]);

  useEffect(() => {
    if (!isShieldRunning(policy) || !policy?.endAt) return;
    const delay = Math.max(0, policy.endAt - Date.now());
    const timer = window.setTimeout(() => {
      setPolicy((current) => (current ? clearFocusShieldPolicy(current, Date.now()) : current));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [policy]);

  return isShieldRunning(policy);
}
