import mermaid from "mermaid";

// Loaded on demand as a separate bundle; see webview/mermaid.ts.
// The window property is declared in webview/mermaid.ts.
(window as unknown as { __mermaid: unknown }).__mermaid = mermaid;
