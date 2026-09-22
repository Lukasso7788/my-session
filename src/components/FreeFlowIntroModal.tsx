import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";

import { FREE_FLOW_TIMELINE_PRESETS } from "./RoomTimelineEditor";
import { resolveStageVisual, type StageKind } from "./SessionStageBar";
import type { RoomTheme } from "./VideoControls";

import "../free-flow-intro.css";

type Props = {
  open: boolean;
  theme: RoomTheme;
  onClose: () => void;
  onBuildOwn: () => void;
  onStartPreset: (presetId: string) => void;
};

type Preset = (typeof FREE_FLOW_TIMELINE_PRESETS)[number];
type PresetBlock = Preset["blocks"][number];

const ICONS_BY_NAME: Record<string, string> = {
  ladder: "/icons/free-flow/trending-up.svg",
  "30/10": "/icons/free-flow/watch.svg",
  "75/15": "/icons/free-flow/activity.svg",
  "sprint stack": "/icons/free-flow/zap.svg",
  "deep arc": "/icons/free-flow/corner-up-right.svg",
};

function presetIcon(preset: Preset) {
  const byName = ICONS_BY_NAME[String(preset.name || "").trim().toLowerCase()];
  if (byName) return byName;

  const id = String(preset.id || "").toLowerCase();
  if (id.includes("ladder")) return ICONS_BY_NAME.ladder;
  if (id.includes("30")) return ICONS_BY_NAME["30/10"];
  if (id.includes("75")) return ICONS_BY_NAME["75/15"];
  if (id.includes("sprint")) return ICONS_BY_NAME["sprint stack"];
  return ICONS_BY_NAME["deep arc"];
}

function visualForBlock(block: PresetBlock) {
  return resolveStageVisual({
    type: block.kind,
    kind: block.kind,
    title: block.title,
    name: block.title,
    minutes: block.minutes,
    color: block.color,
  });
}

