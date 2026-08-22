import type { VoiceController } from "./controller";

interface RecognitionResultEvent extends Event { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>; }
interface RecognitionErrorEvent extends Event { error: string; message?: string; }
interface RecognitionLike extends EventTarget { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void; }
type RecognitionCtor = new () => RecognitionLike;

export class WebSpeechAdapter {
  private recognition?: RecognitionLike;
  private continuousRequested = false;
  private restartTimer?: number;

  constructor(private controller: VoiceController, private transcriptHandler?: (text: string) => void | Promise<void>) {}
  supported() { return Boolean(this.ctor()); }
  private ctor(): RecognitionCtor | undefined {
    const scope = window as typeof window & { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    return scope.SpeechRecognition || scope.webkitSpeechRecognition;
  }
  start({ continuous = false } = {}) {
    const Ctor = this.ctor();
    if (!Ctor) throw new Error("speech_recognition_not_supported");
    this.continuousRequested = continuous;
    if (this.restartTimer) window.clearTimeout(this.restartTimer);
    this.recognition?.abort();
    const recognition = this.recognition = new Ctor();
    recognition.lang = this.controller.options.locale;
    recognition.continuous = continuous;
    recognition.interimResults = false;
    recognition.addEventListener("result", event => {
      const results = (event as RecognitionResultEvent).results;
      const result = results[results.length - 1];
      if (result?.isFinal) {
        const handler = this.transcriptHandler || ((text: string) => this.controller.handle(text));
        void Promise.resolve(handler(result[0].transcript)).catch(error => this.controller.options.onError?.(error));
      }
    });
    recognition.addEventListener("error", event => {
      const detail = event as RecognitionErrorEvent;
      this.controller.options.onError?.(new Error(detail.message || detail.error));
    });
    recognition.addEventListener("end", () => {
      if (!this.continuousRequested || this.recognition !== recognition) return;
      this.restartTimer = window.setTimeout(() => {
        if (this.continuousRequested && this.recognition === recognition) this.start({ continuous: true });
      }, 250);
    });
    recognition.start();
  }
  stop() {
    this.continuousRequested = false;
    if (this.restartTimer) window.clearTimeout(this.restartTimer);
    this.recognition?.stop();
  }
  destroy() {
    this.continuousRequested = false;
    if (this.restartTimer) window.clearTimeout(this.restartTimer);
    this.recognition?.abort();
    this.recognition = undefined;
  }
}
