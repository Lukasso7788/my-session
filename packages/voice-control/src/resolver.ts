import type { VoiceAction, VoiceMatch } from "./types";

const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const STOP = new Set(["please", "the", "a", "an", "to", "on", "пожалуйста", "на", "в", "и"]);
const VERBS = /^(click|press|open|go to|focus|select|choose|type|enter|search|нажми|нажать|открой|открыть|перейди|выбери|фокус|введи|напиши|найди)\s+/i;

function tokens(value: string) { return normalize(value).split(" ").filter(token => token && !STOP.has(token)); }
function similarity(query: string, candidate: string) {
  const q = tokens(query), c = tokens(candidate);
  if (!q.length || !c.length) return 0;
  if (normalize(query) === normalize(candidate)) return 1;
  const intersection = q.filter(token => c.some(other => other === token || (token.length > 3 && other.startsWith(token)))).length;
  const coverage = intersection / Math.max(q.length, c.length);
  const contains = normalize(candidate).includes(normalize(query)) || normalize(query).includes(normalize(candidate)) ? .18 : 0;
  return Math.min(1, coverage + contains);
}

function extractValue(transcript: string, action: VoiceAction) {
  if (action.kind !== "input" && action.kind !== "select") return undefined;
  const patterns = [/^(?:type|enter|write|search for)\s+(.+?)(?:\s+(?:in|into)\s+.+)?$/i, /^(?:введи|напиши|найди)\s+(.+?)(?:\s+в\s+.+)?$/i];
  for (const pattern of patterns) { const match = transcript.match(pattern); if (match) return match[1].trim(); }
  return undefined;
}

export function resolveTranscript(transcript: string, actions: VoiceAction[], threshold = .62): VoiceMatch | null {
  const query = normalize(transcript.replace(VERBS, ""));
  let best: VoiceMatch | null = null;
  for (const action of actions) {
    const target = action.kind === "input" || action.kind === "select"
      ? normalize(transcript.match(/(?:\s|^)(?:in|into|в)\s+(.+)$/i)?.[1] || "")
      : "";
    for (const alias of action.aliases) {
      const confidence = Math.max(similarity(query, alias), similarity(transcript, alias) - .05, target ? similarity(target, alias) : 0);
      if (!best || confidence > best.confidence) best = { action, confidence, value: extractValue(transcript, action), transcript };
    }
  }
  return best && best.confidence >= threshold ? best : null;
}