function rgbaFromHex(hex: string, alpha: number) {
  const normalized = String(hex || "").trim();
  const short = normalized.match(/^#([0-9a-f]{3})$/i);
  const long = normalized.match(/^#([0-9a-f]{6})$/i);

  const raw = short
    ? short[1]
        .split("")
        .map((char) => `${char}${char}`)
        .join("")
    : long?.[1];

  if (!raw) return `rgba(148, 163, 184, ${alpha})`;

  const value = Number.parseInt(raw, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function compactBlockLabel(block: PresetBlock, kind: StageKind) {
  const title = String(block.title || "").trim();
  const lower = title.toLowerCase();

  if (lower === "goal setting" || lower === "goal") return "Goal";
  if (kind === "checkin") return "Check-in";
  if (lower.includes("deep focus") || lower.includes("deep-focus")) return "Deep focus";
  if (kind === "focus") return title || "Focus";
  if (kind === "break") return title || "Break";
  return title || "Stage";
}

function StageGuide({ theme }: { theme: RoomTheme }) {
  const isLight = theme === "light";
  const guideItems = [
    {
      label: "Goal & Check-in",
      color: resolveStageVisual({ type: "intentions", title: "Goal", minutes: 2 }).color,
    },
    {
      label: "Focus / Deep Focus",
      color: resolveStageVisual({ type: "focus", title: "Focus", minutes: 25 }).color,
    },
    {
      label: "Recovery Break",
      color: resolveStageVisual({ type: "break", title: "Break", minutes: 10 }).color,
    },
  ];

  return (
    <div className={`free-flow-picker__guide ${isLight ? "is-light" : "is-dark"}`}>
      <span className="free-flow-picker__guide-title">Guide:</span>
      {guideItems.map((item) => (
        <span key={item.label} className="free-flow-picker__guide-item">
          <span
            className="free-flow-picker__guide-dot"
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          <span>{item.label}</span>
        </span>
      ))}
    </div>
  );
}

function PresetTimeline({ preset, theme }: { preset: Preset; theme: RoomTheme }) {
  const isLight = theme === "light";
  const totalMinutes = Math.max(
    1,
    preset.blocks.reduce((sum, block) => sum + Math.max(0, Number(block.minutes) || 0), 0),
  );

  return (
    <>
      <div
        className={`free-flow-picker__timeline ${isLight ? "is-light" : "is-dark"}`}
        aria-label={`${preset.name} timeline`}
      >
        {preset.blocks.map((block, index) => {
          const visual = visualForBlock(block);
          const minutes = Math.max(0, Number(block.minutes) || 0);
          const widthPercent = (minutes / totalMinutes) * 100;

          if (widthPercent <= 0) return null;

          return (
            <span
              key={`${preset.id}-segment-${index}`}
              className="free-flow-picker__timeline-segment"
              title={`${block.title} · ${minutes} min`}
              style={{
                width: `${widthPercent}%`,
                background: visual.color,
              }}
            />
          );
        })}
      </div>

      <div className="free-flow-picker__chips">
        {preset.blocks.map((block, index) => {
          const visual = visualForBlock(block);
          const label = compactBlockLabel(block, visual.kind);
          const minutes = Math.max(0, Number(block.minutes) || 0);

          return (
            <span
              key={`${preset.id}-chip-${index}`}
              className={`free-flow-picker__chip ${isLight ? "is-light" : "is-dark"}`}
              style={{
                color: isLight ? "#31506f" : "rgba(255,255,255,.80)",
                backgroundColor: rgbaFromHex(visual.color, isLight ? 0.18 : 0.16),
                borderColor: rgbaFromHex(visual.color, isLight ? 0.24 : 0.22),
              }}
            >
              <span style={{ color: visual.color }}>{label}</span>
              <span className="free-flow-picker__chip-minutes">{minutes}m</span>
            </span>
          );
        })}
      </div>
    </>
  );
}

export default function FreeFlowIntroModal({
  open,
  theme,
  onClose,
  onBuildOwn,
  onStartPreset,
}: Props) {
  const isLight = theme === "light";
  const defaultPresetId = FREE_FLOW_TIMELINE_PRESETS[0]?.id || "";
  const [selectedPresetId, setSelectedPresetId] = useState(defaultPresetId);

  useEffect(() => {
    if (open) setSelectedPresetId(defaultPresetId);
  }, [open, defaultPresetId]);

  const selectedPreset = useMemo(
    () =>
      FREE_FLOW_TIMELINE_PRESETS.find((preset) => preset.id === selectedPresetId) ||
      FREE_FLOW_TIMELINE_PRESETS[0] ||
      null,
    [selectedPresetId],
  );

  if (!open) return null;

  return (
    <div
      className={`free-flow-picker ${isLight ? "is-light" : "is-dark"}`}
      role="presentation"
    >
      <button
        type="button"
        className="free-flow-picker__backdrop"
        aria-label="Close Free Flow structure picker"
        onClick={onClose}
      />

      <section
        className={`free-flow-picker__panel ${isLight ? "is-light" : "is-dark"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="free-flow-picker-title"
      >
        <header className="free-flow-picker__header">
          <div className="free-flow-picker__heading-copy">
            <h2 id="free-flow-picker-title" className="free-flow-picker__title">
              Host your Free Flow
            </h2>
            <p className="free-flow-picker__subtitle">
              Start with 2 minutes of goal setting, then choose a suggested structure or build your own timeline. You can use up to 9 blocks.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={`free-flow-picker__close ${isLight ? "is-light" : "is-dark"}`}
            aria-label="Close"
          >
            <X size={15} strokeWidth={2.1} aria-hidden="true" />
          </button>
        </header>

        <StageGuide theme={theme} />

        <div className="free-flow-picker__presets" role="radiogroup" aria-label="Free Flow structures">
          {FREE_FLOW_TIMELINE_PRESETS.map((preset) => {
            const selected = preset.id === selectedPreset?.id;
            const totalMinutes = preset.blocks.reduce(
              (sum, block) => sum + Math.max(0, Number(block.minutes) || 0),
              0,
            );

            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`free-flow-picker__preset ${isLight ? "is-light" : "is-dark"} ${selected ? "is-selected" : ""}`}
                onClick={() => setSelectedPresetId(preset.id)}
              >
                <div className="free-flow-picker__preset-topline">
                  <div className="free-flow-picker__preset-name-wrap">
                    <img
                      src={presetIcon(preset)}
                      className="free-flow-picker__preset-icon"
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                    <span className="free-flow-picker__preset-name">{preset.name}</span>
                  </div>

                  <span
                    className={`free-flow-picker__duration ${isLight ? "is-light" : "is-dark"} ${selected ? "is-selected" : ""}`}
                  >
                    {totalMinutes} min
                  </span>
                </div>

                <div className="free-flow-picker__description">{preset.description}</div>
                <PresetTimeline preset={preset} theme={theme} />
              </button>
            );
          })}
        </div>

        <footer className="free-flow-picker__footer">
          <button
            type="button"
            onClick={onBuildOwn}
            className={`free-flow-picker__secondary ${isLight ? "is-light" : "is-dark"}`}
          >
            <SlidersHorizontal size={15} strokeWidth={2} aria-hidden="true" />
            <span>Build my own</span>
          </button>

          <button
            type="button"
            disabled={!selectedPreset}
            onClick={() => selectedPreset && onStartPreset(selectedPreset.id)}
            className="free-flow-picker__primary"
          >
            Start Session
          </button>
        </footer>
      </section>
    </div>
  );
}
