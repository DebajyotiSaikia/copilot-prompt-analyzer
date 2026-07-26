import * as vscode from "vscode";

export type WebviewHost = "panel" | "sidebar";

function nonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export function webviewOptions(
  extensionUri: vscode.Uri
): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
  };
}

/** The same bundle serves both hosts; `data-host` drives the compact layout. */
export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  host: WebviewHost
): string {
  const asset = (file: string): vscode.Uri =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", file));
  const key = nonce();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none';
      img-src ${webview.cspSource} https: data:;
      style-src ${webview.cspSource} 'unsafe-inline';
      font-src ${webview.cspSource};
      script-src 'nonce-${key}';" />
    <link rel="stylesheet" href="${asset("webview.css")}" />
    <title>Copilot Prompt Analyzer</title>
  </head>
  <body data-host="${host}" data-nonce="${key}" data-mermaid-uri="${asset("mermaid.js")}">
    <div id="root"></div>
    <script nonce="${key}" src="${asset("webview.js")}"></script>
  </body>
</html>`;
}
