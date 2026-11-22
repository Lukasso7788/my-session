import { useEffect, useMemo, useState } from "react";
import { FOCUS_SHIELD_DURATIONS, FOCUS_SHIELD_PRESETS } from "./focusShieldPresets";
import {
  collectBlockTargets,
  formatShieldRemaining,
  isShieldLocked,
  isShieldRunning,
  previewSiteLabel,
} from "./policy";
import { activateFocusShield, reconcileFocusShield, stopFocusShield } from "./sync";
import type { FocusShieldPolicy } from "./focusShieldTypes";

type PanelTheme = "light" | "dark";

function BlockedPagePreview({
  site,
  remaining,
  sample,
}: {
  site: string;
  remaining: string;
  sample: boolean;
}) {
  const address = site.includes("/") ? site : `${site}/`;
  return (
    <section aria-label="Blocked page preview">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-60">Preview</div>
        <div className="text-[11px] opacity-50">{sample ? "Example" : "Blocked tab"}</div>
      </div>
      <div className="mt-2 overflow-hidden rounded-2xl border border-black/10 bg-[#0b1220] text-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-white/10 bg-[#111827] px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-[#F65252]" />
          <span className="h-2 w-2 rounded-full bg-[#F5C451]" />
          <span className="h-2 w-2 rounded-full bg-[#7EE787]" />
          <div className="min-w-0 flex-1 truncate rounded-full bg-white/10 px-3 py-1 text-[11px] text-white/70">
            https://{address}
          </div>
        </div>
        <div className="px-5 py-6 text-center">
          <div className="text-[18px] font-semibold tracking-tight">Blocked by FocusShield</div>
          <p className="mx-auto mt-2 max-w-[280px] text-[13px] leading-5 text-white/70">
            This site is blocked during your focus session.
          </p>
          <div className="mt-4 font-mono text-[32px] font-semibold leading-none tabular-nums">{remaining}</div>
          <div className="mt-4 text-[12px] text-white/55">Back to MySession</div>
        </div>
      </div>
    </section>
  );
}

