# @mysession/voice-control

Desktop-first, framework-agnostic voice control for existing web interfaces. It discovers semantic DOM controls automatically and supports targeted overrides for custom UI.

```ts
import { VoiceController, WebSpeechAdapter } from "@mysession/voice-control";

const voice = new VoiceController({
  locale: "ru-RU",
  confirmation: ({ action }) => window.confirm(`Выполнить «${action.label}»?`),
  onMatch: ({ action, confidence }) => console.log(action.id, confidence)
});

const speech = new WebSpeechAdapter(voice);
document.querySelector("#voice")?.addEventListener("click", () => speech.start());
```

The scanner uses native controls, links, labels, placeholders, accessible names, ARIA roles and `tabindex`. Dynamic interfaces are re-indexed with `MutationObserver`.

## Zero-code annotations

```html
<div role="button" data-voice-label="Open command palette"
     data-voice-aliases="commands,quick actions">...</div>
<button data-voice-confirm>Delete workspace</button>
<div data-voice-ignore>Not voice controllable</div>
```

## Manual action

```ts
voice.register({
  id: "canvas.zoom-in",
  label: "Zoom in",
  aliases: ["increase zoom", "приблизь"],
  execute: () => canvas.zoomBy(1.2)
});
```

## Safety and realistic coverage

- Destructive/payment-like actions require `confirmation` when marked with `data-voice-confirm` or detected by their label.
- Auto-discovery works best with semantic HTML and correct ARIA. Canvas/WebGL, closed shadow roots and ambiguous duplicate labels require manual actions.
- Browser speech recognition is an adapter, not part of the command engine. A local or cloud STT provider can feed text directly to `voice.handle(text)`.
- Production integrations should display the recognized command, offer cancellation and log only consented/non-sensitive telemetry.
