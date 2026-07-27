// Audits the deployed site against the six requirements it was built to meet.
// Points at production by default so the answer is about what is actually live.
//
//   node scripts/site-audit.mjs
//   node scripts/site-audit.mjs http://127.0.0.1:8080
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "extension", "package.json"));
const { chromium, devices } = require("playwright-core");

const ORIGIN = (process.argv[2] ?? "https://prompts.deb0.com").replace(
  /\/$/,
  ""
);
const PAGES = [
  "/",
  "/privacy.html",
  "/terms.html",
  "/security.html",
  "/sitemap.html",
];

const results = [];
const fail = [];
const ok = (item, detail) => results.push(["PASS", item, detail]);
const bad = (item, detail) => {
  results.push(["FAIL", item, detail]);
  fail.push(`${item}: ${detail}`);
};

/*
 * Every read here depends on the stylesheet having been applied: colours come
 * from custom properties, and innerText is affected by text-transform. Reading
 * at domcontentloaded races the CSS and produces convincing nonsense - a
 * transparent background, or two strings of identical length that differ only
 * in case.
 */
async function settle(pg, path) {
  await pg.goto(ORIGIN + path, { waitUntil: "load" });
  await pg.waitForFunction(
    () =>
      getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)",
    null,
    { timeout: 10000 }
  );
}

const browser = await chromium.launch();
const page = await browser.newPage();

/* ---------- 1. icons ---------- */
const ICONS = [
  ["/favicon.svg", "image/svg+xml"],
  ["/favicon-32.png", "image/png"],
  ["/favicon-16.png", "image/png"],
  ["/apple-touch-icon.png", "image/png"],
  ["/mask-icon.svg", "image/svg+xml"],
  ["/icon-192.png", "image/png"],
  ["/icon-512.png", "image/png"],
  ["/icon-maskable-512.png", "image/png"],
  ["/site.webmanifest", null],
];
for (const [path, type] of ICONS) {
  const res = await fetch(ORIGIN + path);
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    bad("1 icons", `${path} -> ${res.status}`);
  } else if (type && !ct.includes(type)) {
    bad("1 icons", `${path} served as ${ct}, expected ${type}`);
  } else {
    ok("1 icons", `${path} ${res.status} ${ct.split(";")[0]}`);
  }
}

// iOS paints any transparency black, so the Apple icon must be fully opaque.
const opacity = await page.evaluate(async (origin) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = origin + "/apple-touch-icon.png";
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const corners = [
    [0, 0],
    [img.width - 1, 0],
    [0, img.height - 1],
    [img.width - 1, img.height - 1],
  ].map(([px, py]) => x.getImageData(px, py, 1, 1).data[3]);
  return { size: `${img.width}x${img.height}`, corners };
}, ORIGIN);
if (opacity.size !== "180x180") {
  bad("1 icons", `apple-touch-icon is ${opacity.size}, expected 180x180`);
} else if (opacity.corners.some((a) => a !== 255)) {
  bad("1 icons", `apple-touch-icon has transparent corners ${opacity.corners}`);
} else {
  ok("1 icons", `apple-touch-icon 180x180, fully opaque (iOS-safe)`);
}

const manifest = await (await fetch(ORIGIN + "/site.webmanifest")).json();
if (!manifest.icons?.some((i) => i.purpose === "maskable")) {
  bad("1 icons", "manifest has no maskable icon");
} else {
  ok("1 icons", `manifest: ${manifest.icons.length} icons, maskable present`);
}

