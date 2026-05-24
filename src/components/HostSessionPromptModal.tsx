import React from "react";

export type HostPromptKind = "never_hosted" | "inactive_host";

type Props = {
  open: boolean;
  kind: HostPromptKind;
  onClose: () => void;
  onHostSession: () => void;
};

const COPY: Record<
  HostPromptKind,
  {
    eyebrow: string;
    title: string;
    body: string;
    note: string;
    cta: string;
  }
> = {
  never_hosted: {
    eyebrow: "Host a focus session",
    title: "Want to host your first session?",
    body:
      "You do not need to be a productivity expert. Pick a time, set a simple focus structure, and let people work alongside you.",
    note:
      "Even one small session helps keep MySession active and gives others a place to show up.",
    cta: "Host a Session",
  },
  inactive_host: {
    eyebrow: "Host again",
    title: "Want to host another session?",
    body:
      "You have hosted before. If you are planning to work anyway, turning it into a session can help others join and stay accountable.",
    note:
      "More hosted sessions means more active rooms, more consistency, and a stronger MySession community.",
    cta: "Host again",
  },
};

export default function HostSessionPromptModal({
  open,
  kind,
  onClose,
  onHostSession,
}: Props) {
  if (!open) return null;

  const copy = COPY[kind] || COPY.never_hosted;

  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-[470px] rounded-[28px] bg-white p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Host a MySession focus session"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 text-gray-400 hover:text-gray-700"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="pr-8">
          <div className="inline-flex rounded-full bg-[#F2F2F2] px-3 py-1 text-[12px] font-semibold text-[#555555]">
            {copy.eyebrow}
          </div>

          <h2 className="mt-4 text-[24px] font-bold leading-tight text-gray-900">
            {copy.title}
          </h2>
        </div>

        <p className="mt-3 text-[15px] leading-6 text-gray-600">
          {copy.body}
        </p>

        <p className="mt-3 text-[15px] leading-6 text-gray-600">
          {copy.note}
        </p>

        <div className="mt-5 rounded-2xl bg-[#F7F7F7] px-4 py-3 text-[13px] leading-5 text-[#555555]">
          Tip: a simple 25/5 or 50/10 session is enough. You can keep it quiet,
          focused, and low-pressure.
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onHostSession}
            className="flex-1 rounded-2xl bg-[#2F2F2F] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#1f1f1f]"
          >
            {copy.cta}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-gray-200 px-4 py-3 text-[15px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
