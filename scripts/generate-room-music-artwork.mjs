// Native vector scenes: no runtime canvas, image requests, filters or animation.
// Rebuild both palettes with: node scripts/generate-room-music-artwork.mjs
import { writeFileSync } from "node:fs";

const gradient = (id, top, bottom) => `<linearGradient id="${id}" x2="0" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
const path = (d, fill, extra = "") => `<path d="${d}" fill="${fill}" ${extra}/>`;
const line = (d, color, width = 1, extra = "") => path(d, "none", `stroke="${color}" stroke-width="${width}" stroke-linecap="round" ${extra}`);
const circle = (x, y, r, fill, extra = "") => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${extra}/>`;
const rect = (x, y, w, h, fill, rx = 0, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${extra}/>`;
const stars = (color) => `<g fill="${color}">${[[35, 22], [74, 42], [122, 17], [211, 28], [277, 14], [324, 40], [412, 18], [451, 47]].map(([x, y], i) => circle(x, y, i % 3 === 0 ? 1.2 : 0.7, color)).join("")}</g>`;
const pine = (x, y, size, color) => `<g transform="translate(${x} ${y}) scale(${size})" fill="${color}"><path d="M0-72-13-47h7l-15 23h10L-28 0H28L11-24h10L6-47h7Z"/><path d="M-2-7h4v18h-4Z"/></g>`;

function ambient(dark) {
  const sky = dark ? ["#142239", "#405D7A"] : ["#CCDFEA", "#EDF0E6"];
  return {
    title: "Moonlight over a quiet mountain lake",
    defs: gradient("sky", ...sky) + gradient("water", dark ? "#314F6B" : "#A4C8D6", dark ? "#152D43" : "#D6E6E5"),
    body: rect(0, 0, 480, 150, "url(#sky)") + (dark ? stars("#BBCCDD") : "") +
      circle(338, 37, 31, dark ? "#C3D9DC" : "#FFFFE7", 'opacity=".07"') +
      circle(338, 37, 18, dark ? "#E5E6CE" : "#FFFEEC") +
      path("M0 89 58 43 101 73 157 34 217 87 274 58 328 89 396 49 480 91V150H0Z", dark ? "#3B526B" : "#91B0C0") +
      path("m139 49 18-15 25 22-17-6-9 5-5-10Z", dark ? "#7C99AE" : "#E6EEF0") +
      path("M0 83Q49 59 101 94L179 76 250 102 357 83Q410 69 480 85V150H0Z", dark ? "#253C52" : "#7396A7") +
      rect(0, 103, 480, 47, "url(#water)") +
      line("M281 110h75m-59 7h77m-87 8h58m-27 10h45m-59 7h42", dark ? "#9AB9BC" : "#F9F5D9", 1.5, 'opacity=".55"') +
      line("M58 113h65m31 17h69m-188 8h64m291-18h60", dark ? "#557A93" : "#EDF1E8", 1, 'opacity=".65"') +
      path("M0 134Q43 113 88 125L135 150H0Z", dark ? "#142B39" : "#4B7782") +
      path("M388 150Q429 122 480 129V150Z", dark ? "#142B39" : "#4B7782") +
      pine(28, 126, .55, dark ? "#112532" : "#3C6572") + pine(61, 133, .38, dark ? "#112532" : "#3C6572") +
      line("M433 145q-5-17-1-29m7 32q1-19 11-25", dark ? "#557D86" : "#72929A", 2),
  };
}

function relax(dark) {
  const wall = dark ? "#282D3C" : "#EFE1CF";
  return {
    title: "A quiet reading nook beside a sunset window",
    defs: gradient("window", dark ? "#333D66" : "#ACC9D6", dark ? "#CB8A78" : "#F4C7A3") + gradient("light", dark ? "#665342" : "#F6D9A8", wall),
    body: rect(0, 0, 480, 150, wall) + rect(22, 13, 242, 116, dark ? "#171E30" : "#C5AB91", 4) +
      rect(28, 19, 230, 104, "url(#window)", 2) + circle(199, 53, 21, "#F6D3A0") +
      path("M28 94Q72 55 129 83T258 73v50H28Z", dark ? "#62566D" : "#B4A5B5") +
      path("M28 111Q71 83 128 103T258 94v29H28Z", dark ? "#3F405B" : "#8F9CA9") +
      rect(139, 19, 5, 104, dark ? "#202639" : "#C5AB91") + rect(28, 85, 230, 4, dark ? "#202639" : "#C5AB91") +
      rect(18, 123, 250, 6, dark ? "#636078" : "#BCA68D", 2) +
      path("M296 117 321 51H366L398 117Z", "url(#light)") +
      line("M345 62v56m-18 1h36", dark ? "#A48C72" : "#8D7261", 3) +
      path("M325 25h34l15 34h-66Z", dark ? "#E0B385" : "#CF9667") +
      path("M325 25h10l-5 34h-22Z", dark ? "#BC8B66" : "#B9825D") +
      rect(0, 133, 480, 17, dark ? "#70544C" : "#CAA78B") + line("M0 133h480", dark ? "#AD8164" : "#B28F73", 2) +
      rect(97, 118, 74, 9, dark ? "#627F87" : "#789692", 1) + rect(102, 128, 85, 5, dark ? "#B1977C" : "#DEBC99", 1) +
      path("M184 110h27v14q0 9-13 9t-14-9Z", dark ? "#B8C5BF" : "#F9F2E4") +
      line("M211 113h4q12 7-4 12", dark ? "#B8C5BF" : "#F9F2E4", 3) +
      line("M194 101q-5-5 0-11m9 12q-4-6 0-10", dark ? "#929AA8" : "#B39D88", 1.2) +
      path("m416 111 5 22h24l5-22Z", dark ? "#B17562" : "#C2856A") +
      line("M433 114V69", dark ? "#829987" : "#6A8773", 2) +
      path("M432 94q-23-1-25-19 23 2 25 19Zm2-13q3-23 19-24 0 21-19 24Zm0 25q7-20 25-15-8 18-25 15Z", dark ? "#718C7D" : "#779780"),
  };
}

function rain(dark) {
  const streak = dark ? "#A4C7DD" : "#F4FBFC";
  return {
    title: "Rain on a window overlooking a misty lake",
    defs: gradient("sky", dark ? "#1D344A" : "#AFC9D3", dark ? "#5A7A89" : "#E3ECE8"),
    body: rect(0, 0, 480, 150, "url(#sky)") +
      path("M0 81q66-30 135-5t139-8 206 13v69H0Z", dark ? "#3B5B6B" : "#8EAFB5") +
      path("M0 109q98-35 199-3t281-8v52H0Z", dark ? "#294857" : "#769AA3") +
      path("M0 120q95-23 230 3t250-8v35H0Z", dark ? "#4D7181" : "#B6CFD1") +
      pine(43, 105, .6, dark ? "#263E4C" : "#6B9198") + pine(83, 114, .44, dark ? "#314E5B" : "#7C9FA2") +
      pine(418, 120, .8, dark ? "#263E4C" : "#6B9198") +
      line("M137 126h71m69 9h60M34 141h63m277 2h34", dark ? "#7A9EA8" : "#E3EEEC", 1, 'opacity=".65"') +
      Array.from({ length: 26 }, (_, i) => {
        const x = 14 + (i * 47) % 458;
        const y = 5 + (i * 31) % 124;
        return line(`M${x} ${y}l-5 ${10 + i % 8}`, streak, i % 4 === 0 ? 1.7 : 1, `opacity="${i % 3 === 0 ? ".7" : ".36"}"`) +
          (i % 5 === 0 ? circle(x - 6, y + 22, 1.6, streak, 'opacity=".6"') : "");
      }).join("") +
      rect(152, 0, 6, 150, dark ? "#1B2A38" : "#6D8891") + rect(328, 0, 6, 150, dark ? "#1B2A38" : "#6D8891") +
      rect(0, 145, 480, 5, dark ? "#1B2A38" : "#6D8891"),
  };
}

function forest(dark) {
  return {
    title: "Layered pine trees and a winding forest stream",
    defs: gradient("sky", dark ? "#1C343C" : "#C4D7CB", dark ? "#688B87" : "#EFF0D8"),
    body: rect(0, 0, 480, 150, "url(#sky)") + circle(279, 36, 21, dark ? "#DEE6C9" : "#FFF7CB") +
      path("M0 87Q90 37 179 79T350 65 480 80v70H0Z", dark ? "#486B6D" : "#A3C0B0") +
      [13, 49, 94, 140, 189, 332, 377, 422, 467].map((x, i) => pine(x, 105, .6 + i % 3 * .13, dark ? "#365C60" : "#86AC9A")).join("") +
      path("M0 110Q100 88 234 114T480 104v46H0Z", dark ? "#2C5052" : "#739B88") +
      path("M267 104q-58 15-24 23t-9 23h70q-61-21-38-27t10-19Z", dark ? "#98BDB5" : "#D8E6D4") +
      line("M246 119h15m-6 15h21m-33 11h44", dark ? "#D4E1CC" : "#F9F7E3", 1.2) +
      [16, 68, 119, 368, 423, 479].map((x, i) => pine(x, 139, 1.05 + i % 2 * .45, dark ? "#173A3F" : "#456F61")).join("") +
      pine(163, 137, .57, dark ? "#22464A" : "#5D8975") +
      path("M0 142q74-14 167 8H0Zm350 8q79-14 130-12v12Z", dark ? "#102F35" : "#365C52") +
      line("M87 149q0-15-8-21m9 14 9-14m270 20q1-14 11-21m-8 21-13-15", dark ? "#6E9590" : "#99B69A", 1.5) +
      circle(208, 110, 1.4, "#EAD9A1") + circle(324, 95, 1.3, "#EAD9A1"),
  };
}

function campfire(dark) {
  return {
    title: "A glowing campfire with logs and a lantern in a forest clearing",
    defs: gradient("sky", dark ? "#172333" : "#B7C9CC", dark ? "#405766" : "#F2DDC0") +
      `<radialGradient id="glow"><stop stop-color="#F7B35D" stop-opacity="${dark ? ".38" : ".3"}"/><stop offset="1" stop-color="#F7B35D" stop-opacity="0"/></radialGradient>` +
      gradient("flame", "#FFCA75", "#DB653F"),
    body: rect(0, 0, 480, 150, "url(#sky)") + (dark ? stars("#A9BDC8") : "") +
      circle(367, 32, 12, dark ? "#E1DDC1" : "#FFF0D1") +
      path("M0 93q72-40 139-10t155 1 186 1v65H0Z", dark ? "#2F4852" : "#8EA49C") +
      [21, 67, 116, 330, 385, 457].map((x, i) => pine(x, 120, .7 + i % 3 * .2, dark ? "#1E3641" : "#607F75")).join("") +
      path("M0 125q96-24 217-6t263-3v34H0Z", dark ? "#242F34" : "#A4A089") +
      `<ellipse cx="224" cy="102" rx="112" ry="81" fill="url(#glow)"/>` +
      `<ellipse cx="223" cy="130" rx="66" ry="10" fill="${dark ? "#171F27" : "#797F70"}"/>` +
      [171, 188, 212, 239, 263, 277].map((x, i) => `<ellipse cx="${x}" cy="${129 + (i % 2) * 5}" rx="${i % 2 ? 11 : 8}" ry="5" fill="${dark ? "#6A6F6C" : "#C6C2AB"}"/>`).join("") +
      line("m188 133 66-20m-64 1 63 19", dark ? "#684C3E" : "#745645", 10) +
      line("m189 131 61-18m-57 1 56 17", dark ? "#AE7851" : "#AE8058", 2) +
      path("M222 120c-22 0-35-14-29-32 3-10 14-19 14-31 12 7 12 18 15 23 15-18 0-33 17-47-2 27 28 41 23 65-2 14-17 24-40 22Z", "url(#flame)") +
      path("M225 119c-12 0-22-9-17-20 3-6 9-9 10-18 8 9 5 15 9 18 7-8 9-16 8-24 14 16 16 29 8 37-4 5-10 7-18 7Z", "#FFD58A") +
      path("M226 118q-13-7 0-22-1 10 8 11 4 9-8 11Z", "#FFF0BC") +
      line("m209 47-2-6m39-13 1-5m11 38 2-5m-40-27-1-4", "#EAB578", 1.5) +
      `<ellipse cx="359" cy="136" rx="24" ry="5" fill="${dark ? "#1C272D" : "#878D79"}"/>` +
      rect(347, 109, 23, 23, dark ? "#8D674A" : "#9C7955", 3) + rect(351, 111, 15, 17, "#F6CC7B", 2) +
      rect(345, 105, 27, 5, dark ? "#B39B76" : "#775E46", 2) + rect(345, 130, 27, 4, dark ? "#B39B76" : "#775E46", 2) +
      line("M351 105v-5a7 7 0 0 1 14 0v5", dark ? "#B39B76" : "#775E46", 2) +
      line("M0 147q43-12 82-2m335 3 13-13m-1 12 19-5", dark ? "#4B625B" : "#687E66", 2),
  };
}

