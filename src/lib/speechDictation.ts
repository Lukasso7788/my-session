// Chat dictation: the browser's own speech recognition (Web Speech API).
// Chrome, Edge and Safari support it; Firefox does not, so the mic button is
// hidden there. The browser sends the audio to its speech service (Google or
// Apple); nothing goes through MySession servers.

export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: null | ((event: any) => void);
  onerror: null | ((event: any) => void);
  onend: null | (() => void);
};

export function getSpeechRecognitionConstructor(win?: Window | null): (new () => SpeechRecognitionLike) | null {
  const target = (win || (typeof window !== "undefined" ? window : null)) as any;
  if (!target) return null;
  return target.SpeechRecognition || target.webkitSpeechRecognition || null;
}

/** The composer text while dictating: what was typed before + what was said. */
export function composeDictation(base: string, finalText: string, interimText: string): string {
  const spoken = [finalText, interimText].map((part) => part.trim()).filter(Boolean).join(" ");
  if (!spoken) return base;
  if (!base.trim()) return capitalizeFirst(spoken);
  const glue = /\s$/.test(base) ? "" : " ";
  return base + glue + (/[.!?]\s*$/.test(base) ? capitalizeFirst(spoken) : spoken);
}

function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

/** Final and interim transcripts from a SpeechRecognition result event. */
export function readTranscripts(event: { resultIndex?: number; results?: ArrayLike<any> }): { finals: string[]; interim: string } {
  const finals: string[] = [];
  let interim = "";
  const results = event.results || [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const transcript = String(result?.[0]?.transcript || "");
    if (result?.isFinal) finals.push(transcript.trim());
    else interim += transcript;
  }
  return { finals: finals.filter(Boolean), interim: interim.trim() };
}

export function dictationErrorMessage(code: unknown): string {
  const error = String(code || "");
  if (error === "not-allowed" || error === "service-not-allowed") return "Allow microphone access in your browser to dictate.";
  if (error === "audio-capture") return "No microphone found for dictation.";
  if (error === "network") return "Dictation needs an internet connection.";
  if (error === "no-speech" || error === "aborted") return "";
  return "Dictation stopped. Try again.";
}
