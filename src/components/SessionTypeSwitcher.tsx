import { useState } from "react";

const tabs = [
  { id: "group", label: "Group sessions" },
  { id: "infinite", label: "Infinite rooms" },
  { id: "body", label: "Body tripling" },
];

export function SessionTypeSwitcher({ value, onChange }) {
  const activeIndex = tabs.findIndex(t => t.id === value);

  return (
    <div className="relative w-full max-w-[420px] bg-white border border-border rounded-full flex p-1">
      
      {/* sliding background */}
      <div
        className="absolute top-1 bottom-1 w-1/3 bg-brandBlack rounded-full transition-all duration-300"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />

      {tabs.map(t => (
        <button
          key={t.id}
          className={`
            relative z-10 flex-1 text-sm font-medium py-2 transition-colors
            ${value === t.id ? "text-white" : "text-brandBlack hover:text-black"}
          `}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}

    </div>
  );
}
