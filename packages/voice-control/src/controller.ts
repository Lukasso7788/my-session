import { discoverActions } from "./discovery";
import { resolveTranscript } from "./resolver";
import type { ManualAction, VoiceAction, VoiceControlOptions, VoiceMatch } from "./types";

export class VoiceController {
  private discovered: VoiceAction[] = [];
  private manual = new Map<string, VoiceAction>();
  private observer?: MutationObserver;
  readonly options: Required<Pick<VoiceControlOptions, "locale" | "threshold" | "observe">> & VoiceControlOptions;

  constructor(options: VoiceControlOptions = {}) {
    this.options = { locale: "en-US", threshold: .62, observe: true, ...options };
    this.refresh();
    if (this.options.observe && typeof MutationObserver !== "undefined") {
      let queued = false;
      this.observer = new MutationObserver(() => {
        if (queued) return; queued = true;
        queueMicrotask(() => { queued = false; this.refresh(); });
      });
      this.observer.observe((this.options.root || document) as Node, { subtree: true, childList: true, attributes: true });
    }
  }

  refresh() { this.discovered = discoverActions(this.options.root || document); return this.actions(); }
  actions() { return [...this.manual.values(), ...this.discovered.filter(item => !this.manual.has(item.id))]; }
  register(action: ManualAction) {
    this.manual.set(action.id, { kind: "custom", ...action, aliases: action.aliases?.length ? action.aliases : [action.label] });
    return () => this.manual.delete(action.id);
  }
  resolve(transcript: string) { this.options.onTranscript?.(transcript); return resolveTranscript(transcript, this.actions(), this.options.threshold); }
  async execute(match: VoiceMatch) {
    if (match.action.dangerous && !(await this.options.confirmation?.(match))) return false;
    const { action, value } = match;
    if (action.execute) await action.execute(value);
    else if (action.element) {
      action.element.scrollIntoView({ behavior: "smooth", block: "center" });
      action.element.focus({ preventScroll: true });
      if (action.kind === "input" && value != null) {
        const editable = action.element as HTMLInputElement;
        editable.value = value; editable.dispatchEvent(new Event("input", { bubbles: true })); editable.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (action.kind === "select" && value != null) {
        const select = action.element as HTMLSelectElement;
        const option = Array.from(select.options).find(item => item.text.toLocaleLowerCase().includes(value.toLocaleLowerCase()));
        if (option) { select.value = option.value; select.dispatchEvent(new Event("change", { bubbles: true })); }
      } else action.element.click();
    }
    this.options.onMatch?.(match); return true;
  }
  async handle(transcript: string) { const match = this.resolve(transcript); if (match) await this.execute(match); return match; }
  destroy() { this.observer?.disconnect(); this.manual.clear(); this.discovered = []; }
}
