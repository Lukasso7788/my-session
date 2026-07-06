import { useEffect, useMemo, useState } from "react";

type InviteFriendsModalProps = {
  open: boolean;
  onClose: () => void;
  referralLink: string;
};

const DEFAULT_INVITE_MESSAGE =
  "Come work with me on MySession — live body doubling and virtual coworking sessions that make it easier to start and stay focused.";

function buildShareText(referralLink: string) {
  return `${DEFAULT_INVITE_MESSAGE}\n\n${referralLink}`;
}

export default function InviteFriendsModal({
  open,
  onClose,
  referralLink,
}: InviteFriendsModalProps) {
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState("");

  const safeReferralLink = String(referralLink || "").trim();

  const shareText = useMemo(
    () => buildShareText(safeReferralLink),
    [safeReferralLink]
  );

  const whatsappUrl = useMemo(() => {
    const text = encodeURIComponent(shareText);
    return `https://wa.me/?text=${text}`;
  }, [shareText]);

  const emailUrl = useMemo(() => {
    const subject = encodeURIComponent("Join me on MySession");
    const body = encodeURIComponent(shareText);
    return `mailto:?subject=${subject}&body=${body}`;
  }, [shareText]);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setShareError("");
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const copyLink = async () => {
    setShareError("");

    try {
      if (!safeReferralLink) {
        throw new Error("Referral link is not ready yet.");
      }

      await navigator.clipboard.writeText(safeReferralLink);
      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 2200);
    } catch (error) {
      console.error("[invite-friends] copy failed:", error);
      setShareError("Could not copy the link. Please try again.");
    }
  };

  const shareNative = async () => {
    setShareError("");

    try {
      if (!safeReferralLink) {
        throw new Error("Referral link is not ready yet.");
      }

      if (!navigator.share) {
        await copyLink();
        return;
      }

      await navigator.share({
        title: "Join me on MySession",
        text: DEFAULT_INVITE_MESSAGE,
        url: safeReferralLink,
      });
    } catch (error) {
      const maybeAbortError = error as { name?: string };

      if (maybeAbortError?.name === "AbortError") {
        return;
      }

      console.error("[invite-friends] native share failed:", error);
      setShareError("Could not open sharing. You can copy the link instead.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-friends-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        aria-label="Close invite friends dialog"
        onClick={onClose}
      />

      <div className="relative w-full max-w-[520px] overflow-hidden rounded-[28px] border border-[#DBD8D8] bg-white text-[#111827] shadow-[0_30px_100px_rgba(0,0,0,0.28)]">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-[#D8D8D8] bg-white text-[#111827] transition hover:border-[#111827] hover:bg-[#111827] hover:text-white"
          aria-label="Close"
          title="Close"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 6L18 18M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div className="px-6 pb-7 pt-8 sm:px-8 sm:pb-8 sm:pt-9">
          <div className="pr-12">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#111827] text-[26px]">
              🤝
            </div>

            <h2
              id="invite-friends-title"
              className="text-[24px] font-semibold leading-tight sm:text-[28px]"
            >
              Invite a friend
            </h2>

            <p className="mt-3 max-w-[430px] text-[14px] leading-[1.65] text-[#606060] sm:text-[15px]">
              Send your personal link to someone who could use a little more
              focus, accountability, or company while getting things done.
            </p>
          </div>

          <div className="mt-7 rounded-[20px] border border-[#E4E4E4] bg-[#F7F7F7] p-4">
            <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#777777]">
              Your invite link
            </div>

            <div className="mt-3 flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1 overflow-hidden rounded-[14px] border border-[#DDDDDD] bg-white px-4 py-3">
                <div className="truncate text-[13px] text-[#2F2F2F]">
                  {safeReferralLink || "Preparing your invite link..."}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  void copyLink();
                }}
                disabled={!safeReferralLink}
                className="shrink-0 rounded-[14px] bg-[#111827] px-4 py-3 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => {
                void shareNative();
              }}
              disabled={!safeReferralLink}
              className="flex items-center justify-center gap-2 rounded-[16px] border border-[#D8D8D8] bg-white px-4 py-3.5 text-[13px] font-semibold transition hover:border-[#111827] hover:bg-[#F7F7F7] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M12 16V4M12 4L7.5 8.5M12 4L16.5 8.5M5 13V19C5 20.1 5.9 21 7 21H17C18.1 21 19 20.1 19 19V13"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Share
            </button>

            <a
              href={safeReferralLink ? whatsappUrl : undefined}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (!safeReferralLink) event.preventDefault();
              }}
              className={`flex items-center justify-center gap-2 rounded-[16px] border border-[#D8D8D8] bg-white px-4 py-3.5 text-[13px] font-semibold transition hover:border-[#111827] hover:bg-[#F7F7F7] ${
                safeReferralLink
                  ? ""
                  : "pointer-events-none cursor-not-allowed opacity-40"
              }`}
            >
              <span aria-hidden="true">💬</span>
              WhatsApp
            </a>

            <a
              href={safeReferralLink ? emailUrl : undefined}
              onClick={(event) => {
                if (!safeReferralLink) event.preventDefault();
              }}
              className={`flex items-center justify-center gap-2 rounded-[16px] border border-[#D8D8D8] bg-white px-4 py-3.5 text-[13px] font-semibold transition hover:border-[#111827] hover:bg-[#F7F7F7] ${
                safeReferralLink
                  ? ""
                  : "pointer-events-none cursor-not-allowed opacity-40"
              }`}
            >
              <span aria-hidden="true">✉️</span>
              Email
            </a>
          </div>

          <div className="mt-6 rounded-[18px] border border-[#DDE7FF] bg-[#F4F7FF] px-4 py-4">
            <div className="text-[13px] font-semibold text-[#111827]">
              A simple message is enough
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#606060]">
              “Come work with me for one session. We’ll just join, set our tasks,
              and focus alongside other people.”
            </p>
          </div>

          {shareError ? (
            <div className="mt-4 rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              {shareError}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
