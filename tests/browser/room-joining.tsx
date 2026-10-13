import { useState } from "react";
import { createRoot } from "react-dom/client";
import RoomJoiningTip from "../../src/components/RoomJoiningTip";
import { PRODUCTIVITY_TIPS } from "../../src/data/productivityTips";
import "../../src/index.css";
import "../../src/components/room-joining-tip.css";

// Dev-only preview of the room joining screen. "Switch theme" re-renders the
// same attempt (the tip must stay), "New join attempt" remounts it (new tip),
// "Slow connection" shows the in-place retry status, and "All 48 tips" lays
// every tip out in the same markup to check wrapping at phone widths.
function Preview() {
  const params = new URLSearchParams(window.location.search);
  const [theme, setTheme] = useState<"light" | "dark">(params.get("theme") === "light" ? "light" : "dark");
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const [all, setAll] = useState(params.get("all") === "1");
  const isLight = theme === "light";
  const button = { flexShrink: 0, padding: "6px 10px", borderRadius: 8, border: `1px solid ${isLight ? "#D8D0D0" : "#343434"}`, background: isLight ? "#fff" : "#242424", color: "inherit" };
  return <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: isLight ? "#F3F1F1" : "#1B1B1B", color: isLight ? "#2F2F2F" : "#E8E8E8" }}>
    <header style={{ padding: "14px 16px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderBottom: `1px solid ${isLight ? "#D8D0D0" : "#343434"}` }}>
      <span style={{ fontWeight: 600, flex: "1 1 190px", minWidth: 0 }}>Room joining preview</span>
      <button style={button} onClick={() => setTheme(isLight ? "dark" : "light")}>Switch theme</button>
      <button style={button} onClick={() => setAttempt((n) => n + 1)}>New join attempt</button>
      <button style={button} aria-pressed={slow} onClick={() => setSlow(!slow)}>Slow connection</button>
      <button style={button} aria-pressed={all} onClick={() => setAll(!all)}>All 48 tips</button>
    </header>
    {all ? (
      <ol style={{ listStyle: "none", margin: 0, padding: "16px 0", display: "grid", gap: 28 }}>
        {PRODUCTIVITY_TIPS.map((tip, index) => (
          <li key={tip} style={{ display: "flex", justifyContent: "center" }} data-tip-index={index}>
            <div className="ms-room-joining-tip" data-theme={theme}>
              <p className="ms-room-joining-tip-label">Productivity tip</p>
              <p className="ms-room-joining-tip-text">{tip}</p>
            </div>
          </li>
        ))}
      </ol>
    ) : (
      <div style={{ position: "relative", flex: 1, minHeight: 320 }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <RoomJoiningTip key={attempt} theme={theme}
            status={slow ? "The connection is slow. Trying again (2 of 3)…" : "Connecting to room..."} />
        </div>
      </div>
    )}
    <footer style={{ padding: "14px 16px", textAlign: "center", fontSize: 12, opacity: .7 }}>Preview only · no live connection or camera access</footer>
  </main>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<Preview />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
