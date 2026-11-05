import { useEffect, useId, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";
import { LOCATION_NAME_MAX_LENGTH, searchPlaces, type PlaceSuggestion } from "../lib/placeSearch";

type Props = {
  value: string;
  onChange: (location: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
};

// Optional "where I am" field. Whatever is typed is kept as is; suggestions
// (any city, town or village) only help fill in the full name.
export default function LocationPicker({ value, onChange, disabled = false, id, className = "" }: Props) {
  const generatedId = useId();
  const inputId = id || `location-${generatedId}`;
  const listId = `${inputId}-options`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const clean = query.trim();
    if (!open || clean.length < 2) {
      setResults([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchPlaces(clean, controller.signal)
        .then((places) => {
          setResults(places);
          setFailed(false);
          setActiveIndex(-1);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.warn("[location] search failed:", error);
          setResults([]);
          setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  const select = (place: PlaceSuggestion) => {
    onChange(place.label);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const showList = open && !disabled && query.trim().length >= 2;

  return (
    <div
      ref={rootRef}
      className={`relative ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/45" aria-hidden="true" />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          value={value}
          maxLength={LOCATION_NAME_MAX_LENGTH}
          placeholder="Any city, town or village"
          autoComplete="off"
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value);
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (showList) {
                setOpen(false);
                event.preventDefault();
                event.stopPropagation();
              }
            } else if (event.key === "ArrowDown" && results.length) {
              setOpen(true);
              setActiveIndex((index) => Math.min(index + 1, results.length - 1));
              event.preventDefault();
            } else if (event.key === "ArrowUp" && results.length) {
              setActiveIndex((index) => Math.max(0, index - 1));
              event.preventDefault();
            } else if (event.key === "Enter" && showList && results[activeIndex]) {
              select(results[activeIndex]);
              event.preventDefault();
            }
          }}
          disabled={disabled}
          className="h-12 w-full rounded-2xl border border-black/10 bg-[#F6F6F6] py-2 pl-10 pr-10 text-[14px] font-medium outline-none transition placeholder:font-normal placeholder:text-black/40 focus:border-[#5286F6] focus:ring-2 focus:ring-[#5286F6]/20 disabled:opacity-55"
        />
        {value && !disabled ? (
          <button
            type="button"
            aria-label="Remove location"
            title="Remove location"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange("");
              setQuery("");
              setResults([]);
            }}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-black/45 transition hover:bg-black/5 hover:text-black/75"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {showList ? (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-[10100] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
          <div id={listId} role="listbox" aria-label="Places" className="max-h-64 overflow-y-auto py-1">
            {results.map((place, index) => (
              <div
                key={place.label}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={place.label === value}
                className={`cursor-pointer px-4 py-2 ${index === activeIndex ? "bg-[#EFF4FF]" : "hover:bg-[#F5F7FB]"}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(place)}
              >
                <div className="truncate text-[13px] font-semibold leading-5 text-[#2F2F2F]">{place.name}</div>
                {place.context ? (
                  <div className="truncate text-[12px] leading-4 text-black/50">{place.context}</div>
                ) : null}
              </div>
            ))}
            {!results.length ? (
              <p className="px-4 py-3 text-[13px] text-black/55">
                {loading
                  ? "Looking for places…"
                  : failed
                    ? "Place search is unavailable right now. What you typed will be saved as is."
                    : "No matching place. What you typed will be saved as is."}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
