import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { getFreeSessionUsage } from "../lib/freeSessionNotice";
import type { EntitlementState } from "../lib/entitlements";
import { PAYWALL_ENABLED } from "../lib/flags";

export default function FreeSessionsNotice({ state, enabled = PAYWALL_ENABLED }: { state: EntitlementState | null; enabled?: boolean }) {
  if (!state) return null;
  const usage = getFreeSessionUsage({ ...state, enabled });
  if (!usage?.showWarning) return null;

  return (
    <aside aria-label="Free session allowance" className="flex flex-col gap-3 rounded-2xl border border-[#BCD4F5] bg-[#EDF5FF] px-4 py-3 text-[#16365C] sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold" aria-live="polite" aria-atomic="true">{usage.title}.</p>
        <p className="mt-0.5 text-xs text-[#405D7F]">{Math.min(usage.used, usage.limit)} of {usage.limit} free sessions used. Pro includes unlimited sessions.</p>
      </div>
      <Link to="/pricing" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#245FBD] px-4 text-sm font-semibold text-white hover:bg-[#194C9B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#245FBD]">
        Upgrade to Pro <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </aside>
  );
}
