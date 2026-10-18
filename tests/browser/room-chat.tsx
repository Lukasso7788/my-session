import "./profile-page-auth";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import { ChatPanel } from "../../src/components/ChatPanel";

// Dev-only preview of the room chat composer with dictation. ?theme=light.
// ?fakeSpeech=1 swaps in a scripted SpeechRecognition so the flow can be
// checked without a microphone.
const params = new URLSearchParams(location.search);
if (params.get("fakeSpeech") === "1") {
  class FakeRecognition {
    continuous = false;
    interimResults = false;
    lang = "en-US";
    onresult: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    onend: (() => void) | null = null;
    private timers: number[] = [];
    start() {
      const phrases = [
        { t: "back in five minutes", final: false },
        { t: "back in five minutes", final: true },
      ];
      phrases.forEach((p, i) => {
        this.timers.push(window.setTimeout(() => {
          this.onresult?.({ results: [Object.assign([{ transcript: p.t }], { isFinal: p.final })] });
        }, 400 * (i + 1)));
      });
    }
    stop() {
      this.timers.forEach(clearTimeout);
      window.setTimeout(() => this.onend?.(), 50);
    }
    abort() {
      this.stop();
    }
  }
  (window as any).SpeechRecognition = FakeRecognition;
  (window as any).webkitSpeechRecognition = FakeRecognition;
}
(window as any).__dictationEvents = [];
window.addEventListener("mysession:chat-dictation", (e) => (window as any).__dictationEvents.push((e as CustomEvent).detail));

const theme = params.get("theme") === "light" ? "light" : "dark";
createRoot(document.getElementById("root")!).render(
  <div style={{ width: 380, height: "100vh", margin: "0 auto", background: theme === "light" ? "#F3F1F1" : "#1F2328" }}>
    <ChatPanel sessionId="6f1c2a7e-3b9d-4c1e-9a5f-2d8b7e4c1a90" theme={theme} currentUserId="00000000-0000-4000-8000-000000000001" />
  </div>,
);
