/**
 * Minimal markdown -> HTML renderer for model answers.
 * Input is escaped first, so the output is safe to inject.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<span class="md-link">$1</span>')
    .replace(/\[([a-z0-9-]+#\d+)\]/gi, '<span class="md-ref">[$1]</span>');
}

/**
 * Mermaid blocks become a render target rather than a code block. The source is
 * kept as escaped text inside the placeholder so the renderer can read it back
 * with `textContent`, and so it stays visible if the diagram fails to parse —
 * which models manage regularly.
 */
function renderCodeBlock(language: string, code: string): string {
  if (language === "mermaid" && code.trim()) {
    return (
      '<div class="mermaid-block" data-state="pending">' +
      `<pre class="mermaid-src">${escapeHtml(code)}</pre>` +
      '<div class="mermaid-out"></div>' +
      "</div>"
    );
  }
  return `<pre class="md-code"><code>${escapeHtml(code)}</code></pre>`;
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inCode = false;
  let codeLanguage = "";
  let codeLines: string[] = [];
  let paragraph: string[] = [];

  const closeList = (): void => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_RULE = /^\s*\|[\s:|-]+\|\s*$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(header: string[], rows: string[][]): string {
  const head = header.map((cell) => `<th>${inline(cell)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`
    )
    .join("");
  return `<table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^\s*```(\w+)?/.exec(line);
    if (fence) {
      if (inCode) {
        out.push(renderCodeBlock(codeLanguage, codeLines.join("\n")));
        inCode = false;
      } else {
        flushParagraph();
        closeList();
        inCode = true;
        codeLanguage = (fence[1] ?? "").toLowerCase();
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(6, heading[1].length + 2);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const wanted = bullet ? "ul" : "ol";
      if (listType !== wanted) {
        closeList();
        out.push(`<${wanted}>`);
        listType = wanted;
      }
      out.push(`<li>${inline((bullet ?? numbered)![1])}</li>`);
      continue;
    }

    // A table is a row followed by a dashed rule; the reports are full of them.
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[index + 1] ?? "")) {
      flushParagraph();
      closeList();
      const header = splitRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && TABLE_ROW.test(lines[index])) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }
      index -= 1;
      out.push(renderTable(header, rows));
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      closeList();
      continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  if (inCode) {
    // Still streaming: show the partial block, but never as a half-parsed diagram.
    out.push(
      `<pre class="md-code"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`
    );
  }
  return out.join("");
}
