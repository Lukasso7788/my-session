import { useState } from "react";

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
];

export function SessionTypeSwitcher({ value, onChange }) {
  const activeIndex = tabs.findIndex((t) => t.id === value);

  return (
    <div className="relative w-full max-w-[420px] bg-white border border-borderGray rounded-full flex p-1 mx-auto">

      {/* sliding active background */}
      <div
        className="absolute top-1 bottom-1 w-1/3 bg-brandBlack rounded-full transition-all duration-300"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />

      {tabs.map((t) => {
        const isActive = value === t.id;
        return (
          <button
            key={t.id}
            className={`
              relative z-10 flex-1 text-sm font-medium py-2 px-3 
              flex items-center justify-center gap-2 transition-all
              ${isActive ? "text-white" : "text-brandBlack hover:text-black"}
            `}
            onClick={() => onChange(t.id)}
          >
            <img
              src={isActive ? t.iconActive : t.iconInactive}
              alt=""
              className="w-4 h-4"
            />
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
