// Drives the real extension in a real VS Code window and captures stills and,
// optionally, a narrated video of the actual product.
//
//   node demo/capture.mjs                stills only
//   node demo/capture.mjs --video        record frames, stitch, and add voiceover
//   node demo/capture.mjs --fresh        rebuild the scratch profile first
//   node demo/capture.mjs --keep         leave VS Code running when finished
//   node demo/capture.mjs --silent       skip the voiceover
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, launch, prepare, runCommand } from "./vscode-driver.mjs";
import { muxVoice, renderVoice } from "./voiceover.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, "shots");
const frames = join(here, "frames");
// Standard 1080p so the recording drops straight into a video timeline.
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 5;

const wantVideo = process.argv.includes("--video");
const wantVoice = wantVideo && !process.argv.includes("--silent");
mkdirSync(shots, { recursive: true });
if (wantVideo) {
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
}

// Rendered up front: knowing how long each line takes to read is what lets a
// beat hold the screen until the narration for it has finished.
const voice = wantVoice ? await renderVoice() : {};
const cues = [];

let stillIndex = 0;
let frameIndex = 0;
let recorder = null;

async function shot(page, name) {
  stillIndex += 1;
  const file = join(
    shots,
    `${String(stillIndex).padStart(2, "0")}-${name}.png`
  );
  await tidyWorkbench(page);
  await page.screenshot({ path: file });
  console.log("still:", name);
  return file;
}

/** Captures frames on a timer so the video shows real motion, not a slideshow. */
function startRecording(page) {
  if (!wantVideo) {
    return;
  }
  let busy = false;
  recorder = setInterval(
    async () => {
      if (busy) {
        return;
      }
      busy = true;
      try {
        frameIndex += 1;
        await page.screenshot({
          path: join(frames, `${String(frameIndex).padStart(5, "0")}.png`),
        });
      } catch {
        // window closing
      } finally {
        busy = false;
      }
    },
    Math.round(1000 / FPS)
  );
}

function stopRecording() {
  if (recorder) {
    clearInterval(recorder);
    recorder = null;
  }
}

/** Holds a beat on screen so it is readable in the video. */
async function hold(page, ms) {
  await page.waitForTimeout(ms);
}

/**
 * Waits until the *video* clock reaches a point. Screenshots do not always keep
 * up with the frame rate, so wall time runs ahead of the stitched timeline;
 * counting frames is what keeps the narration aligned with the picture.
 */
async function holdUntil(page, videoSeconds) {
  const wallCap = Date.now() + 90000;
  while (frameIndex / FPS < videoSeconds && Date.now() < wallCap) {
    await page.waitForTimeout(150);
  }
}

/**
 * One narrated beat. The cue is stamped with the current video time, the action
 * plays underneath the line, and the screen is then held until the line has
 * finished so the picture never runs ahead of the words.
 */
async function beat(page, id, action) {
  const clip = voice[id];
  const at = frameIndex / FPS;
  if (clip) {
    cues.push({ id, at, file: clip.file, ends: at + clip.duration });
  }
  await action();
  if (clip) {
    await holdUntil(page, at + clip.duration + 0.6);
  }
}

/**
 * Continuous frame capture keeps elements from ever satisfying Playwright's
 * "stable" check, so clicks bypass actionability. The selectors are verified to
 * exist before use, so this loses nothing.
 */
async function clickIn(frame, selector) {
  await frame.locator(selector).first().click({ force: true, timeout: 8000 });
}

/**
 * The analyzer renders in a webview, which is a nested iframe. Both the sidebar
 * view and the editor panel match, so the widest one wins — that is the panel.
 */
async function analyzerFrame(page, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let best = null;
    let bestWidth = 0;
    for (const frame of page.frames()) {
      try {
        const found = await frame.evaluate(() => ({
          cards: document.querySelectorAll(".area-card").length,
          width: document.body.clientWidth,
        }));
        if (found.cards > 0 && found.width > bestWidth) {
          best = frame;
          bestWidth = found.width;
        }
      } catch {
        // detached or still loading
      }
    }
    if (best) {
      return best;
    }
    await page.waitForTimeout(400);
  }
  return null;
}

/**
 * Removes first-run noise that adds nothing to the story. Stray context menus
 * also install a full-window click blocker, which silently eats later clicks.
 */
async function tidyWorkbench(page) {
  await page.evaluate(() => {
    const noise = [
      ".notifications-toasts",
      ".context-view",
      ".context-view-block",
      ".context-view-pointerBlock",
      ".monaco-menu-container",
    ];
    for (const el of document.querySelectorAll(noise.join(","))) {
      el.remove();
    }
  });
}

// `--attach` drives an already-running VS Code (started with
// --remote-debugging-port) instead of launching a scratch profile. That instance
// is signed in to Copilot, so the AI beats actually run.
const attach = process.argv.includes("--attach");
if (!attach) {
  prepare({ fresh: process.argv.includes("--fresh") });
  launch();
}

const { browser, page } = await connect();
await page.setViewportSize({ width: WIDTH, height: HEIGHT });
await hold(page, 2500);

