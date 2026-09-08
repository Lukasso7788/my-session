const MOBILE_MAX_WIDTH = 480;
const STYLE_ID = "mysession-mobile-room-control-swap";

function buttonText(button: HTMLButtonElement | null) {
  return String(button?.textContent || "").replace(/\s+/g, " ").trim();
}

function findButtons() {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));

  const screenShare = buttons.find(
    (button) =>
      button.dataset.mysessionMobileProxy !== "true" &&
      button.title === "Share screen",
  ) || null;

  const voice = buttons.find((button) => {
    if (button.dataset.mysessionMobileProxy === "true") return false;
    const title = String(button.title || "");
    return (
      title.startsWith("Voice controls off") ||
      title.startsWith("Always listening") ||
      title.startsWith("Hotkey mode")
    );
  }) || null;

  const chat = buttons.find(
    (button) =>
      button.dataset.mysessionMobileProxy !== "true" &&
      button.title === "Chat" &&
      String(button.className).includes("min-w-10"),
  ) || null;

  const tasks = buttons.find(
    (button) =>
      button.dataset.mysessionMobileProxy !== "true" &&
      button.title === "Tasks" &&
      String(button.className).includes("min-w-10"),
  ) || null;

  const more = buttons.find(
    (button) =>
      button.dataset.mysessionMobileProxy !== "true" &&
      button.title === "Menu",
  ) || null;

  return { screenShare, voice, chat, tasks, more };
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @media (max-width: ${MOBILE_MAX_WIDTH}px) {
      button[data-mysession-mobile-replaced="true"] {
        display: none !important;
      }

      button[data-mysession-mobile-proxy="true"] {
        display: flex !important;
      }
    }

    @media (min-width: ${MOBILE_MAX_WIDTH + 1}px) {
      button[data-mysession-mobile-proxy="true"],
      button[data-mysession-mobile-menu-extra="true"] {
        display: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function makeProxyButton(
  source: HTMLButtonElement,
  target: HTMLButtonElement,
  key: "chat" | "tasks",
) {
  const proxy = source.cloneNode(true) as HTMLButtonElement;
  proxy.dataset.mysessionMobileProxy = "true";
  proxy.dataset.mysessionMobileProxyKind = key;
  proxy.removeAttribute("id");
  proxy.removeAttribute("aria-pressed");
  proxy.disabled = false;
  proxy.classList.remove("hidden");
  proxy.classList.add("w-10", "px-0");
  proxy.title = key === "chat" ? "Chat" : "Tasks";
  proxy.setAttribute("aria-label", proxy.title);

  proxy.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    target.click();
  });

  return proxy;
}

function ensureMainButtonSwap() {
  const { screenShare, voice, chat, tasks } = findButtons();
  if (!screenShare || !voice || !chat || !tasks) return;

  screenShare.dataset.mysessionMobileReplaced = "true";
  voice.dataset.mysessionMobileReplaced = "true";

  let tasksProxy = document.querySelector<HTMLButtonElement>(
    'button[data-mysession-mobile-proxy-kind="tasks"]',
  );
  if (!tasksProxy || !tasksProxy.isConnected) {
    tasksProxy = makeProxyButton(tasks, tasks, "tasks");
    screenShare.parentNode?.insertBefore(tasksProxy, screenShare);
  }

  let chatProxy = document.querySelector<HTMLButtonElement>(
    'button[data-mysession-mobile-proxy-kind="chat"]',
  );
  if (!chatProxy || !chatProxy.isConnected) {
    chatProxy = makeProxyButton(chat, chat, "chat");
    voice.parentNode?.insertBefore(chatProxy, voice);
  }
}

function menuItemTemplate(more: HTMLButtonElement) {
  const parent = more.parentElement;
  if (!parent) return null;

  const buttons = Array.from(parent.querySelectorAll<HTMLButtonElement>("button"));
  return (
    buttons.find((button) => buttonText(button) === "Settings") ||
    buttons.find((button) => buttonText(button) === "Participants") ||
    null
  );
}

function makeMenuItem(
  template: HTMLButtonElement,
  label: string,
  target: HTMLButtonElement,
  more: HTMLButtonElement,
  key: "screen" | "voice",
) {
  const item = template.cloneNode(false) as HTMLButtonElement;
  item.dataset.mysessionMobileMenuExtra = "true";
  item.dataset.mysessionMobileMenuKind = key;
  item.type = "button";
  item.disabled = false;
  item.removeAttribute("aria-pressed");
  item.textContent = label;

  item.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    target.click();
    more.click();
  });

  return item;
}

function ensureMoreMenuItems() {
  const { screenShare, voice, more } = findButtons();
  if (!screenShare || !voice || !more) return;

  const template = menuItemTemplate(more);
  if (!template) return;
  const menu = template.parentElement;
  if (!menu) return;

  let screenItem = menu.querySelector<HTMLButtonElement>(
    'button[data-mysession-mobile-menu-kind="screen"]',
  );
  if (!screenItem) {
    screenItem = makeMenuItem(template, "Screen share", screenShare, more, "screen");
    template.insertAdjacentElement("beforebegin", screenItem);
  }

  let voiceItem = menu.querySelector<HTMLButtonElement>(
    'button[data-mysession-mobile-menu-kind="voice"]',
  );
  if (!voiceItem) {
    voiceItem = makeMenuItem(template, "Voice controls", voice, more, "voice");
    screenItem.insertAdjacentElement("afterend", voiceItem);
  }
}

function removeMobileOnlyNodes() {
  document
    .querySelectorAll<HTMLElement>(
      '[data-mysession-mobile-proxy="true"], [data-mysession-mobile-menu-extra="true"]',
    )
    .forEach((node) => node.remove());
}

export function installMobileRoomControls() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  ensureStyle();

  const media = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
  let frame = 0;

  const sync = () => {
    frame = 0;
    if (!media.matches) {
      removeMobileOnlyNodes();
      return;
    }

    ensureMainButtonSwap();
    ensureMoreMenuItems();
  };

  const scheduleSync = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(sync);
  };

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  const onMediaChange = () => scheduleSync();
  try {
    media.addEventListener("change", onMediaChange);
  } catch {
    // @ts-ignore - Safari < 14 fallback
    media.addListener(onMediaChange);
  }

  scheduleSync();
}
