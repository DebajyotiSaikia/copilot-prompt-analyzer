// Probe: does the demo scratch profile have usable Copilot models?
// Launches the scratch VS Code, opens the analyzer, and reads the model picker.
import { connect, launch, prepare, runCommand } from "./vscode-driver.mjs";

prepare({ fresh: false });
launch();

const { browser, page } = await connect();
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForTimeout(3000);

await runCommand(page, "Copilot Prompt Analyzer: Toggle Demo Data");
await page.waitForTimeout(3000);

let frame = null;
const deadline = Date.now() + 25000;
while (Date.now() < deadline && !frame) {
  for (const candidate of page.frames()) {
    try {
      const cards = await candidate.evaluate(
        () => document.querySelectorAll(".area-card").length
      );
      if (cards > 0) {
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
  console.log("analyzer webview not found");
} else {
  const before = await frame.evaluate(() => ({
    modelButton: document.querySelector(".model-btn")?.textContent?.trim(),
  }));
  console.log("model button:", JSON.stringify(before.modelButton));

  await frame.locator(".model-btn").first().click({ force: true });
  await page.waitForTimeout(3000);

  const models = await frame.evaluate(() =>
    Array.from(document.querySelectorAll("#cca-model option")).map((el) =>
      el.textContent?.trim()
    )
  );
  console.log("model options:", models.length);
  for (const m of models.slice(0, 12)) {
    console.log("  -", m);
  }
}

// Is the workbench still showing a sign-in affordance?
const signIn = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a,button,.monaco-button"))
    .map((el) => el.textContent?.trim() ?? "")
    .filter((t) => /sign in/i.test(t))
    .slice(0, 5)
);
console.log("sign-in affordances:", JSON.stringify(signIn));

if (!process.argv.includes("--keep")) {
  await browser.close();
}
