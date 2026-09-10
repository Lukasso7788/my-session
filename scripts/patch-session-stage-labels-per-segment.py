from pathlib import Path

path = Path('src/components/SessionStageBar.tsx')
text = path.read_text()

old_logic = '''  const legendItems = useMemo(() => {
    const shortLabelByKind: Record<StageKind, string> = {
      welcome: "Welcome",
      intentions: "Plan",
      focus: "Focus",
      break: "Break",
      checkin: "Check-in",
      recap: "Recap",
      celebrate: "Celebrate",
      farewell: "End",
      custom: "Custom",
    };

    const seen = new Set<string>();
    const items: Array<{ key: string; label: string; color: string }> = [];

    for (const stage of stages || []) {
      const visual = resolveStageVisual(stage as any);
      const key = visual.kind === "custom"
        ? `${visual.kind}:${visual.name.toLowerCase()}`
        : visual.kind;
      if (seen.has(key)) continue;
      seen.add(key);

      items.push({
        key,
        label: visual.kind === "custom"
          ? String(visual.name || "Custom").slice(0, 14)
          : shortLabelByKind[visual.kind],
        color: visual.color,
      });
    }

    return items;
  }, [stages]);'''

new_logic = '''  const legendItems = useMemo(() => {
    const shortLabelByKind: Record<StageKind, string> = {
      welcome: "Welcome",
      intentions: "Plan",
      focus: "Focus",
      break: "Break",
      checkin: "Check-in",
      recap: "Recap",
      celebrate: "Celebrate",
      farewell: "End",
      custom: "Custom",
    };

    return (stages || [])
      .map((stage, index) => {
        const visual = resolveStageVisual(stage as any);
        const durSec = stageSecondsList[index] || 0;
        const width = durSec > 0 ? (durSec / totalStagesSeconds) * 100 : 0;

        return {
          key: `${(stage as any)?.id || index}-${index}`,
          label: visual.kind === "custom"
            ? String(visual.name || "Custom").slice(0, 14)
            : shortLabelByKind[visual.kind],
          width,
        };
      })
      .filter((item) => item.width > 0);
  }, [stages, stageSecondsList, totalStagesSeconds]);'''

old_markup = '''      {showLegend && legendItems.length > 0 && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-medium leading-none text-[#777777] sm:text-[10px]">
          {legendItems.map((item) => (
            <span key={item.key} className="inline-flex items-center gap-1 whitespace-nowrap">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={stageColorStyle(item.color)}
                aria-hidden="true"
              />
              {item.label}
            </span>
          ))}
        </div>
      )}'''

new_markup = '''      {showLegend && legendItems.length > 0 && (
        <div className="mt-2 flex w-full min-w-0 items-start text-[7px] font-medium leading-none text-[#777777] min-[481px]:text-[8px] sm:text-[9px]">
          {legendItems.map((item) => (
            <div
              key={item.key}
              className="min-w-0 px-[1px] text-center"
              style={{ width: `${item.width}%` }}
              title={item.label}
            >
              <span className="block truncate">{item.label}</span>
            </div>
          ))}
        </div>
      )}'''

if old_logic not in text:
    raise SystemExit('old legend logic not found')
if old_markup not in text:
    raise SystemExit('old legend markup not found')

text = text.replace(old_logic, new_logic, 1)
text = text.replace(old_markup, new_markup, 1)
path.write_text(text)
