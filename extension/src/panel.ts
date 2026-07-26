import * as vscode from "vscode";

import type { AnalyzerService } from "./service";
import { renderWebviewHtml, webviewOptions } from "./webviewHtml";

/** Full-width dashboard hosted in an editor tab. */
export class AnalyzerPanel {
  private static current: AnalyzerPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    service: AnalyzerService
  ) {
    this.panel.webview.html = renderWebviewHtml(
      this.panel.webview,
      extensionUri,
      "panel"
    );
    this.disposables.push(service.attach(this.panel.webview));
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static show(
    context: vscode.ExtensionContext,
    service: AnalyzerService
  ): AnalyzerPanel {
    const column =
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (AnalyzerPanel.current) {
      AnalyzerPanel.current.panel.reveal(column);
      return AnalyzerPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      "copilotChatAnalyzer",
      "Copilot Chat Analyzer",
      column,
      { ...webviewOptions(context.extensionUri), retainContextWhenHidden: true }
    );
    AnalyzerPanel.current = new AnalyzerPanel(
      panel,
      context.extensionUri,
      service
    );
    return AnalyzerPanel.current;
  }

  dispose(): void {
    AnalyzerPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
