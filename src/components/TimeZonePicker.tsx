import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { getBrowserTimeZone } from "../lib/timezones";
import {
  buildTimeZoneOptions,
  searchTimeZones,
  type TimeZoneRecord,
} from "../lib/timezoneSearch";

type Props = {
  value: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  className?: string;
};

export default function TimeZonePicker({
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  id,
  className = "",
}: Props) {
  const generatedId = useId();
  const inputId = id || `timezone-${generatedId}`;
  const listId = `${inputId}-options`;
  const rootRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef<Promise<void> | null>(null);
  const [records, setRecords] = useState<TimeZoneRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  const locale = typeof navigator === "undefined" ? "en" : navigator.language;
  const options = useMemo(
    () => buildTimeZoneOptions(records, value, locale),
    [records, value, locale],
  );
  const matches = useMemo(
    () => searchTimeZones(options, query, value),
    [options, query, value],
  );
  const deviceZone = getBrowserTimeZone();

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  const loadCatalog = () => {
    if (loadRef.current) return;
    setLoading(true);
    loadRef.current = import("@vvo/tzdb")
      .then(({ rawTimeZones }) => setRecords(rawTimeZones))
      .catch(() => {
        // IANA identifiers from Intl remain searchable if the catalog fails.
      })
      .finally(() => setLoading(false));
  };

  const select = (zone: string) => {
    onChange(zone);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  };

  return (
    <div
      ref={rootRef}
      className={`relative ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/45" aria-hidden="true" />
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-label="Search timezones by city, country, or region"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          value={open ? query : value}
          placeholder={open ? "Search city, country or timezone…" : "Choose a timezone"}
          onFocus={() => {
            setQuery("");
            setActiveIndex(0);
            setOpen(true);
            loadCatalog();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              event.preventDefault();
            } else if (event.key === "ArrowDown") {
              if (!open) setOpen(true);
              setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
              event.preventDefault();
            } else if (event.key === "ArrowUp") {
              setActiveIndex((index) => Math.max(0, index - 1));
              event.preventDefault();
            } else if (event.key === "Enter" && open && matches[activeIndex]) {
              select(matches[activeIndex].value);
              event.preventDefault();
            }
          }}
          disabled={disabled}
          autoFocus={autoFocus}
          className="h-12 w-full rounded-2xl border border-black/10 bg-[#F6F6F6] py-2 pl-10 pr-4 text-[14px] font-medium outline-none transition placeholder:text-black/40 focus:border-[#5286F6] focus:ring-2 focus:ring-[#5286F6]/20 disabled:opacity-55"
        />
      </div>
      {open && !disabled ? (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-[10100] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
          {deviceZone ? (
            <button
              type="button"
              className="w-full border-b border-black/10 px-4 py-3 text-left text-[13px] font-semibold text-[#315DCB] hover:bg-[#EFF4FF] focus:bg-[#EFF4FF] focus:outline-none"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(deviceZone)}
            >
              Use my device timezone · {deviceZone.replace(/_/g, " ")}
            </button>
          ) : null}
          <div id={listId} role="listbox" aria-label="Timezones" className="max-h-60 overflow-y-auto py-1">
            {matches.length ? matches.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                className={`cursor-pointer px-4 py-2 text-[13px] leading-5 ${index === activeIndex ? "bg-[#EFF4FF] text-[#214BAE]" : "text-[#2F2F2F] hover:bg-[#F5F7FB]"}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(option.value)}
              >
                {option.label}
              </div>
            )) : (
              <p className="px-4 py-3 text-[13px] text-black/55">
                {loading ? "Loading places…" : "No matching timezone. Try a nearby city or country."}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
