// Step 1: prove we can launch a real VS Code with the extension installed and
// attach to it over CDP. Prints what it found and leaves the window open.
import { connect, launch, prepare, paths } from "./vscode-driver.mjs";

prepare({ fresh: process.argv.includes("--fresh") });
launch();

const { browser, page, version } = await connect();
console.log("browser:", version.Browser);
console.log("page url:", page.url().slice(0, 90));

const info = await page.evaluate(() => ({
  title: document.title,
  workbench: !!document.querySelector(".monaco-workbench"),
  activityBarItems: [...document.querySelectorAll(".activitybar .action-item")]
    .map((el) => el.getAttribute("aria-label"))
    .filter(Boolean),
}));
console.log("title:", info.title);
console.log("workbench present:", info.workbench);
console.log("activity bar:", info.activityBarItems.join(" | "));
console.log("scratch profile:", paths.scratch);

await browser.close();
