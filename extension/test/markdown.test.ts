import assert from "node:assert/strict";
import test from "node:test";

import { escapeHtml, renderMarkdown } from "../webview/markdown.ts";

test("escapes every character that could break out of the document", () => {
  assert.equal(
    escapeHtml(`<script>alert("x" + 'y' & z)</script>`),
    "&lt;script&gt;alert(&quot;x&quot; + &#39;y&#39; &amp; z)&lt;/script&gt;"
  );
});

test("renders a pipe table with a header and body", () => {
  const html = renderMarkdown(
    ["| Score | Prompt |", "| --- | --- |", "| 12 | add a cache |"].join("\n")
  );

  assert.match(html, /<table class="md-table">/);
  assert.match(
    html,
    /<thead><tr><th>Score<\/th><th>Prompt<\/th><\/tr><\/thead>/
  );
  assert.match(
    html,
    /<tbody><tr><td>12<\/td><td>add a cache<\/td><\/tr><\/tbody>/
  );
});

test("accepts alignment colons in the rule", () => {
  const html = renderMarkdown(
    ["| A | B |", "|:---|---:|", "| 1 | 2 |"].join("\n")
  );
  assert.match(html, /<table class="md-table">/);
});

// The bug this guards: without the rule the pipes used to survive into a
// paragraph, which is exactly how the reports shipped broken.
test("a row without a following rule is not a table", () => {
  const html = renderMarkdown("| not | a table |");
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /<p>/);
});

test("escapes cell contents and applies inline formatting", () => {
  const html = renderMarkdown(
    ["| Code | Note |", "| --- | --- |", "| `a<b>` | **bold** |"].join("\n")
  );

  assert.match(html, /<td><code>a&lt;b&gt;<\/code><\/td>/);
  assert.match(html, /<td><strong>bold<\/strong><\/td>/);
});

test("a table ends where its rows end", () => {
  const html = renderMarkdown(
    ["| A |", "| --- |", "| 1 |", "", "After the table."].join("\n")
  );

  assert.match(html, /<\/table><p>After the table\.<\/p>/);
});

test("consecutive tables stay separate", () => {
  const html = renderMarkdown(
    ["| A |", "| --- |", "| 1 |", "", "| B |", "| --- |", "| 2 |"].join("\n")
  );
  assert.equal(html.match(/<table/g)?.length, 2);
});

test("mermaid fences become a render target, other fences stay code", () => {
  const mermaid = renderMarkdown("```mermaid\ngraph TD;\n```");
  assert.match(mermaid, /<div class="mermaid-block" data-state="pending">/);
  assert.match(mermaid, /<pre class="mermaid-src">graph TD;<\/pre>/);

  const code = renderMarkdown("```ts\nconst a = 1;\n```");
  assert.match(code, /<pre class="md-code"><code>const a = 1;<\/code><\/pre>/);
});

// Reports stream in, so a fence is routinely open when a render happens.
test("an unterminated fence still renders as code", () => {
  const html = renderMarkdown("```ts\nconst a = 1;");
  assert.match(html, /<pre class="md-code"><code>const a = 1;<\/code><\/pre>/);
});

test("headings start at h3 so they nest under the panel title", () => {
  const html = renderMarkdown("# One\n## Two");
  assert.match(html, /<h3>One<\/h3>/);
  assert.match(html, /<h4>Two<\/h4>/);
});

test("switching list type closes the previous list", () => {
  const html = renderMarkdown("- a\n- b\n\n1. c");
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<ol><li>c<\/li><\/ol>/);
});
