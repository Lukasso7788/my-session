import { Link } from "react-router-dom";
import { ArrowUpRight, Lock } from "lucide-react";
import { getFreeSessionUsage } from "../lib/freeSessionNotice";
import type { EntitlementState } from "../lib/entitlements";
import { PAYWALL_ENABLED } from "../lib/flags";

export default function FreeSessionsNotice({ state, enabled = PAYWALL_ENABLED }: { state: EntitlementState | null; enabled?: boolean }) {
  if (!state) return null;
  const usage = getFreeSessionUsage({ ...state, enabled });
  if (!usage?.showWarning) return null;

  // Same red as the "Structured Flow" tile on the 24/7 Focus Rooms card:
  // #F65252 border, the same color at 20% for the fill. A full-bleed bar right under the header;
  // message and button sit together in the center.
  return (
    <aside aria-label="Free session allowance" className="flex w-full flex-col items-center justify-center gap-3 border-b border-[#F65252] bg-[#F6525233] px-4 py-3 text-center font-inter text-brandBlack sm:flex-row sm:gap-6 sm:text-left">
      <div className="flex min-w-0 flex-col items-center gap-2 sm:flex-row sm:gap-4">
        <span className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[13.5px] border border-[#F65252] bg-white text-[#F65252]" aria-hidden="true">
          <Lock className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold leading-snug" aria-live="polite" aria-atomic="true">{usage.title}.</p>
          <p className="mt-0.5 text-[12px] font-light leading-snug text-brandBlack/70">{Math.min(usage.used, usage.limit)} of {usage.limit} free sessions used. Pro includes unlimited sessions.</p>
        </div>
      </div>
      <Link to="/pricing" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#F65252] px-5 text-sm font-semibold text-white transition hover:bg-[#E64545] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F65252]">
        Upgrade to Pro <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </aside>
  );
}
