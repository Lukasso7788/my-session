import { useState } from "react";
import { createRoot } from "react-dom/client";
import CameraOffReminder from "../../src/pages/livekit/CameraOffReminder";
import "../../src/index.css";

// Dev-only preview of the camera-off reminder over a mock room.
// The mock uses inline styles: Tailwind does not scan tests/.
function Preview() {
  const [open, setOpen] = useState(true);
  const [log, setLog] = useState("");
  const dark = new URLSearchParams(window.location.search).get("theme") === "dark";
  const tiles = ["#2B3A4A", "#3B2F2F", "#2F3B30", "#3A3346"];
  return (
    <div style={{ position: "relative", minHeight: "100vh", background: dark ? "#121212" : "#F2F2F2", padding: 24, boxSizing: "border-box" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, height: "calc(100vh - 140px)" }}>
        {tiles.map((color, i) => (
          <div key={color} style={{ position: "relative", borderRadius: 10, border: "2px solid #5A6AA8", background: color, overflow: "hidden" }}>
            <span style={{ position: "absolute", left: 12, top: 12, borderRadius: 999, background: "rgba(0,0,0,0.4)", padding: "4px 10px", color: "#fff", font: "12px Inter, sans-serif" }}>
              Participant {i + 1}
            </span>
          </div>
        ))}
      </div>
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 24, display: "flex", justifyContent: "center", gap: 8 }}>
        {["Cam", "Mic", "Share", "PiP", "More"].map((label) => (
          <span key={label} style={{ height: 40, minWidth: 40, padding: "0 12px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, background: "#fff", font: "12px Inter, sans-serif", color: "#2F2F2F", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
            {label}
          </span>
        ))}
        <span style={{ height: 40, width: 40, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, background: "#C0533F", color: "#fff", font: "12px Inter, sans-serif" }}>Exit</span>
      </div>
      {log ? <div style={{ position: "fixed", left: 24, top: 8, background: "#fff", padding: "4px 10px", borderRadius: 6, font: "12px Inter, sans-serif" }}>{log}</div> : null}
      {open ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-[85] flex justify-center px-4 sm:px-6">
          <div className="w-full max-w-[620px]">
            <CameraOffReminder
              theme={dark ? "dark" : "light"}
              minutesOff={5}
              onRemindLater={() => { setOpen(false); setLog("Remind me in 5 min"); }}
              onTurnOn={() => { setOpen(false); setLog("Turn camera on"); }}
              onStayOff={() => { setOpen(false); setLog("Stay camera off for this session"); }}
              onClose={() => { setOpen(false); setLog("Closed (reminds again in 10 min)"); }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);