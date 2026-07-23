export type VoiceActionKind = "activate" | "focus" | "input" | "select" | "scroll" | "custom";

export interface VoiceAction {
  id: string;
  kind: VoiceActionKind;
  label: string;
  aliases: string[];
  description?: string;
  element?: HTMLElement;
  dangerous?: boolean;
  execute?: (value?: string) => void | Promise<void>;
}

export interface VoiceMatch {
  action: VoiceAction;
  confidence: number;
  value?: string;
  transcript: string;
}

export interface VoiceControlOptions {
  locale?: string;
  root?: ParentNode;
  threshold?: number;
  observe?: boolean;
  confirmation?: (match: VoiceMatch) => boolean | Promise<boolean>;
  onTranscript?: (text: string) => void;
  onMatch?: (match: VoiceMatch) => void;
  onError?: (error: Error) => void;
}

export interface ManualAction extends Omit<VoiceAction, "aliases" | "kind"> {
  kind?: VoiceActionKind;
  aliases?: string[];
}
