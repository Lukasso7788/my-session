// Small flat badges for community pages: the highest session milestone a
// person has reached, and the Founding member mark.

export type SessionMilestone = {
  threshold: number;
  label: string;
  fill: string;
  ink: string;
  ring: string;
  // Solid seal color and the number drawn on it.
  seal: string;
  sealInk: string;
};

// Ordered from highest to lowest so the first match is the earned tier.
export const SESSION_MILESTONES: SessionMilestone[] = [
  { threshold: 1000, label: "1000 sessions", fill: "#2F2F2F", ink: "#F6C343", ring: "#F6C343", seal: "#F6C343", sealInk: "#2F2F2F" },
  { threshold: 500, label: "500 sessions", fill: "#FFFFFF", ink: "#2F2F2F", ring: "#2F2F2F", seal: "#2F2F2F", sealInk: "#FFFFFF" },
  { threshold: 250, label: "250 sessions", fill: "#FFF3D6", ink: "#8A6100", ring: "#E9C46A", seal: "#D9A21B", sealInk: "#FFFFFF" },
  { threshold: 100, label: "100 sessions", fill: "#FFE9E4", ink: "#C2412D", ring: "#F2A493", seal: "#E0533C", sealInk: "#FFFFFF" },
  { threshold: 50, label: "50 sessions", fill: "#EEF0FF", ink: "#5145CD", ring: "#B4B0F2", seal: "#6366F1", sealInk: "#FFFFFF" },
  { threshold: 25, label: "25 sessions", fill: "#E4EDFF", ink: "#2F5FD0", ring: "#9DB8F2", seal: "#5286F6", sealInk: "#FFFFFF" },
  { threshold: 10, label: "10 sessions", fill: "#E5F8E7", ink: "#2F8F35", ring: "#9AD8A0", seal: "#49B552", sealInk: "#FFFFFF" },
];

export function sessionMilestone(sessions: number | string | null | undefined): SessionMilestone | null {
  const count = Number(sessions) || 0;
  return SESSION_MILESTONES.find((tier) => count >= tier.threshold) ?? null;
}

function shortNumber(value: number) {
  return value >= 1000 ? `${value / 1000}k` : String(value);
}

// A rounded scalloped seal with the milestone number inside.
function MilestoneSeal({ tier, size }: { tier: SessionMilestone; size: number }) {
  const points = 12;
  const outer = 11;
  const inner = 9.6;
  let path = "";
  for (let i = 0; i <= points * 2; i += 1) {
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const radius = i % 2 === 0 ? outer : inner;
    const x = 12 + radius * Math.cos(angle);
    const y = 12 + radius * Math.sin(angle);
    path += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  const text = shortNumber(tier.threshold);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path d={`${path}Z`} fill={tier.seal} />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fill={tier.sealInk}
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="700"
        fontSize={text.length >= 3 ? 6.6 : 8}
      >
        {text}
      </text>
    </svg>
  );
}

export function SessionMilestoneBadge({
  sessions,
  compact = false,
}: {
  sessions: number | string | null | undefined;
  compact?: boolean;
}) {
  const tier = sessionMilestone(sessions);
  if (!tier) return null;
  if (compact) {
    return (
      <span title={`${tier.label} attended`} aria-label={`${tier.label} attended`} className="inline-flex">
        <MilestoneSeal tier={tier} size={20} />
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-7 items-center gap-1.5 rounded-full py-0.5 pl-1 pr-2.5 text-[12px] font-semibold"
      style={{ backgroundColor: tier.fill, color: tier.ink, boxShadow: `inset 0 0 0 1px ${tier.ring}` }}
      title={`${tier.label} attended`}
    >
      <MilestoneSeal tier={tier} size={20} />
      {tier.label}
    </span>
  );
}

export function FoundingMemberBadge({ compact = false }: { compact?: boolean }) {
  const star = (
    <svg width={compact ? 20 : 18} height={compact ? 20 : 18} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="11" fill="#2F2F2F" />
      <path
        d="M12 5.6l1.86 3.94 4.3.52-3.17 2.96.82 4.26L12 15.2l-3.81 2.08.82-4.26-3.17-2.96 4.3-.52z"
        fill="#F6C343"
      />
    </svg>
  );
  if (compact) {
    return (
      <span title="Founding member" aria-label="Founding member" className="inline-flex">
        {star}
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#2F2F2F] py-0.5 pl-1 pr-2.5 text-[12px] font-semibold text-white"
      title="Founding member"
    >
      {star}
      Founding member
    </span>
  );
}
