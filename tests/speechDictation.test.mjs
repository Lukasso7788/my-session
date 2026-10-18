import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

async function importTs(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { composeDictation, readTranscripts, dictationErrorMessage, getSpeechRecognitionConstructor } = await importTs("src/lib/speechDictation.ts");

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
  assert.match(chat, /dictation\.stop\(\);/);
});
