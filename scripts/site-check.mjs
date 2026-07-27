// Validates the static site: asset existence, link targets, duplicate ids, and
// the metadata that search results and social previews depend on.
//
// Every .html file in site/ is checked, not just the home page, because the
// legal pages carry the same head, nav and footer and drift silently otherwise.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
const pages = readdirSync(site)
  .filter((name) => name.endsWith(".html"))
  .sort();

const ORIGIN = "https://prompts.deb0.com";
const problems = [];
const notes = [];
let refCount = 0;
let idCount = 0;
let headingCount = 0;

/** Resolves an href to a path inside site/, or null if it is off-site. */
function resolveLocal(ref) {
  if (/^(https?:|mailto:|data:|tel:)/.test(ref)) {
    return null;
  }
  const [path] = ref.split("#");
  if (path === "" || path === "/") {
    return "index.html";
  }
  return path.replace(/^\//, "");
}

/** The ids each page exposes, so cross-page anchors can be checked. */
const idsByPage = new Map(
  pages.map((page) => [
    page,
    new Set(
      [...readFileSync(join(site, page), "utf8").matchAll(/id="([^"]+)"/g)].map(
        (m) => m[1]
      )
    ),
  ])
);

for (const page of pages) {
  const html = readFileSync(join(site, page), "utf8");
  const where = (message) => problems.push(`${page}: ${message}`);

  /* ---------- local assets referenced by the page exist ---------- */
  for (const ref of new Set(
    [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
  )) {
    if (ref.startsWith("#")) {
      continue;
    }
    const local = resolveLocal(ref);
    if (local === null) {
      continue;
    }
    refCount += 1;
    if (!existsSync(join(site, local))) {
      where(`missing asset: ${ref}`);
    }
  }

  /* ---------- anchors resolve, on this page and across pages ---------- */
  const ids = idsByPage.get(page);
  idCount += ids.size;
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) {
    if (!ids.has(id)) {
      where(`dead anchor: #${id}`);
    }
  }
  for (const [, ref] of html.matchAll(/href="(\/[^"]*#[^"]+)"/g)) {
    const [path, fragment] = ref.split("#");
    const targetIds = idsByPage.get(resolveLocal(path));
    if (targetIds && !targetIds.has(fragment)) {
      where(`dead cross-page anchor: ${ref}`);
    }
  }

  /* ---------- ids are unique ---------- */
  const seen = new Set();
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
    if (seen.has(id)) {
      where(`duplicate id: ${id}`);
    }
    seen.add(id);
  }

  /* ---------- every image is described ---------- */
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt="/.test(tag)) {
      where(`img without alt: ${tag.slice(0, 70)}`);
    }
    if (!/\bwidth="/.test(tag) || !/\bheight="/.test(tag)) {
      where(`img without intrinsic size: ${tag.slice(0, 70)}`);
    }
  }

  /* ---------- metadata search and social previews need ---------- */
  const required = [
    ['<html lang="', "lang on <html>"],
    ['name="viewport"', "viewport"],
    ["viewport-fit=cover", "viewport-fit, for the iPhone notch"],
    ['name="description"', "meta description"],
    ['rel="canonical"', "canonical url"],
    ['name="author"', "author"],
    ['name="robots"', "robots directive"],
    ['property="og:title"', "og:title"],
    ['property="og:image"', "og:image"],
    ['property="og:url"', "og:url"],
    ['property="og:type"', "og:type"],
    ['name="twitter:card"', "twitter:card"],
    ['rel="icon"', "favicon"],
    ['rel="apple-touch-icon"', "apple touch icon"],
    ['rel="mask-icon"', "safari pinned tab icon"],
    ['rel="manifest"', "web app manifest"],
    ['name="theme-color"', "theme colour"],
    ['name="color-scheme"', "color-scheme"],
    ["application/ld+json", "structured data"],
  ];
  for (const [needle, label] of required) {
    if (!html.includes(needle)) {
      where(`missing ${label}`);
    }
  }

  /* ---------- the theme toggle carries all three states ---------- */
  for (const id of ["theme-system", "theme-light", "theme-dark"]) {
    if (!html.includes(`id="${id}"`)) {
      where(`theme toggle missing ${id}`);
    }
  }

  /* ---------- canonical points at this page ---------- */
  const canonical = html.match(/rel="canonical" href="([^"]+)"/)?.[1];
  const expected = page === "index.html" ? `${ORIGIN}/` : `${ORIGIN}/${page}`;
  if (canonical !== expected) {
    where(`canonical is ${canonical}, expected ${expected}`);
  }

  /* ---------- structured data parses ---------- */
  for (const [, block] of html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  )) {
    try {
      JSON.parse(block);
    } catch (error) {
      where(`invalid JSON-LD: ${error.message}`);
    }
  }

  /* ---------- heading order ---------- */
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  headingCount += levels.length;
  const h1s = levels.filter((l) => l === 1).length;
  if (h1s !== 1) {
    where(`expected exactly one <h1>, found ${h1s}`);
  }
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      where(`heading jumps h${levels[i - 1]} -> h${levels[i]}`);
    }
  }

  /* ---------- title and description survive a result page ---------- */
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1].trim();
  if (!title || title.length > 70) {
    where(
      `title is ${title ? `${title.length} chars` : "missing"}, want <= 70`
    );
  }
  const description = html.match(/name="description"\s+content="([^"]+)"/)?.[1];
  if (!description || description.length < 70 || description.length > 165) {
    where(
      `description is ${
        description ? `${description.length} chars` : "missing"
      }, want 70-165`
    );
  }

  /* ---------- leftovers ---------- */
  for (const marker of ["TODO", "FIXME", "<publisher>", "lorem"]) {
    if (html.toLowerCase().includes(marker.toLowerCase())) {
      where(`leftover marker in markup: ${marker}`);
    }
  }
}