export default function FocusShieldPanel({
  theme = "light",
  userId,
  onClose,
}: {
  theme?: PanelTheme;
  userId: string | null;
  onClose: () => void;
}) {
  const light = theme === "light";
  const [policy, setPolicy] = useState<FocusShieldPolicy | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customText, setCustomText] = useState("");
  const [minutes, setMinutes] = useState(25);
  const [customMinutes, setCustomMinutes] = useState("");
  const [locked, setLocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void reconcileFocusShield(userId).then((next) => {
      if (!cancelled && next) setPolicy(next);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!isShieldRunning(policy)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [policy]);

  const presetDomains = useMemo(
    () => FOCUS_SHIELD_PRESETS.filter((preset) => selectedIds.includes(preset.id)).flatMap((preset) => preset.domains),
    [selectedIds],
  );
  const targets = useMemo(() => collectBlockTargets(presetDomains, customText), [presetDomains, customText]);
  const running = isShieldRunning(policy, now);
  const lockedRunning = isShieldLocked(policy, now);
  const activeSite = running ? previewSiteLabel(policy?.web.domains || [], policy?.web.urls || []) : "";
  const draftSite = previewSiteLabel(targets.domains, targets.urls);
  const site = activeSite || draftSite || "youtube.com";
  const durationMinutes = minutes === 0 ? Number(customMinutes) : minutes;
  const draftEnd = Number.isFinite(durationMinutes) && durationMinutes > 0
    ? Date.now() + durationMinutes * 60_000
    : null;
  const remaining = running ? formatShieldRemaining(policy?.endAt, now) : formatShieldRemaining(draftEnd);

  const togglePreset = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const start = async () => {
    if (busy) return;
    if (!targets.domains.length && !targets.urls.length) {
      setNotice("Choose at least one site, or add a custom page.");
      return;
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      setNotice("Use a duration between 1 and 1440 minutes.");
      return;
    }
    setBusy(true);
    setNotice("");
    const result = await activateFocusShield({
      userId,
      domains: targets.domains,
      urls: targets.urls,
      minutes: durationMinutes,
      locked,
    });
    setPolicy(result.policy);
    setBusy(false);
    if (result.error && result.error !== "locked") {
      setNotice(result.error);
      return;
    }
    if (result.extension === "missing") {
      setNotice(result.saved
        ? "Saved to your account. Install the FocusShield extension in this browser to block open tabs."
        : "Sign in to save this shield, or install the FocusShield extension to block this browser.");
      return;
    }
    setNotice(result.saved ? "Shield is on for this browser and saved to your account." : "Shield is on in this browser.");
  };

  const stop = async () => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    const result = await stopFocusShield(userId, policy);
    setPolicy(result.policy);
    setBusy(false);
    setNotice(result.error === "locked"
      ? `Locked until ${formatShieldRemaining(result.policy.endAt)}.`
      : "Shield is off.");
  };

  const chipClass = (selected: boolean) =>
    `rounded-full border px-2.5 py-1 text-[12px] transition ${selected
      ? light
        ? "border-[#1B1B1B] bg-[#1B1B1B] text-white"
        : "border-[#5286F6] bg-[#5286F6] text-white"
      : light
        ? "border-[#CFCFCF] text-black/75 hover:bg-[#E8E8E8]"
        : "border-[#59616A] text-[#D0D6DD] hover:bg-[#353B42]"
    }`;

  return (
    <div data-side-panel-section="focus-shield" className="flex h-full min-h-0 flex-col">
      <div className={`flex min-h-[44px] items-center justify-between border-b px-3 py-1.5 ${light ? "border-[#D8D0D0] bg-[#F3F1F1]" : "border-[#343434] bg-[#232323]"}`}>
        <div className="flex min-w-0 items-center gap-2">
          <img src="/icons/focus-shield.svg" alt="" className={`h-4 w-4 ${light ? "" : "brightness-0 invert"}`} />
          <div className={`text-[12px] font-semibold ${light ? "text-black/85" : "text-[#F4F5F6]"}`}>Focus Shield</div>
          {running ? <span className="rounded-full bg-[#173D1A] px-2 py-0.5 text-[10px] font-semibold text-[#B8E9BE]">On</span> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`flex h-8 w-8 items-center justify-center rounded-[10px] transition ${light ? "bg-[#E6E6E6] text-black/60 hover:bg-[#DCDCDC]" : "bg-[#303030] text-[#D4D9DF] hover:bg-[#3A3A3A]"}`}
          aria-label="Close Focus Shield"
        >
          ✕
        </button>
      </div>

      <div className={`min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3 ${light ? "text-[#1F1F1F]" : "text-[#F4F5F6]"}`}>
        <BlockedPagePreview site={site} remaining={remaining} sample={!activeSite && !draftSite} />

        <p className={`text-[12px] leading-5 ${light ? "text-black/60" : "text-[#B5BCC6]"}`}>
          {running
            ? `Blocking ${policy?.web.domains.length || 0} sites${policy?.web.urls.length ? ` and ${policy.web.urls.length} pages` : ""}.`
            : "Choose what to block. The preview shows the page a distracting tab will land on."}
        </p>

        {running ? (
          <div className={`rounded-xl border px-3 py-2 text-[12px] leading-5 ${light ? "border-[#CFCFCF] bg-[#EFEFEF]" : "border-[#484848] bg-[#292929]"}`}>
            {(policy?.web.domains || []).concat(policy?.web.urls || []).slice(0, 12).join(", ") || "No sites listed."}
          </div>
        ) : (
          <>
            <div>
              <div className="text-[12px] font-semibold">Sites</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {FOCUS_SHIELD_PRESETS.filter((preset) => preset.group === "common").map((preset) => (
                  <button key={preset.id} type="button" className={chipClass(selectedIds.includes(preset.id))} onClick={() => togglePreset(preset.id)} aria-pressed={selectedIds.includes(preset.id)}>
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <details>
              <summary className="cursor-pointer text-[12px] font-semibold">Categories</summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {FOCUS_SHIELD_PRESETS.filter((preset) => preset.group === "category").map((preset) => (
                  <button key={preset.id} type="button" title={preset.hint} className={chipClass(selectedIds.includes(preset.id))} onClick={() => togglePreset(preset.id)} aria-pressed={selectedIds.includes(preset.id)}>
                    {preset.label}
                  </button>
                ))}
              </div>
            </details>

            <label className="block" htmlFor="focus-shield-custom-sites">
              <span className="text-[12px] font-semibold">Custom sites or pages</span>
              <textarea
                id="focus-shield-custom-sites"
                value={customText}
                onChange={(event) => setCustomText(event.target.value)}
                placeholder={"One per line:\nyoutube.com\nhttps://www.youtube.com/shorts"}
                className={`mt-2 min-h-[76px] w-full resize-y rounded-xl border px-3 py-2 text-[13px] outline-none ${light ? "border-[#CFCFCF] bg-[#E6E6E6] placeholder:text-black/35" : "border-[#484848] bg-[#292929] placeholder:text-white/35"}`}
              />
            </label>

            <div>
              <div className="text-[12px] font-semibold">Duration</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {FOCUS_SHIELD_DURATIONS.map((option) => (
                  <button key={option.minutes} type="button" className={chipClass(minutes === option.minutes)} onClick={() => { setMinutes(option.minutes); setCustomMinutes(""); }}>
                    {option.label}
                  </button>
                ))}
                <button type="button" className={chipClass(minutes === 0)} onClick={() => setMinutes(0)}>Custom</button>
              </div>
              {minutes === 0 ? (
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={customMinutes}
                  onChange={(event) => setCustomMinutes(event.target.value)}
                  placeholder="Minutes, 1–1440"
                  className={`mt-2 h-10 w-full rounded-xl border px-3 text-[13px] outline-none ${light ? "border-[#CFCFCF] bg-[#E6E6E6]" : "border-[#484848] bg-[#292929]"}`}
                />
              ) : null}
            </div>

            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" checked={locked} onChange={(event) => setLocked(event.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-semibold">Locked mode</span>
                <span className={`mt-0.5 block text-[12px] ${light ? "text-black/55" : "text-[#B5BCC6]"}`}>You cannot turn the shield off until the timer ends.</span>
              </span>
            </label>
          </>
        )}

        {notice ? <div className={`rounded-xl px-3 py-2 text-[12px] leading-5 ${light ? "bg-[#EFEFEF] text-black/75" : "bg-[#292929] text-[#D0D6DD]"}`}>{notice}</div> : null}

        {running ? (
          <button type="button" onClick={() => void stop()} disabled={busy || lockedRunning} className="h-11 w-full rounded-xl border border-[#F65252] text-[13px] font-semibold text-[#F65252] disabled:cursor-not-allowed disabled:opacity-45">
            {busy ? "Stopping…" : lockedRunning ? "Locked until the timer ends" : "Stop shield"}
          </button>
        ) : (
          <button type="button" onClick={() => void start()} disabled={busy} className={`h-11 w-full rounded-xl text-[13px] font-semibold text-white disabled:opacity-50 ${light ? "bg-[#1B1B1B] hover:bg-[#242424]" : "bg-[#5286F6] hover:bg-[#6B98FA]"}`}>
            {busy ? "Starting…" : "Start shield"}
          </button>
        )}

        <a href="/focus-shield" className={`block text-[12px] underline-offset-2 hover:underline ${light ? "text-black/55" : "text-[#B5BCC6]"}`}>
          Install the browser extension
        </a>
      </div>
    </div>
  );
}
