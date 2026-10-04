import assert from "node:assert/strict";
import test from "node:test";

function luminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((value) => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  assert.equal(channels?.length, 3);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("dark side-panel text and icon palette meets WCAG AA normal-text contrast", () => {
  for (const [label, foreground, background] of [
    ["main text on panel", "#F4F5F6", "#1B1D20"],
    ["muted text on panel", "#B5BCC6", "#1B1D20"],
    ["muted text on card", "#B5BCC6", "#25292E"],
    ["input text", "#F4F5F6", "#292D32"],
    ["input placeholder", "#AEB6BF", "#292D32"],
    ["playlist subtext", "#B5BCC6", "#30353A"],
    ["dark button text on green", "#102816", "#81DB86"],
    ["white action icon on panel", "#FFFFFF", "#1B1D20"],
  ]) {
    assert.ok(contrast(foreground, background) >= 4.5, `${label}: ${contrast(foreground, background).toFixed(2)}:1`);
  }
});