// The Copilot Chat pane opens itself on a fresh profile and eats a third of the
// frame; the demo is about the analyzer, not the chat.
await runCommand(page, "View: Close Secondary Side Bar");
await hold(page, 800);
await tidyWorkbench(page);

// Never film real chat history. This also opens the analyzer in the editor.
await runCommand(page, "Copilot Chat Analyzer: Toggle Demo Data");
await hold(page, 2500);

// Put the extension's own view in the side bar rather than the file explorer.
await runCommand(page, "Copilot Chat Analyzer: Show Analyzer Sidebar");
await hold(page, 2000);
await tidyWorkbench(page);

startRecording(page);

const frame = await analyzerFrame(page);
if (!frame) {
  await shot(page, "no-webview");
  stopRecording();
  await browser.close();
  throw new Error("Analyzer webview not found");
}

const summary = await frame.evaluate(() => ({
  cards: document.querySelectorAll(".area-card").length,
  prompts: document.querySelector(".metric-value")?.textContent,
}));
console.log("analyzer:", JSON.stringify(summary));

await beat(page, "intro", async () => {
  await hold(page, 1200);
  await shot(page, "areas");
});

// Scroll the grid so several areas pass by.
await beat(page, "areas", async () => {
  for (let i = 0; i < 3; i++) {
    await frame.evaluate(() => {
      document
        .querySelector(".area-grid")
        ?.scrollBy({ top: 320, behavior: "smooth" });
    });
    await hold(page, 900);
  }
  await frame.evaluate(() => {
    document
      .querySelector(".area-grid")
      ?.scrollTo({ top: 0, behavior: "smooth" });
  });
  await hold(page, 900);
});

// Model controls.
await beat(page, "model", async () => {
  await clickIn(frame, ".model-btn");
  await hold(page, 1400);
  await shot(page, "model-controls");
});
await clickIn(frame, ".model-btn");
await hold(page, 700);

// Filtering narrows every view at once.
const search = frame.locator(".search-box input");
await beat(page, "search", async () => {
  await search.click({ force: true, timeout: 8000 });
  await search.type("cache", { delay: 90 });
  await hold(page, 1600);
  await shot(page, "filtered");
});
await search.fill("");
await hold(page, 1000);

await beat(page, "prompts", async () => {
  await clickIn(frame, '.tabs button:text-is("Prompts")');
  await hold(page, 1500);
  await shot(page, "prompts");
});

// Open one row so the detail drawer is on camera.
const row = frame.locator(".prompt-table tbody tr").first();
if (await row.count()) {
  await beat(page, "detail", async () => {
    await row.click({ force: true, timeout: 8000 });
    await hold(page, 1800);
    await shot(page, "detail");
  });
  await clickIn(frame, ".detail .icon-btn");
  await hold(page, 700);
}

await beat(page, "timeline", async () => {
  await clickIn(frame, '.tabs button:text-is("Timeline")');
  await hold(page, 1500);
  await shot(page, "timeline");
});

await beat(page, "insights", async () => {
  await clickIn(frame, '.tabs button:text-is("Insights")');
  await hold(page, 1500);
  await shot(page, "insights");
});

// A locally computed report opens instantly and needs no model.
const reportCard = frame.locator(".insight-card", {
  hasText: "Prompt quality",
});
if (await reportCard.count()) {
  await beat(page, "report", async () => {
    await reportCard.first().click({ force: true, timeout: 8000 });
    await hold(page, 2600);
    await shot(page, "report");
    await frame.evaluate(() => {
      document
        .querySelector(".studio-body")
        ?.scrollBy({ top: 260, behavior: "smooth" });
    });
    await hold(page, 1600);
    await shot(page, "report-scrolled");
  });
  await page.keyboard.press("Escape");
  await hold(page, 700);
}

await beat(page, "outro", async () => {
  await clickIn(frame, '.tabs button:text-is("Areas")');
  await hold(page, 1200);
});

// Leave a moment of picture after the last word so nothing is clipped.
const lastCue = cues.reduce((max, cue) => Math.max(max, cue.ends ?? 0), 0);
await holdUntil(page, lastCue + 1.5);

stopRecording();

if (wantVideo && frameIndex > 0) {
  const mp4 = join(here, "demo.mp4");
  const silent = join(here, "demo-silent.mp4");
  const gif = join(here, "demo.gif");
  console.log(`stitching ${frameIndex} frames…`);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      String(FPS),
      "-i",
      join(frames, "%05d.png"),
      "-vf",
      "scale=1920:-2:flags=lanczos",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "20",
      silent,
    ],
    { stdio: "ignore" }
  );

  if (wantVoice && muxVoice(silent, cues, mp4)) {
    rmSync(silent, { force: true });
    console.log(`voiceover: ${cues.length} lines`);
  } else {
    renameSync(silent, mp4);
  }

  // The GIF is a silent teaser for the README, so it only needs the opening.
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      String(FPS),
      "-i",
      join(frames, "%05d.png"),
      "-t",
      "22",
      "-vf",
      "fps=10,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
      gif,
    ],
    { stdio: "ignore" }
  );
  console.log("video:", mp4);
  console.log("gif  :", gif);
}

console.log("\nstills:", shots);
if (!process.argv.includes("--keep")) {
  await browser.close();
}
