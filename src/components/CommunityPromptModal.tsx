import React from "react";

type Props = {
  open: boolean;
  whatsappUrl: string;
  discordUrl: string;
  onClose: () => void;
  onJoinedCommunity: () => void;
};

export default function CommunityPromptModal({
  open,
  whatsappUrl,
  discordUrl,
  onClose,
  onJoinedCommunity,
}: Props) {
  if (!open) return null;

  const openCommunityLink = (url: string) => {
    onJoinedCommunity();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-[480px] rounded-[28px] bg-white p-6 text-[#2F2F2F] shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 text-gray-400 transition hover:text-gray-700"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="pr-8">
          <div className="inline-flex rounded-full border border-[#DBD8D8] bg-[#F8F8F8] px-3 py-1 text-[12px] font-semibold text-[#606060]">
            MySession Community
          </div>

          <h2 className="mt-4 text-[24px] font-bold leading-tight text-[#2F2F2F]">
            Join the MySession community
          </h2>

          <p className="mt-3 text-[15px] leading-6 text-[#606060]">
            Get session reminders, community updates, and an easier way to find
            people to focus with.
          </p>
        </div>

        <div className="mt-5 grid gap-3">
          <button
            type="button"
            onClick={() => openCommunityLink(whatsappUrl)}
            className="flex w-full items-center justify-between rounded-2xl border border-[#DBD8D8] bg-white px-4 py-3 text-left transition hover:bg-[#F8F8F8]"
          >
            <div>
              <div className="text-[15px] font-semibold text-[#2F2F2F]">
                Join WhatsApp
              </div>
              <div className="mt-0.5 text-[12px] leading-5 text-[#606060]">
                Quick reminders, session coordination, and lightweight updates.
              </div>
            </div>

            <span className="ml-4 text-[18px]">→</span>
          </button>

          <button
            type="button"
            onClick={() => openCommunityLink(discordUrl)}
            className="flex w-full items-center justify-between rounded-2xl border border-[#DBD8D8] bg-white px-4 py-3 text-left transition hover:bg-[#F8F8F8]"
          >
            <div>
              <div className="text-[15px] font-semibold text-[#2F2F2F]">
                Join Discord
              </div>
              <div className="mt-0.5 text-[12px] leading-5 text-[#606060]">
                Community, hosts, feedback, session updates, and support.
              </div>
            </div>

            <span className="ml-4 text-[18px]">→</span>
          </button>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#EAEAEA] bg-[#FAFAFA] px-4 py-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[#2F2F2F]"
            onChange={(e) => {
              if (e.target.checked) onJoinedCommunity();
            }}
          />

          <span className="text-[13px] leading-5 text-[#606060]">
            I’m already in the community — don’t remind me for a while.
          </span>
        </label>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#CAC3C3] bg-white px-5 py-2.5 text-[13px] font-semibold text-[#2F2F2F] transition hover:bg-[#F8F8F8]"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