function brown(dark) {
  return {
    title: "Quiet sandstone dunes with fine flowing contours",
    defs: gradient("sky", dark ? "#3B3034" : "#E8D6C2", dark ? "#94725C" : "#F4E6D0"),
    body: rect(0, 0, 480, 150, "url(#sky)") + circle(106, 41, 22, dark ? "#DEC396" : "#FFF2D3") +
      path("M0 97 29 80H72L89 62h45l11 25h58l26-14h45l23 26 38-13h58l29 18h58v46H0Z", dark ? "#866553" : "#D1AE8C") +
      path("M0 108q92-61 202-6t278-9v57H0Z", dark ? "#A98262" : "#DEBF99") +
      path("M0 132q108-7 189-34t145 20 146 5v27H0Z", dark ? "#6F5145" : "#BF916E") +
      path("M0 150q79-30 170-12t174-6 136-11v29Z", dark ? "#483A38" : "#946F58") +
      line("M18 103q66-26 132-11m-105 7q40-10 75-9m112 22q54-8 90 8m-98-15q55-8 93 11m-85 5 37 2m79 20q70-27 117-13", dark ? "#C9A27B" : "#F7DFC0", 1, 'opacity=".55"') +
      line("M33 143q37-13 69-10m11 7 32 3m230-36 47-9", dark ? "#C9A27B" : "#F7DFC0", 1, 'opacity=".55"') +
      line("M413 147q-1-14 5-24m-5 21-9-12m10 10 9-9", dark ? "#AB8A69" : "#B8946A", 1.5),
  };
}