/* ---------- per-page head checks: 1, 3, 4 ---------- */
for (const path of PAGES) {
  await settle(page, path);
  const head = await page.evaluate(() => {
    const attr = (sel, a) =>
      document.querySelector(sel)?.getAttribute(a) ?? null;
    const ld = [
      ...document.querySelectorAll('script[type="application/ld+json"]'),
    ]
      .flatMap((s) => {
        const j = JSON.parse(s.textContent);
        return j["@graph"] ?? [j];
      })
      .map((n) => n["@type"]);
    return {
      title: document.title,
      description: attr('meta[name="description"]', "content"),
      canonical: attr('link[rel="canonical"]', "href"),
      author: attr('meta[name="author"]', "content"),
      robots: attr('meta[name="robots"]', "content"),
      og: [...document.querySelectorAll('meta[property^="og:"]')].length,
      twitter: [...document.querySelectorAll('meta[name^="twitter:"]')].length,
      themeColors: document.querySelectorAll('meta[name="theme-color"]').length,
      appleIcon: !!document.querySelector('link[rel="apple-touch-icon"]'),
      maskIcon: !!document.querySelector('link[rel="mask-icon"]'),
      manifest: !!document.querySelector('link[rel="manifest"]'),
      appleCapable: attr(
        'meta[name="apple-mobile-web-app-capable"]',
        "content"
      ),
      viewport: attr('meta[name="viewport"]', "content"),
      ld,
      brandMark: (() => {
        const img = document.querySelector("img.brand-mark");
        return img ? img.complete && img.naturalWidth > 0 : false;
      })(),
      toggles: document.querySelectorAll('input[name="theme"]').length,
      footLinks: [...document.querySelectorAll(".foot-links a")].map((a) =>
        a.getAttribute("href")
      ),
    };
  });

  const label = path === "/" ? "home" : path;
  const problems = [];
  if (!head.description || head.description.length < 70)
    problems.push("description");
  if (!head.canonical?.startsWith("https://prompts.deb0.com"))
    problems.push("canonical");
  if (head.author !== "Debajyoti Saikia") problems.push("author");
  if (!head.robots?.includes("index")) problems.push("robots");
  if (head.og < 8) problems.push(`og(${head.og})`);
  if (head.twitter < 4) problems.push(`twitter(${head.twitter})`);
  if (!head.ld.length) problems.push("json-ld");
  if (problems.length) {
    bad("3 seo", `${label}: missing ${problems.join(", ")}`);
  } else {
    ok(
      "3 seo",
      `${label}: og x${head.og}, twitter x${head.twitter}, ld ${head.ld.join("+")}`
    );
  }

  if (!head.appleIcon || !head.maskIcon || !head.manifest) {
    bad("1 icons", `${label}: missing apple/mask/manifest link`);
  }
  if (
    head.appleCapable !== "yes" ||
    !head.viewport?.includes("viewport-fit=cover")
  ) {
    bad("6 mobile", `${label}: apple-web-app-capable/viewport-fit missing`);
  }
  if (!head.brandMark) {
    bad("1 icons", `${label}: brand mark did not decode`);
  }
  if (head.toggles !== 3) {
    bad("2 theme", `${label}: ${head.toggles} theme states, expected 3`);
  }
  for (const needed of ["/privacy.html", "/terms.html", "/security.html"]) {
    if (!head.footLinks.includes(needed)) {
      bad("4 legal", `${label}: footer does not link ${needed}`);
    }
  }
}
ok("1 icons", "every page links apple-touch-icon, mask-icon and the manifest");
ok("2 theme", "every page carries all three theme states");
ok("4 legal", "privacy, terms and security linked from every footer");

/* ---------- 3. author identity in the graph ---------- */
await settle(page, "/");
const person = await page.evaluate(() => {
  const g = JSON.parse(
    document.querySelector('script[type="application/ld+json"]').textContent
  );
  return (g["@graph"] ?? []).find((n) => n["@type"] === "Person") ?? null;
});
if (
  person?.name === "Debajyoti Saikia" &&
  person.worksFor?.name === "Microsoft" &&
  person.sameAs?.length >= 3
) {
  ok(
    "3 seo",
    `Person: ${person.name}, ${person.jobTitle} @ ${person.worksFor.name}, sameAs ${person.sameAs.length}`
  );
} else {
  bad("3 seo", `Person node incomplete: ${JSON.stringify(person)}`);
}

for (const [path, needle] of [
  ["/robots.txt", "sitemap.xml"],
  ["/sitemap.xml", "<loc>"],
]) {
  const res = await fetch(ORIGIN + path);
  const body = await res.text();
  if (res.ok && body.includes(needle)) {
    const count = path.endsWith(".xml")
      ? ` (${[...body.matchAll(/<loc>/g)].length} urls)`
      : "";
    ok("3 seo", `${path} ${res.status}${count}`);
  } else {
    bad("3 seo", `${path} -> ${res.status}`);
  }
}

/* ---------- 2. theme toggle, including with scripting off ---------- */
const noJs = await browser.newContext({
  javaScriptEnabled: false,
  colorScheme: "dark",
});
const plain = await noJs.newPage();
await settle(plain, "/");
const bg = () =>
  plain.evaluate(() => getComputedStyle(document.body).backgroundColor);
const d0 = await bg();
await plain.locator('label[for="theme-light"]').click();
await plain.waitForTimeout(150);
const l1 = await bg();
await plain.locator('label[for="theme-dark"]').click();
await plain.waitForTimeout(150);
const d1 = await bg();
if (d0 !== l1 && d1 === d0) {
  ok("2 theme", `no JavaScript: ${d0} -> ${l1} -> ${d1}`);
} else {
  bad("2 theme", `no-JS switching broken: ${d0} -> ${l1} -> ${d1}`);
}
await noJs.close();

