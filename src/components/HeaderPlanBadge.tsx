type HeaderPlanBadgeProps = {
  label: "Free" | "Pro" | "FM Pro";
  open: boolean;
  title: string;
  description: string;
  onBadgeClick: () => void;
  onActionClick: () => void;
  onOpen: () => void;
  onClose: () => void;
};

/** Presentation only. The Header owns membership state, navigation and hover timing. */
export default function HeaderPlanBadge({ label, open, title, description, onBadgeClick, onActionClick, onOpen, onClose }: HeaderPlanBadgeProps) {
  return (
    <div
      data-plan-badge-anchor
      className="absolute left-[calc(100%-4px)] -top-[2px] z-20 pb-[12px]"
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
    >
      <button
        type="button"
        onClick={onBadgeClick}
        className="inline-flex items-center justify-center whitespace-nowrap rounded-[8px] border border-[#2F2F2F] bg-white px-[6px] py-[2px] text-[12px] font-bold leading-none text-[#2F2F2F] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
        style={{ fontFamily: "Inter, sans-serif" }}
        aria-label={`Current plan: ${label}`}
        aria-expanded={open}
        title={label === "Free" ? "Upgrade plan" : "Plan status"}
      >
        {label}
      </button>

      {open ? (
        <div className="absolute -left-[150px] top-full mt-0 w-[220px] max-w-[calc(100vw-24px)] whitespace-normal pt-[8px] sm:left-auto sm:right-0">
          <div role="group" aria-label="Plan details" className="min-w-0 rounded-[14px] border border-[#2F2F2F]/10 bg-white p-3 text-left shadow-[0_12px_32px_rgba(0,0,0,0.12)]">
            <div className="break-words text-[12px] font-semibold text-[#2F2F2F]">
              {title}
            </div>
            <div className="mt-1 break-words text-[12px] leading-[1.45] text-[#2F2F2F]/75">
              {description}
            </div>
            <button
              type="button"
              onClick={onActionClick}
              className="mt-3 w-full break-words rounded-[10px] bg-[#2F2F2F] px-3 py-2 text-[12px] font-semibold text-white transition hover:opacity-90"
            >
              {label === "Free" ? "Upgrade to Pro" : "Manage subscription"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
