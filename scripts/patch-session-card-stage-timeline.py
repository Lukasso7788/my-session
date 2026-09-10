from pathlib import Path

CARD_PATH = Path("src/components/SessionCard.tsx")
BAR_PATH = Path("src/components/SessionStageBar.tsx")

card = CARD_PATH.read_text()
bar = BAR_PATH.read_text()


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label} not found")
    return text.replace(old, new, 1)


card = replace_once(
    card,
    '''    const timelineStartTime = useMemo(() => {
        const startedAt = session?.started_at;
        const startTime = session?.start_time;
        const createdAt = session?.created_at;

        const start = startedAt || startTime || createdAt || "";
        if (!start) return String(Date.now());

        if (!startedAt && startTime) {
            const ms = Date.parse(String(startTime));
            if (Number.isFinite(ms) && ms > Date.now()) return String(Date.now());
        }

        return String(start);
    }, [session?.start_time, session?.started_at, session?.created_at]);''',
    '''    const timelineStartTime = useMemo(() => {
        const startedAt = session?.started_at;
        const startTime = session?.start_time;
        const createdAt = session?.created_at;
        const start = startedAt || startTime || createdAt || "";

        return start ? String(start) : String(Date.now());
    }, [session?.start_time, session?.started_at, session?.created_at]);''',
    "timelineStartTime block",
)

marker = "    const tickEveryMs = isInfinite ? 15000 : 1000;\n"
if marker not in card:
    raise SystemExit("tickEveryMs marker not found")

card_stages = r'''

    // Render the card timeline from data that is already in the session payload.
    // This keeps the stage bar visible by default without reintroducing a
    // per-card PostgREST request (important for the current egress budget).
    const cardStages = useMemo<SessionStage[]>(() => {
        if (Array.isArray(session?.session_stages) && session.session_stages.length) {
            return normalizeStages(sortStagesInClient(session.session_stages));
        }

        if (Array.isArray(session?.stages) && session.stages.length) {
            return normalizeStages(sortStagesInClient(session.stages));
        }

        const scheduleStages = tryStagesFromSchedule(session?.schedule);
        if (scheduleStages.length) return scheduleStages;

        const embeddedTemplate = getEmbeddedTemplate(session);
        if (embeddedTemplate) {
            const embeddedBlocks =
                tryParseJson<any[]>(embeddedTemplate?.blocks) ||
                tryParseJson<any[]>(embeddedTemplate?.stages);

            if (Array.isArray(embeddedBlocks) && embeddedBlocks.length) {
                return normalizeStages(sortStagesInClient(embeddedBlocks));
            }

            const embeddedScheduleStages = tryStagesFromSchedule(embeddedTemplate?.schedule);
            if (embeddedScheduleStages.length) return embeddedScheduleStages;
        }

        const durationMinutes = Number(session?.duration_minutes);
        if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
            return normalizeStages(
                sortStagesInClient([
                    {
                        id: `card-fallback-${String(session?.id || "session")}`,
                        kind: "focus",
                        title: "Focus",
                        durationMinutes,
                        position: 0,
                    },
                ])
            );
        }

        return [];
    }, [
        session?.id,
        session?.session_stages,
        session?.stages,
        session?.schedule,
        session?.session_template,
        session?.session_templates,
        session?.template,
        session?.templates,
        session?.duration_minutes,
    ]);
'''
card = card.replace(marker, marker + card_stages, 1)

card = replace_once(
    card,
    '<div className="flex flex-col xl:flex-row w-full gap-6">',
    '<div className="flex flex-col min-[769px]:flex-row min-[769px]:items-center w-full gap-5 min-[1024px]:gap-6">',
    "outer session card layout",
)

card = replace_once(
    card,
    '<div className="flex min-w-0 flex-1 items-stretch justify-between gap-4">',
    '<div className="flex min-w-0 items-stretch justify-between gap-4 min-[769px]:w-[42%] min-[769px]:max-w-[620px] min-[769px]:shrink-0">',
    "left session info layout",
)

card = replace_once(
    card,
    "{peopleInline}",
    "{hasStarted ? peopleInline : null}",
    "peopleInline render",
)

old_controls = '<div className="grid w-full grid-cols-[auto_minmax(0,1fr)_48px] items-center gap-3 min-[769px]:flex min-[769px]:justify-end xl:w-auto">'
new_controls = '<div className="grid w-full grid-cols-[auto_minmax(0,1fr)_48px] items-center gap-3 min-[769px]:flex min-[769px]:w-auto min-[769px]:shrink-0 min-[769px]:justify-end">'

timeline_block = '''                    <div className="w-full min-w-0 px-1 min-[769px]:flex-1 min-[769px]:px-0">
                        {cardStages.length > 0 ? (
                            <SessionStageBar
                                stages={cardStages}
                                startTime={timelineStartTime}
                                cycleSeconds={cycleSeconds}
                                progressStyle="tick"
                                tickEveryMs={tickEveryMs}
                                theme="light"
                            />
                        ) : (
                            <div
                                className="h-2 w-full rounded-full bg-[#E7E7E7]"
                                aria-label="Session timeline"
                            />
                        )}
                    </div>

                    '''
card = replace_once(
    card,
    old_controls,
    timeline_block + new_controls,
    "right controls layout",
)

card = replace_once(
    card,
    'className="hidden xl:flex items-center gap-5 xl:mr-3 transition-opacity hover:opacity-70"',
    'className={`${hasStarted ? "hidden xl:flex" : "hidden"} items-center gap-5 xl:mr-3 transition-opacity hover:opacity-70`}',
    "occupancy button visibility",
)

card = replace_once(
    card,
    'w-full min-[769px]:flex-1 xl:w-auto xl:flex-none xl:min-w-[160px]',
    'w-full min-[769px]:w-auto min-[769px]:flex-none min-[769px]:min-w-[150px] xl:min-w-[160px]',
    "join button responsive layout",
)

bar = replace_once(
    bar,
    '''    const raw = Number.isFinite(elapsed) ? elapsed : 0;
    const normalized =
      loopSeconds > 0 ? ((raw % loopSeconds) + loopSeconds) % loopSeconds : raw;''',
    '''    const raw = Number.isFinite(elapsed) ? elapsed : 0;
    // A future session has negative elapsed time. Keep its marker at the
    // beginning instead of modulo-wrapping it into an apparently active stage.
    const normalized =
      raw <= 0
        ? 0
        : loopSeconds > 0
          ? raw % loopSeconds
          : raw;''',
    "SessionStageBar normalized time",
)

CARD_PATH.write_text(card)
BAR_PATH.write_text(bar)
