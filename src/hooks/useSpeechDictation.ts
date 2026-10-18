import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDictationBuffer,
  dictationErrorMessage,
  getSpeechRecognitionConstructor,
  type SpeechRecognitionLike,
} from "../lib/speechDictation";

/**
 * Dictate into a text field. While listening, the room pauses its own voice
 * commands and mutes the room microphone (mysession:chat-dictation), so the
 * people in the room do not hear the dictation; both come back afterwards.
 */
export function useSpeechDictation(params: {
  win: Window;
  getText: () => string;
  setText: (text: string) => void;
}) {
  const { win } = params;
  const supported = !!getSpeechRecognitionConstructor(win);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const bufferRef = useRef<ReturnType<typeof createDictationBuffer> | null>(null);
  const latest = useRef(params);
  latest.current = params;

  const announce = useCallback((active: boolean) => {
    try {
      window.dispatchEvent(new Event(active ? "mysession:voice-ui-pause" : "mysession:voice-ui-resume"));
      window.dispatchEvent(new CustomEvent("mysession:chat-dictation", { detail: { active } }));
    } catch {
      // Events are best-effort.
    }
  }, []);

  /**
   * discard: the text was just sent, so words the browser finalises after
   * stopping must not refill the emptied field. A plain stop keeps them.
   */
  const stop = useCallback((options: { discard?: boolean } = {}) => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (options.discard) recognition.onresult = null;
    try {
      recognition.stop();
    } catch {
      // Already stopped.
    }
  }, []);

  const start = useCallback(() => {
    const Recognition = getSpeechRecognitionConstructor(latest.current.win);
    if (!Recognition || recognitionRef.current) return;
    setError("");

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    const nav = latest.current.win.navigator || navigator;
    recognition.lang = (nav.languages && nav.languages[0]) || nav.language || "en-US";

    const buffer = createDictationBuffer(latest.current.getText());
    bufferRef.current = buffer;
    recognition.onresult = (event) => {
      latest.current.setText(buffer.onResult(event));
    };
    recognition.onerror = (event) => {
      const message = dictationErrorMessage(event?.error);
      if (message) setError(message);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      bufferRef.current = null;
      setListening(false);
      announce(false);
    };

    try {
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
      announce(true);
    } catch {
      recognitionRef.current = null;
      setError("Dictation could not start. Try again.");
    }
  }, [announce]);

  const toggle = useCallback(() => {
    if (recognitionRef.current) stop();
    else start();
  }, [start, stop]);

  // Never leave the microphone listening after the chat closes.
  useEffect(
    () => () => {
      const recognition = recognitionRef.current;
      if (!recognition) return;
      recognitionRef.current = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        // ignore
      }
      announce(false);
    },
    [announce],
  );

  /** Call from the field's onChange: the person typed or deleted while dictating. */
  const manualEdit = useCallback((nextText: string) => {
    bufferRef.current?.manualEdit(nextText);
  }, []);

  return { supported, listening, error, start, stop, toggle, manualEdit, clearError: () => setError("") };
}
