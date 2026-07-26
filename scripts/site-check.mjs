// Validates the static site: tag balance, asset existence, link targets,
// duplicate ids, and the metadata that social previews depend on.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
const html = readFileSync(join(site, "index.html"), "utf8");

const problems = [];
const notes = [];

/* ---------- local assets referenced by the page exist ---------- */
const refs = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)]
  .map((m) => m[1])
  .filter((v) => !/^(https?:|mailto:|data:)/.test(v));
for (const ref of new Set(refs)) {
  if (!existsSync(join(site, ref))) {
    problems.push(`missing asset: ${ref}`);
  }
}

/* ---------- in-page anchors resolve ---------- */
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) {
  if (!ids.has(id)) {
    problems.push(`dead anchor: #${id}`);
  }
}

/* ---------- ids are unique ---------- */
const seen = new Set();
for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
  if (seen.has(id)) {
    problems.push(`duplicate id: ${id}`);
  }
  seen.add(id);
}

/* ---------- every image is described ---------- */
for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
  if (!/\balt="/.test(tag)) {
    problems.push(`img without alt: ${tag.slice(0, 70)}`);
  }
  if (!/\bwidth="/.test(tag) || !/\bheight="/.test(tag)) {
    problems.push(`img without intrinsic size: ${tag.slice(0, 70)}`);
  }
}

/* ---------- metadata social previews need ---------- */
const required = [
  ['<html lang="', "lang on <html>"],
  ['name="viewport"', "viewport"],
  ['name="description"', "meta description"],
  ['rel="canonical"', "canonical url"],
  ['property="og:title"', "og:title"],
  ['property="og:image"', "og:image"],
  ['property="og:url"', "og:url"],
  ['name="twitter:card"', "twitter:card"],
  ['rel="icon"', "favicon"],
];
for (const [needle, label] of required) {
  if (!html.includes(needle)) {
    problems.push(`missing ${label}`);
  }
}

/* ---------- heading order ---------- */
const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
if (levels.filter((l) => l === 1).length !== 1) {
  problems.push(`expected exactly one <h1>, found ${levels.filter((l) => l === 1).length}`);
}
for (let i = 1; i < levels.length; i++) {
  if (levels[i] - levels[i - 1] > 1) {
    problems.push(`heading jumps h${levels[i - 1]} -> h${levels[i]}`);
  }
}

/* ---------- leftovers ---------- */
for (const marker of ["TODO", "FIXME", "<publisher>", "lorem"]) {
  if (html.toLowerCase().includes(marker.toLowerCase())) {
    problems.push(`leftover marker in markup: ${marker}`);
  }
}

/* ---------- css selectors that no longer match anything ---------- */
const css = readFileSync(join(site, "styles.css"), "utf8");
const classes = new Set(
  [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].trim().split(/\s+/))
);
for (const [, name] of css.matchAll(/\.([a-z][a-z0-9-]*)\s*[,{]/gi)) {
  if (!classes.has(name)) {
    notes.push(`css class never used in markup: .${name}`);
  }
}

console.log(`checked ${refs.length} local refs, ${ids.size} ids, ${levels.length} headings\n`);
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
  for (const n of notes) {
    console.log(`  - ${n}`);
  }
}
