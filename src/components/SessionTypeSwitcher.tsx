import React from "react";

const GAP_PX = 8;
const PAD_X_PX = 24; // container px-3 + px-3 = 12*2
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
    label: "Infinite rooms",
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
  const activeIndexRaw = tabs.findIndex((t) => t.id === value);
  const activeIndex = activeIndexRaw >= 0 ? activeIndexRaw : 0;

  // ✅ Responsive бегунок без фикс-ширины (работает и на w-full, и на md:w-fit + md:w-[197px])
  const sliderWidth = `calc((100% - ${PAD_X_PX}px - ${GAP_PX * 2}px) / 3)`;
  const sliderX = `calc(${PAD_X_PX / 2}px + ${activeIndex} * ((100% - ${PAD_X_PX}px - ${GAP_PX * 2
    }px) / 3 + ${GAP_PX}px))`;

  return (
    <div
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
      {/* бегунок */}
      <div
        className="absolute top-2 bottom-2 left-0 bg-brandBlack rounded-full transition-transform duration-300 ease-in-out"
        style={{
          width: sliderWidth,
          height: BUTTON_HEIGHT_PX,
          transform: `translateX(${sliderX})`,
        }}
      />

      {tabs.map((t) => {
        const isActive = value === t.id;

        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={[
              "relative z-10",
              "flex items-center justify-center gap-2",
              "rounded-full",
              "text-[16px] font-normal",
              "transition-colors duration-200 ease-in-out",
              "h-12",
              "min-w-0",
              // ✅ mobile: equal-width columns
              "flex-1",
              // ✅ desktop (>=768): fixed width by макету
              "md:flex-none md:w-[197px]",
              // ✅ padding responsive
              "px-3 min-[480px]:px-4 md:px-6",
              isActive ? "text-white" : "text-brandBlack",
            ].join(" ")}
            type="button"
          >
            <img
              src={isActive ? t.iconActive : t.iconInactive}
              className="w-6 h-6 shrink-0"
              alt=""
            />

            {/* ✅ Text rules:
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
