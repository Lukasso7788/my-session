import "./room-joining-indicator.css";

type Props = { theme: "light" | "dark"; label?: string };

// Frame-measured from the owner's reference (first row, fifth from the left):
// every 0.5s the two outer dots close in, absorb the small middle dot, touch
// and spring back out while the middle dot reappears and settles.
const KEY_TIMES = "0;0.13;0.2;0.27;0.33;0.4;0.47;0.53;0.6;0.67;0.73;0.8;0.87;0.93;1";
const LEFT_X = "-9;-9;-8.1;-7.3;-6.15;-4.8;-3.7;-3;-3.7;-4.7;-5.8;-7.2;-8.1;-8.65;-9";
const RIGHT_X = "9;9;8.1;7.3;6.15;4.8;3.7;3;3.7;4.7;5.8;7.2;8.1;8.65;9";
const MIDDLE_R = "0.7;0.7;1.4;1.4;0;0;0;0;0;0;0;1.4;1.1;0.85;0.7";
const SPLINE = "0.45 0 0.55 1";
const SPLINES = Array(14).fill(SPLINE).join(";");

const WORD = "Loading";

/**
 * Small dots loader with a "Loading" word whose letters dim in a wave, for the
 * temporary joining state. The label is what screen readers announce.
 */
export default function RoomJoiningIndicator({ theme, label = "Joining room…" }: Props) {
  const animate = (attributeName: string, values: string) => (
    <animate attributeName={attributeName} dur="0.5s" repeatCount="indefinite"
      calcMode="spline" keyTimes={KEY_TIMES} keySplines={SPLINES} values={values} />
  );
  return (
    <div className="ms-room-joining" data-theme={theme} role="status" aria-live="polite">
      <span className="ms-room-joining-accessible">{label}</span>
      <svg className="ms-room-joining-dots" viewBox="-14 -7 28 14" aria-hidden="true" focusable="false">
        <circle cx="-9" r="2.75">{animate("cx", LEFT_X)}</circle>
        <circle r="0.7">{animate("r", MIDDLE_R)}</circle>
        <circle cx="9" r="2.75">{animate("cx", RIGHT_X)}</circle>
      </svg>
      <svg className="ms-room-joining-still" viewBox="-14 -7 28 14" aria-hidden="true" focusable="false">
        <circle cx="-9" r="2.75" />
        <circle r="0.7" />
        <circle cx="9" r="2.75" />
      </svg>
      <span className="ms-room-joining-word" aria-hidden="true">
        {WORD.split("").map((letter, index) => (
          <span key={index} style={{ animationDelay: `${index * 0.09}s` }}>{letter}</span>
        ))}
      </span>
    </div>
  );
}