function downtown(dark) {
  const windows = dark ? "#EFC48B" : "#D7E7EA";
  const blocks = [[15, 71, 26], [52, 54, 31], [96, 78, 22], [134, 41, 32], [183, 64, 26], [229, 79, 24], [271, 47, 33], [322, 69, 26], [367, 34, 32], [420, 62, 31], [462, 83, 20]];
  return {
    title: "City lights and a riverside skyline at dusk",
    defs: gradient("sky", dark ? "#1D2946" : "#B4CEDE", dark ? "#8B707C" : "#EDCCBB") + gradient("water", dark ? "#3D526D" : "#94B4C9", dark ? "#1E3049" : "#C3D6DC"),
    body: rect(0, 0, 480, 150, "url(#sky)") + circle(237, 35, 22, dark ? "#E2CEB5" : "#FFF0CD") +
      path("M0 108V66h30v18h28V40h27v47h22V58h39v50h31V51h29v35h29V70h42v38h27V55h30v25h39V57h37v51h28V46h30v43h42v19Z", dark ? "#4B526E" : "#8EA7BE") +
      blocks.map(([x, top, w], i) => rect(x, top, w, 121 - top, dark ? (i % 2 ? "#273851" : "#34435D") : (i % 2 ? "#587C9A" : "#6A8AA6")) +
        Array.from({ length: Math.floor((116 - top) / 11) }, (_, row) => Array.from({ length: 3 }, (_, col) =>
          (row + col + i) % 4 === 0 ? "" : rect(x + 5 + col * 8, top + 6 + row * 11, 3, 4, windows, .5, `opacity="${(row + col) % 3 ? ".8" : ".4"}"`)).join("")).join("")).join("") +
      path("M143 41V33h14v8m-9-8V20h4v13m224 1V22h14v12m-9-12V10h4v12", dark ? "#273851" : "#587C9A") +
      rect(0, 121, 480, 29, "url(#water)") +
      line("M0 122h480", dark ? "#B4998D" : "#DCE6E5", 2) +
      blocks.map(([x, , w], i) => line(`M${x + 4} 129h${w - 8}m-12 7h${w - 4}`, dark ? (i % 2 ? "#BD956F" : "#6A83A0") : "#E0E7E1", 1.5, 'opacity=".55"')).join("") +
      line("M39 147h53m70-5h45m81 5h30m85-6h45", dark ? "#5D7493" : "#E0E7E1", 1),
  };
}

const scenes = { "ambient-focus": ambient, "flow-relax": relax, "gentle-rain": rain, "quiet-forest": forest, campfire, "brown-noise": brown, "downtown-flow": downtown };
for (const [name, scene] of Object.entries(scenes)) {
  for (const dark of [false, true]) {
    const { title, defs, body } = scene(dark);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 150" role="img" aria-label="${title}">\n  <defs>${defs}</defs>\n  ${body}\n</svg>\n`.replaceAll("><", ">\n  <");
    writeFileSync(new URL(`../public/images/room-music/${name}${dark ? "-dark" : ""}.svg`, import.meta.url), svg);
  }
}
