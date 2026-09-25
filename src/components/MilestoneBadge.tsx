import type { BadgeMilestone, BadgeTier } from "../data/badgeMilestones";
import { badgeMilestones } from "../data/badgeMilestones";

type MilestoneBadgeProps = {
  milestone: BadgeMilestone;
  variant: "large" | "compact";
};

const tierAppearance: Record<BadgeTier, {
  background: string;
  leaf: string;
  leafLight: string;
  trunk: string;
  ring: string;
  ringTrack: string;
  card: string;
  chip: string;
  name: string;
}> = {
  sprout: {
    background: "#F2F8F0",
    leaf: "#61BD70",
    leafLight: "#9DE2A4",
    trunk: "#438356",
    ring: "#72C87C",
    ringTrack: "#DBECDD",
    card: "border-[#DDE9DD] bg-white",
    chip: "bg-[#EEF7EE] text-[#397348]",
    name: "Sprout",
  },
  sapling: {
    background: "#EAF6ED",
    leaf: "#36A963",
    leafLight: "#77D58B",
    trunk: "#28764A",
    ring: "#42B76A",
    ringTrack: "#CFE8D5",
    card: "border-[#CFE6D5] bg-white",
    chip: "bg-[#E4F5E9] text-[#247449]",
    name: "Sapling",
  },
  mature: {
    background: "#E7F4EA",
    leaf: "#238B56",
    leafLight: "#5CC680",
    trunk: "#225F42",
    ring: "#278E59",
    ringTrack: "#C6E3D0",
    card: "border-[#B8D9C4] bg-white",
    chip: "bg-[#DDF1E4] text-[#1E6745]",
    name: "Evergreen",
  },
  legacy: {
    background: "#F2F5EB",
    leaf: "#1D7751",
    leafLight: "#4BAE71",
    trunk: "#23583F",
    ring: "#B39A60",
    ringTrack: "#E5E8D7",
    card: "border-[#D9DBBE] bg-white",
    chip: "bg-[#F5F1DF] text-[#796635]",
    name: "Legacy",
  },
};

function TreeArtwork({ milestone }: { milestone: BadgeMilestone }) {
  const stage = milestone.growthStage;
  const colors = tierAppearance[milestone.tier];
  const sameTier = badgeMilestones.filter((item) => item.tier === milestone.tier);
  const tierProgress = (sameTier.findIndex((item) => item.value === milestone.value) + 1) / sameTier.length;
  const circumference = 2 * Math.PI * 75;
  const earlyGrowth = stage <= 7;
  const topY = 124 - (stage - 1) * 7;
  const leafPairs = Math.min(4, Math.ceil(stage / 2));
  const growth = Math.max(0, stage - 8);
  const treeTop = 87 - growth * 1.7;
  const crownY = treeTop + 9;
  const crownWidth = stage <= 14 ? 18 + growth * 4.2 : 43.2 + (stage - 14) * 1.1;
  const crownHeight = stage <= 14 ? 15 + growth * 2 : 27 + (stage - 14) * 0.4;

  return (
    <svg
      viewBox="0 0 180 180"
      className="h-full w-full"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="90" cy="90" r="68" fill={colors.background} />
      <circle cx="90" cy="90" r="75" fill="none" stroke={colors.ringTrack} strokeWidth="3.5" />
      <circle
        cx="90"
        cy="90"
        r="75"
        fill="none"
        stroke={colors.ring}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={`${(circumference * tierProgress).toFixed(1)} ${circumference.toFixed(1)}`}
        transform="rotate(-90 90 90)"
      />
      <path d="M59 143 Q90 139 121 143" fill="none" stroke={colors.trunk} strokeOpacity=".32" strokeWidth="2" strokeLinecap="round" />

      {earlyGrowth ? (
        <>
          <path
            d={`M90 141 Q${89 - stage * 0.2} 118 90 ${topY}`}
            fill="none"
            stroke={colors.trunk}
            strokeWidth={2.4 + stage * 0.3}
            strokeLinecap="round"
          />
          {Array.from({ length: leafPairs }, (_, index) => {
            const y = topY + 12 + index * ((136 - topY) / leafPairs);
            const offset = 8 + stage * 0.8;
            const leafSize = 4.5 + stage * 0.8;
            return (
              <g key={index}>
                <ellipse
                  cx={90 - offset}
                  cy={y}
                  rx={leafSize}
                  ry={leafSize * 0.52}
                  transform={`rotate(28 ${90 - offset} ${y})`}
                  fill={index % 2 ? colors.leaf : colors.leafLight}
                />
                <ellipse
                  cx={90 + offset}
                  cy={y - 4}
                  rx={leafSize}
                  ry={leafSize * 0.52}
                  transform={`rotate(-28 ${90 + offset} ${y - 4})`}
                  fill={index % 2 ? colors.leafLight : colors.leaf}
                />
              </g>
            );
          })}
          {stage >= 5 && <ellipse cx="90" cy={topY} rx={3 + stage * 0.35} ry={7 + stage * 0.45} fill={colors.leafLight} />}
        </>
      ) : (
        <>
          <path
            d={`M84 142 Q87 119 87 ${treeTop + 7} L93 ${treeTop + 7} Q94 119 96 142 Z`}
            fill={colors.trunk}
          />
          <path
            d={`M89 120 Q${90 - crownWidth * 0.45} 108 ${90 - crownWidth * 0.7} ${crownY + 6} M91 113 Q${90 + crownWidth * 0.45} 103 ${90 + crownWidth * 0.7} ${crownY + 6}`}
            fill="none"
            stroke={colors.trunk}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <ellipse cx="90" cy={crownY + 7} rx={crownWidth * 0.8} ry={crownHeight} fill={colors.leaf} />
          <ellipse cx={90 - crownWidth * 0.55} cy={crownY + 12} rx={crownWidth * 0.55} ry={crownHeight * 0.78} fill={colors.leafLight} />
          <ellipse cx={90 + crownWidth * 0.55} cy={crownY + 12} rx={crownWidth * 0.55} ry={crownHeight * 0.78} fill={colors.leaf} />
          {stage >= 11 && (
            <>
              <ellipse cx={90 - crownWidth * 0.25} cy={crownY - crownHeight * 0.38} rx={crownWidth * 0.47} ry={crownHeight * 0.76} fill={colors.leaf} />
              <ellipse cx={90 + crownWidth * 0.25} cy={crownY - crownHeight * 0.38} rx={crownWidth * 0.47} ry={crownHeight * 0.76} fill={colors.leafLight} />
            </>
          )}
          {stage >= 20 && (
            <>
              <ellipse cx={90 - crownWidth * 0.86} cy={crownY + 16} rx={crownWidth * 0.32} ry={crownHeight * 0.55} fill={colors.leaf} />
              <ellipse cx={90 + crownWidth * 0.86} cy={crownY + 16} rx={crownWidth * 0.32} ry={crownHeight * 0.55} fill={colors.leafLight} />
            </>
          )}
          {stage >= 25 && Array.from({ length: stage - 24 }, (_, index) => (
            <circle
              key={index}
              cx={90 + [-24, 18, -3, 35][index]}
              cy={crownY + [-7, -14, 9, 4][index]}
              r="2.4"
              fill="#C8AC6D"
            />
          ))}
        </>
      )}
    </svg>
  );
}

