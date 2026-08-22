import type { VoiceController } from "./controller";

interface RecognitionResultEvent extends Event { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>; }
interface RecognitionErrorEvent extends Event { error: string; message?: string; }
interface RecognitionLike extends EventTarget { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void; }
type RecognitionCtor = new () => RecognitionLike;

export class WebSpeechAdapter {
  private recognition?: RecognitionLike;
  private continuousRequested = false;
  private restartTimer?: number;
  private watchdogTimer?: number;

  constructor(private controller: VoiceController, private transcriptHandler?: (text: string) => void | Promise<void>) {}
  supported() { return Boolean(this.ctor()); }

  private ctor(): RecognitionCtor | undefined {
    const scope = window as typeof window & { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    return scope.SpeechRecognition || scope.webkitSpeechRecognition;
  }

  private clearTimers() {
    if (this.restartTimer) window.clearTimeout(this.restartTimer);
    if (this.watchdogTimer) window.clearTimeout(this.watchdogTimer);
    this.restartTimer = undefined;
    this.watchdogTimer = undefined;
  }

  private restart(recognition: RecognitionLike, delay = 180) {
    if (!this.continuousRequested || this.recognition !== recognition) return;
    this.clearTimers();
    this.recognition = undefined;
    try { recognition.abort(); } catch { /* already finalized */ }
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = undefined;
      if (this.continuousRequested && !this.recognition) this.start({ continuous: true });
    }, delay);
  }

  start({ continuous = false } = {}) {
    const Ctor = this.ctor();
    if (!Ctor) throw new Error("speech_recognition_not_supported");
    this.continuousRequested = continuous;
    this.clearTimers();
    try { this.recognition?.abort(); } catch { /* already finalized */ }

    const recognition = this.recognition = new Ctor();
    recognition.lang = this.controller.options.locale;
    // Short sessions are more reliable than the browser's nominal continuous
    // mode, especially while another WebRTC surface owns the microphone.
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.addEventListener("result", event => {
      const results = (event as RecognitionResultEvent).results;
      const result = results[results.length - 1];
      if (!result?.isFinal) return;
      const handler = this.transcriptHandler || ((text: string) => this.controller.handle(text));
      void Promise.resolve(handler(result[0].transcript))
        .catch(error => this.controller.options.onError?.(error))
        .finally(() => {
          if (this.continuousRequested) this.restart(recognition);
        });
    });

    recognition.addEventListener("error", event => {
      const detail = event as RecognitionErrorEvent;
      const code = detail.message || detail.error;
      if (!/aborted|no-speech/i.test(code)) this.controller.options.onError?.(new Error(code));
    });

    recognition.addEventListener("end", () => {
      if (this.continuousRequested) this.restart(recognition);
      else if (this.recognition === recognition) this.recognition = undefined;
    });

    recognition.start();
    if (continuous) {
      this.watchdogTimer = window.setTimeout(() => this.restart(recognition, 220), 12_000);
    }
  }

  stop() {
    this.continuousRequested = false;
    this.clearTimers();
    const recognition = this.recognition;
    this.recognition = undefined;
    try { recognition?.abort(); } catch { /* already finalized */ }
  }

  destroy() { this.stop(); }
}
