import * as React from "react";

import type {
  AnalyzerSettings,
  ModelCapabilities,
  ModelInfo,
} from "../../src/types";
import type { Stats } from "../selectors";
import { compact as compactNumber, formatDate } from "../selectors";

interface Props {
  stats: Stats;
  taxonomyName: string;
  scannedAt: number;
  busy: boolean;
  compact: boolean;
  showOpenInEditor: boolean;
  models: ModelInfo[];
  settings: AnalyzerSettings;
  capabilities: Record<string, ModelCapabilities>;
  probingModel: string | null;
  activeModel: string | null;
  activeModelId: string | null;
  unclassified: number;
  totalPrompts: number;
  onSettingsChange: (patch: Partial<AnalyzerSettings>) => void;
  onRefreshModels: () => void;
  onProbe: () => void;
  onRescan: () => void;
  onClassify: () => void;
  onReclassify: () => void;
  onExport: () => void;
  onOpenInEditor: () => void;
  askOpen: boolean;
  onToggleAsk: () => void;
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="metric">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
      {hint ? <span className="metric-hint">{hint}</span> : null}
    </div>
  );
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}k`;
  }
  return String(tokens);
}

/**
 * Budget choices are derived from the provider's own `maxInputTokens` rather
 * than a fixed list, so a 32k model and a 1M model get sensible options.
 */
function budgetOptions(maxInputTokens: number): number[] {
  if (!maxInputTokens) {
    return [];
  }
  const fractions = [0.25, 0.4, 0.55, 0.7, 0.85, 1];
  const values = fractions.map((fraction) =>
    Math.max(1000, Math.floor((maxInputTokens * fraction) / 1000) * 1000)
  );
  return [...new Set(values)];
}

export function Chrome({
  stats,
  taxonomyName,
  scannedAt,
  busy,
  compact,
  showOpenInEditor,
  models,
  settings,
  capabilities,
  probingModel,
  activeModel,
  activeModelId,
  unclassified,
  totalPrompts,
  onSettingsChange,
  onRefreshModels,
  onProbe,
  onRescan,
  onClassify,
  onReclassify,
  onExport,
  onOpenInEditor,
  askOpen,
  onToggleAsk,
}: Props): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const coverage = Math.round(stats.coverage * 100);

  const resolvedId = settings.modelId ?? activeModelId;
  const selected =
    models.find((model) => model.id === resolvedId) ??
    models.find((model) => model.name === activeModel);
  const capability = resolvedId ? capabilities[resolvedId] : undefined;
  const probing = probingModel !== null && probingModel === resolvedId;

  const maxTokens = selected?.maxInputTokens ?? capability?.maxInputTokens ?? 0;
  const options = budgetOptions(maxTokens);
  const effectiveBudget =
    settings.contextTokens ?? (maxTokens ? Math.floor(maxTokens * 0.55) : 0);
  const levels = capability?.reasoningLevels ?? [];
  const probed = Boolean(capability?.probedAt);

  return (
    <header className="chrome">
      <div className="chrome-top">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true" />
          <div className="brand-copy">
            <h1>{compact ? "Prompt Analyzer" : "Copilot Prompt Analyzer"}</h1>
            <p className="brand-sub">
              {taxonomyName}
              {scannedAt && !compact
                ? ` · scanned ${new Date(scannedAt).toLocaleTimeString()}`
                : ""}
            </p>
          </div>
        </div>

        <div className="chrome-actions">
          <button
            type="button"
            className={`btn model-btn${open ? " is-active" : ""}`}
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            title="Model, reasoning and context budget"
          >
            <span className="model-btn-name">
              {selected?.name ?? activeModel ?? "Auto"}
            </span>
            {settings.reasoningLevel ? (
              <span className="model-btn-badge">{settings.reasoningLevel}</span>
            ) : null}
            <span className="model-btn-caret">▾</span>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={unclassified > 0 ? onClassify : onReclassify}
            disabled={busy || totalPrompts === 0}
            title={
              unclassified > 0
                ? `Assign an area to the ${unclassified.toLocaleString()} prompt(s) that do not have one yet`
                : "Every prompt is classified. This re-runs classification over all of them."
            }
          >
            {unclassified > 0
              ? compact
                ? `Classify ${compactNumber(unclassified)}`
                : `Classify ${unclassified.toLocaleString()} new`
              : compact
                ? "Re-classify"
                : "Re-classify all"}
          </button>
          <button
            type="button"
            className={`btn btn-ghost${askOpen ? " is-active" : ""}`}
            onClick={onToggleAsk}
            aria-pressed={askOpen}
          >
            Ask
          </button>
          <button
            type="button"
            className="btn"
            onClick={onRescan}
            disabled={busy}
          >
            Rescan
          </button>
          {compact ? null : (
            <button
              type="button"
              className="btn"
              onClick={onExport}
              disabled={busy}
            >
              Export
            </button>
          )}
          {showOpenInEditor ? (
            <button
              type="button"
              className="btn"
              onClick={onOpenInEditor}
              title="Open the full dashboard in an editor tab"
            >
              Expand
            </button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="model-panel">
          <div className="model-row">
            <label htmlFor="cca-model">Model</label>
            <select
              id="cca-model"
              value={settings.modelId ?? ""}
              onChange={(event) =>
                onSettingsChange({ modelId: event.target.value || null })
              }
            >
              <option value="">
                Auto ({activeModel ?? "resolve on demand"})
              </option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} · {model.vendor} ·{" "}
                  {formatTokens(model.maxInputTokens)} ctx
                </option>
              ))}
            </select>
            <button type="button" className="link" onClick={onRefreshModels}>
              Refresh
            </button>
          </div>

          <div className="model-row">
            <label htmlFor="cca-reasoning">Reasoning</label>
            <select
              id="cca-reasoning"
              value={settings.reasoningLevel ?? ""}
              onChange={(event) =>
                onSettingsChange({ reasoningLevel: event.target.value || null })
              }
              disabled={!probed || levels.length === 0 || probing}
            >
              <option value="">
                {levels.length === 0 ? "unavailable" : "off"}
              </option>
              {levels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="link"
              onClick={onProbe}
              disabled={probing}
            >
              {probing ? "Detecting…" : probed ? "Re-detect" : "Detect"}
            </button>
            <span className="model-note">
              {probing
                ? "Sending one-token probes…"
                : !probed
                  ? "VS Code publishes no reasoning metadata. Detect asks the provider directly — a few one-token requests, once per model."
                  : levels.length > 0
                    ? `Provider accepted "${capability?.reasoningKey}" with: ${levels.join(", ")}.`
                    : "This provider rejected every reasoning option tried."}
            </span>
          </div>

          <div className="model-row">
            <label htmlFor="cca-context">Context</label>
            <select
              id="cca-context"
              value={settings.contextTokens ?? ""}
              onChange={(event) =>
                onSettingsChange({
                  contextTokens: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
              disabled={options.length === 0}
            >
              <option value="">
                {maxTokens
                  ? `Auto (${formatTokens(Math.floor(maxTokens * 0.55))})`
                  : "Auto"}
              </option>
              {options.map((value) => (
                <option key={value} value={value}>
                  {formatTokens(value)} tokens
                  {value === maxTokens ? " (full window)" : ""}
                </option>
              ))}
            </select>
            <span className="model-note">
              {maxTokens
                ? `Model window is ${formatTokens(maxTokens)} tokens; up to ${formatTokens(
                    effectiveBudget
                  )} used per request.` +
                  (capability?.charsPerToken
                    ? ` Measured ${capability.charsPerToken.toFixed(2)} chars/token.`
                    : "")
                : "Select a model to read its window from the provider."}
            </span>
          </div>
        </div>
      ) : null}

      <div className="metrics">
        <Metric label="prompts" value={compactNumber(stats.prompts)} />
        <Metric label="sessions" value={compactNumber(stats.sessions)} />
        {compact ? null : (
          <Metric label="workspaces" value={compactNumber(stats.workspaces)} />
        )}
        {compact ? null : (
          <Metric label="words written" value={compactNumber(stats.words)} />
        )}
        <Metric
          label="classified"
          value={`${coverage}%`}
          hint={
            compact
              ? undefined
              : `${compactNumber(stats.classified)} of ${compactNumber(stats.prompts)}`
          }
        />
        {compact ? null : (
          <Metric
            label="range"
            value={formatDate(stats.from)}
            hint={stats.to ? `to ${formatDate(stats.to)}` : undefined}
          />
        )}
      </div>
    </header>
  );
}
