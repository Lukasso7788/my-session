import { supabase } from "./supabase";

export function browserNotificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getBrowserNotificationPermission() {
  if (!browserNotificationsSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestBrowserNotificationsPermission() {
  if (!browserNotificationsSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  return permission;
}

export async function saveBrowserNotificationsPreference(enabled: boolean) {
  const { data } = await supabase.auth.getUser();
  const userId = data?.user?.id;

  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("notification_preferences")
    .upsert(
      {
        user_id: userId,
        browser_notifications_enabled: enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) throw error;
}

export function showLocalNotification(title: string, options?: NotificationOptions) {
  if (!browserNotificationsSupported()) return false;
  if (Notification.permission !== "granted") return false;

  new Notification(title, options);
  return true;
}