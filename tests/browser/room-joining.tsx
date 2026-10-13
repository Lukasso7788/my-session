import { useState } from "react";
import { createRoot } from "react-dom/client";
import RoomJoiningIndicator from "../../src/components/RoomJoiningIndicator";
import "../../src/index.css";

function Preview() {
  const [theme, setTheme] = useState<"light" | "dark">(new URLSearchParams(window.location.search).get("theme") === "light" ? "light" : "dark");
  return <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: theme === "light" ? "#F3F1F1" : "#1B1B1B", color: theme === "light" ? "#2F2F2F" : "#E8E8E8" }}>
    <header style={{ padding: "18px 24px", display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "space-between", borderBottom: theme === "light" ? "1px solid #D8D0D0" : "1px solid #343434" }}>
      <span style={{ fontWeight: 600, flex: "1 1 190px", minWidth: 0 }}>Room connection · animation preview</span>
      <button style={{ flexShrink: 0 }} onClick={() => setTheme(theme === "light" ? "dark" : "light")}>Switch to {theme === "light" ? "dark" : "light"}</button>
    </header>
    <div style={{ display: "grid", flex: 1, placeItems: "center", minHeight: 260, minWidth: 0, width: "100%", padding: "0 12px", boxSizing: "border-box" }}><RoomJoiningIndicator theme={theme} /></div>
    <footer style={{ padding: "18px 24px", textAlign: "center", fontSize: 12, opacity: .7 }}>Preview only · no live connection or camera access</footer>
  </main>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<Preview />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
