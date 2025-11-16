import { useEffect, useRef, useState } from "react";

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
  const containerRef = useRef(null);
  const btnRefs = useRef([]);
  const [bgStyle, setBgStyle] = useState({});

  useEffect(() => {
    const index = tabs.findIndex((t) => t.id === value);
    const btn = btnRefs.current[index];
    if (!btn) return;

    setBgStyle({
      width: btn.offsetWidth + "px",
      transform: `translateX(${btn.offsetLeft}px)`,
    });
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="
        relative inline-flex items-center
        bg-white border border-borderGray rounded-full
        p-2
      "
    >
      {/* бегунок */}
      <div
        className="
          absolute top-2 bottom-2
          bg-brandBlack rounded-full
          transition-all duration-300
        "
        style={bgStyle}
      />

      {tabs.map((t, idx) => {
        const isActive = value === t.id;
        return (
          <button
            key={t.id}
            ref={(el) => (btnRefs.current[idx] = el)}
            onClick={() => onChange(t.id)}
            className={`
              relative z-10 flex items-center gap-2
              px-6 py-3
              text-[16px] font-normal whitespace-nowrap
              transition-all rounded-full
              ${isActive ? "text-white" : "text-brandBlack"}
            `}
          >
            <img
              src={isActive ? t.iconActive : t.iconInactive}
              className="w-6 h-6"
            />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
