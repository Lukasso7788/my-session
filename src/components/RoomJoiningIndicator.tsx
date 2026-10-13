import "./room-joining-indicator.css";

type Props = { theme: "light" | "dark"; label?: string };

// Frame-by-frame track (30 fps, 0.5s loop) of the owner's reference: first row,
// fifth from the left. Two big dots swap places: the one travelling left to
// right passes in front at full size, the other passes behind, shrinking and
// dimming. Both hesitate just before and after they cross, then snap past each
// other. The small dim middle dot drifts towards the front dot, hides under it
// and settles back. Units are reference pixels.
const KEY_TIMES = Array.from({ length: 16 }, (_, frame) => (frame / 15).toFixed(4)).join(";");
const FRONT_X = "-8.95;-8.95;-8.34;-7.05;-6.2;-4.9;-2.56;-2.01;0.38;2.77;3.48;4.65;7.14;7.77;8.5;8.95";
const BACK_X = "8.95;8.95;8.84;8.05;7.84;7.07;5.81;5.43;-0.1;-5.66;-5.97;-6.92;-7.9;-8.11;-8.61;-8.95";
const BACK_R = "2.9;2.9;2.9;2.77;2.64;2.49;2.26;2.26;2.2;2.26;2.42;2.49;2.7;2.77;2.9;2.9";
const BACK_OPACITY = "1;1;1;0.96;0.9;0.84;0.74;0.74;0.72;0.74;0.78;0.84;0.95;0.98;1;1";
const MIDDLE_X = "0.1;0.1;-0.14;-0.82;-1.5;-2;-1.6;-1;-0.2;1.5;1.9;1.3;1.01;0.69;0.44;0.1";

const WORD = "Loading";

/**
 * Small dots loader with a shimmering "Loading" word, for the temporary
 * joining state. The label is what screen readers announce.
 */
export default function RoomJoiningIndicator({ theme, label = "Joining room…" }: Props) {
  const animate = (attributeName: string, values: string) => (
    <animate attributeName={attributeName} dur="0.5s" repeatCount="indefinite" keyTimes={KEY_TIMES} values={values} />
  );
  return (
    <div className="ms-room-joining" data-theme={theme} role="status" aria-live="polite">
      <span className="ms-room-joining-accessible">{label}</span>
      {/* Paint order is depth: back dot, middle dot, front dot. */}
      <svg className="ms-room-joining-dots" viewBox="-14 -7 28 14" aria-hidden="true" focusable="false">
        <circle cx="8.95" r="2.9">
          {animate("cx", BACK_X)}
          {animate("r", BACK_R)}
          {animate("opacity", BACK_OPACITY)}
        </circle>
        <circle className="ms-room-joining-middle" cx="0.1" r="1.3">{animate("cx", MIDDLE_X)}</circle>
        <circle cx="-8.95" r="2.9">{animate("cx", FRONT_X)}</circle>
      </svg>
      <svg className="ms-room-joining-still" viewBox="-14 -7 28 14" aria-hidden="true" focusable="false">
        <circle cx="-8.95" r="2.9" />
        <circle className="ms-room-joining-middle" cx="0.1" r="1.3" />
        <circle cx="8.95" r="2.9" />
      </svg>
      <span className="ms-room-joining-word" aria-hidden="true">{WORD}</span>
    </div>
  );
}
