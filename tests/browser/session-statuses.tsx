import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { GUIDE_PEOPLE } from "../../src/hostGuide/people";
import "./profile-page-auth";
import { STATUS_GUIDE, STATUS_RULE } from "../../src/hostGuide/statuses";
import { VideoTile } from "../../src/pages/livekit/VideoTileLiveKit";
import "../../src/index.css";
import "../../src/pages/livekit/room-chrome-motion.css";

// Local concept: what each room status means, shown on the real room tile.
const TILE_PEOPLE = [GUIDE_PEOPLE[3], GUIDE_PEOPLE[1], GUIDE_PEOPLE[2], GUIDE_PEOPLE[1], GUIDE_PEOPLE[3]];

function StatusesPage() {
  return (
    <div className="ss">
      <style>{CSS}</style>
      <header className="ss-header">MySession</header>
      <main className="ss-main">
        <section className="ss-hero">
          <span className="ss-kicker">Host guide</span>
          <h1>Room statuses</h1>
          <p>People set a status from their tile menu to tell the room what they need. As the host, you read it and act on it.</p>
          <div className="ss-rule">{STATUS_RULE}</div>
        </section>

        <div className="ss-list">
          {STATUS_GUIDE.map((st, i) => {
            const p = TILE_PEOPLE[i % TILE_PEOPLE.length];
            return (
              <section key={st.key} className="ss-item">
                <div className="ss-tile">
                  <VideoTile
                    tileId={`status-${st.key}`}
                    label={p.name}
                    status={st.key}
                    isLocal={false}
                    theme="dark"
                    showBadge={null}
                    avatarUrl={p.avatar}
                    micMuted
                    isSpeaking={false}
                    currentIntention={p.task}
                    taskList={[]}
                    participantTimeZone={p.tz}
                  />
                </div>
                <div className="ss-text">
                  <h2>{st.menu}</h2>
                  <p className="ss-meaning">{st.meaning}</p>
                  <div className="ss-host">
                    <span>What you do</span>
                    <p>{st.host}</p>
                  </div>
                  {st.exception ? (
                    <div className="ss-exception">
                      <span>Private sessions</span>
                      <p>{st.exception}</p>
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>

        <section className="ss-how">
          <h2>How people set a status</h2>
          <p>Open the menu on your own tile and pick a status. Pick "Clear status" when you're back. Everyone sees the badge next to your name.</p>
          <a href="/host-guide/">← Back to the host guide</a>
        </section>
      </main>
    </div>
  );
}

const CSS = `
.ss { min-height: 100vh; background: #fff; color: #2F2F2F; font-family: Inter, system-ui, sans-serif; }
.ss-header { height: 64px; display: grid; place-items: center; font-size: 26px; font-weight: 800; border-bottom: 1px solid #EEE; }
.ss-main { max-width: 1080px; margin: 0 auto; padding: 36px 20px 72px; display: grid; gap: 16px; }
.ss-kicker { font-size: 13px; font-weight: 600; color: #6B6B6B; }
.ss-hero h1 { margin: 4px 0 8px; font-size: 40px; line-height: 1.1; font-weight: 700; letter-spacing: -0.02em; }
.ss-hero p { margin: 0; max-width: 640px; font-size: 16px; line-height: 1.55; color: #4A4A4A; }
.ss-rule { margin-top: 18px; display: inline-block; padding: 12px 16px; border-radius: 14px; background: #2F2F2F; color: #fff; font-size: 15px; font-weight: 600; }
.ss-list { display: grid; gap: 12px; }
.ss-item { display: grid; grid-template-columns: 440px 1fr; gap: 28px; align-items: center; border: 1px solid #EEE; border-radius: 22px; padding: 14px; }
.ss-tile { position: relative; height: 290px; border-radius: 16px; overflow: hidden; background: #1B1B1B; }
.ss-tile > * { height: 100%; }
.ss-text h2 { margin: 0 0 4px; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
.ss-meaning { margin: 0 0 12px; font-size: 14.5px; line-height: 1.5; color: #4A4A4A; }
.ss-host, .ss-exception { border-radius: 12px; padding: 10px 12px; background: #F7F7F7; }
.ss-exception { margin-top: 6px; background: #EEF5FF; }
.ss-host span, .ss-exception span { display: block; font-size: 12.5px; font-weight: 600; color: #6B6B6B; }
.ss-host p, .ss-exception p { margin: 2px 0 0; font-size: 14px; line-height: 1.5; color: #2F2F2F; }
.ss-how { border: 1px solid #EEE; border-radius: 22px; padding: 20px; }
.ss-how h2 { margin: 0 0 6px; font-size: 19px; font-weight: 700; }
.ss-how p { margin: 0 0 12px; font-size: 14px; line-height: 1.5; color: #4A4A4A; }
.ss-how a { font-size: 13px; font-weight: 600; color: #5286F6; text-decoration: none; }
@media (max-width: 760px) { .ss-item { grid-template-columns: 1fr; } .ss-hero h1 { font-size: 30px; } }
`;

createRoot(document.getElementById("root")!).render(<MemoryRouter><StatusesPage /></MemoryRouter>);
