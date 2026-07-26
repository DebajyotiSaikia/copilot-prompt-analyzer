# Copilot Prompt Analyzer — Roadmap

v0.3.0 is live: the **Dashboard** page ships 21 visualisations over the same
filtered corpus every other view uses, all computed locally.

For build, release and demo commands, and the traps that cost real time, see the
**Maintaining** section of `README.md`.

---

## Ground rules

- Every chart reads the **filtered** `PromptRecord[]`. A dashboard that ignores
  filters becomes a second product that disagrees with the first.
- **No charting library.** Bars, lines, heatmaps, treemaps, Sankeys and scatters
  are a few dozen lines of SVG each. Hand-drawn SVG inherits the VS Code theme,
  stays crisp at any zoom, and keeps the bundle flat — mermaid alone is 3.3 MB
  and is already lazy-loaded for that reason.
- **Every metric is computed locally.** No model calls, instant, works signed
  out. That is what makes the dashboard the first thing people trust.
- Metrics live in `webview/dashboard.ts` as pure functions so they can be tested
  under `node --test` without a DOM.

## Pending

- [ ] **Export the dashboard** — a markdown summary of every metric, so the
      numbers can leave the editor and land in a retro or an issue.
- [ ] **Sparse-history charts** — with only two months of data the trend cards
      render a single dashed segment across a tall card. Collapse to a compact
      form when there are fewer than three points.
