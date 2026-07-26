// Opens the dashboard page in the scratch profile and captures it, so the
// layout can be checked without a full demo recording.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, launch, prepare, runCommand } from "./vscode-driver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, "shots");
mkdirSync(shots, { recursive: true });

prepare({ fresh: false });
launch();

const { browser, page } = await connect();
await page.setViewportSize({ width: 1920, height: 1080 });
await page.waitForTimeout(3000);

await runCommand(page, "View: Close Secondary Side Bar");
await page.waitForTimeout(800);
await runCommand(page, "Copilot Prompt Analyzer: Toggle Demo Data");
await page.waitForTimeout(2500);
await runCommand(page, "Copilot Prompt Analyzer: Open Dashboard");
await page.waitForTimeout(4000);
await runCommand(page, "View: Close Secondary Side Bar");
await page.waitForTimeout(1000);

await page.evaluate(() => {
  for (const el of document.querySelectorAll(
    ".notifications-toasts,.context-view,.context-view-block,.monaco-menu-container"
  )) {
    el.remove();
  }
});

let frame = null;
const deadline = Date.now() + 25000;
while (Date.now() < deadline && !frame) {
  for (const candidate of page.frames()) {
    try {
      const found = await candidate.evaluate(
        () => document.querySelectorAll(".chart-card").length
      );
      if (found > 0) {
        frame = candidate;
        break;
      }
    } catch {
      // still loading
    }
  }
  if (!frame) {
    await page.waitForTimeout(400);
  }
}

if (!frame) {
  console.log("dashboard not found");
  await page.screenshot({ path: join(shots, "dash-missing.png") });
} else {
  const summary = await frame.evaluate(() => ({
    cards: document.querySelectorAll(".chart-card").length,
    stats: document.querySelectorAll(".stat").length,
    empties: Array.from(document.querySelectorAll(".chart-empty")).map((el) =>
      el.textContent?.trim().slice(0, 60)
    ),
  }));
  console.log("dashboard:", JSON.stringify(summary, null, 2));

  await page.screenshot({ path: join(shots, "dash-top.png") });

  // Walk down the page so every section gets captured.
  for (let i = 1; i <= 9; i++) {
    await frame.evaluate(() => {
      document.querySelector(".dashboard-main")?.scrollBy({ top: 950 });
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(shots, `dash-${i}.png`) });
  }
}

if (!process.argv.includes("--keep")) {
  await browser.close();
}