// System state has to actually follow the OS.
for (const scheme of ["dark", "light"]) {
  const ctx = await browser.newContext({ colorScheme: scheme });
  const p = await ctx.newPage();
  await settle(p, "/");
  const colour = await p.evaluate(
    () => getComputedStyle(document.body).backgroundColor
  );
  const expected = scheme === "dark" ? "rgb(11, 11, 20)" : "rgb(255, 255, 255)";
  if (colour === expected) {
    ok("2 theme", `system follows OS ${scheme} -> ${colour}`);
  } else {
    bad("2 theme", `system/${scheme} rendered ${colour}, expected ${expected}`);
  }
  await ctx.close();
}

// Persistence across a navigation.
const persist = await browser.newContext({ colorScheme: "dark" });
const pp = await persist.newPage();
await settle(pp, "/");
await pp.locator('label[for="theme-light"]').click();
await pp.waitForTimeout(150);
await settle(pp, "/terms.html");
const carried = await pp.evaluate(
  () => getComputedStyle(document.body).backgroundColor
);
if (carried === "rgb(255, 255, 255)") {
  ok("2 theme", `choice persists across pages -> ${carried}`);
} else {
  bad("2 theme", `choice did not persist: ${carried}`);
}
await persist.close();

/* ---------- 5. static rendering ---------- */
const withJs = await browser.newContext();
const withoutJs = await browser.newContext({ javaScriptEnabled: false });
const a = await withJs.newPage();
const b = await withoutJs.newPage();
for (const path of PAGES) {
  const read = async (pg) => {
    await settle(pg, path);
    return pg.evaluate(() =>
      (document.body.innerText || "").replace(/\s+/g, " ").trim()
    );
  };
  const scripted = await read(a);
  const bare = await read(b);
  if (scripted === bare && bare.length > 200) {
    ok("5 static", `${path} identical without JS (${bare.length} chars)`);
  } else {
    bad("5 static", `${path} differs: ${scripted.length} vs ${bare.length}`);
  }
}
await withJs.close();
await withoutJs.close();

/* ---------- 6. Apple form factors ---------- */
const FACTORS = [
  ["iPhone SE", devices["iPhone SE"]],
  ["iPhone 15", devices["iPhone 15"]],
  ["iPhone 15 landscape", devices["iPhone 15 landscape"]],
  ["iPad Mini", devices["iPad Mini"]],
  ["iPad Pro 11", devices["iPad Pro 11"]],
  ["iPad Pro 11 landscape", devices["iPad Pro 11 landscape"]],
];
for (const [name, device] of FACTORS) {
  const ctx = await browser.newContext({ ...device, colorScheme: "dark" });
  const p = await ctx.newPage();
  let worst = null;
  for (const path of PAGES) {
    await settle(p, path);
    const m = await p.evaluate(() => {
      const d = document.documentElement;
      const t = document.querySelector('label[for="theme-dark"]');
      const r = t?.getBoundingClientRect();
      return {
        over: d.scrollWidth - d.clientWidth,
        tap: r ? [Math.round(r.width), Math.round(r.height)] : null,
      };
    });
    if (m.over > 1) {
      worst = `${path} overflows by ${m.over}px`;
    }
    if (m.tap && (m.tap[0] < 44 || m.tap[1] < 40)) {
      worst = `${path} tap target ${m.tap.join("x")}`;
    }
  }
  if (worst) {
    bad("6 mobile", `${name}: ${worst}`);
  } else {
    ok(
      "6 mobile",
      `${name} (${device.viewport.width}x${device.viewport.height}): no overflow, 44px targets`
    );
  }
  await ctx.close();
}

await browser.close();

/* ---------- report ---------- */
const GROUPS = {
  "1 icons": "1. Favicon / tab icon, mac + iPad",
  "2 theme": "2. Three-state theme toggle",
  "3 seo": "3. Comprehensive SEO",
  "4 legal": "4. Security, privacy, terms pages",
  "5 static": "5. Statically rendered, no JS",
  "6 mobile": "6. iPhone / iPad form factors",
};
console.log(`audit of ${ORIGIN}\n`);
for (const [key, title] of Object.entries(GROUPS)) {
  const rows = results.filter((r) => r[1] === key);
  const failed = rows.filter((r) => r[0] === "FAIL").length;
  console.log(`${failed ? "FAIL" : "PASS"}  ${title}`);
  for (const [state, , detail] of rows) {
    console.log(`      ${state === "PASS" ? "+" : "!"} ${detail}`);
  }
  console.log("");
}
console.log(
  fail.length ? `${fail.length} FAILURE(S)` : "all six requirements met"
);
process.exit(fail.length ? 1 : 0);
