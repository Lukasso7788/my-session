import { useEffect, useMemo, useState } from "react";
import { formatBanCountdown, formatBanEnd, type ActiveBan } from "../lib/bans";

type Props = {
  open: boolean;
  ban: ActiveBan | null;
  onBackToSessions: () => void;
};

export default function ActiveBanModal({ open, ban, onBackToSessions }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!open) return;

    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [open]);

  const countdown = useMemo(() => {
    return formatBanCountdown(ban?.expires_at || null, now);
  }, [ban?.expires_at, now]);

  if (!open || !ban) return null;

  const permanent = !ban.expires_at;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[3px]" />

      <div className="relative w-full max-w-[560px] rounded-[28px] border border-red-500/20 bg-white p-6 text-[#2F2F2F] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <div className="inline-flex rounded-full bg-red-50 px-3 py-1 text-[12px] font-bold uppercase tracking-[0.12em] text-red-700">
          Access restricted
        </div>

        <h2 className="mt-4 text-[28px] font-bold">
          {permanent ? "You’re banned from MySession" : "You’re temporarily banned from MySession"}
        </h2>

        <p className="mt-3 text-[14px] leading-6 text-[#666]">
          You cannot join sessions while this ban is active.
        </p>

        <div className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-4 py-3">
          <div className="text-[12px] font-bold uppercase tracking-[0.10em] text-red-700">
            Reason
          </div>
          <div className="mt-2 whitespace-pre-wrap text-[14px] leading-6 text-red-950">
            {ban.reason || "No reason provided."}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-black/10 bg-gray-50 px-4 py-3">
            <div className="text-[12px] font-semibold uppercase tracking-[0.10em] text-[#777]">
              Ends
            </div>
            <div className="mt-1 text-[14px] font-bold">
              {formatBanEnd(ban.expires_at || null)}
            </div>
          </div>

          <div className="rounded-2xl border border-black/10 bg-gray-50 px-4 py-3">
            <div className="text-[12px] font-semibold uppercase tracking-[0.10em] text-[#777]">
              Countdown
            </div>
            <div className="mt-1 text-[14px] font-bold">
              {countdown}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onBackToSessions}
            className="rounded-full bg-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-white hover:opacity-90"
          >
            Back to sessions
          </button>
          <a
            href="mailto:support@mysession.club"
            className="rounded-full border border-black/10 bg-white px-5 py-3 text-center text-[14px] font-semibold text-[#2F2F2F] hover:bg-black/[0.04]"
          >
            Contact support
          </a>
        </div>
      </div>
    </div>
  );
}
