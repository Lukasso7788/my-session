import { useEffect, useRef } from "react";

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
  const bgRef = useRef(null);
  const btnRefs = useRef([]);

  useEffect(() => {
    const activeIndex = tabs.findIndex((t) => t.id === value);
    const btn = btnRefs.current[activeIndex];
    const bg = bgRef.current;

    if (btn && bg) {
      const { offsetWidth, offsetLeft } = btn;

      bg.style.width = `${offsetWidth}px`;
      bg.style.transform = `translateX(${offsetLeft}px)`;
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="
        relative inline-flex items-center
        bg-white border border-borderGray rounded-full
        px-2 py-2
      "
    >
      {/* Moving background */}
      <div
        ref={bgRef}
        className="
          absolute top-2 bottom-2 
          bg-brandBlack rounded-full
          transition-all duration-300
        "
        style={{ width: 0 }}
      />

      {tabs.map((t, i) => {
        const isActive = t.id === value;

        return (
          <button
            key={t.id}
            ref={(el) => (btnRefs.current[i] = el)}
            onClick={() => onChange(t.id)}
            className={`
              relative z-10 flex items-center gap-2
              px-6 py-3 text-[16px] font-normal whitespace-nowrap
              rounded-full transition-all
              ${isActive ? "text-white" : "text-brandBlack hover:text-black"}
            `}
          >
            <img
              src={isActive ? t.iconActive : t.iconInactive}
              alt=""
              className="w-6 h-6"
            />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
