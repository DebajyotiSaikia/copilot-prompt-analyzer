/**
 * Number formatting shared by the charts and the markdown export.
 *
 * It lives apart from `charts.tsx` so `dashboard.ts` can format its summary
 * without importing React — the metric module has to stay loadable under
 * `node --test` with no DOM.
 */

export function formatCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return String(Math.round(value));
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}
