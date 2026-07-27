// Renders the site's icon set from one SVG source.
//
// Apple and Android want different things from the same artwork: iOS fills any
// transparency with black and rounds the corners itself, Android crops a
// maskable icon to a circle or squircle, and Safari's pinned tabs want a flat
// monochrome silhouette. Each of those is a separate render rather than a
// resized copy of the others.
//
//   node scripts/make-icons.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..", "site");

// playwright-core lives with the extension; resolve it from there rather than
// adding a second node_modules tree at the repo root.
const require = createRequire(join(here, "..", "extension", "package.json"));
const { chromium } = require("playwright-core");

const VIOLET = "#7c3aed";
const BLUE = "#2563eb";
const CYAN = "#06b6d4";

/** The speech bubble and its bars, drawn against a 512 canvas. */
const ART = `
  <path
    d="M76 116h360a44 44 0 0 1 44 44v144a44 44 0 0 1-44 44H170l-62 56v-56H76a44 44 0 0 1-44-44V160a44 44 0 0 1 44-44z"
    fill="#f5f5ff"/>
  <g>
    <rect x="149" y="236" width="34" height="64" rx="17" fill="${VIOLET}"/>
    <rect x="209" y="172" width="34" height="128" rx="17" fill="${CYAN}"/>
    <rect x="269" y="196" width="34" height="104" rx="17" fill="${BLUE}"/>
    <rect x="329" y="228" width="34" height="72" rx="17" fill="${VIOLET}"/>
  </g>`;

// The gradient has to travel with every copy of the artwork: an SVG that
// references url(#bg) without carrying its own <defs> renders transparent, and
// does it silently.
const DEFS = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${VIOLET}"/>
      <stop offset="0.55" stop-color="${BLUE}"/>
      <stop offset="1" stop-color="${CYAN}"/>
    </linearGradient>
  </defs>`;

function svg({ rounded = true, scale = 1, fullBleed = false }) {
  const inset = (512 - 512 * scale) / 2;
  const art =
    scale === 1
      ? ART
      : `<g transform="translate(${inset} ${inset}) scale(${scale})">${ART}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" preserveAspectRatio="xMidYMid meet">
    ${DEFS}
    <rect width="512" height="512" ${rounded ? 'rx="114"' : ""} fill="url(#bg)"/>
    ${fullBleed ? "" : ""}
    ${art}
  </svg>`;
}

/** Flat black silhouette — Safari pinned tabs ignore colour entirely. */
const MASK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path
    d="M76 116h360a44 44 0 0 1 44 44v144a44 44 0 0 1-44 44H170l-62 56v-56H76a44 44 0 0 1-44-44V160a44 44 0 0 1 44-44zm73 120v64h34v-64zm60-64v128h34V172zm60 24v104h34V196zm60 32v72h34v-72z"
    fill="black" fill-rule="evenodd"/>
</svg>`;

const TARGETS = [
  { file: "favicon-16.png", size: 16, svg: svg({}) },
  { file: "favicon-32.png", size: 32, svg: svg({}) },
  { file: "icon-192.png", size: 192, svg: svg({}) },
  { file: "icon-512.png", size: 512, svg: svg({}) },
  // iOS composites onto black wherever the icon is transparent, and applies its
  // own corner radius, so this one is a full opaque square.
  {
    file: "apple-touch-icon.png",
    size: 180,
    svg: svg({ rounded: false, scale: 0.9 }),
  },
  // Android crops to a circle, so the artwork sits inside the central 60%.
  {
    file: "icon-maskable-512.png",
    size: 512,
    svg: svg({ rounded: false, scale: 0.6 }),
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

for (const target of TARGETS) {
  await page.setViewportSize({ width: target.size, height: target.size });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;width:${target.size}px;height:${target.size}px;overflow:hidden">
       <style>svg{display:block;width:${target.size}px;height:${target.size}px}</style>
       ${target.svg}
     </body></html>`
  );
  await page.screenshot({
    path: join(site, target.file),
    clip: { x: 0, y: 0, width: target.size, height: target.size },
    omitBackground: true,
  });
  console.log(`${target.file} (${target.size}px)`);
}

await browser.close();

writeFileSync(join(site, "favicon.svg"), `${svg({})}\n`, "utf8");
writeFileSync(join(site, "mask-icon.svg"), `${MASK_ICON}\n`, "utf8");
console.log("favicon.svg, mask-icon.svg");
