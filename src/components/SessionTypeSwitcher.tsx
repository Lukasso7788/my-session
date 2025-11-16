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
  const btnRefs = useRef({});
  const bgRef = useRef(null);

  // Track background width/position
  useEffect(() => {
    const activeBtn = btnRefs.current[value];
    const bg = bgRef.current;

    if (activeBtn && bg) {
      const { offsetWidth, offsetLeft } = activeBtn;
      bg.style.width = `${offsetWidth}px`;
      bg.style.transform = `translateX(${offsetLeft}px)`;
    }
  }, [value]);

  return (
    <div className="relative inline-flex bg-white border border-borderGray rounded-full px-2 py-2">

      {/* ACTIVE BACKGROUND */}
      <div
        ref={bgRef}
        className="
          absolute top-2 bottom-2
          bg-brandBlack rounded-full
          transition-all duration-300
        "
        style={{ width: 0, transform: "translateX(0)" }}
      />

      {tabs.map((t) => {
        const isActive = value === t.id;

        return (
          <button
            key={t.id}
            ref={(el) => (btnRefs.current[t.id] = el)}
            onClick={() => onChange(t.id)}
            className={`
              relative z-10
              flex items-center gap-2
              px-5 py-2
              text-[16px] font-normal
              whitespace-nowrap
              rounded-full transition-all
              ${isActive ? "text-white" : "text-brandBlack hover:text-black"}
            `}
          >
            <img
              src={isActive ? t.iconActive : t.iconInactive}
              className="w-6 h-6"
              alt=""
            />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
