import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAccountEntitlement } from "../hooks/useAccountEntitlement";
import { getSubscriptionManagementSummary, openSubscriptionPortal } from "../lib/subscriptionManagement";
import type { SubscriptionManagementSummary } from "../types/subscriptionManagement";
import SubscriptionCard, { type PortalAction } from "./SubscriptionCard";

export default function AccountSubscriptionSection({ userId }: { userId: string }) {
  const location = useLocation();
  const account = useAccountEntitlement(userId, "settings");
  const [summary, setSummary] = useState<SubscriptionManagementSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState<PortalAction | null>(null);
  const [revision, setRevision] = useState(0);
  const customerId = account.state?.entitlement?.stripe_customer_id;
  const subscriptionId = account.state?.entitlement?.stripe_subscription_id;

  useEffect(() => {
    if (location.hash === "#subscription") document.getElementById("subscription")?.scrollIntoView({ block: "start" });
  }, [location.hash]);

  useEffect(() => {
    setSummary(null);
    setMessage("");
    if (!customerId || !subscriptionId) { setSummaryLoading(false); return; }
    const controller = new AbortController();
    setSummaryLoading(true);
    void getSubscriptionManagementSummary(controller.signal)
      .then((next) => { if (!controller.signal.aborted) setSummary(next); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not load billing details."); })
      .finally(() => { if (!controller.signal.aborted) setSummaryLoading(false); });
    return () => controller.abort();
  }, [customerId, subscriptionId, location.search, revision, userId]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") setRevision((value) => value + 1); };
    window.addEventListener("focus", onVisible);
    return () => window.removeEventListener("focus", onVisible);
  }, []);

  const onOpenPortal = async (action: PortalAction) => {
    if (busyAction) return;
    setBusyAction(action);
    setMessage("");
    try { await openSubscriptionPortal(action); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not open billing settings."); }
    finally { setBusyAction(null); }
  };
  const onRefresh = () => { account.refresh(); setRevision((value) => value + 1); };

  return <SubscriptionCard state={account.state} loading={account.loading} error={account.error} summary={summary} summaryLoading={summaryLoading} message={message} busyAction={busyAction} onOpenPortal={onOpenPortal} onRefresh={onRefresh} />;
}
