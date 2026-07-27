// Screenshots the site across the themes and Apple form factors it has to
// support, and asserts the things that are easy to break and hard to see:
// horizontal overflow, touch-target size, and the no-JavaScript theme toggle.
//
//   node scripts/site-shots.mjs
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..", "site");
const out = join(here, "..", "out", "site-shots");
mkdirSync(out, { recursive: true });

const require = createRequire(join(here, "..", "extension", "package.json"));
const { chromium, devices } = require("playwright-core");

const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".gif": "image/gif",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".webmanifest": "application/manifest+json",
};

// The pages use root-relative URLs, which only resolve over HTTP. Serving the
// folder is the difference between testing the site and testing file://.
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  const rel = normalize(path === "/" ? "index.html" : path).replace(
    /^([/\\.]+)/,
    ""
  );
  const file = join(site, rel);
  if (!file.startsWith(site) || !existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  const ext = file.slice(file.lastIndexOf("."));
  res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const url = (page) => `${origin}/${page === "index.html" ? "" : page}`;

const FORM_FACTORS = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "ipad-pro", ...devices["iPad Pro 11"] },
  { name: "ipad-mini", ...devices["iPad Mini"] },
  { name: "iphone-15", ...devices["iPhone 15"] },
  { name: "iphone-se", ...devices["iPhone SE"] },
];

const problems = [];
const browser = await chromium.launch();

for (const factor of FORM_FACTORS) {
  const { name, ...device } = factor;
  for (const scheme of ["dark", "light"]) {
    const context = await browser.newContext({
      ...device,
      colorScheme: scheme,
    });
    const page = await context.newPage();
    await page.goto(url("index.html"));
    await page.waitForTimeout(250);

    // Nothing may push the page sideways; on a phone that is the difference
    // between a site and a mess. Elements inside a deliberately scrollable box
    // are exempt — a wide <pre> that scrolls on its own is the correct answer.
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const scrolls = (el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === "auto" || o === "scroll") {
            return true;
          }
        }
        return false;
      };
      const wide = [...document.querySelectorAll("body *")]
        .filter(
          (el) =>
            el.getBoundingClientRect().right > doc.clientWidth + 1 &&
            !scrolls(el)
        )
        .map(
          (el) =>
            el.tagName + "." + (el.className || "").toString().slice(0, 40)
        );
      return {
        scrollW: doc.scrollWidth,
        clientW: doc.clientWidth,
        wide: wide.slice(0, 5),
      };
    });
    if (overflow.scrollW > overflow.clientW + 1) {
      problems.push(
        `${name}/${scheme}: horizontal overflow ${overflow.scrollW} > ${overflow.clientW} ${JSON.stringify(overflow.wide)}`
      );
    }

    // Apple asks for 44px; the theme toggle is the smallest control on the page.
    if (device.isMobile) {
      const box = await page.locator('label[for="theme-dark"]').boundingBox();
      if (!box || box.width < 44 || box.height < 40) {
        problems.push(
          `${name}/${scheme}: theme target ${box && Math.round(box.width)}x${box && Math.round(box.height)}, want >= 44x40`
        );
      }
    }

    await page.screenshot({
      path: join(out, `${name}-${scheme}.png`),
      fullPage: false,
    });
    await context.close();
  }
}

/* ---------- the toggle has to work with scripting disabled ---------- */
const noJs = await browser.newContext({
  javaScriptEnabled: false,
  colorScheme: "dark",
  viewport: { width: 1280, height: 860 },
});
const page = await noJs.newPage();
await page.goto(url("index.html"));

const bg = () =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const beforeDark = await bg();
await page.locator('label[for="theme-light"]').click();
await page.waitForTimeout(150);
const afterLight = await bg();
await page.screenshot({ path: join(out, "nojs-light.png") });
await page.locator('label[for="theme-dark"]').click();
await page.waitForTimeout(150);
const afterDark = await bg();

if (afterLight === beforeDark) {
  problems.push(`no-JS toggle did not switch to light (stayed ${afterLight})`);
}
if (afterDark !== beforeDark) {
  problems.push(`no-JS toggle did not switch back to dark (got ${afterDark})`);
}
console.log(
  `no-JS toggle: default ${beforeDark} -> light ${afterLight} -> dark ${afterDark}`
);
await noJs.close();

/* ---------- the legal pages render and carry the same chrome ---------- */
const check = await browser.newContext({
  viewport: { width: 1280, height: 1400 },
});
const legal = await check.newPage();
for (const name of ["privacy.html", "terms.html", "security.html"]) {
  await legal.goto(url(name));
  const counts = await legal.evaluate(() => ({
    h1: document.querySelectorAll("h1").length,
    toggle: document.querySelectorAll('input[name="theme"]').length,
    footLinks: document.querySelectorAll(".foot-links a").length,
    words: (document.body.innerText.match(/\S+/g) || []).length,
  }));
  console.log(`${name}: ${JSON.stringify(counts)}`);
  if (counts.h1 !== 1 || counts.toggle !== 3 || counts.footLinks < 5) {
    problems.push(`${name}: chrome mismatch ${JSON.stringify(counts)}`);
  }
  await legal.screenshot({
    path: join(out, name.replace(".html", "")) + ".png",
  });
}
await check.close();

/* ---------- every page is fully rendered without scripting ---------- */
const withJs = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const withoutJs = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  javaScriptEnabled: false,
});
const a = await withJs.newPage();
const b = await withoutJs.newPage();
const text = async (page, name) => {
  await page.goto(url(name));
  return page.evaluate(() =>
    (document.body.innerText || "").replace(/\s+/g, " ").trim()
  );
};
for (const name of ["index.html", "privacy.html", "terms.html", "security.html"]) {
  const scripted = await text(a, name);
  const plain = await text(b, name);
  if (scripted !== plain) {
    problems.push(
      `${name}: content differs with scripting off (${scripted.length} vs ${plain.length} chars)`
    );
  } else {
    console.log(`${name}: static, ${plain.length} chars either way`);
  }
}
await withJs.close();
await withoutJs.close();

await browser.close();
server.close();

if (problems.length) {
  console.log("\nPROBLEMS");
  for (const p of problems) {
    console.log(`  - ${p}`);
  }
  process.exit(1);
}
console.log("\nno problems");
