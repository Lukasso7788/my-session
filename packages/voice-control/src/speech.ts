import type { VoiceController } from "./controller";

interface RecognitionResultEvent extends Event { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>; }
interface RecognitionErrorEvent extends Event { error: string; message?: string; }
interface RecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

export class WebSpeechAdapter {
  private recognition?: RecognitionLike;
  private continuousRequested = false;
  private restartTimer?: number;
  private watchdogTimer?: number;

  constructor(
    private controller: VoiceController,
    private transcriptHandler?: (text: string) => void | Promise<void>,
  ) {
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  supported() { return Boolean(this.ctor()); }

  private ctor(): RecognitionCtor | undefined {
    const scope = window as typeof window & { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    return scope.SpeechRecognition || scope.webkitSpeechRecognition;
  }

  private clearRestartTimer() {
    if (this.restartTimer) window.clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
  }

  private clearWatchdog() {
    if (this.watchdogTimer) window.clearTimeout(this.watchdogTimer);
    this.watchdogTimer = undefined;
  }

  private scheduleRestart(delay = 180) {
    if (!this.continuousRequested || this.restartTimer) return;
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = undefined;
      if (!this.continuousRequested || this.recognition) return;
      this.startSession();
    }, delay);
  }

  private finishSession(recognition: RecognitionLike, delay = 180) {
    this.clearWatchdog();
    if (this.recognition === recognition) this.recognition = undefined;
    try { recognition.abort(); } catch { /* recognition may already be finalizing */ }
    this.scheduleRestart(delay);
  }

  private startSession() {
    if (this.recognition) return;
    if (this.continuousRequested && document.visibilityState !== "visible") {
      this.scheduleRestart(1_000);
      return;
    }

    const Ctor = this.ctor();
    if (!Ctor) throw new Error("speech_recognition_not_supported");

    const recognition = new Ctor();
    this.recognition = recognition;
    recognition.lang = this.controller.options.locale;
    // Chrome's nominal continuous mode frequently stalls after a command.
    // Keep using short sessions and explicitly start the next one, matching
    // the reliable lifecycle used by the in-room voice controls.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.addEventListener("result", event => {
      const results = (event as RecognitionResultEvent).results;
      let transcript = "";
      for (let index = results.length - 1; index >= 0; index -= 1) {
        const result = results[index];
        if (!result?.isFinal) continue;
        transcript = String(result[0]?.transcript || "").trim();
        if (transcript) break;
      }
      if (!transcript) return;

      const handler = this.transcriptHandler || ((text: string) => this.controller.handle(text));
      // Release the current browser session immediately. Waiting for command
      // execution is unsafe because an action may navigate and rerender UI.
      this.finishSession(recognition, 220);
      void Promise.resolve(handler(transcript))
        .catch(error => this.controller.options.onError?.(error));
    });

    recognition.addEventListener("error", event => {
      const detail = event as RecognitionErrorEvent;
      const code = String(detail.message || detail.error || "").trim();
      if (/not-allowed|service-not-allowed/i.test(code)) {
        this.continuousRequested = false;
        this.clearRestartTimer();
        this.clearWatchdog();
        if (this.recognition === recognition) this.recognition = undefined;
        this.controller.options.onError?.(new Error(code));
        return;
      }
      if (!/aborted|no-speech/i.test(code)) {
        this.controller.options.onError?.(new Error(code));
      }
      this.finishSession(recognition, /network|audio-capture/i.test(code) ? 900 : 250);
    });

    recognition.addEventListener("end", () => {
      this.clearWatchdog();
      if (this.recognition === recognition) this.recognition = undefined;
      this.scheduleRestart(180);
    });

    try {
      recognition.start();
      if (this.continuousRequested) {
        this.watchdogTimer = window.setTimeout(() => {
          if (this.recognition === recognition) this.finishSession(recognition, 250);
        }, 12_000);
      }
    } catch (error) {
      if (this.recognition === recognition) this.recognition = undefined;
      if (this.continuousRequested) {
        this.scheduleRestart(900);
        return;
      }
      throw error;
    }
  }

  private handleVisibilityChange = () => {
    if (!this.continuousRequested) return;
    if (document.visibilityState !== "visible") {
      this.clearRestartTimer();
      this.clearWatchdog();
      const recognition = this.recognition;
      this.recognition = undefined;
      try { recognition?.abort(); } catch { /* already finalized */ }
      return;
    }
    this.scheduleRestart(250);
  };

  start({ continuous = false } = {}) {
    this.continuousRequested = continuous;
    this.clearRestartTimer();
    this.clearWatchdog();
    const previous = this.recognition;
    this.recognition = undefined;
    try { previous?.abort(); } catch { /* already finalized */ }
    this.startSession();
  }

  stop() {
    this.continuousRequested = false;
    this.clearRestartTimer();
    this.clearWatchdog();
    const recognition = this.recognition;
    this.recognition = undefined;
    try { recognition?.abort(); } catch { /* already finalized */ }
  }

  destroy() {
    this.stop();
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
  }
}
