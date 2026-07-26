/**
 * Mermaid is ~3.3 MB minified — far too much to parse on every webview load for a
 * feature that only applies when a generated document happens to contain a
 * diagram. It is built as a separate bundle and injected the first time one
 * appears.
 */

type Mermaid = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

declare global {
  interface Window {
    __mermaid?: Mermaid;
  }
}

let loader: Promise<Mermaid | null> | undefined;
let counter = 0;

function themeName(): string {
  const classes = document.body.className;
  if (classes.includes("vscode-high-contrast")) {
    return classes.includes("vscode-high-contrast-light") ? "neutral" : "dark";
  }
  return classes.includes("vscode-light") ? "default" : "dark";
}

function loadMermaid(): Promise<Mermaid | null> {
  if (loader) {
    return loader;
  }
  const src = document.body.dataset.mermaidUri;
  const nonce = document.body.dataset.nonce;
  if (!src) {
    loader = Promise.resolve(null);
    return loader;
  }

  loader = new Promise<Mermaid | null>((resolve) => {
    const script = document.createElement("script");
    // The IDL property must be set before insertion; the content attribute is
    // hidden from script by Chromium's nonce-hiding.
    if (nonce) {
      script.nonce = nonce;
    }
    script.src = src;
    script.onload = () => {
      const instance = window.__mermaid;
      if (!instance) {
        resolve(null);
        return;
      }
      instance.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: themeName(),
        fontFamily: "var(--vscode-font-family)",
      });
      resolve(instance);
    };
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return loader;
}

/**
 * Renders every unrendered mermaid block inside `root`. Blocks that fail to
 * parse keep their source visible rather than vanishing — model-authored mermaid
 * is frequently invalid.
 */
export async function renderMermaidBlocks(
  root: HTMLElement | null
): Promise<void> {
  if (!root) {
    return;
  }
  const blocks = [
    ...root.querySelectorAll<HTMLElement>(
      '.mermaid-block[data-state="pending"]'
    ),
  ];
  if (blocks.length === 0) {
    return;
  }
  for (const block of blocks) {
    block.dataset.state = "loading";
  }

  const instance = await loadMermaid();
  if (!instance) {
    for (const block of blocks) {
      block.dataset.state = "unavailable";
    }
    return;
  }

  for (const block of blocks) {
    const source =
      block.querySelector<HTMLElement>(".mermaid-src")?.textContent ?? "";
    const target = block.querySelector<HTMLElement>(".mermaid-out");
    if (!target || !source.trim()) {
      block.dataset.state = "error";
      continue;
    }
    try {
      counter += 1;
      const { svg } = await instance.render(`cca-mermaid-${counter}`, source);
      target.innerHTML = svg;
      block.dataset.state = "done";
    } catch (error) {
      block.dataset.state = "error";
      target.textContent =
        error instanceof Error
          ? error.message
          : "Diagram could not be rendered.";
    }
  }
}
