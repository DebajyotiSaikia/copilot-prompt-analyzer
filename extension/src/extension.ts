import * as vscode from "vscode";

import { AnalyzerPanel } from "./panel";
import { AnalyzerService } from "./service";
import { AnalyzerSidebar } from "./sidebar";
import { AnalyzerStore } from "./store";

export function activate(context: vscode.ExtensionContext): void {
  const store = new AnalyzerStore(context.globalState);
  const service = new AnalyzerService(context, store);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AnalyzerSidebar.viewId,
      new AnalyzerSidebar(context.extensionUri, service),
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.commands.registerCommand("copilotPromptAnalyzer.open", () => {
      AnalyzerPanel.show(context, service);
    }),
    vscode.commands.registerCommand("copilotPromptAnalyzer.focus", async () => {
      await vscode.commands.executeCommand(`${AnalyzerSidebar.viewId}.focus`);
    }),
    vscode.commands.registerCommand("copilotPromptAnalyzer.reindex", async () => {
      await service.rescan();
    }),
    vscode.commands.registerCommand(
      "copilotPromptAnalyzer.classify",
      async () => {
        await service.classify(false);
      }
    ),
    vscode.commands.registerCommand(
      "copilotPromptAnalyzer.exportJson",
      async () => {
        await service.exportJson();
      }
    ),
    vscode.commands.registerCommand(
      "copilotPromptAnalyzer.toggleDemo",
      async () => {
        const next = !service.isDemoMode;
        await service.setDemoMode(next);
        if (next) {
          await vscode.commands.executeCommand("copilotPromptAnalyzer.open");
        }
      }
    )
  );
}

export function deactivate(): void {
  /* nothing to clean up */
}