export default function MilestoneBadge({ milestone, variant }: MilestoneBadgeProps) {
  const appearance = tierAppearance[milestone.tier];
  const accessibleLabel = `${milestone.title}: ${milestone.value.toLocaleString("en-US")} ${milestone.value === 1 ? "session" : "sessions"}`;

  if (variant === "compact") {
    return (
      <article
        aria-label={accessibleLabel}
        className={`relative flex h-[76px] min-w-0 items-center overflow-hidden rounded-2xl border px-4 shadow-[0_4px_14px_rgba(26,52,37,0.04)] ${appearance.card}`}
      >
        <div className="relative z-10 min-w-0 pr-12">
          <div className="font-inter text-[27px] font-extrabold leading-none tracking-[-0.055em] text-[#24372F]">
            {milestone.displayNumber}
          </div>
          <div className="mt-1 max-w-[110px] font-inter text-[10px] font-semibold leading-3 text-[#65746A]">
            {milestone.title}
          </div>
        </div>
        <div className="pointer-events-none absolute -right-2 top-1/2 h-[76px] w-[76px] -translate-y-1/2 opacity-45">
          <TreeArtwork milestone={milestone} />
        </div>
      </article>
    );
  }

  return (
    <article
      aria-label={accessibleLabel}
      className={`flex min-h-[300px] flex-col rounded-[24px] border p-5 shadow-[0_8px_28px_rgba(26,52,37,0.055)] ${appearance.card}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-2.5 py-1 font-inter text-[10px] font-semibold uppercase tracking-[0.08em] ${appearance.chip}`}>
          {appearance.name}
        </span>
        <span className="font-inter text-[11px] font-semibold text-[#89968D]">
          {String(milestone.growthStage).padStart(2, "0")} / 28
        </span>
      </div>
      <div className="mx-auto my-1 aspect-square w-full max-w-[162px] shrink-0">
        <TreeArtwork milestone={milestone} />
      </div>
      <div className="mt-auto border-t border-[#E8EEE9] pt-4">
        <div className="flex items-baseline gap-1.5">
          <span className="font-inter text-[30px] font-extrabold leading-none tracking-[-0.06em] text-[#24372F]">
            {milestone.displayNumber}
          </span>
          <span className="font-inter text-[11px] font-medium text-[#738177]">
            {milestone.value === 1 ? "session" : "sessions"}
          </span>
        </div>
        <h3 className="mt-1.5 font-inter text-[15px] font-semibold leading-tight text-[#2F4034]">
          {milestone.title}
        </h3>
      </div>
    </article>
  );
}
