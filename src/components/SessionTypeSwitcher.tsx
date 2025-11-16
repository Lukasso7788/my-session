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
    <div
      className="
        relative w-full max-w-[420px]
        bg-white border border-borderGray rounded-full
        mx-auto flex
        px-3 py-2    /* 12px left/right, 8px top/bottom */
      "
    >
      {/* Active background */}
      <div
        className="
          absolute top-2 bottom-2
          w-1/3 bg-brandBlack rounded-full
          transition-all duration-300
        "
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />

      {tabs.map((t) => {
        const isActive = value === t.id;

        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`
              relative z-10 flex-1
              flex items-center justify-center gap-2
              text-[16px] font-normal whitespace-nowrap
              transition-all rounded-full
              px-6 py-3     /* 24px left/right, 12px top/bottom */
              ${isActive ? "text-white" : "text-brandBlack hover:text-black"}
            `}
          >
            <img
              src={isActive ? t.iconActive : t.iconInactive}
              alt=""
              className="w-6 h-6" /* 24px */
            />
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
