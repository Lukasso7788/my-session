import { supabase } from "./supabase";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getPushPermission() {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

export async function hasPushSubscription() {
  if (!pushSupported() || Notification.permission !== "granted") return false;

  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) return false;

  return Boolean(await registration.pushManager.getSubscription());
}

function normalizeSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();

  return {
    endpoint: subscription.endpoint || json.endpoint,
    expirationTime: subscription.expirationTime || null,
    keys: {
      p256dh: json.keys?.p256dh || "",
      auth: json.keys?.auth || "",
    },
  };
}

export async function ensurePushSubscription() {
  if (!pushSupported()) {
    throw new Error("Push notifications are not supported in this browser.");
  }

  if (!window.isSecureContext) {
    throw new Error("Push notifications require HTTPS.");
  }

  const vapidPublicKey = String(import.meta.env.VITE_VAPID_PUBLIC_KEY || "").trim();

  if (!vapidPublicKey) {
    throw new Error("Missing VITE_VAPID_PUBLIC_KEY.");
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error(`Notification permission is ${permission}.`);
  }

  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
  });

  try {
    await registration.update();
  } catch {
    // A stale service worker can still complete registration; update is best-effort.
  }

  const readyRegistration = await navigator.serviceWorker.ready;

  let subscription = await readyRegistration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await readyRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const normalized = normalizeSubscription(subscription);

  if (!normalized.endpoint || !normalized.keys.p256dh || !normalized.keys.auth) {
    throw new Error("Browser returned incomplete push subscription.");
  }

  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  if (!token) {
    throw new Error("Not authenticated.");
  }

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      subscription: normalized,
      userAgent: navigator.userAgent,
      browser: {
        permission: Notification.permission,
        secureContext: window.isSecureContext,
        serviceWorkerController: !!navigator.serviceWorker.controller,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "Failed to save push subscription.");
  }

  return subscription;
}

export async function showPushEnabledTestNotification() {
  if (!("Notification" in window)) return;

  if (Notification.permission === "granted") {
    new Notification("Notifications enabled", {
      body: "We’ll notify you about active focus rooms and hosts you follow.",
      icon: "/icons/followers_profile.svg",
    });
  }
}
