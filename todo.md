# Copilot Prompt Analyzer — Roadmap

v0.3.1 is live. The **Dashboard** page ships 21 visualisations over the same
filtered corpus every other view uses, all computed locally, and exports the
whole page as markdown.

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
  under `node --test` without a DOM. The page and its markdown export both read
  `collectMetrics`, so they cannot disagree.

## Pending

Nothing outstanding.
