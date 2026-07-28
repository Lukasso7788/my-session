import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const illustrations = [
  ["scripts/blog-illustrations/format-comparison.svg", "public/blog/focusmate-alternatives/format-comparison.svg"],
  ["scripts/blog-illustrations/decision-map.svg", "public/blog/focusmate-alternatives/decision-map.svg"],
  ["scripts/blog-illustrations/session-flow.svg", "public/blog/focusmate-alternatives/session-flow.svg"],
];

const [regularFont, boldFont] = await Promise.all([
  readFile(resolve(projectRoot, "public/fonts/Inter-Regular.woff2")),
  readFile(resolve(projectRoot, "public/fonts/Inter-Bold.woff2")),
]);

const embeddedFontCss = `
    /* Inter is embedded because fonts from the parent page are unavailable to SVG images. */
    @font-face {
      font-family: "Inter Embedded";
      src: url("data:font/woff2;base64,${regularFont.toString("base64")}") format("woff2");
      font-style: normal;
      font-weight: 400;
      font-display: block;
    }
    @font-face {
      font-family: "Inter Embedded";
      src: url("data:font/woff2;base64,${boldFont.toString("base64")}") format("woff2");
      font-style: normal;
      font-weight: 700;
      font-display: block;
    }
`;

for (const [sourcePath, outputPath] of illustrations) {
  const source = await readFile(resolve(projectRoot, sourcePath), "utf8");
  const withoutPreviousEmbed = source.replace(
    /\n\s*\/\* INTER_EMBED_START \*\/[\s\S]*?\/\* INTER_EMBED_END \*\/\s*/,
    "\n",
  );
  const next = withoutPreviousEmbed
    .replace(
      /<style>\s*/,
      `<style>\n    /* INTER_EMBED_START */${embeddedFontCss}    /* INTER_EMBED_END */\n`,
    )
    .replace(
      /text \{ font-family: Inter,[^}]+\}/,
      'text { font-family: "Inter Embedded", sans-serif; }',
    );

  if (next === withoutPreviousEmbed) {
    throw new Error(`Could not inject Inter into ${sourcePath}`);
  }

  await writeFile(resolve(projectRoot, outputPath), next, "utf8");
}

console.log(`Embedded Inter in ${illustrations.length} blog illustrations.`);
