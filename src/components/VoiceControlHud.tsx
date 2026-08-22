import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Keyboard, Mic, MicOff, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { VoiceController, WebSpeechAdapter } from "../../packages/voice-control/src";
import type { ManualAction, VoiceAction } from "../../packages/voice-control/src";
import "./VoiceControlHud.css";

type Mode = "off" | "always" | "hotkey";
type Locale = "en-US" | "ru-RU";

const MODE_KEY = "room_voice_ui_mode_v1";
const HOTKEY_KEY = "room_voice_ui_hotkey_v1";
const LOCALE_KEY = "mysession_voice_locale_v1";
const DEFAULT_HOTKEY = "Alt+V";

const routes: Array<ManualAction & { path: string }> = [
  { id: "route-home", path: "/", label: "Home", aliases: ["home", "go home", "главная", "на главную"] },
  { id: "route-sessions", path: "/sessions", label: "Sessions", aliases: ["sessions", "open sessions", "focus rooms", "сессии", "комнаты"] },
  { id: "route-tasks", path: "/tasks", label: "Tasks", aliases: ["tasks", "open tasks", "focus plan", "задачи", "таски"] },
  { id: "route-profile", path: "/profile", label: "Profile", aliases: ["profile", "open profile", "профиль"] },
  { id: "route-settings", path: "/settings", label: "Settings", aliases: ["settings", "open settings", "настройки"] },
  { id: "route-pricing", path: "/pricing", label: "Pricing", aliases: ["pricing", "plans", "цены", "тарифы"] },
  { id: "route-one-on-one", path: "/sessions?tab=one-on-one", label: "One on one", aliases: ["one on one", "one to one", "matching", "один на один"] },
  { id: "route-login", path: "/login", label: "Log in", aliases: ["login", "log in", "sign in", "войти"] },
  { id: "route-register", path: "/register", label: "Sign up", aliases: ["register", "sign up", "create account", "регистрация"] },
];

function hintsFor(path: string) {
  if (path.startsWith("/sessions")) return ["Open group sessions", "Open 24/7 Focus Hub", "Open one on one", "Open tasks", "Create a session"];
  if (path.startsWith("/tasks")) return ["Add a task", "Open unfinished tasks", "Create a category", "Go to sessions"];
  if (path.startsWith("/profile")) return ["Open settings", "Edit profile", "Go to sessions"];
  if (path.startsWith("/pricing")) return ["Choose Pro", "View plans", "Go to sessions"];
  if (path.startsWith("/login") || path.startsWith("/register")) return ["Continue with Google", "Continue with Discord", "Continue with Facebook"];
  return ["Open sessions", "Open tasks", "Open profile", "Scroll down"];
}

function spokenCommand(action: VoiceAction) {
  if (action.kind === "input") return "Type [text] in " + action.label;
  if (action.kind === "select") return "Select [option] in " + action.label;
  if (action.kind === "activate") return "Click " + action.label;
  return action.label;
}

const ORDINAL_WORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

function ordinalNumber(value: number) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return value + "th";
  if (value % 10 === 1) return value + "st";
  if (value % 10 === 2) return value + "nd";
  if (value % 10 === 3) return value + "rd";
  return value + "th";
}

function sessionPositionAliases(verb: "join" | "edit", index: number) {
  const position = index + 1;
  return [
    verb + " " + (ORDINAL_WORDS[index] || ordinalNumber(position)) + " session",
    verb + " " + ordinalNumber(position) + " session",
    verb + " session " + position,
  ];
}
function matchesHotkey(event: KeyboardEvent, hotkey: string) {
  const parts = hotkey.toLowerCase().split("+").map(part => part.trim());
  const key = parts.at(-1) || "v";
  return event.key.toLowerCase() === key &&
    event.altKey === parts.includes("alt") &&
    event.ctrlKey === parts.includes("ctrl") &&
    event.shiftKey === parts.includes("shift") &&
    event.metaKey === (parts.includes("meta") || parts.includes("cmd"));
}

