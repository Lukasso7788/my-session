import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { SessionsDateFilter } from "../components/SessionsDateFilter";
import { SessionTypeSwitcher } from "../components/SessionTypeSwitcher";

const SECTION_LINKS = [
  { id: "infinite" as const, href: "#infinite-rooms", label: "Infinite rooms" },
  { id: "group" as const, href: "#group-sessions", label: "Group sessions" },
];

const FULL_SWITCHER_HEIGHT = 72;
const COMPACT_SWITCHER_HEIGHT = 44;
const SWITCHER_VERTICAL_PADDING = 16;
const SWITCHER_BOTTOM_MARGIN = 24;

type Props = {
  infiniteRoomsIntro: ReactNode;
  alwaysOpenCards: ReactNode[];
  scheduledGroups: {
    key: string;
    label: string;
    pretty: string;
    cards: ReactNode[];
  }[];
  dateFilter: string | null;
  exampleSchedule: boolean;
  onDateChange: (value: string | null) => void;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
};

export default function UnifiedSessionsConceptPage({
  infiniteRoomsIntro,
  alwaysOpenCards,
  scheduledGroups,
  dateFilter,
  exampleSchedule,
  onDateChange,
  isLoading,
  error,
  onRetry,
}: Props) {
  const [showPreviewNotice, setShowPreviewNotice] = useState(false);
  const [showAllRooms, setShowAllRooms] = useState(false);
  const [activeSection, setActiveSection] = useState<"infinite" | "group">("infinite");
  const [isSwitcherSticky, setIsSwitcherSticky] = useState(false);
  const switcherSentinelRef = useRef<HTMLDivElement | null>(null);
  const infiniteRef = useRef<HTMLElement | null>(null);
  const groupRef = useRef<HTMLElement | null>(null);
  const initialAnchorApplied = useRef(false);
  const [headerHeight, setHeaderHeight] = useState(80);
  // Anchor destinations use the final sticky size even when scrolling from the full switcher.
  const anchorOffset = headerHeight + COMPACT_SWITCHER_HEIGHT + SWITCHER_VERTICAL_PADDING + 16;
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSessions = alwaysOpenCards.length > 0 || scheduledGroups.some((group) => group.cards.length > 0);
  const visibleRooms = showAllRooms ? alwaysOpenCards : alwaysOpenCards.slice(0, 2);

  useLayoutEffect(() => {
    const header = document.querySelector("header");
    const measure = () => {
      setHeaderHeight(header?.getBoundingClientRect().height || 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    const updateScrollState = () => {
      frame = 0;
      const sentinel = switcherSentinelRef.current;
      if (sentinel) {
        setIsSwitcherSticky(sentinel.getBoundingClientRect().top <= headerHeight);
      }
      const group = groupRef.current;
      if (group) {
        const groupTop = group.getBoundingClientRect().top;
        const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
        setActiveSection(groupTop <= anchorOffset + 2 || (atBottom && groupTop < window.innerHeight) ? "group" : "infinite");
      }
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateScrollState);
    };
    updateScrollState();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [anchorOffset, headerHeight, isLoading, showAllRooms, dateFilter]);

  useEffect(() => {
    if (isLoading) return;
    const followHash = () => {
      const target = window.location.hash === "#group-sessions"
        ? groupRef.current
        : window.location.hash === "#infinite-rooms" ? infiniteRef.current : null;
      target?.scrollIntoView({ block: "start", behavior: "instant" });
    };
    if (!initialAnchorApplied.current && (infiniteRef.current || groupRef.current)) {
      initialAnchorApplied.current = true;
      followHash();
    }
    window.addEventListener("hashchange", followHash);
    return () => window.removeEventListener("hashchange", followHash);
  }, [isLoading, hasSessions, anchorOffset]);

  const goToSection = (section: "infinite" | "group" | "one-on-one") => {
    if (section === "one-on-one") return;
    const target = section === "infinite" ? infiniteRef.current : groupRef.current;
    if (!target) return;
    const href = section === "infinite" ? "#infinite-rooms" : "#group-sessions";
    window.history.replaceState(window.history.state, "", href);
    target.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  };

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  const keepCardInteractionLocal = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setShowPreviewNotice(true);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setShowPreviewNotice(false), 3600);
  };

  return (
    <div className="min-h-screen bg-white text-brandBlack font-inter">
      <main className="w-full px-3 md:px-6 lg:px-10 pb-12">
        <div className="text-center pt-[100px] pb-[50px]">
          <h1 className="text-[24px] md:text-[28px] xl:text-[36px] font-normal leading-tight mx-auto">
            Join a focus session to stay accountable
          </h1>
        </div>

        {infiniteRoomsIntro}

        <div ref={switcherSentinelRef} aria-hidden="true" />
        <nav
          aria-label="Session sections"
          className="session-section-nav sticky z-20 -mx-3 flex justify-center bg-white/95 px-3 py-2 backdrop-blur-sm md:-mx-6 md:px-6 lg:-mx-10 lg:px-10"
          style={{
            top: headerHeight,
            // Keep the same flow footprint when the sticky controls shrink.
            marginBottom: SWITCHER_BOTTOM_MARGIN + (isSwitcherSticky ? FULL_SWITCHER_HEIGHT - COMPACT_SWITCHER_HEIGHT : 0),
          }}
        >
          <SessionTypeSwitcher
            compact={isSwitcherSticky}
            value={activeSection}
            onChange={goToSection}
            sectionLinks={SECTION_LINKS}
          />
        </nav>

        <div className="rounded-[24px] px-3 py-3 md:border md:border-[#DBD8D8] md:p-8">
          {isLoading && !hasSessions ? (
            <div className="text-center py-12" role="status">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brandBlack" />
              <p className="mt-4 text-[13px] text-[#606060]">Loading sessions...</p>
            </div>
          ) : error && !hasSessions ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="text-[16px] font-semibold text-brandBlack">Couldn't load sessions</div>
              <p className="mt-2 max-w-[420px] text-[13px] leading-relaxed text-[#606060]">
                {error}
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-5 rounded-full bg-[#111827] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90"
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="space-y-10 md:space-y-12">
              <section id="infinite-rooms" ref={infiniteRef} aria-labelledby="always-open-heading" style={{ scrollMarginTop: anchorOffset }}>
                {alwaysOpenCards.length > 0 ? (
                  <div
                    className="space-y-3 md:space-y-6"
                    onClickCapture={keepCardInteractionLocal}
                    onAuxClickCapture={keepCardInteractionLocal}
                  >
                    {visibleRooms}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-[#606060]">No 24/7 rooms available right now.</p>
                )}
                {alwaysOpenCards.length > 2 && (
                  <button
                    type="button"
                    aria-expanded={showAllRooms}
                    onClick={() => setShowAllRooms((current) => !current)}
                    className="mt-4 rounded-full border border-[#DBD8D8] px-4 py-2 text-[13px] text-brandBlack transition hover:bg-black/5"
                  >
                    {showAllRooms ? "Show fewer rooms" : `Show all ${alwaysOpenCards.length} rooms`}
                  </button>
                )}
              </section>

              <section id="group-sessions" ref={groupRef} aria-labelledby="scheduled-sessions-heading" style={{ scrollMarginTop: anchorOffset }}>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img src="/icons/group-active-black.svg" className="h-6 w-6" alt="" />
                    <h2 id="scheduled-sessions-heading" className="text-[20px] sm:text-[24px] font-semibold">
                      Group sessions
                    </h2>
                  </div>
                  <span className="text-[13px] text-[#606060]">Join a focus session to stay accountable</span>
                </div>
                {exampleSchedule && (
                  <p className="mb-4 text-[12px] text-[#606060]">
                    No upcoming sessions right now. Example sessions below show how the combined page would look.
                  </p>
                )}

                <div className="mb-6 w-full">
                  <SessionsDateFilter value={dateFilter} onChange={onDateChange} weeksAhead={3} />
                </div>

                {scheduledGroups.length > 0 ? (
                  <div className="space-y-8 md:space-y-10">
                    {scheduledGroups.map((group) => (
                      <section key={group.key} aria-label={`${group.label}, ${group.pretty}`}>
                        <div className="flex items-center gap-3 mb-4 md:mb-5">
                          <div className="inline-flex items-center gap-2 rounded-full border border-[#DBD8D8] bg-[#F8F8F8] px-4 py-2">
                            <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-[#606060]">
                              {group.label}
                            </span>
                            <span className="text-[#BDBDBD]">•</span>
                            <span className="text-[13px] font-semibold text-brandBlack">{group.pretty}</span>
                          </div>
                          <div className="hidden sm:block h-px flex-1 bg-[#EAEAEA]" />
                          <div className="hidden md:inline-flex items-center rounded-full border border-[#EAEAEA] bg-white px-3 py-1 text-[12px] text-[#606060]">
                            {group.cards.length} {group.cards.length === 1 ? "session" : "sessions"}
                          </div>
                        </div>
                        <div
                          className="space-y-3 md:space-y-6"
                          onClickCapture={keepCardInteractionLocal}
                          onAuxClickCapture={keepCardInteractionLocal}
                        >
                          {group.cards}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-[#606060]">
                    No group sessions {dateFilter ? "for this date" : "scheduled yet"}.
                  </p>
                )}
              </section>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-[12px] text-[#8A8A8A]">Local preview</p>
      </main>

      {showPreviewNotice && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[1000] w-max max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-2xl bg-[#2F2F2F] px-5 py-3 text-center text-[13px] leading-5 text-white shadow-lg"
        >
          Local preview. Session actions are available on the Sessions page.
        </div>
      )}
    </div>
  );
}
