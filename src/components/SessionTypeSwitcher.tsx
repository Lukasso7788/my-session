import { useRef, useEffect, useState } from "react";

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
  const [bgStyle, setBgStyle] = useState({});
  const refs = useRef({});

  useEffect(() => {
    const el = refs.current[value];
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const parentRect = el.parentElement.getBoundingClientRect();

    setBgStyle({
      width: rect.width + "px",
      height: rect.height + "px",
      transform: `translateX(${rect.left - parentRect.left}px)`,
    });
  }, [value]);

  return (
    <div className="relative inline-flex items-center bg-white border border-borderGray rounded-full px-2 py-2">
      {/* Moving background */}
      <div
        className="absolute rounded-full bg-brandBlack transition-all duration-300"
        style={bgStyle}
      />

      {/* Tabs */}
      {tabs.map((t) => {
        const isActive = value === t.id;

        return (
          <button
            key={t.id}
            ref={(el) => (refs.current[t.id] = el)}
            onClick={() => onChange(t.id)}
            className={`relative z-10 inline-flex items-center gap-2 px-3 py-2 text-[16px] rounded-full transition-all
              ${isActive ? "text-white" : "text-brandBlack hover:text-black"}
            `}
          >
            <img
              src={isActive ? t.iconActive : t.iconInactive}
              alt=""
              className="w-5 h-5"
            />
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
