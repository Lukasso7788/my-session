export type SubscriptionManagementSummary = {
  canManage: boolean;
  canCancel: boolean;
  status: string | null;
  cancellationScheduled: boolean;
  accessEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancellationUnavailableReason: "not_recurring" | "already_canceled" | "scheduled" | "portal_not_configured" | null;
};
