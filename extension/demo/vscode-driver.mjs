// Drives the real extension inside a real VS Code window over the Chrome
// DevTools Protocol, and captures screenshots of the actual product.
//
// VS Code is Electron, so it accepts --remote-debugging-port. A second instance
// only starts (rather than handing off to the running one) when it is given its
// own --user-data-dir, which is why this uses a scratch profile.
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(here, "..");
const PORT = Number(process.env.CCA_PORT ?? 9333);

const codeExe = join(
  process.env.LOCALAPPDATA,
  "Programs",
  "Microsoft VS Code",
  "Code.exe"
);
const codeCli = join(
  process.env.LOCALAPPDATA,
  "Programs",
  "Microsoft VS Code",
  "bin",
  "code.cmd"
);

const scratch = join(process.env.TEMP, "cca-demo-vscode");
const userDataDir = join(scratch, "user-data");
const extensionsDir = join(scratch, "extensions");
// The folder name is the window title on camera, so make it look like a project.
const workspaceDir = join(scratch, "storefront");

export function prepare({ fresh = false } = {}) {
  if (fresh) {
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const dir of [userDataDir, extensionsDir, workspaceDir]) {
    mkdirSync(dir, { recursive: true });
  }

  // Configure the window declaratively. Driving layout through the command
  // palette is unreliable — toggles depend on current state and can land on the
  // wrong view entirely.
  const settingsDir = join(userDataDir, "User");
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(
    join(settingsDir, "settings.json"),
    JSON.stringify(
      {
        "workbench.colorTheme": "Default Light Modern",
        "workbench.startupEditor": "none",
        "workbench.secondarySideBar.defaultVisibility": "hidden",
        "workbench.tips.enabled": false,
        "workbench.enableExperiments": false,
        "window.commandCenter": false,
        "chat.commandCenter.enabled": false,
        "editor.minimap.enabled": false,
        "extensions.ignoreRecommendations": true,
        "update.showReleaseNotes": false,
        "telemetry.telemetryLevel": "off",
        "window.zoomLevel": 0,
      },
      null,
      2
    ),
    "utf8"
  );
  // A tiny, believable project so the window is not empty on camera.
  writeFileSync(
    join(workspaceDir, "README.md"),
    "# storefront\n\nDemo workspace.\n",
    "utf8"
  );

  const vsix = join(extensionDir, "copilot-chat-analyzer-0.2.0.vsix");
  if (!existsSync(vsix)) {
    throw new Error(`VSIX not found: ${vsix}. Run vsce package first.`);
  }
  // code.cmd is a batch file, so Windows needs a shell; every path is quoted
  // because they all contain spaces.
  const quoted = (value) => `"${value}"`;
  execSync(
    [
      quoted(codeCli),
      "--user-data-dir",
      quoted(userDataDir),
      "--extensions-dir",
      quoted(extensionsDir),
      "--install-extension",
      quoted(vsix),
      "--force",
    ].join(" "),
    { stdio: "inherit" }
  );
}

/** Closes any VS Code still running on the scratch profile. */
export function closeScratch() {
  try {
    execSync(
      `powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \\"Name='Code.exe'\\" | Where-Object { $_.CommandLine -like '*cca-demo-vscode*' }) | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: "ignore" }
    );
  } catch {
    // nothing running
  }
}

export function launch() {
  // A second launch on the same profile would hand off to the running window
  // instead of starting a debuggable process, and would re-toggle demo mode.
  closeScratch();
  // The debugging port stays bound briefly after the old process dies.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);

  const child = spawn(
    codeExe,
    [
      `--remote-debugging-port=${PORT}`,
      "--user-data-dir",
      userDataDir,
      "--extensions-dir",
      extensionsDir,
      "--disable-workspace-trust",
      "--skip-release-notes",
      "--skip-welcome",
      "--disable-telemetry",
      "--new-window",
      workspaceDir,
    ],
    { detached: true, stdio: "ignore" }
  );
  child.unref();
  return child;
}

async function endpointReady(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("VS Code did not expose a debugging endpoint in time");
}

/** Returns the workbench page (the main VS Code window). */
export async function connect() {
  const version = await endpointReady();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const url = page.url();
        if (url.includes("workbench") || url.startsWith("vscode-file://")) {
          try {
            await page.waitForSelector(".monaco-workbench", { timeout: 5000 });
            return { browser, page, version };
          } catch {
            // keep looking
          }
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Could not find the VS Code workbench page");
}

/** Runs a command through the command palette. */
export async function runCommand(page, command) {
  await page.keyboard.press("Control+Shift+P");
  await page.waitForSelector(".quick-input-widget", { state: "visible" });
  await page.waitForTimeout(150);
  await page.keyboard.type(command, { delay: 12 });
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
}

export const paths = {
  scratch,
  userDataDir,
  extensionsDir,
  workspaceDir,
  PORT,
};
