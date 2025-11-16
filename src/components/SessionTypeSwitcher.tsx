const BUTTON_WIDTH = 197; // ширина кнопки по макету
const GAP = 8; // расстояние между кнопками
const BUTTON_HEIGHT = 48;

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

  const sliderX = activeIndex * (BUTTON_WIDTH + GAP);

  return (
    <div
      className="
        relative bg-white border border-borderGray rounded-full
        px-3 py-2
        flex items-center
        h-[64px]
      "
      style={{
        gap: `${GAP}px`,
      }}
    >
      {/* бегунок */}
      <div
        className="
          absolute top-2 bottom-2 bg-brandBlack rounded-full
          transition-all duration-300
        "
        style={{
          width: BUTTON_WIDTH,
          height: BUTTON_HEIGHT,
          transform: `translateX(${sliderX}px)`,
        }}
      />

      {tabs.map((t) => {
        const isActive = value === t.id;

        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`
              relative z-10
              flex items-center justify-center gap-2
              rounded-full
              text-[16px] font-normal
              transition-colors
              ${isActive ? "text-white" : "text-brandBlack"}
            `}
            style={{
              width: BUTTON_WIDTH,
              height: BUTTON_HEIGHT,
              padding: "12px 24px",
            }}
          >
            <img
              src={isActive ? t.iconActive : t.iconInactive}
              className="w-6 h-6"
            />
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
