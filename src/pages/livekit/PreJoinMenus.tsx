import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import "./prejoin-menus.css";

type Option = { value: string; label: string };

/** Presentation only: the parent still owns the selected device and media handlers. */
export function PreJoinDeviceSelect({ id, label, value, options, theme, onChange }: {
  id: string;
  label: string;
  value: string;
  options: Option[];
  theme: "light" | "dark";
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 240 });
  const searchRef = useRef({ text: "", time: 0 });
  const selected = Math.max(0, options.findIndex((option) => option.value === value));
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  useEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dialog = triggerRef.current?.closest('[role="dialog"]');
      const topLimit = Math.max(10, (dialog?.querySelector('[data-prejoin-header]')?.getBoundingClientRect().bottom || 0) + 6);
      const bottomLimit = Math.min(window.innerHeight - 10, (dialog?.querySelector('[data-prejoin-footer]')?.getBoundingClientRect().top || window.innerHeight) - 6);
      const below = bottomLimit - rect.bottom - 6;
      const above = rect.top - topLimit - 6;
      const height = Math.min(240, Math.max(below, above), options.length * 40 + 10);
      setPosition({ left: rect.left, width: rect.width, top: below >= height ? rect.bottom + 6 : rect.top - height - 6, maxHeight: height });
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const scroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    positionMenu();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", positionMenu);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", positionMenu);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  return <>
    <button
      ref={triggerRef} id={id} type="button" role="combobox" aria-label={label}
      aria-expanded={open} aria-haspopup="listbox" aria-controls={listId}
      aria-activedescendant={open && options.length ? `${listId}-${activeIndex}` : undefined}
      className="ms-prejoin-select" data-theme={theme}
      onBlur={() => setOpen(false)}
      onClick={() => { setActive(selected); setOpen(!open); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault(); event.stopPropagation(); setOpen(false); return;
        }
        if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
          event.preventDefault();
          if (!open) { setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : selected); setOpen(true); return; }
          if (event.key === "Enter" || event.key === " ") { choose(activeIndex); return; }
          setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % Math.max(1, options.length));
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const now = Date.now();
          const text = (now - searchRef.current.time < 650 ? searchRef.current.text : "") + event.key.toLowerCase();
          searchRef.current = { text, time: now };
          const index = options.findIndex((option) => option.label.toLowerCase().startsWith(text));
          if (index >= 0) { setActive(index); setOpen(true); }
        }
      }}
    >
      <span className="min-w-0 flex-1 truncate text-left">{options[selected]?.label || "Default"}</span>
      <ChevronDown size={16} aria-hidden="true" className="ms-prejoin-chevron" data-open={open} />
    </button>
    {typeof document !== "undefined" ? createPortal(
      <div ref={menuRef} id={listId} role="listbox" aria-label={label} aria-hidden={!open}
        className="ms-prejoin-device-menu custom-scrollbar" data-theme={theme} data-open={open}
        style={{ ...position, zIndex: 2147483647 }} onPointerDown={(event) => event.preventDefault()}>
        {options.map((option, index) => <div key={`${option.value}-${index}`} id={`${listId}-${index}`}
          role="option" aria-selected={option.value === value} data-option-index={index}
          data-active={index === activeIndex} className="ms-prejoin-device-option"
          onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
          <span className="min-w-0 flex-1 break-words">{option.label}</span>
          {option.value === value ? <Check size={15} className="shrink-0" aria-hidden="true" /> : null}
        </div>)}
      </div>, triggerRef.current?.closest('[role="dialog"]') || document.body,
    ) : null}
  </>;
}

export function PreJoinDisclosure({ open, children, id }: { open: boolean; children: ReactNode; id?: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Keep closing content mounted for its transition but out of keyboard navigation.
    contentRef.current?.toggleAttribute("inert", !open);
  }, [open]);
  return <div id={id} className="ms-prejoin-disclosure" data-open={open} aria-hidden={!open}>
    <div ref={contentRef} className="ms-prejoin-disclosure-content">{children}</div>
  </div>;
}
