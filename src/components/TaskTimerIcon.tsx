import { useId } from "react";

// Task timer icon for the room's Tasks panel: a solid clock inside a clockwise
// arrow. Drawn in currentColor so it follows the surrounding color in both
// themes; the marks and hands are cut out, so the background shows through.
export default function TaskTimerIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  // Each icon needs its own mask id; useId's colons are not safe in url(#...).
  const maskId = `task-timer-cutout-${useId().replace(/:/g, "")}`;
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
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
        <rect width="512" height="512" fill="#fff" />
        <g stroke="#000" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round">
          {/* Hour marks: run from outside the disc inward */}
          <path d="M266 60V98M266 451V413M71 255.5H108.5M461 255.5H424M128 117.5L154.3 143.8M404 117.5L377.7 143.8M128 393.5L154.3 367.2M404 393.5L377.7 367.2" />
          {/* Hands */}
          <path d="M266 190V262.5L308.5 297.5" />
        </g>
      </mask>
      {/* Solid clock face */}
      <circle cx="266" cy="255.5" r="175.5" fill="currentColor" mask={`url(#${maskId})`} />
      {/* Clockwise arrow around the clock */}
      <g stroke="currentColor" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round">
        <path d="M486 353.1A240.75 240.75 0 1 1 445.2 94.8" />
        <path d="M428.5 34L450.5 90H389" />
      </g>
    </svg>
  );
}
