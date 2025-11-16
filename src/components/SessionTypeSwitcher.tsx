const TAB_WIDTH = 197;

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
        relative inline-flex items-center
        bg-white border border-borderGray rounded-full
        px-2 py-2
      "
      style={{ width: TAB_WIDTH * 3 + 16 }}  // контейнер под три вкладки
    >
      {/* Ползунок */}
      <div
        className="
          absolute top-2 bottom-2
          bg-brandBlack rounded-full
          transition-all duration-300
        "
        style={{
          width: TAB_WIDTH,
          transform: `translateX(${activeIndex * TAB_WIDTH}px)`
        }}
      />

      {tabs.map((t) => {
        const isActive = value === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`
              relative z-10 flex items-center justify-center gap-2
              w-[197px] h-[44px]
              text-[16px] font-normal transition-all rounded-full
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
