import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RoomSoundscapePanel } from "../../src/pages/livekit/RoomSoundscapePanel";
import { ROOM_SOUNDSCAPE_OPTIONS, type RoomSoundscapeId } from "../../src/lib/roomSoundscapes";
import "../../src/index.css";
import "../../src/pages/livekit/roomSidePanelTheme.css";

const noop = () => {};
const params = new URLSearchParams(location.search);
const panelWidth = Math.max(280, Math.min(420, Number(params.get("width")) || 420));
function Panel({ theme }: { theme: "light" | "dark" }) {
  const [track, setTrack] = useState<RoomSoundscapeId>("fireplace");
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [mode, setMode] = useState<"room" | "personal">("room");
  const guest = params.has("guest");
  return <div className="ms-room-side-panel" data-panel-theme={theme} style={{ width: `min(${panelWidth}px, 100%)`, height: 850, overflow: "hidden", borderRadius: 18, border: `1px solid ${theme === "dark" ? "#414141" : "#ddd"}` }}>
    <RoomSoundscapePanel theme={theme} listeningMode={mode} activeId={track} playing={playing}
      currentTime={9} duration={ROOM_SOUNDSCAPE_OPTIONS.find(t => t.id === track)!.durationSeconds}
      volume={volume} personalMuted={muted} canControl={!guest || mode === "personal"} canUpload={false}
      canShareTabMusic={false} sharingTabMusic={false} tabMusicShareBusy={false} tabMusicShareError={null}
      onShareTabMusic={noop} onStopTabMusicShare={noop} customTrackLabel={null} busy={false} uploading={false} error={null}
      onListeningModeChange={setMode} onSelect={setTrack} onSeek={noop} onVolumeChange={setVolume}
      onToggleMute={() => setMuted(v => !v)} onUpload={noop} onStop={() => setPlaying(v => !v)} onClose={noop} />
  </div>;
}
function Preview() {
  return <main style={{ margin: "0 auto", maxWidth: 980, padding: "24px 12px 48px", color: "#d8e2ef", fontFamily: "Inter, sans-serif" }}>
    <h1 style={{ fontSize: 24, fontWeight: 700 }}>Music · light & dark</h1>
    <p style={{ margin: "8px 0 20px", fontSize: 13 }}>Actual room panel. Local controls only; no audio, authentication or network side effects.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24, justifyContent: "center" }}>
      {params.get("theme") !== "dark" ? <Panel theme="light" /> : null}
      {params.get("theme") !== "light" ? <Panel theme="dark" /> : null}
    </div>
    <h2 style={{ margin: "32px 0 16px", fontWeight: 700, fontSize: 20 }}>All seven scenes</h2>
    <div style={{ display: "grid", gap: 24 }}>
      {ROOM_SOUNDSCAPE_OPTIONS.map(option => <section key={option.id}>
        <h3 style={{ marginBottom: 8, fontSize: 13 }}>{option.label}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
          {[false, true].map(dark => <img key={String(dark)} src={dark ? option.artwork.replace(".svg", "-dark.svg") : option.artwork}
            width={480} height={150} style={{ width: "100%", borderRadius: 14 }} alt={`${option.label} · ${dark ? "night" : "day"}`} />)}
        </div>
      </section>)}
    </div>
  </main>;
}
document.body.style.background = "#14191f";
const root = createRoot(document.getElementById("root")!);
root.render(<Preview />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
