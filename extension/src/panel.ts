import * as vscode from "vscode";

import type { AnalyzerService } from "./service";
import {
  renderWebviewHtml,
  webviewOptions,
  type WebviewPage,
} from "./webviewHtml";

interface PanelSpec {
  viewType: string;
  title: string;
  icon: string;
}

const SPECS: Record<WebviewPage, PanelSpec> = {
  analyzer: {
    viewType: "copilotPromptAnalyzer",
    title: "Copilot Prompt Analyzer",
    icon: "graph",
  },
  dashboard: {
    viewType: "copilotPromptAnalyzerDashboard",
    title: "Prompt Dashboard",
    icon: "pulse",
  },
};

/**
 * Full-width surfaces hosted in editor tabs. The analyzer and the dashboard are
 * separate tabs rather than one tabbed view, so both can be open side by side
 * and each keeps its own scroll position.
 */
export class AnalyzerPanel {
  private static readonly open = new Map<WebviewPage, AnalyzerPanel>();

  private readonly disposables: vscode.Disposable[] = [];
  private readonly page: WebviewPage;
  private readonly panel: vscode.WebviewPanel;

  private constructor(
    panel: vscode.WebviewPanel,
    page: WebviewPage,
    extensionUri: vscode.Uri,
    service: AnalyzerService
  ) {
    this.panel = panel;
    this.page = page;
    this.panel.webview.html = renderWebviewHtml(
      this.panel.webview,
      extensionUri,
      "panel",
      page
    );
    this.disposables.push(service.attach(this.panel.webview));
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static show(
    context: vscode.ExtensionContext,
    service: AnalyzerService,
    page: WebviewPage = "analyzer"
  ): AnalyzerPanel {
    const column =
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const existing = AnalyzerPanel.open.get(page);
    if (existing) {
      existing.panel.reveal(column);
      return existing;
    }

    const spec = SPECS[page];
    const panel = vscode.window.createWebviewPanel(
      spec.viewType,
      spec.title,
      column,
      { ...webviewOptions(context.extensionUri), retainContextWhenHidden: true }
    );
    panel.iconPath = new vscode.ThemeIcon(spec.icon);

    const instance = new AnalyzerPanel(
      panel,
      page,
      context.extensionUri,
      service
    );
    AnalyzerPanel.open.set(page, instance);
    return instance;
  }

  dispose(): void {
    AnalyzerPanel.open.delete(this.page);
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
