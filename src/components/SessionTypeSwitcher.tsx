import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./SessionTypeSwitcher.css";

const GAP_PX = 8;
const BUTTON_HEIGHT_PX = 48;

const tabs = [
  {
    id: "group",
    label: "Group sessions",
    iconActive: "/icons/group-active.svg",
    iconInactive: "/icons/group-inactive.svg",
  },
  {
    id: "infinite",
    label: "24/7 sessions",
    iconActive: "/icons/infinite-active.svg",
    iconInactive: "/icons/infinite-inactive.svg",
  },
  {
    id: "one-on-one",
    label: "1-on-1",
    iconActive: "/icons/one-on-one-active.svg",
    iconInactive: "/icons/one-on-one-inactive.svg",
  },
] as const;

type TabId = (typeof tabs)[number]["id"];

type Props = {
  value: TabId;
  onChange: (next: TabId) => void;
  liveCounts?: Partial<Record<"group" | "infinite", number>>;
  /** Blur the live head count (signed-out visitors). */
  blurLiveCounts?: boolean;
  className?: string;
  sectionLinks?: { id: TabId; href: string; label: string }[];
  compact?: boolean;
};

export function SessionTypeSwitcher({ value, onChange, liveCounts, blurLiveCounts = false, className = "", sectionLinks, compact = false }: Props) {
  const isSectionSwitcher = Boolean(sectionLinks);
  const visibleTabs = sectionLinks
    ? sectionLinks.map((link) => ({ ...tabs.find((tab) => tab.id === link.id)!, ...link }))
    : tabs.map((tab) => ({ ...tab, href: undefined }));
  // ✅ NEW: measure real button geometry instead of calc() in translateX
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<Record<TabId, HTMLButtonElement | HTMLAnchorElement | null>>({
    group: null,
    infinite: null,
    "one-on-one": null,
  });

  const [slider, setSlider] = useState<{ left: number; width: number } | null>(null);

  const updateSlider = useCallback(() => {
    if (isSectionSwitcher) return;
    const root = rootRef.current;
    const btn = btnRefs.current[value];
    if (!root || !btn) return;

    setSlider({
      left: btn.offsetLeft,
      width: btn.offsetWidth,
    });
  }, [value, isSectionSwitcher]);

  useLayoutEffect(() => {
    updateSlider();
  }, [updateSlider, compact]);

  useEffect(() => {
    if (isSectionSwitcher) return;
    const root = rootRef.current;
    if (!root) return;

    const ro = new ResizeObserver(() => updateSlider());
    ro.observe(root);
    Object.values(btnRefs.current).forEach((el) => el && ro.observe(el));

    return () => ro.disconnect();
  }, [updateSlider, isSectionSwitcher]);

  return (
    <div
      ref={rootRef}
      data-compact={compact}
      className={[
        "relative bg-white border border-borderGray rounded-full",
        sectionLinks ? "session-section-switcher" : [
          compact ? "px-1 py-1" : "px-3 py-2",
          "flex items-center",
          compact ? "h-11" : "h-[72px]",
          compact ? "w-fit max-w-full" : "w-full md:w-fit",
        ].join(" "),
        sectionLinks ? "overflow-visible" : "overflow-hidden",
        className,
      ].join(" ")}
      style={sectionLinks ? {
        "--section-count": visibleTabs.length,
        "--active-section": Math.max(0, visibleTabs.findIndex((tab) => tab.id === value)),
      } as React.CSSProperties : { gap: `${compact ? 2 : GAP_PX}px` }}
    >
      {sectionLinks ? (
        <div className="session-section-switcher__track" aria-hidden="true">
          <div className="session-section-switcher__indicator bg-brandBlack rounded-full" />
        </div>
      ) : <div
        className={`absolute ${compact ? "top-1/2 -translate-y-1/2" : "top-3 bottom-3"} bg-brandBlack rounded-full duration-300 ease-in-out`}
        style={{
          left: slider?.left ?? 0,
          width: slider?.width ?? 0,
          height: compact ? 32 : BUTTON_HEIGHT_PX,
          transitionProperty: "left, width",
          willChange: "left, width",
        }}
      />}

      {visibleTabs.map((t) => {
        const isActive = value === t.id;
        const Element = t.href ? "a" : "button";
        const liveCount = t.id === "one-on-one" ? 0 : Math.max(0, Math.trunc(Number(liveCounts?.[t.id]) || 0));

        return (
          <Element
            key={t.id}
            ref={(el: HTMLButtonElement | HTMLAnchorElement | null) => {
              btnRefs.current[t.id] = el;
            }}
            href={t.href}
            onClick={(event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
              if (t.href) {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
              }
              onChange(t.id);
            }}
            aria-label={liveCount > 0 && !blurLiveCounts ? `${t.label}, ${liveCount} people live` : t.label}
            aria-current={t.href && isActive ? "location" : undefined}
            className={[
              "relative z-10",
              "flex items-center justify-center",
              "rounded-full",
              sectionLinks ? "session-section-switcher__button" : [
                compact ? "gap-1.5" : "gap-2",
                compact ? "text-[12px] font-normal" : "text-[16px] font-normal",
                "transition-colors duration-200 ease-in-out",
                compact ? "h-8" : "h-12",
                "min-w-0 flex-1",
                compact ? "md:flex-none md:w-[140px]" : "md:flex-none md:w-[197px]",
                compact ? "px-2.5 md:px-3" : "px-3 min-[480px]:px-4 md:px-6",
              ].join(" "),
              isActive ? "text-white" : "text-brandBlack",
            ].join(" ")}
            type={t.href ? undefined : "button"}
          >
            {liveCount > 0 && (
              <span
                aria-hidden="true"
                className={[
                  "pointer-events-none absolute -top-3 right-0 z-20 inline-flex items-center gap-1 rounded-full border border-white font-semibold leading-none text-white whitespace-nowrap",
                  sectionLinks ? "session-section-switcher__live" : "h-6 px-2.5 text-[12px]",
                  t.id === "group" ? "bg-[#57D264]" : "bg-[#EF4444]",
                ].join(" ")}
              >
                <span
                  aria-hidden="true"
                  className={sectionLinks ? "h-3 w-3 shrink-0" : "h-[15px] w-[15px] shrink-0"}
                  style={{
                    backgroundColor: "#FFFFFF",
                    mask: "url('/icons/group-active.svg') center / contain no-repeat",
                    WebkitMask: "url('/icons/group-active.svg') center / contain no-repeat",
                  }}
                />
                <span className={blurLiveCounts ? "select-none blur-[3px]" : undefined}>{liveCount}</span> LIVE
              </span>
            )}
            <img src={isActive ? t.iconActive : t.iconInactive} className={sectionLinks ? "session-section-switcher__icon" : compact ? "w-4 h-4 shrink-0" : "w-6 h-6 shrink-0"} alt="" />

            {/* Text rules:
               <480: hidden for all
               480..767: only active shows
               >=768: all show
            */}
            <span
              className={[
                "whitespace-nowrap",
                sectionLinks
                  ? "session-section-switcher__label"
                  : isActive ? "hidden min-[480px]:inline md:inline" : "hidden md:inline",
              ].join(" ")}
            >
              {t.label}
            </span>
          </Element>
        );
      })}
    </div>
  );
}