export default function VoiceControlHud() {
  const location = useLocation();
  const navigate = useNavigate();
  const speechRef = useRef<WebSpeechAdapter | null>(null);
  const hotkeyTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) as Mode) || "off");
  const [locale, setLocale] = useState<Locale>(() => (localStorage.getItem(LOCALE_KEY) as Locale) || "en-US");
  const [hotkey, setHotkey] = useState(() => localStorage.getItem(HOTKEY_KEY) || DEFAULT_HOTKEY);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Voice controls ready");
  const [actions, setActions] = useState<VoiceAction[]>([]);
  const actionCount = actions.length;
  const hints = useMemo(() => hintsFor(location.pathname), [location.pathname]);
  const isRoom = location.pathname.startsWith("/room");

  const stopListening = useCallback(() => {
    speechRef.current?.stop();
    setListening(false);
  }, []);

  useEffect(() => {
    if (isRoom) return;
    const controller = new VoiceController({
      locale, threshold: .58, root: document,
      confirmation: ({ action }) => window.confirm(`Confirm “${action.label}”?`),
      onTranscript: text => setStatus(`Heard: ${text}`),
      onMatch: ({ action }) => setStatus(`Done: ${action.label}`),
      onNoMatch: text => setStatus(`No matching control for “${text}”`),
      onError: error => { if (!/aborted|no-speech/i.test(error.message)) setStatus(`Voice error: ${error.message}`); },
    });
    routes.forEach(action => controller.register({ ...action, execute: () => navigate(action.path) }));
    controller.register({ id: "browser-back", label: "Go back", aliases: ["go back", "back", "назад"], execute: () => navigate(-1) });
    controller.register({ id: "scroll-down", label: "Scroll down", aliases: ["scroll down", "page down", "вниз"], execute: () => window.scrollBy({ top: innerHeight * .75, behavior: "smooth" }) });
    controller.register({ id: "scroll-up", label: "Scroll up", aliases: ["scroll up", "page up", "вверх"], execute: () => window.scrollBy({ top: -innerHeight * .75, behavior: "smooth" }) });
    controller.register({ id: "scroll-top", label: "Scroll to top", aliases: ["scroll to top", "top of page", "в начало"], execute: () => window.scrollTo({ top: 0, behavior: "smooth" }) });
    controller.register({ id: "scroll-bottom", label: "Scroll to bottom", aliases: ["scroll to bottom", "bottom of page", "в конец"], execute: () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }) });

    const dynamicUnregisters = new Map<string, () => void>();
    const refreshSessionActions = () => {
      dynamicUnregisters.forEach(unregister => unregister());
      dynamicUnregisters.clear();
      const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-voice-session-card]"));
      cards.forEach((card, index) => {
        const sessionId = card.dataset.voiceSessionId || String(index);
        const sessionName = String(card.dataset.voiceSessionName || "Session").trim();
        const findCard = () => Array.from(document.querySelectorAll<HTMLElement>("[data-voice-session-card]"))
          .find(candidate => candidate.dataset.voiceSessionId === sessionId);

        const joinId = "session-join-" + sessionId;
        dynamicUnregisters.set(joinId, controller.register({
          id: joinId,
          label: "Join " + sessionName,
          aliases: ["join " + sessionName, "open " + sessionName, ...sessionPositionAliases("join", index)],
          execute: () => findCard()?.querySelector<HTMLButtonElement>("[data-voice-session-action='join']")?.click(),
        }));

        if (card.dataset.voiceSessionEditable === "true") {
          const editId = "session-edit-" + sessionId;
          dynamicUnregisters.set(editId, controller.register({
            id: editId,
            label: "Edit " + sessionName,
            aliases: ["edit " + sessionName, "change " + sessionName, ...sessionPositionAliases("edit", index)],
            execute: () => {
              const currentCard = findCard();
              if (!currentCard) return;
              const clickEdit = () => {
                const editButton = Array.from(currentCard.querySelectorAll<HTMLButtonElement>("button"))
                  .find(button => /^edit/i.test(String(button.textContent || "").trim()));
                editButton?.click();
                return Boolean(editButton);
              };
              if (clickEdit()) return;
              currentCard.querySelector<HTMLButtonElement>("[data-voice-session-action='options']")?.click();
              window.setTimeout(clickEdit, 100);
            },
          }));
        }
      });
    };

    refreshSessionActions();
    const speech = new WebSpeechAdapter(controller);
    speechRef.current = speech;
    setActions(controller.actions());
    const timer = window.setInterval(() => {
      refreshSessionActions();
      setActions(controller.actions());
    }, 2000);
    return () => { window.clearInterval(timer); dynamicUnregisters.forEach(unregister => unregister()); speech.destroy(); controller.destroy(); speechRef.current = null; };
  }, [isRoom, locale, navigate, location.pathname]);

  const startListening = useCallback((continuous: boolean) => {
    if (!speechRef.current?.supported()) { setStatus("Voice recognition is not supported in this browser"); return; }
    try {
      speechRef.current.start({ continuous });
      setListening(true);
      setStatus(continuous ? "Listening continuously…" : "Listening while hotkey is active…");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not start voice recognition");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
    if (isRoom || mode !== "always") { stopListening(); return; }
    startListening(true);
    return stopListening;
  }, [isRoom, mode, startListening, stopListening]);

  useEffect(() => {
    if (isRoom || mode !== "hotkey") return;
    const down = (event: KeyboardEvent) => {
      if (event.repeat || !matchesHotkey(event, hotkey)) return;
      if ((event.target as HTMLElement | null)?.matches("input,textarea,[contenteditable=true]")) return;
      event.preventDefault();
      if (hotkeyTimerRef.current) window.clearTimeout(hotkeyTimerRef.current);
      startListening(false);
    };
    const up = (event: KeyboardEvent) => {
      if (!matchesHotkey(event, hotkey)) return;
      event.preventDefault();
      hotkeyTimerRef.current = window.setTimeout(stopListening, 3200);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      if (hotkeyTimerRef.current) window.clearTimeout(hotkeyTimerRef.current);
    };
  }, [hotkey, isRoom, mode, startListening, stopListening]);

  const selectMode = (next: Mode) => {
    setMode(next);
    setStatus(next === "off" ? "Voice controls off" : next === "always" ? "Always-listening mode" : `Hold ${hotkey} to speak`);
  };
  const updateLocale = (next: Locale) => { localStorage.setItem(LOCALE_KEY, next); setLocale(next); };
  if (isRoom) return null;

  return <div className={`vc-hud vc-hud--${mode} ${listening ? "is-listening" : ""}`} data-voice-ignore>
    {open && <section className="vc-hud__panel" aria-label="Voice control settings">
      <header><div><strong>Voice controls</strong><span>{actionCount} controls available here</span></div><button type="button" onClick={() => setOpen(false)} aria-label="Close voice controls"><X size={16}/></button></header>
      <div className="vc-hud__modes">
        <button type="button" className={mode === "always" ? "active" : ""} onClick={() => selectMode("always")}><Mic size={17}/><span><b>Always</b><small>Continuous listening</small></span></button>
        <button type="button" className={mode === "hotkey" ? "active" : ""} onClick={() => selectMode("hotkey")}><Keyboard size={17}/><span><b>Hotkey</b><small>{hotkey}</small></span></button>
        <button type="button" className={mode === "off" ? "active" : ""} onClick={() => selectMode("off")}><MicOff size={17}/><span><b>Off</b><small>No listening</small></span></button>
      </div>
      <div className="vc-hud__preferences">
        <label>Language<select value={locale} onChange={event => updateLocale(event.target.value as Locale)}><option value="en-US">English</option><option value="ru-RU">Русский</option></select></label>
        <label>Hotkey<input value={hotkey} onChange={event => { setHotkey(event.target.value); localStorage.setItem(HOTKEY_KEY, event.target.value); }}/></label>
      </div>
      <div className="vc-hud__hints"><b>Recommended on this page</b>{hints.map(hint => <span key={hint}>“{hint}”</span>)}</div>
      <div className="vc-hud__catalog">
        <div className="vc-hud__catalog-title"><b>All available commands</b><span>{actionCount}</span></div>
        <div className="vc-hud__command-list">
          {actions.map(action => (
            <div className="vc-hud__command" key={action.id}>
              <b>{spokenCommand(action)}</b>
              {action.aliases.length > 1 && <small>{action.aliases.join(" · ")}</small>}
            </div>
          ))}
        </div>
      </div>
      <p className="vc-hud__status">{status}</p>
    </section>}
    <button type="button" className="vc-hud__launcher" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label="Open voice controls">
      <span className="vc-hud__icon">{mode === "off" ? <MicOff size={18}/> : mode === "hotkey" ? <Keyboard size={18}/> : <Mic size={18}/>}</span>
      <span><b>{mode === "off" ? "Voice off" : listening ? "Listening…" : mode === "hotkey" ? hotkey : "Voice on"}</b><small>{mode === "off" ? "Click to configure" : status}</small></span>
      <ChevronDown size={15} className={open ? "rotate" : ""}/>
    </button>
  </div>;
}
