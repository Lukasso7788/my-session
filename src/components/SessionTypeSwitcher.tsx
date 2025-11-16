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
  const btnRefs = useRef([]);
  const [bgStyle, setBgStyle] = useState({ width: 0, left: 0 });

  useEffect(() => {
    const index = tabs.findIndex((t) => t.id === value);
    const el = btnRefs.current[index];
    if (el) {
      setBgStyle({
        width: el.offsetWidth,
        left: el.offsetLeft,
      });
    }
  }, [value]);

  return (
    <div
      className="
        relative inline-flex
        bg-white border border-borderGray rounded-full
        px-3 py-2
      "
    >
      {/* Active BG */}
      <div
        className="
          absolute top-2 bottom-2
          bg-brandBlack rounded-full
          transition-all duration-300
        "
        style={{
          width: bgStyle.width,
          transform: `translateX(${bgStyle.left}px)`,
        }}
      />

      {tabs.map((t, idx) => {
        const isActive = value === t.id;

        return (
          <button
            key={t.id}
            ref={(el) => (btnRefs.current[idx] = el)}
            onClick={() => onChange(t.id)}
            className={`
              relative z-10
              flex items-center justify-center gap-2
              px-3 py-2       /* FIXED - exactly 12px x 8px */
              text-[16px] font-normal whitespace-nowrap
              transition-all rounded-full
              ${isActive ? "text-white" : "text-brandBlack hover:text-black"}
            `}
          >
            <img
              src={isActive ? t.iconActive : t.iconInactive}
              alt=""
              className="w-6 h-6"
            />
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
