import type { VoiceController } from "./controller";

interface RecognitionResultEvent extends Event { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>; }
interface RecognitionErrorEvent extends Event { error: string; message?: string; }
interface RecognitionLike extends EventTarget { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void; }
type RecognitionCtor = new () => RecognitionLike;

export class WebSpeechAdapter {
  private recognition?: RecognitionLike;
  constructor(private controller: VoiceController) {}
  supported() { return Boolean(this.ctor()); }
  private ctor(): RecognitionCtor | undefined {
    const scope = window as typeof window & { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    return scope.SpeechRecognition || scope.webkitSpeechRecognition;
  }
  start({ continuous = false } = {}) {
    const Ctor = this.ctor();
    if (!Ctor) throw new Error("speech_recognition_not_supported");
    this.recognition?.abort();
    const recognition = this.recognition = new Ctor();
    recognition.lang = this.controller.options.locale; recognition.continuous = continuous; recognition.interimResults = false;
    recognition.addEventListener("result", event => {
      const result = (event as RecognitionResultEvent).results[0];
      if (result?.isFinal) void this.controller.handle(result[0].transcript).catch(error => this.controller.options.onError?.(error));
    });
    recognition.addEventListener("error", event => {
      const detail = event as RecognitionErrorEvent;
      this.controller.options.onError?.(new Error(detail.message || detail.error));
    });
    recognition.start();
  }
  stop() { this.recognition?.stop(); }
  destroy() { this.recognition?.abort(); this.recognition = undefined; }
}