/* ---------- sitemap lists every page, and only real ones ---------- */
const sitemap = readFileSync(join(site, "sitemap.xml"), "utf8");
const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
for (const page of pages) {
  const url = page === "index.html" ? `${ORIGIN}/` : `${ORIGIN}/${page}`;
  if (!listed.includes(url)) {
    problems.push(`sitemap.xml is missing ${url}`);
  }
}
for (const url of listed) {
  const local = resolveLocal(url.replace(ORIGIN, ""));
  if (local && !existsSync(join(site, local))) {
    problems.push(`sitemap.xml lists a page that does not exist: ${url}`);
  }
}
if (!readFileSync(join(site, "robots.txt"), "utf8").includes("sitemap.xml")) {
  problems.push("robots.txt does not point at the sitemap");
}

/* ---------- manifest parses and its icons exist ---------- */
const manifest = JSON.parse(
  readFileSync(join(site, "site.webmanifest"), "utf8")
);
for (const icon of manifest.icons) {
  if (!existsSync(join(site, icon.src.replace(/^\//, "")))) {
    problems.push(`manifest icon missing: ${icon.src}`);
  }
}
if (!manifest.icons.some((icon) => icon.purpose === "maskable")) {
  problems.push("manifest has no maskable icon");
}

/* ---------- css selectors that no longer match anything ---------- */
const css = readFileSync(join(site, "styles.css"), "utf8");
const classes = new Set(
  pages.flatMap((page) =>
    [
      ...readFileSync(join(site, page), "utf8").matchAll(/class="([^"]+)"/g),
    ].flatMap((m) => m[1].trim().split(/\s+/))
  )
);
for (const [, name] of css.matchAll(/\.([a-z][a-z0-9-]*)\s*[,{:\s]/gi)) {
  if (!classes.has(name)) {
    notes.push(`css class never used in markup: .${name}`);
  }
}

console.log(
  `checked ${pages.length} pages, ${refCount} local refs, ${idCount} ids, ${headingCount} headings\n`
);
if (problems.length) {
  console.log("PROBLEMS");
  for (const p of problems) {
    console.log(`  - ${p}`);
  }
} else {
  console.log("no problems");
}
if (notes.length) {
  console.log("\nNOTES");
  for (const n of new Set(notes)) {
    console.log(`  - ${n}`);
  }
}
process.exit(problems.length ? 1 : 0);
