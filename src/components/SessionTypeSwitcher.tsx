import { useState } from "react";

const tabs = [
  {
    id: "group",
    label: "Group sessions",
    iconInactive: "/icons/body-tripling-inactive.svg",
    iconActive: "/icons/body-tripling-active.svg",
  },
  {
    id: "infinite",
    label: "Infinite rooms",
    iconInactive: "/icons/infinite-inactive.svg",
    iconActive: "/icons/infinite-active.svg",
  },
  {
    id: "body",
    label: "Body tripling",
    iconInactive: "/icons/body-tripling-inactive.svg",
    iconActive: "/icons/body-tripling-active.svg",
  },
];

export function SessionTypeSwitcher({ value, onChange }) {
  const activeIndex = tabs.findIndex((t) => t.id === value);

  return (
    <div className="relative w-full max-w-[420px] bg-white border border-borderGray rounded-full flex p-1">

      {/* Sliding background */}
      <div
        className="
          absolute top-1 bottom-1 w-1/3 
          bg-brandBlack rounded-full transition-all duration-300
        "
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />

      {/* Buttons */}
      {tabs.map((t) => {
        const isActive = value === t.id;
        return (
          <button
            key={t.id}
            className={`
              relative z-10 flex-1 flex items-center justify-center gap-2
              text-sm font-medium py-2 transition-colors
              ${isActive ? "text-white" : "text-brandBlack hover:text-black"}
            `}
            onClick={() => onChange(t.id)}
          >
            {/* Icon */}
            <img
              src={isActive ? t.iconActive : t.iconInactive}
              alt={t.label}
              className="w-5 h-5"
            />

            {t.label}
          </button>
        );
      })}
    </div>
  );
}
