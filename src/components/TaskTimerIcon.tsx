// Task timer icon for the room's Tasks panel: clock hands inside a
// counter-clockwise arrow. Drawn in currentColor so it follows the
// surrounding color in both panel themes.
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
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Arc, running counter-clockwise into the arrowhead */}
      <path d="M170.7 421.5A197.5 197.5 0 1 0 80.6 250.5" strokeWidth="47" />
      {/* Arrowhead */}
      <path d="M26.5 257.5H142.5L84.5 353.5Z" fill="currentColor" strokeWidth="26" />
      {/* Hands */}
      <path d="M278.5 155.5L280.5 255.5L345.5 286.5" strokeWidth="47" />
    </svg>
  );
}
