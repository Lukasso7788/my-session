import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const GAP_PX = 8;
const BUTTON_HEIGHT_PX = 48;

const tabs = [
  {
    id: "group",
    label: "Group sessions",
    iconActive: "/icons/group-active.svg",
    iconInactive: "/icons/group-inactive.svg",
  },
  {
    id: "infinite",
    label: "24/7 Focus",
    iconActive: "/icons/infinite-active.svg",
    iconInactive: "/icons/infinite-inactive.svg",
  },
  {
    id: "body",
    label: "Body tripling",
    iconActive: "/icons/body-active.svg",
    iconInactive: "/icons/body-inactive.svg",
  },
] as const;

type TabId = (typeof tabs)[number]["id"];

type Props = {
  value: TabId;
  onChange: (next: TabId) => void;
  className?: string;
};

export function SessionTypeSwitcher({ value, onChange, className = "" }: Props) {
  // ✅ NEW: measure real button geometry instead of calc() in translateX
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    group: null,
    infinite: null,
    body: null,
  });

  const [slider, setSlider] = useState<{ left: number; width: number } | null>(null);

  const updateSlider = useCallback(() => {
    const root = rootRef.current;
    const btn = btnRefs.current[value];
    if (!root || !btn) return;

    setSlider({
      left: btn.offsetLeft,
      width: btn.offsetWidth,
    });
  }, [value]);

  useLayoutEffect(() => {
    updateSlider();
  }, [updateSlider]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const ro = new ResizeObserver(() => updateSlider());
    ro.observe(root);
    Object.values(btnRefs.current).forEach((el) => el && ro.observe(el));

    return () => ro.disconnect();
  }, [updateSlider]);

  return (
    <div
      ref={rootRef}
      className={[
        "relative bg-white border border-borderGray rounded-full",
        "px-3 py-2",
        "flex items-center",
        "h-[64px]",
        "w-full md:w-fit",
        "overflow-hidden",
        className,
      ].join(" ")}
      style={{ gap: `${GAP_PX}px` }}
    >
      {/* ✅ FIXED SLIDER: uses real left/width of active button */}
      <div
        className="absolute top-2 bottom-2 bg-brandBlack rounded-full duration-300 ease-in-out"
        style={{
          left: slider?.left ?? 0,
          width: slider?.width ?? 0,
          height: BUTTON_HEIGHT_PX,
          transitionProperty: "left, width",
          willChange: "left, width",
        }}
      />

      {tabs.map((t) => {
        const isActive = value === t.id;

        return (
          <button
            key={t.id}
            ref={(el) => {
              btnRefs.current[t.id] = el;
            }}
            onClick={() => onChange(t.id)}
            className={[
              "relative z-10",
              "flex items-center justify-center gap-2",
              "rounded-full",
              "text-[16px] font-normal",
              "transition-colors duration-200 ease-in-out",
              "h-12",
              "min-w-0",
              // mobile: equal-width columns
              "flex-1",
              // desktop: fixed width by mock
              "md:flex-none md:w-[197px]",
              // padding responsive
              "px-3 min-[480px]:px-4 md:px-6",
              isActive ? "text-white" : "text-brandBlack",
            ].join(" ")}
            type="button"
          >
            <img src={isActive ? t.iconActive : t.iconInactive} className="w-6 h-6 shrink-0" alt="" />

            {/* Text rules:
               <480: hidden for all
               480..767: only active shows
               >=768: all show
            */}
            <span
              className={[
                "whitespace-nowrap",
                isActive ? "hidden min-[480px]:inline md:inline" : "hidden md:inline",
              ].join(" ")}
            >
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
