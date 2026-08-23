import { useEffect, useState } from "react";
import { ArrowLeft, Bell, ChevronRight, CreditCard, Mail, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  ensurePushSubscription,
  getPushPermission,
  hasPushSubscription,
  pushSupported,
  showPushEnabledTestNotification,
} from "../lib/pushNotifications";
import { supabase } from "../lib/supabase";
import type { UserEntitlement } from "../lib/billing";
import { getUserEntitlement } from "../lib/entitlements";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : String(error || fallback);
}

export default function ProfileSettingsPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [presencePushEnabled, setPresencePushEnabled] = useState(true);
  const [pushPermission, setPushPermission] = useState<string>(() => getPushPermission());
  const [deviceSubscribed, setDeviceSubscribed] = useState<boolean | null>(null);
  const [pushPreferenceBusy, setPushPreferenceBusy] = useState(false);
  const [pushTestBusy, setPushTestBusy] = useState(false);
  const [pushPreferenceMessage, setPushPreferenceMessage] = useState("");
  const [entitlement, setEntitlement] = useState<UserEntitlement | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingMessage, setBillingMessage] = useState("");

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [loading, navigate, user]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const loadSettings = async () => {
      const [{ data, error }, subscribed] = await Promise.all([
        supabase
          .from("notification_preferences")
          .select("focus_presence_push_enabled")
          .eq("user_id", user.id)
          .maybeSingle(),
        hasPushSubscription().catch(() => false),
      ]);

      if (cancelled) return;
      setPushPermission(getPushPermission());
      setDeviceSubscribed(subscribed);

      if (error) {
        console.warn("Failed to load push preference; using default-on:", error);
        setPresencePushEnabled(true);
        return;
      }

      setPresencePushEnabled(data?.focus_presence_push_enabled !== false);
    };

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);


  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    setBillingLoading(true);
    void getUserEntitlement(user.id)
      .then((nextEntitlement) => {
        if (!cancelled) setEntitlement(nextEntitlement);
      })
      .catch((error) => {
        console.warn("Failed to load billing details:", error);
        if (!cancelled) setBillingMessage("Could not load subscription details.");
      })
      .finally(() => {
        if (!cancelled) setBillingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleManageSubscription = async () => {
    if (billingBusy) return;
    setBillingBusy(true);
    setBillingMessage("");

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again to manage your subscription.");

      const response = await fetch("/api/billing/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ checkoutKind: "customer_portal" }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.url) {
        throw new Error(
          payload?.error === "billing_profile_not_found"
            ? "This plan is not connected to a recurring Stripe subscription."
            : payload?.details || payload?.error || "Could not open subscription settings.",
        );
      }

      window.location.assign(String(payload.url));
    } catch (error) {
      setBillingMessage(errorMessage(error, "Could not open subscription settings."));
      setBillingBusy(false);
    }
  };
  const enableOnThisDevice = async () => {
    await ensurePushSubscription();
    setPushPermission(getPushPermission());
    setDeviceSubscribed(true);
    setPushPreferenceMessage("Notifications are enabled on this device.");
    await showPushEnabledTestNotification();
  };

  const handlePresencePushToggle = async () => {
    if (!user?.id || pushPreferenceBusy) return;
    const nextEnabled = !presencePushEnabled;
    setPushPreferenceBusy(true);
    setPushPreferenceMessage("");

    try {
      const { error } = await supabase.from("notification_preferences").upsert(
        {
          user_id: user.id,
          focus_presence_push_enabled: nextEnabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

      if (error) throw error;
      setPresencePushEnabled(nextEnabled);

      if (!nextEnabled) {
        setPushPreferenceMessage("Focus room activity notifications are off.");
        return;
      }

      try {
        await enableOnThisDevice();
      } catch (error) {
        setPushPermission(getPushPermission());
        setDeviceSubscribed(false);
        setPushPreferenceMessage(
          errorMessage(error, "Allow notifications in your browser to receive them on this device."),
        );
      }
    } catch (error) {
      setPushPreferenceMessage(errorMessage(error, "Could not update notification settings."));
    } finally {
      setPushPreferenceBusy(false);
    }
  };

  const handleEnablePushOnDevice = async () => {
    if (pushPreferenceBusy) return;
    setPushPreferenceBusy(true);
    setPushPreferenceMessage("");

    try {
      await enableOnThisDevice();
    } catch (error) {
      setPushPermission(getPushPermission());
      setDeviceSubscribed(false);
      setPushPreferenceMessage(
        errorMessage(error, "Allow notifications in your browser to receive them on this device."),
      );
    } finally {
      setPushPreferenceBusy(false);
    }
  };

  const handleSendTestPush = async () => {
    if (pushTestBusy) return;
    setPushTestBusy(true);
    setPushPreferenceMessage("");

    try {
      await ensurePushSubscription();
      setPushPermission(getPushPermission());
      setDeviceSubscribed(true);

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again before testing push notifications.");

      const response = await fetch("/api/push/send-host-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "user_test" }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.details || payload?.reason || payload?.error || "The server could not send a test push.",
        );
      }

      setPushPreferenceMessage(
        `Test push sent to ${Number(payload.sent || 0)} of ${Number(payload.subscriptions || 0)} subscribed devices.`,
      );
    } catch (error) {
      setPushPreferenceMessage(errorMessage(error, "Could not send the test push."));
    } finally {
      setPushTestBusy(false);
    }
  };

  if (loading || !user) {
    return <main className="min-h-screen bg-[#F7F8FA]" />;
  }

  const deviceStatus = !pushSupported()
    ? "Push notifications are not supported on this device."
    : pushPermission === "denied"
      ? "Blocked by the browser. Allow notifications in this site's browser settings."
      : !presencePushEnabled
        ? "Turn this on whenever you want to hear about active focus rooms."
        : deviceSubscribed
          ? "Ready on this device."
          : pushPermission === "granted"
            ? "Browser access is allowed. Finish setting up this device."
            : "Allow notifications once on this device to start receiving them.";

  const planLabel =
    entitlement?.plan === "pro_monthly"
      ? "MySession Pro · Monthly"
      : entitlement?.plan === "pro_yearly"
        ? "MySession Pro · Yearly"
        : entitlement?.plan === "lifetime"
          ? "MySession Lifetime"
          : entitlement?.plan === "founding_free"
            ? "Founding member"
            : "MySession Free";
  const recurringSubscription =
    entitlement?.plan === "pro_monthly" || entitlement?.plan === "pro_yearly";
  const subscriptionStatus = entitlement?.status
    ? entitlement.status.charAt(0).toUpperCase() + entitlement.status.slice(1)
    : "Free";
  return (
    <main className="min-h-screen bg-[#F7F8FA] px-4 py-8 text-[#2F2F2F] sm:px-6 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <button
          type="button"
          onClick={() => navigate("/profile")}
          className="inline-flex items-center gap-2 text-sm text-black/55 transition hover:text-black"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to profile
        </button>

        <header className="mt-6">
          <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#4AAE55]">
            Profile settings
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Settings</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-black/55">
            Manage how MySession reaches you and where your profile information appears.
          </p>
        </header>

        <section className="mt-8 overflow-hidden rounded-[28px] border border-black/10 bg-white shadow-sm">
          <div className="flex items-start gap-4 border-b border-black/10 px-5 py-5 sm:px-7">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#EAF9EC] text-[#2F9D46]">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Notifications</h2>
              <p className="mt-1 text-sm leading-6 text-black/55">Choose which activity can reach this browser.</p>
            </div>
          </div>

          <div className="px-5 py-5 sm:px-7 sm:py-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[16px] font-semibold">Focus room activity</h3>
                  <span className="rounded-full bg-[#EAF9EC] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#238B3A]">
                    Push
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-5 text-black/55">
                  Get updates such as “5 people are focusing right now in 25/5 Pomodoro.”
                </p>
                <p className="mt-2 text-[12px] text-black/45">{deviceStatus}</p>
                {pushPreferenceMessage ? (
                  <p className="mt-2 text-[12px] font-medium text-[#2F2F2F]">{pushPreferenceMessage}</p>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-3">
                {presencePushEnabled && deviceSubscribed ? (
                  <button
                    type="button"
                    onClick={handleSendTestPush}
                    disabled={pushTestBusy || pushPreferenceBusy}
                    className="rounded-full border border-[#2F2F2F] px-4 py-2 text-[13px] font-medium transition hover:bg-[#2F2F2F] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pushTestBusy ? "Sending test…" : "Send test push"}
                  </button>
                ) : null}

                {presencePushEnabled &&
                pushSupported() &&
                pushPermission !== "denied" &&
                deviceSubscribed === false ? (
                  <button
                    type="button"
                    onClick={handleEnablePushOnDevice}
                    disabled={pushPreferenceBusy}
                    className="rounded-full border border-[#2F2F2F] px-4 py-2 text-[13px] font-medium transition hover:bg-[#2F2F2F] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Enable on this device
                  </button>
                ) : null}

                <button
                  type="button"
                  role="switch"
                  aria-checked={presencePushEnabled}
                  aria-label="Focus room activity push notifications"
                  onClick={handlePresencePushToggle}
                  disabled={pushPreferenceBusy}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    presencePushEnabled ? "border-[#65D46C] bg-[#65D46C]" : "border-gray-300 bg-gray-200"
                  }`}
                >
                  <span
                    className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                      presencePushEnabled ? "translate-x-7" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </section>


        <section className="mt-5 overflow-hidden rounded-[28px] border border-black/10 bg-white shadow-sm">
          <div className="flex items-start gap-4 border-b border-black/10 px-5 py-5 sm:px-7">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-black/[0.06] text-[#2F2F2F]">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Subscription</h2>
              <p className="mt-1 text-sm leading-6 text-black/55">
                View your plan, pause billing when available, or cancel your subscription.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-6">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[16px] font-semibold">
                  {billingLoading ? "Loading your plan…" : planLabel}
                </h3>
                {!billingLoading ? (
                  <span className="rounded-full bg-black/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#2F2F2F]">
                    {subscriptionStatus}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[13px] leading-5 text-black/55">
                {recurringSubscription
                  ? "Stripe securely handles billing changes. Your access remains active through any paid period."
                  : "This plan does not have a recurring subscription to manage."}
              </p>
              {billingMessage ? (
                <p className="mt-2 text-[12px] font-medium text-[#2F2F2F]">{billingMessage}</p>
              ) : null}
            </div>

            {recurringSubscription ? (
              <button
                type="button"
                onClick={handleManageSubscription}
                disabled={billingBusy || billingLoading}
                className="shrink-0 rounded-full bg-[#2F2F2F] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                {billingBusy ? "Opening…" : "Manage subscription"}
              </button>
            ) : null}
          </div>
        </section>
        <section className="mt-5 grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => navigate("/settings/email")}
            className="group flex items-center gap-4 rounded-3xl border border-black/10 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#FFF4E8] text-[#D97706]">
              <Mail className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Email preferences</div>
              <div className="mt-1 text-[12px] leading-5 text-black/50">Reminders, recaps, lifecycle and marketing email.</div>
            </div>
            <ChevronRight className="h-5 w-5 text-black/30 transition group-hover:translate-x-0.5" />
          </button>

          <button
            type="button"
            onClick={() => navigate("/profile")}
            className="group flex items-center gap-4 rounded-3xl border border-black/10 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#EEF2FF] text-[#4F46E5]">
              <UserRound className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Profile details</div>
              <div className="mt-1 text-[12px] leading-5 text-black/50">Update your name, avatar, bio and public profile.</div>
            </div>
            <ChevronRight className="h-5 w-5 text-black/30 transition group-hover:translate-x-0.5" />
          </button>
        </section>
      </div>
    </main>
  );
}
