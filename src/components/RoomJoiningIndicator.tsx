import "./room-joining-indicator.css";

type Props = { theme: "light" | "dark"; label?: string };

// One ripple's life within a 1s cycle (visible for the first ~0.77s), taken
// from frame measurements of the reference: a centre dot swells into a disc,
// opens into a thick ring, then the ring widens and thins out.
// Two ripples half a cycle apart give one new ring every 0.5s.
const KEY_TIMES = "0;0.067;0.133;0.2;0.267;0.333;0.4;0.467;0.533;0.6;0.667;0.733;0.767;1";
// Strokes are about two thirds of the reference's weight for a finer look.
const RADIUS = "0;0.85;1.35;2.9;4.7;5.8;7.2;8.9;9.8;11;12.25;12.9;13;13";
const STROKE = "0;1.7;2.7;2.8;3.1;3.1;3;2.4;1.9;1.5;0.8;0.2;0;0";

/** Ripple loader for the temporary joining state; the label is for screen readers. */
export default function RoomJoiningIndicator({ theme, label = "Joining room…" }: Props) {
  return (
    <div className="ms-room-joining" data-theme={theme} role="status" aria-live="polite">
      <span className="ms-room-joining-accessible">{label}</span>
      <svg className="ms-room-joining-ripple" viewBox="-14 -14 28 28" aria-hidden="true" focusable="false">
        {["0s", "-0.5s"].map((begin) => (
          <circle key={begin} r="0" strokeWidth="0">
            <animate attributeName="r" dur="1s" begin={begin} repeatCount="indefinite" keyTimes={KEY_TIMES} values={RADIUS} />
            <animate attributeName="stroke-width" dur="1s" begin={begin} repeatCount="indefinite" keyTimes={KEY_TIMES} values={STROKE} />
          </circle>
        ))}
      </svg>
      <svg className="ms-room-joining-still" viewBox="-14 -14 28 28" aria-hidden="true" focusable="false">
        <circle r="5.8" strokeWidth="3.1" />
      </svg>
    </div>
  );
}
