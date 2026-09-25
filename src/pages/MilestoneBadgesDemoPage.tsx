import MilestoneBadge from "../components/MilestoneBadge";
import { badgeMilestones } from "../data/badgeMilestones";

const tierGuide = [
  { name: "Sprout", range: "1–25", color: "bg-[#9DE2A4]" },
  { name: "Sapling", range: "40–250", color: "bg-[#61C780]" },
  { name: "Evergreen", range: "300–1K", color: "bg-[#278E59]" },
  { name: "Legacy", range: "1.25K–2K", color: "bg-[#C8AC6D]" },
];

export default function MilestoneBadgesDemoPage() {
  return (
    <main className="min-h-screen bg-[#F6F8F5] px-4 pb-24 pt-12 font-inter text-[#283A30] sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1240px]">
        <header className="max-w-[720px]">
          <span className="inline-flex rounded-full border border-[#D6E7D9] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4E8E61]">
            MySession milestones
          </span>
          <h1 className="mt-5 text-3xl font-bold tracking-[-0.045em] text-[#26372D] sm:text-[42px] sm:leading-tight">
            Every session grows something.
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#68766C] sm:text-base">
            From a first sprout to a full tree, each milestone marks the quiet momentum of showing up.
          </p>
        </header>

        <div className="mt-8 flex flex-wrap gap-2" aria-label="Badge progression tiers">
          {tierGuide.map((tier) => (
            <div key={tier.name} className="inline-flex items-center gap-2 rounded-full border border-[#E2E9E2] bg-white px-3 py-2 text-[11px] font-medium text-[#536358]">
              <span className={`h-2.5 w-2.5 rounded-full ${tier.color}`} />
              <span className="font-semibold text-[#314838]">{tier.name}</span>
              <span>{tier.range}</span>
            </div>
          ))}
        </div>

        <section className="mt-14" aria-labelledby="milestone-gallery-title">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="milestone-gallery-title" className="text-xl font-bold tracking-[-0.03em] text-[#26372D]">
                Milestone collection
              </h2>
              <p className="mt-1 text-xs text-[#7B887E]">28 stages of focus and consistency</p>
            </div>
            <span className="text-xs font-medium text-[#738177]">Large badge / card</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {badgeMilestones.map((milestone) => (
              <MilestoneBadge key={milestone.value} milestone={milestone} variant="large" />
            ))}
          </div>
        </section>

        <section className="mt-20" aria-labelledby="compact-gallery-title">
          <div className="mb-5">
            <h2 id="compact-gallery-title" className="text-xl font-bold tracking-[-0.03em] text-[#26372D]">
              Compact badges
            </h2>
            <p className="mt-1 text-xs text-[#7B887E]">
              Number-first versions for profiles, participant lists, and smaller UI spaces.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {badgeMilestones.map((milestone) => (
              <MilestoneBadge key={milestone.value} milestone={milestone} variant="compact" />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
