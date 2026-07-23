import test from "node:test";
import assert from "node:assert/strict";
import { resolveTranscript } from "../dist/resolver.js";

const actions = [
  { id: "settings", kind: "activate", label: "settings", aliases: ["settings", "настройки"] },
  { id: "search", kind: "input", label: "поиск", aliases: ["поиск", "search"] },
  { id: "delete", kind: "activate", label: "delete account", aliases: ["delete account"], dangerous: true }
];

test("matches direct and verb-prefixed commands", () => {
  assert.equal(resolveTranscript("open settings", actions)?.action.id, "settings");
  assert.equal(resolveTranscript("открой настройки", actions)?.action.id, "settings");
});

test("extracts input value", () => {
  const match = resolveTranscript("введи квартальный отчет в поиск", actions);
  assert.equal(match?.action.id, "search");
  assert.equal(match?.value, "квартальный отчет");
});

test("does not execute unrelated speech", () => {
  assert.equal(resolveTranscript("какая сегодня погода", actions), null);
});
