import * as vscode from "vscode";

import type { AnalyzerService } from "./service";
import { renderWebviewHtml, webviewOptions } from "./webviewHtml";

/** Compact dashboard hosted in the activity bar. */
export class AnalyzerSidebar implements vscode.WebviewViewProvider {
  static readonly viewId = "copilotChatAnalyzer.view";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: AnalyzerService
  ) {}

  resolveWebviewView(
    view: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    view.webview.options = webviewOptions(this.extensionUri);
    view.webview.html = renderWebviewHtml(
      view.webview,
      this.extensionUri,
      "sidebar"
    );

    const attachment = this.service.attach(view.webview);
    view.onDidDispose(() => attachment.dispose());
  }
}
