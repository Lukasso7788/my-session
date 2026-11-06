// Task timer icon for the room's Tasks panel: a clock inside a clockwise arrow.
// Drawn in currentColor so it follows the surrounding color in both themes.
export default function TaskTimerIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
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
      stroke="currentColor"
      strokeWidth="30"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Clockwise arrow around the clock */}
      <path d="M486 353.1A240.75 240.75 0 1 1 445.2 94.8" />
      <path d="M428.5 34L450.5 90H389" />
      {/* Clock face */}
      <circle cx="266" cy="255.5" r="160.5" />
      {/* Hour marks */}
      <path d="M266 105.5V116M266 405.5V395M116 255.5H126.5M416 255.5H405.5M160 149.5L167.4 156.9M372 149.5L364.6 156.9M160 361.5L167.4 354.1M372 361.5L364.6 354.1" />
      {/* Hands */}
      <path d="M266 190V262.5L308.5 297.5" />
    </svg>
  );
}
