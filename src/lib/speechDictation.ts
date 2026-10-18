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
  if (!base.trim()) return capitalizeFirst(spoken.replace(/^[.,?!:;]\s*/, ""));
  // A spoken "comma" or "question mark" right after typed text sticks to it.
  if (/^[.,?!:;]/.test(spoken)) return base.replace(/\s+$/, "") + spoken;
  const glue = /\s$/.test(base) ? "" : " ";
  return base + glue + (/[.!?]\s*$/.test(base) ? capitalizeFirst(spoken) : spoken);
}

function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

// Browser speech recognition returns words only: no punctuation, no
// intonation. Punctuation comes from two places instead:
//  1. spoken commands ("comma", "question mark", "запятая", "точка", ...);
//  2. pauses: the browser splits speech into phrases at pauses, and a phrase
//     followed by more speech ends a sentence, with "?" when it starts like a
//     question (what/how/почему/где/... or has the Russian particle "ли").
const SPOKEN_PUNCTUATION: Array<[string[], string]> = [
  [["question mark", "вопросительный знак", "знак вопроса"], "?"],
  [["exclamation mark", "exclamation point", "восклицательный знак"], "!"],
  [["full stop", "period", "точка"], "."],
  [["comma", "запятая"], ","],
  [["colon", "двоеточие"], ":"],
  [["semicolon", "точка с запятой"], ";"],
  [["new line", "new paragraph", "новая строка", "с новой строки", "новый абзац"], "\n"],
];

const QUESTION_STARTS = new Set([
  "what", "why", "how", "when", "where", "who", "whom", "whose", "which",
  "can", "could", "would", "will", "shall", "should", "may", "might",
  "do", "does", "did", "is", "are", "was", "were", "am", "have", "has", "had",
  "isn't", "aren't", "don't", "doesn't", "didn't", "can't", "won't", "shouldn't",
  "что", "чего", "чем", "почему", "зачем", "как", "когда", "где", "кто", "кого", "кому",
  "куда", "откуда", "сколько", "какой", "какая", "какое", "какие", "каким", "какую",
  "чей", "чья", "чьё", "чьи", "разве", "неужели", "можно", "правда",
]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Longest phrases first, so "точка с запятой" wins over "точка".
const SPOKEN_PATTERNS = SPOKEN_PUNCTUATION.flatMap(([words, mark]) => words.map((word) => [word, mark] as const))
  .sort((a, b) => b[0].length - a[0].length)
  .map(([word, mark]) => [new RegExp(`(^|\\s+)${escapeRegExp(word).replace(/ /g, "\\s+")}(?=\\s|$)`, "giu"), mark] as const);

function applySpokenPunctuation(text: string): string {
  let out = text;
  for (const [pattern, mark] of SPOKEN_PATTERNS) out = out.replace(pattern, mark);
  return out.replace(/\n[ \t]+/g, "\n").trim();
}

export function looksLikeQuestion(phrase: string): boolean {
  const words = phrase.toLocaleLowerCase().replace(/[^\p{L}\p{N}'\s-]/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  return QUESTION_STARTS.has(words[0]) || words.includes("ли");
}

/** Spoken phrases (finals in order, then the phrase still being heard) as text. */
export function punctuateDictation(finals: string[], interim = ""): string {
  const phrases = finals.map(applySpokenPunctuation).filter(Boolean);
  const live = applySpokenPunctuation(interim);
  const parts: string[] = [];
  phrases.forEach((phrase, index) => {
    const next = index < phrases.length - 1 ? phrases[index + 1] : live;
    // The next phrase is itself a mark ("точка", "comma"): it decides.
    if (!/[.!?,:;\n]$/.test(phrase) && !/^[.!?,:;\n]/.test(next)) {
      if (looksLikeQuestion(phrase)) phrase += "?";
      else if (next) phrase += ".";
    }
    parts.push(phrase);
  });
  if (live) parts.push(live);

  return parts
    .join(" ")
    .replace(/\s+([.,?!:;])/g, "$1")
    .replace(/ *\n */g, "\n")
    // The very first letter is left to composeDictation, which knows what was
    // typed before.
    .replace(/([.?!]\s+|\n)(\p{Ll})/gu, (_, lead: string, letter: string) => lead + letter.toLocaleUpperCase());
}

/**
 * Final and interim transcripts from a SpeechRecognition result event,
 * starting at result fromIndex (results before it are already in the text).
 */
export function readTranscripts(
  event: { resultIndex?: number; results?: ArrayLike<any> },
  fromIndex = 0,
): { finals: string[]; interim: string } {
  const finals: string[] = [];
  let interim = "";
  const results = event.results || [];
  for (let i = Math.max(0, fromIndex); i < results.length; i++) {
    const result = results[i];
    const transcript = String(result?.[0]?.transcript || "");
    if (result?.isFinal) finals.push(transcript.trim());
    else interim += transcript;
  }
  return { finals: finals.filter(Boolean), interim: interim.trim() };
}

/**
 * What the field shows while dictating. The browser reports everything said
 * since dictation started, so after a manual edit the edited text becomes the
 * new base and only speech after the edit is added. A phrase that was still
 * being recognised during the edit is dropped too: otherwise deleted words
 * would come back once the browser finalises them.
 */
export function createDictationBuffer(base: string) {
  let text = base;
  let fromIndex = 0;
  let seenResults = 0;
  return {
    /** Text for a result event. */
    onResult(event: { results?: ArrayLike<any> }): string {
      seenResults = event.results?.length ?? seenResults;
      const { finals, interim } = readTranscripts(event, fromIndex);
      return composeDictation(text, punctuateDictation(finals, interim), "");
    },
    /** The person typed or deleted something while dictating. */
    manualEdit(nextText: string) {
      text = nextText;
      fromIndex = seenResults;
    },
  };
}

export function dictationErrorMessage(code: unknown): string {
  const error = String(code || "");
  if (error === "not-allowed" || error === "service-not-allowed") return "Allow microphone access in your browser to dictate.";
  if (error === "audio-capture") return "No microphone found for dictation.";
  if (error === "network") return "Dictation needs an internet connection.";
  if (error === "no-speech" || error === "aborted") return "";
  return "Dictation stopped. Try again.";
}
