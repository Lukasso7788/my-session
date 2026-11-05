// Stopwatch for task timers in the room's Tasks panel. Drawn in currentColor
// so it follows the surrounding text color in both panel themes.
export default function StopwatchIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Crown button and stem */}
      <rect x="189" y="10" width="134" height="40" rx="8" fill="currentColor" />
      <rect x="224" y="44" width="64" height="56" fill="currentColor" />
      {/* Side buttons */}
      <line x1="90" y1="111" x2="150" y2="171" stroke="currentColor" strokeWidth="44" />
      <rect x="31" y="80" width="101" height="45" rx="10" transform="rotate(-45 81.5 102.5)" fill="currentColor" />
      <line x1="421" y1="111" x2="361" y2="171" stroke="currentColor" strokeWidth="44" />
      <rect x="379" y="80" width="101" height="45" rx="10" transform="rotate(45 429.5 102.5)" fill="currentColor" />
      {/* Case */}
      <circle cx="255.5" cy="293.5" r="182.5" stroke="currentColor" strokeWidth="48" />
      {/* Hour marks and hand */}
      <g stroke="currentColor" strokeWidth="12" strokeLinecap="round">
        <line x1="255.5" y1="148" x2="255.5" y2="178" />
        <line x1="255.5" y1="408" x2="255.5" y2="438" />
        <line x1="111" y1="293.5" x2="140" y2="293.5" />
        <line x1="371" y1="293.5" x2="400" y2="293.5" />
        <line x1="255.5" y1="293.5" x2="337" y2="211" strokeWidth="14" />
      </g>
      <circle cx="255.5" cy="293.5" r="30" fill="currentColor" />
    </svg>
  );
}
