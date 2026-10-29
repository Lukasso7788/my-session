import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, HeartHandshake, Megaphone, MessagesSquare, X } from "lucide-react";
import { HEADER_NOTICE_SLOT_ID } from "../lib/headerNoticeSlot";
import type { PrioritySlots } from "../lib/hostPrioritySlots";

export type SessionsNotice = "hosts" | "community" | "support";

type Props = {
  notice: SessionsNotice | null;
  slots: PrioritySlots;
  whatsappUrl: string;
  discordUrl: string;
  onApplyToHost: () => void;
  onDismiss: (notice: SessionsNotice) => void;
  onJoinedCommunity: () => void;
};

// One pinned line under the header (same layout as FreeSessionsNotice) instead
// of popups. The page decides which single notice is due.
export default function SessionsNoticeBar(props: Props) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setSlot(document.getElementById(HEADER_NOTICE_SLOT_ID));
  }, []);

  if (!props.notice || !slot) return null;
  return createPortal(<NoticeLine {...props} notice={props.notice} />, slot);
}

const ACCENT: Record<SessionsNotice, string> = {
  hosts: "#5286F6",
  community: "#22C55E",
  support: "#F5B300",
};

function NoticeLine({ notice, slots, whatsappUrl, discordUrl, onApplyToHost, onDismiss, onJoinedCommunity }: Props & { notice: SessionsNotice }) {
  const navigate = useNavigate();
  const accent = ACCENT[notice];
  const openCommunity = (url: string) => {
    onJoinedCommunity();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  let icon: ReactNode;
  let title: string;
  let body: ReactNode;
  let actions: ReactNode;

  if (notice === "hosts") {
    icon = <Megaphone className="h-5 w-5" strokeWidth={2} />;
    title = "We're looking for hosts";
    body = (
      <>
        Apply for the host role. Priority slots: <b className="whitespace-nowrap font-semibold">{slots.start}–{slots.end}</b> your time
        {slots.isKyiv ? "" : <> <span className="whitespace-nowrap">(06:00–16:00 Kyiv)</span></>}.
      </>
    );
    actions = (
      <button type="button" onClick={onApplyToHost} className={primaryCls} style={{ background: accent }}>
        Apply for host role <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  } else if (notice === "community") {
    icon = <MessagesSquare className="h-5 w-5" strokeWidth={2} />;
    title = "Join the MySession community";
    body = <>Session reminders, updates and an easier way to find people to focus with.</>;
    actions = (
      <>
        <button type="button" onClick={() => openCommunity(whatsappUrl)} className={secondaryCls}>WhatsApp</button>
        <button type="button" onClick={() => openCommunity(discordUrl)} className={secondaryCls}>Discord</button>
        <button type="button" onClick={onJoinedCommunity} className="text-[12px] font-medium text-brandBlack/60 underline-offset-2 hover:underline">I'm already in</button>
      </>
    );
  } else {
    icon = <HeartHandshake className="h-5 w-5" strokeWidth={2} />;
    title = "Support MySession";
    body = <>A small independent platform. Your support covers video, hosting and new features.</>;
    actions = (
      <>
        <button type="button" onClick={() => navigate("/pricing")} className={secondaryCls}>Card / Stripe</button>
        <button type="button" onClick={() => navigate("/pricing?payment=india_upi")} className={secondaryCls}>India / UPI</button>
      </>
    );
  }

  return (
    <aside
      aria-label={title}
      className="relative -mb-px flex w-full flex-col items-center justify-center gap-3 border-b border-t border-t-borderGray px-12 py-3 text-center font-inter text-brandBlack sm:flex-row sm:gap-6 sm:text-left"
      style={{ borderBottomColor: accent, background: `${accent}33` }}
    >
      <div className="flex min-w-0 flex-col items-center gap-2 sm:flex-row sm:gap-4">
        <span
          className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[13.5px] border bg-white"
          style={{ borderColor: accent, color: accent }}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold leading-snug">{title}</p>
          <p className="mt-0.5 text-[12px] font-light leading-snug text-brandBlack/70">{body}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">{actions}</div>
      <button
        type="button"
        onClick={() => onDismiss(notice)}
        className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-brandBlack/50 transition hover:bg-black/5 hover:text-brandBlack sm:top-1/2 sm:-translate-y-1/2"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </aside>
  );
}

const primaryCls =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-5 text-sm font-semibold text-white transition hover:brightness-95";
const secondaryCls =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-brandBlack/15 bg-white px-4 text-sm font-semibold text-brandBlack transition hover:bg-white/70";
