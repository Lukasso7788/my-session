function makeBgPresetDataUrl(a: string, b: string, c: string, d: string) {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/>
      <stop offset="0.5" stop-color="${b}"/>
      <stop offset="1" stop-color="${c}"/>
    </linearGradient>
    <radialGradient id="r" cx="25%" cy="25%" r="80%">
      <stop offset="0" stop-color="${d}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <rect width="1280" height="720" fill="url(#r)"/>
  <circle cx="1030" cy="170" r="230" fill="#F3F3F3" opacity="0.04"/>
  <circle cx="360" cy="520" r="310" fill="#F3F3F3" opacity="0.03"/>
</svg>
`)
  );
}

// One source for the camera-arrow chooser, prejoin and room Settings.
export const FX_BG_PRESETS = [
  {
    id: "ocean",
    label: "Ocean",
    url: makeBgPresetDataUrl("#DCEBFF", "#83B8F4", "#EAF4FF", "#FFFFFF"),
  },
  {
    id: "forest",
    label: "Forest",
    url: makeBgPresetDataUrl("#E0F5E8", "#87CCA1", "#F1FAF4", "#FFFFFF"),
  },
  {
    id: "violet",
    label: "Violet",
    url: makeBgPresetDataUrl("#EEE8FF", "#B7A4ED", "#F8F5FF", "#FFFFFF"),
  },
  {
    id: "sunset",
    label: "Sunset",
    url: makeBgPresetDataUrl("#FFF0E5", "#F4AAA4", "#FFF8F3", "#FFFFFF"),
  },
];
