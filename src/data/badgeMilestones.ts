export type BadgeTier = "sprout" | "sapling" | "mature" | "legacy";

export type BadgeMilestone = {
  value: number;
  shortLabel: string;
  displayNumber: string;
  title: string;
  tier: BadgeTier;
  growthStage: number;
};

const definitions: ReadonlyArray<readonly [value: number, title: string]> = [
  [1, "First Step"],
  [3, "Starter"],
  [5, "Newcomer"],
  [10, "On Track"],
  [15, "Focused"],
  [20, "Building"],
  [25, "Habit Starter"],
  [40, "Habit Builder"],
  [50, "Regular"],
  [75, "Steady"],
  [100, "Consistent"],
  [150, "Committed"],
  [200, "Intentional"],
  [250, "Dedicated"],
  [300, "Deep Worker"],
  [350, "Persistent"],
  [400, "Disciplined"],
  [450, "In Flow"],
  [500, "Flow State"],
  [600, "Deep Focus"],
  [700, "Resilient"],
  [800, "Steadfast"],
  [900, "Clear Mind"],
  [1000, "Focus Master"],
  [1250, "Deep Master"],
  [1500, "Sustained Flow"],
  [1750, "Peak Focus"],
  [2000, "Master of Focus"],
];

function formatDisplayNumber(value: number): string {
  if (value < 1000) return String(value);
  return `${Number((value / 1000).toFixed(2))}K`;
}

function tierFor(value: number): BadgeTier {
  if (value <= 25) return "sprout";
  if (value <= 250) return "sapling";
  if (value <= 1000) return "mature";
  return "legacy";
}

export const badgeMilestones: BadgeMilestone[] = definitions.map(
  ([value, title], index) => {
    const displayNumber = formatDisplayNumber(value);
    return {
      value,
      shortLabel: `${displayNumber} ${value === 1 ? "session" : "sessions"}`,
      displayNumber,
      title,
      tier: tierFor(value),
      growthStage: index + 1,
    };
  },
);

export function getHighestEarnedBadge(sessionCount: number): BadgeMilestone | null {
  for (let index = badgeMilestones.length - 1; index >= 0; index -= 1) {
    if (sessionCount >= badgeMilestones[index].value) return badgeMilestones[index];
  }
  return null;
}
