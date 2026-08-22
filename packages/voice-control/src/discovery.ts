import type { VoiceAction } from "./types";

const INTERACTIVE = [
  "button", "a[href]", "input:not([type=hidden])", "textarea", "select", "summary",
  "[role=button]", "[role=link]", "[role=menuitem]", "[role=checkbox]", "[role=radio]",
  "[role=switch]", "[role=tab]", "[contenteditable=true]", "[tabindex]:not([tabindex='-1'])",
  "[data-voice-label]"
].join(",");

const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function visible(element: HTMLElement) {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}

function labelOf(element: HTMLElement) {
  const input = element as HTMLInputElement;
  const labelledBy = element.getAttribute("aria-labelledby");
  const labelled = labelledBy?.split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ");
  const nativeLabel = input.labels ? Array.from(input.labels).map(label => label.textContent || "").join(" ") : "";
  return [
    element.dataset.voiceLabel, element.getAttribute("aria-label"), labelled, nativeLabel,
    input.placeholder, element.getAttribute("title"), element.textContent, input.name, element.id
  ].map(value => normalize(value || "")).find(Boolean) || "";
}

function aliasesOf(element: HTMLElement, label: string) {
  const configured = (element.dataset.voiceAliases || "").split(",").map(normalize).filter(Boolean);
  return Array.from(new Set([label, ...configured]));
}

function kindOf(element: HTMLElement): VoiceAction["kind"] {
  if (element.matches("input:not([type=button]):not([type=submit]), textarea, [contenteditable=true]")) return "input";
  if (element.matches("select")) return "select";
  return "activate";
}

export function discoverActions(root: ParentNode = document): VoiceAction[] {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(INTERACTIVE));
  const seen = new Set<HTMLElement>();
  return elements.flatMap((element, index) => {
    if (seen.has(element) || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true" ||
        element.closest("[data-voice-ignore]") != null || element.closest("[aria-hidden='true'], [inert]") != null || !visible(element)) return [];
    seen.add(element);
    const label = labelOf(element);
    if (!label) return [];
    return [{
      id: element.dataset.voiceId || element.id || `auto-${index}`,
      kind: kindOf(element), label, aliases: aliasesOf(element, label), element,
      description: element.dataset.voiceDescription,
      dangerous: element.dataset.voiceConfirm != null || /delete|remove|pay|purchase|удал|оплат|купить/i.test(label)
    } satisfies VoiceAction];
  });
}
