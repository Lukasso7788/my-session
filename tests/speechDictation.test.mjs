import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

async function importTs(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { composeDictation, readTranscripts, dictationErrorMessage, getSpeechRecognitionConstructor, createDictationBuffer, punctuateDictation, looksLikeQuestion } = await importTs("src/lib/speechDictation.ts");

test("a pause ends a sentence; questions get a question mark", () => {
  assert.equal(punctuateDictation(["i'll be back in five minutes", "can you start without me"]), "i'll be back in five minutes. Can you start without me?");
  assert.equal(punctuateDictation(["я скоро вернусь", "вы начнёте без меня"]), "я скоро вернусь. Вы начнёте без меня");
  assert.equal(punctuateDictation(["где ссылка на сессию"]), "где ссылка на сессию?");
  assert.equal(punctuateDictation(["придёшь ли ты завтра"]), "придёшь ли ты завтра?");
  // The last phrase gets no full stop, so short chat messages stay natural.
  assert.equal(punctuateDictation(["ok"]), "ok");
  assert.equal(punctuateDictation(["first part"], "still talking"), "first part. Still talking");
});

test("spoken punctuation in English and Russian", () => {
  assert.equal(punctuateDictation(["hi everyone comma quick update period"]), "hi everyone, quick update.");
  assert.equal(punctuateDictation(["are you there question mark"]), "are you there?");
  assert.equal(punctuateDictation(["привет запятая как дела вопросительный знак"]), "привет, как дела?");
  assert.equal(punctuateDictation(["отлично восклицательный знак"]), "отлично!");
  assert.equal(punctuateDictation(["список двоеточие хлеб точка с запятой молоко"]), "список: хлеб; молоко");
  assert.equal(punctuateDictation(["first line new line second line"]), "first line\nSecond line");
  // A command said as its own phrase sticks to the previous word.
  assert.equal(punctuateDictation(["see you tomorrow", "точка"]), "see you tomorrow.");
});

test("question detection", () => {
  assert.equal(looksLikeQuestion("What time is it"), true);
  assert.equal(looksLikeQuestion("почему так"), true);
  assert.equal(looksLikeQuestion("I know what you mean"), false);
  assert.equal(looksLikeQuestion("я знаю"), false);
});

test("dictated punctuation after typed text", () => {
  const buffer = createDictationBuffer("Hi team");
  assert.equal(buffer.onResult({ results: [Object.assign([{ transcript: "comma back in five" }], { isFinal: true })] }), "Hi team, back in five");
  assert.equal(composeDictation("Done.", "next one", ""), "Done. Next one");
});
const res = (...parts) => ({ results: parts.map(([t, final]) => Object.assign([{ transcript: t }], { isFinal: final })) });

test("deleting text while dictating keeps it deleted; only new speech is added", () => {
  const buffer = createDictationBuffer("");
  assert.equal(buffer.onResult(res(["hello world", true])), "Hello world");
  buffer.manualEdit("");
  // The browser still reports everything said since dictation started.
  assert.equal(buffer.onResult(res(["hello world", true])), "");
  assert.equal(buffer.onResult(res(["hello world", true], ["see you", false])), "See you");
  assert.equal(buffer.onResult(res(["hello world", true], ["see you soon", true])), "See you soon");
});

test("a phrase still being recognised during the edit does not come back", () => {
  const buffer = createDictationBuffer("Note:");
  assert.equal(buffer.onResult(res(["first", true], ["wrong word", false])), "Note: first. Wrong word");
  buffer.manualEdit("Note: first");
  assert.equal(buffer.onResult(res(["first", true], ["wrong word", true])), "Note: first");
  assert.equal(buffer.onResult(res(["first", true], ["wrong word", true], ["right one", true])), "Note: first right one");
});

test("typing while dictating keeps the typed text and continues after it", () => {
  const buffer = createDictationBuffer("");
  buffer.onResult(res(["back in", true]));
  buffer.manualEdit("Back in 5");
  assert.equal(buffer.onResult(res(["back in", true], ["minutes", true])), "Back in 5 minutes");
});

test("reading results can start after the ones already in the text", () => {
  assert.deepEqual(readTranscripts(res(["a", true], ["b", true], ["c", false]), 1), { finals: ["b"], interim: "c" });
});

test("dictation fills an empty composer and capitalizes the first word", () => {
  assert.equal(composeDictation("", "hello everyone", ""), "Hello everyone");
  assert.equal(composeDictation("", "", "still talk"), "Still talk");
  assert.equal(composeDictation("", "", ""), "");
});

test("dictation appends to what was typed, with one space", () => {
  assert.equal(composeDictation("Quick note", "back in five", ""), "Quick note back in five");
  assert.equal(composeDictation("Quick note ", "back in five", ""), "Quick note back in five");
  assert.equal(composeDictation("Done.", "next task", "is"), "Done. Next task is");
});

test("final and interim results are read in order", () => {
  const event = { results: [
    Object.assign([{ transcript: "first part " }], { isFinal: true }),
    Object.assign([{ transcript: "second" }], { isFinal: true }),
    Object.assign([{ transcript: "maybe more" }], { isFinal: false }),
  ] };
  assert.deepEqual(readTranscripts(event), { finals: ["first part", "second"], interim: "maybe more" });
  assert.deepEqual(readTranscripts({}), { finals: [], interim: "" });
});

test("errors: permission and device problems are explained, silence is not an error", () => {
  assert.match(dictationErrorMessage("not-allowed"), /Allow microphone access/);
  assert.match(dictationErrorMessage("audio-capture"), /No microphone/);
  assert.equal(dictationErrorMessage("no-speech"), "");
  assert.equal(dictationErrorMessage("aborted"), "");
});

test("unsupported browsers (no SpeechRecognition) hide the mic button", () => {
  assert.equal(getSpeechRecognitionConstructor({}), null);
  const Fake = function () {};
  assert.equal(getSpeechRecognitionConstructor({ webkitSpeechRecognition: Fake }), Fake);
});

test("the room mutes its mic while chat dictation runs and pauses voice commands", () => {
  const hook = readFileSync("src/hooks/useSpeechDictation.ts", "utf8");
  assert.match(hook, /mysession:voice-ui-pause/);
  assert.match(hook, /mysession:chat-dictation/);
  const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");
  assert.match(room, /addEventListener\("mysession:chat-dictation"/);
  const chat = readFileSync("src/components/ChatPanel.tsx", "utf8");
  // Sending drops late results so the emptied field is not refilled.
  assert.match(chat, /dictation\.stop\(\{ discard: true \}\);/);
  assert.match(chat, /dictation\.manualEdit\(e\.target\.value\)/);
  assert.match(readFileSync("src/hooks/useSpeechDictation.ts", "utf8"), /if \(options\.discard\) recognition\.onresult = null;/);
});
