import * as React from "react";

import type {
  AnalyzerSettings,
  Filter,
  PromptRecord,
  ReportId,
  Snapshot,
} from "../src/types";
import { onMessage, post } from "./bridge";
import { AreasView } from "./components/AreasView";
import { AskPanel, type Turn } from "./components/AskPanel";
import { Chrome } from "./components/Chrome";
import { DetailDrawer } from "./components/DetailDrawer";
import { DocumentModal } from "./components/DocumentModal";
import { Filters } from "./components/Filters";
import { InsightsView, REPORT_CARDS } from "./components/InsightsView";
import { PromptsView } from "./components/PromptsView";
import { TimelineView } from "./components/TimelineView";
import {
  EMPTY_FILTER,
  UNCLASSIFIED,
  applyFilter,
  buildFacets,
  buildStats,
  groupByArea,
  groupByMonth,
} from "./selectors";

type View = "areas" | "prompts" | "timeline" | "insights" | "ask";

interface Toast {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
}

const DEFAULT_SETTINGS: AnalyzerSettings = {
  modelId: null,
  reasoningLevel: null,
  contextTokens: null,
};

const EMPTY_SNAPSHOT: Snapshot = {
  prompts: [],
  sessions: [],
  taxonomy: { name: "Engineering areas", areas: [], instruction: null },
  classifications: {},
  generated: {},
  reports: {},
  models: [],
  settings: DEFAULT_SETTINGS,
  capabilities: {},
  probingModel: null,
  activeModel: null,
  activeModelId: null,
  unclassified: 0,
  failures: [],
  scannedAt: 0,
  scannedDirs: [],
};

const HOST = document.body.dataset.host === "sidebar" ? "sidebar" : "panel";
const COMPACT_BREAKPOINT = 820;

/** The sidebar is always compact; the editor panel collapses when narrow. */
function useCompact(): boolean {
  const [narrow, setNarrow] = React.useState(
    () => document.documentElement.clientWidth < COMPACT_BREAKPOINT
  );

  React.useEffect(() => {
    if (HOST === "sidebar") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setNarrow(entries[0].contentRect.width < COMPACT_BREAKPOINT);
    });
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);

  return HOST === "sidebar" || narrow;
}

function countActiveFilters(filter: Filter): number {
  return (
    (filter.query ? 1 : 0) +
    filter.areas.length +
    filter.workspaces.length +
    filter.models.length +
    filter.modes.length +
    (filter.from ? 1 : 0) +
    (filter.to ? 1 : 0)
  );
}

function describeScope(filter: Filter, taxonomyLabels: Map<string, string>): string {
  const parts: string[] = [];
  if (filter.query) {
    parts.push(`matching “${filter.query}”`);
  }
  if (filter.areas.length) {
    parts.push(filter.areas.map((a) => taxonomyLabels.get(a) ?? a).join(", "));
  }
  if (filter.workspaces.length) {
    parts.push(filter.workspaces.join(", "));
  }
  if (filter.models.length) {
    parts.push(filter.models.join(", "));
  }
  if (filter.modes.length) {
    parts.push(`${filter.modes.join("/")} mode`);
  }
  if (filter.from || filter.to) {
    parts.push(`${filter.from ?? "start"} → ${filter.to ?? "now"}`);
  }
  return parts.length ? parts.join(" · ") : "all prompts";
}

export function App(): JSX.Element {
  const compact = useCompact();
  const [snapshot, setSnapshot] = React.useState<Snapshot>(EMPTY_SNAPSHOT);
  const [filter, setFilter] = React.useState<Filter>(EMPTY_FILTER);
  const [view, setView] = React.useState<View>("areas");
  const [selected, setSelected] = React.useState<PromptRecord | null>(null);
  const [busy, setBusy] = React.useState<{
    busy: boolean;
    label?: string;
    progress?: number;
  }>({ busy: false });
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [askOpen, setAskOpen] = React.useState(false);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [draft, setDraft] = React.useState("");
  const [activeRequest, setActiveRequest] = React.useState<string | null>(null);

  const [studioArea, setStudioArea] = React.useState<string | null>(null);
  const [studioExtra, setStudioExtra] = React.useState("");
  const [streamedPrompts, setStreamedPrompts] = React.useState<Record<string, string>>({});
  const [generatingArea, setGeneratingArea] = React.useState<string | null>(null);

  const [openReport, setOpenReport] = React.useState<ReportId | null>(null);
  const [streamedReports, setStreamedReports] = React.useState<
    Partial<Record<ReportId, string>>
  >({});
  const [busyReport, setBusyReport] = React.useState<ReportId | null>(null);
  const [estimate, setEstimate] = React.useState<string | null>(null);
  const estimateId = React.useRef("");

  React.useEffect(() => {
    const dispose = onMessage((message) => {
      switch (message.type) {
        case "snapshot":
          setSnapshot(message.snapshot);
          break;
        case "busy":
          setBusy({
            busy: message.busy,
            label: message.label,
            progress: message.progress,
          });
          break;
        case "toast":
          setToasts((current) => [
            ...current,
            {
              id: Date.now() + Math.random(),
              level: message.level,
              message: message.message,
            },
          ]);
          break;
        case "answerStart":
          setActiveRequest(message.requestId);
          setTurns((current) => [
            ...current,
            { id: message.requestId, role: "assistant", text: "", scope: "" },
          ]);
          break;
        case "answerChunk":
          setTurns((current) =>
            current.map((turn) =>
              turn.id === message.requestId
                ? { ...turn, text: turn.text + message.text }
                : turn
            )
          );
          break;
        case "answerEnd":
          setActiveRequest(null);
          break;
        case "promptStart":
          setGeneratingArea(message.areaId);
          setStreamedPrompts((current) => ({ ...current, [message.areaId]: "" }));
          break;
        case "promptChunk":
          setStreamedPrompts((current) => ({
            ...current,
            [message.areaId]: (current[message.areaId] ?? "") + message.text,
          }));
          break;
        case "promptEnd":
          setGeneratingArea(null);
          break;
        case "reportStart":
          setBusyReport(message.reportId);
          setStreamedReports((current) => ({ ...current, [message.reportId]: "" }));
          break;
        case "reportChunk":
          setStreamedReports((current) => ({
            ...current,
            [message.reportId]: (current[message.reportId] ?? "") + message.text,
          }));
          break;
        case "reportEnd":
          setBusyReport(null);
          break;
        case "contextEstimate": {
          if (message.estimateId !== estimateId.current) {
            break;
          }
          if (message.tokens === null) {
            setEstimate(null);
            break;
          }
          const fmt = (n: number): string =>
            n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
          const omitted = message.total - message.sampled;
          setEstimate(
            `~${fmt(message.tokens)} of ${fmt(message.budgetTokens)} token budget` +
              (omitted > 0 ? ` · ${omitted} request(s) will not fit` : "")
          );
          break;
        }
        default:
          break;
      }
    });
    post({ type: "ready" });
    return dispose;
  }, []);

  React.useEffect(() => {
    if (toasts.length === 0) {
      return;
    }
    const timer = window.setTimeout(
      () => setToasts((current) => current.slice(1)),
      6000
    );
    return () => window.clearTimeout(timer);
  }, [toasts]);

  // Leaving compact mode must not strand the user on the ask-only tab.
  React.useEffect(() => {
    if (!compact && view === "ask") {
      setView("areas");
      setAskOpen(true);
    }
  }, [compact, view]);

  const filtered = React.useMemo(
    () => applyFilter(snapshot.prompts, snapshot.classifications, filter),
    [snapshot, filter]
  );
  const facets = React.useMemo(() => buildFacets(snapshot.prompts), [snapshot.prompts]);
  const buckets = React.useMemo(
    () => groupByArea(filtered, snapshot.classifications, snapshot.taxonomy),
    [filtered, snapshot.classifications, snapshot.taxonomy]
  );
  const months = React.useMemo(
    () => groupByMonth(filtered, snapshot.classifications),
    [filtered, snapshot.classifications]
  );
  const stats = React.useMemo(
    () => buildStats(filtered, snapshot.classifications),
    [filtered, snapshot.classifications]
  );
  const areaLabels = React.useMemo(() => {
    const map = new Map(snapshot.taxonomy.areas.map((a) => [a.id, a.label]));
    map.set(UNCLASSIFIED.id, UNCLASSIFIED.label);
    return map;
  }, [snapshot.taxonomy]);
  const areaColors = React.useMemo(() => {
    const map = new Map(snapshot.taxonomy.areas.map((a) => [a.id, a.color]));
    map.set(UNCLASSIFIED.id, UNCLASSIFIED.color);
    return map;
  }, [snapshot.taxonomy]);

  const scopeLabel = describeScope(filter, areaLabels);
  const activeFilters = countActiveFilters(filter);

  const ask = (question: string): void => {
    const requestId = `q${Date.now()}`;
    if (compact) {
      setView("ask");
    } else {
      setAskOpen(true);
    }
    setDraft("");
    setTurns((current) => [
      ...current,
      {
        id: `${requestId}-user`,
        role: "user",
        text: question,
        scope: `${filtered.length} prompts · ${scopeLabel}`,
      },
    ]);
    post({
      type: "ask",
      requestId,
      question,
      context: { promptIds: filtered.map((p) => p.id), label: scopeLabel },
    });
  };

  const rewrite = (prompt: PromptRecord): void => {
    const requestId = `r${Date.now()}`;
    if (compact) {
      setView("ask");
    } else {
      setAskOpen(true);
    }
    setTurns((current) => [
      ...current,
      {
        id: `${requestId}-user`,
        role: "user",
        text: `Improve this prompt: ${prompt.text.slice(0, 120)}`,
        scope: `1 prompt · ${prompt.workspaceName}`,
      },
    ]);
    post({ type: "rewritePrompt", requestId, promptId: prompt.id });
  };

  const toggleAsk = (): void => {
    if (compact) {
      setView((current) => (current === "ask" ? "areas" : "ask"));
    } else {
      setAskOpen((open) => !open);
    }
  };

  const focusArea = (areaId: string): void => {
    setFilter((current) => ({ ...current, areas: [areaId] }));
    setView("prompts");
  };

  const studioBucket = studioArea
    ? buckets.find((bucket) => bucket.area.id === studioArea)
    : undefined;

  // Estimate whatever the open modal would actually send, so the cost is visible
  // before the request runs. One tokeniser call per change.
  const estimateIds = studioArea
    ? (studioBucket?.prompts.map((prompt) => prompt.id) ?? [])
    : openReport
      ? filtered.map((prompt) => prompt.id)
      : null;
  const estimateKey = estimateIds ? estimateIds.join("|") : "";

  React.useEffect(() => {
    if (!estimateIds) {
      setEstimate(null);
      return;
    }
    const id = `e${Date.now()}`;
    estimateId.current = id;
    setEstimate(null);
    post({ type: "estimateContext", estimateId: id, promptIds: estimateIds });
    // estimateKey collapses the id list into one dependency
  }, [estimateKey, snapshot.settings.contextTokens, snapshot.settings.modelId]);

  const runGenerate = (areaId: string, extra: string): void => {
    const bucket = buckets.find((candidate) => candidate.area.id === areaId);
    if (!bucket) {
      return;
    }
    post({
      type: "generatePrompt",
      areaId,
      areaLabel: bucket.area.label,
      promptIds: bucket.prompts.map((prompt) => prompt.id),
      extra,
    });
  };

  const openStudio = (areaId: string): void => {
    setStudioArea(areaId);
    setStudioExtra("");
    if (!snapshot.generated[areaId]) {
      runGenerate(areaId, "");
    }
  };

  const runReport = (reportId: ReportId): void => {
    post({
      type: "buildReport",
      reportId,
      promptIds: filtered.map((prompt) => prompt.id),
    });
  };

  const openReportModal = (reportId: ReportId): void => {
    setOpenReport(reportId);
    if (!snapshot.reports[reportId]) {
      runReport(reportId);
    }
  };

  const selectedClassification = selected
    ? snapshot.classifications[selected.hash]
    : undefined;
  const selectedAreaId = selectedClassification?.area ?? UNCLASSIFIED.id;
  const askVisible = compact ? view === "ask" : askOpen;

  const filtersElement = (
    <Filters
      filter={filter}
      facets={facets}
      buckets={buckets}
      taxonomy={snapshot.taxonomy}
      resultCount={filtered.length}
      totalCount={snapshot.prompts.length}
      onChange={setFilter}
      onRegroup={(instruction) => post({ type: "regroup", instruction })}
      onResetTaxonomy={() => post({ type: "resetTaxonomy" })}
      busy={busy.busy}
    />
  );

  const tabs: View[] = compact
    ? ["areas", "prompts", "timeline", "insights", "ask"]
    : ["areas", "prompts", "timeline", "insights"];
  const tabLabel: Record<View, string> = {
    areas: "Areas",
    prompts: "Prompts",
    timeline: "Timeline",
    insights: "Insights",
    ask: "Ask",
  };

  const studioMarkdown = studioArea
    ? generatingArea === studioArea
      ? (streamedPrompts[studioArea] ?? "")
      : (snapshot.generated[studioArea]?.markdown ??
        streamedPrompts[studioArea] ??
        "")
    : "";

  const reportCard = openReport
    ? REPORT_CARDS.find((card) => card.id === openReport)
    : undefined;
  const storedReport = openReport ? snapshot.reports[openReport] : undefined;
  const reportMarkdown = openReport
    ? busyReport === openReport
      ? (streamedReports[openReport] ?? "")
      : (storedReport?.markdown ?? streamedReports[openReport] ?? "")
    : "";

  return (
    <div
      className={[
        "app",
        compact ? "is-compact" : "",
        !compact && askOpen ? "with-ask" : "",
        selected ? "with-detail" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Chrome
        stats={stats}
        taxonomyName={snapshot.taxonomy.name}
        scannedAt={snapshot.scannedAt}
        busy={busy.busy}
        compact={compact}
        showOpenInEditor={HOST === "sidebar"}
        models={snapshot.models}
        settings={snapshot.settings}
        capabilities={snapshot.capabilities}
        probingModel={snapshot.probingModel}
        activeModel={snapshot.activeModel}
        activeModelId={snapshot.activeModelId}
        unclassified={snapshot.unclassified}
        totalPrompts={snapshot.prompts.length}
        onSettingsChange={(settings) => post({ type: "setSettings", settings })}
        onRefreshModels={() => post({ type: "refreshModels" })}
        onProbe={() =>
          post({ type: "probeCapabilities", modelId: snapshot.settings.modelId })
        }
        onRescan={() => post({ type: "rescan" })}
        onClassify={() => post({ type: "classify", force: false })}
        onReclassify={() => post({ type: "classify", force: true })}
        onExport={() => post({ type: "export" })}
        onOpenInEditor={() => post({ type: "openInEditor" })}
        askOpen={askVisible}
        onToggleAsk={toggleAsk}
      />

      {busy.busy ? (
        <div className="progress" role="status">
          <div
            className="progress-fill"
            style={
              busy.progress !== undefined
                ? { width: `${busy.progress * 100}%` }
                : undefined
            }
          />
          <span>{busy.label ?? "Working…"}</span>
        </div>
      ) : null}

      {snapshot.failures.length > 0 ? (
        <details className="failures">
          <summary>
            {snapshot.failures.length.toLocaleString()} session file(s) could not be
            read and were skipped
          </summary>
          <ul>
            {snapshot.failures.slice(0, 40).map((name) => (
              <li key={name}>{name}</li>
            ))}
            {snapshot.failures.length > 40 ? (
              <li>…and {snapshot.failures.length - 40} more</li>
            ) : null}
          </ul>
        </details>
      ) : null}

      <div className="body">
        {compact ? null : filtersElement}

        <main className="content">
          <nav className="tabs">
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                className={view === id ? "is-active" : ""}
                onClick={() => setView(id)}
              >
                {tabLabel[id]}
              </button>
            ))}
          </nav>

          {compact && view !== "ask" ? (
            <details className="filters-drawer">
              <summary>
                Filters
                {activeFilters > 0 ? <span className="badge">{activeFilters}</span> : null}
                <span className="filters-summary">
                  {filtered.length.toLocaleString()} of{" "}
                  {snapshot.prompts.length.toLocaleString()}
                </span>
              </summary>
              {filtersElement}
            </details>
          ) : null}

          {view === "areas" ? (
            <AreasView
              buckets={buckets}
              classifications={snapshot.classifications}
              generated={snapshot.generated}
              generatingArea={generatingArea}
              onFocusArea={focusArea}
              onSelectPrompt={setSelected}
              onBuildPrompt={openStudio}
              onAskAbout={(label) =>
                ask(
                  `Summarise what I worked on in "${label}" and list the concrete asks.`
                )
              }
            />
          ) : null}
          {view === "prompts" ? (
            <PromptsView
              prompts={filtered}
              classifications={snapshot.classifications}
              taxonomy={snapshot.taxonomy}
              selectedId={selected?.id ?? null}
              compact={compact}
              onSelectPrompt={setSelected}
            />
          ) : null}
          {view === "timeline" ? (
            <TimelineView
              months={months}
              taxonomy={snapshot.taxonomy}
              onFocusArea={focusArea}
            />
          ) : null}
          {view === "insights" ? (
            <InsightsView
              reports={snapshot.reports}
              busyReport={busyReport}
              scopeCount={filtered.length}
              onOpen={openReportModal}
            />
          ) : null}
          {compact && view === "ask" ? (
            <AskPanel
              turns={turns}
              streaming={activeRequest !== null}
              scopeLabel={scopeLabel}
              scopeCount={filtered.length}
              draft={draft}
              compact
              onDraftChange={setDraft}
              onAsk={ask}
              onCancel={() => post({ type: "cancelAsk" })}
              onClear={() => setTurns([])}
              onClose={() => setView("areas")}
            />
          ) : null}
        </main>

        {selected ? (
          <DetailDrawer
            prompt={selected}
            classification={selectedClassification}
            areaLabel={areaLabels.get(selectedAreaId) ?? selectedAreaId}
            areaColor={areaColors.get(selectedAreaId) ?? UNCLASSIFIED.color}
            onClose={() => setSelected(null)}
            onCopy={(text) => post({ type: "copy", text })}
            onOpenSession={(sessionId) => post({ type: "openSession", sessionId })}
            onImprove={() => rewrite(selected)}
          />
        ) : null}

        {!compact && askOpen ? (
          <AskPanel
            turns={turns}
            streaming={activeRequest !== null}
            scopeLabel={scopeLabel}
            scopeCount={filtered.length}
            draft={draft}
            compact={false}
            onDraftChange={setDraft}
            onAsk={ask}
            onCancel={() => post({ type: "cancelAsk" })}
            onClear={() => setTurns([])}
            onClose={() => setAskOpen(false)}
          />
        ) : null}
      </div>

      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.level}`}>
            {toast.message}
          </div>
        ))}
      </div>

      {studioArea ? (
        <DocumentModal
          eyebrow={
            studioBucket?.area.label ??
            snapshot.generated[studioArea]?.areaLabel ??
            areaLabels.get(studioArea) ??
            studioArea
          }
          title="Working prompt"
          meta={
            snapshot.generated[studioArea] && generatingArea !== studioArea
              ? `Built from ${snapshot.generated[studioArea]!.sampledCount} of ${
                  snapshot.generated[studioArea]!.sourceCount
                } requests · ${new Date(
                  snapshot.generated[studioArea]!.generatedAt
                ).toLocaleString()}`
              : `${(studioBucket?.prompts.length ?? 0).toLocaleString()} request(s) in this area`
          }
          accent={areaColors.get(studioArea) ?? UNCLASSIFIED.color}
          markdown={studioMarkdown}
          generating={generatingArea === studioArea}
          hasStored={Boolean(snapshot.generated[studioArea])}
          generateLabel="Generate prompt"
          extra={{
            value: studioExtra,
            placeholder:
              "Optional steer, e.g. target a fresh Next.js project, or keep it under 40 lines",
            onChange: setStudioExtra,
          }}
          saveOptions={[
            {
              label: "Save .prompt.md",
              format: "prompt",
              title: "Save to .github/prompts/ so it becomes a / command in chat",
            },
            {
              label: ".instructions.md",
              format: "instructions",
              title: "Save to .github/instructions/ so it is applied automatically",
            },
            { label: "Save as…", format: "markdown" },
          ]}
          emptyState={
            <>
              <p>
                This distils every request you made in this area into one reusable
                prompt — requirements, conventions, the corrections you had to make,
                and a definition of done.
              </p>
              <p className="hint">
                Filters apply: only the{" "}
                {(studioBucket?.prompts.length ?? 0).toLocaleString()} request(s)
                currently selected are used.
              </p>
            </>
          }
          estimate={estimate}
          onGenerate={() => {
            runGenerate(studioArea, studioExtra);
            // The steer applies to this run only; leaving it in place makes the
            // next Regenerate silently repeat an instruction the user forgot about.
            setStudioExtra("");
          }}
          onCancel={() => post({ type: "cancelGenerate" })}
          onCopy={(text) => post({ type: "copy", text })}
          onSave={(format) => post({ type: "savePrompt", areaId: studioArea, format })}
          onClear={() => {
            post({ type: "clearPrompt", areaId: studioArea });
            setStreamedPrompts((current) => {
              const next = { ...current };
              delete next[studioArea];
              return next;
            });
          }}
          onClose={() => setStudioArea(null)}
        />
      ) : null}

      {openReport && reportCard ? (
        <DocumentModal
          eyebrow={reportCard.local ? "Local report" : "AI report"}
          title={reportCard.title}
          meta={
            storedReport && busyReport !== openReport
              ? `${storedReport.meta} · ${new Date(
                  storedReport.generatedAt
                ).toLocaleString()}${
                  storedReport.modelName ? ` · ${storedReport.modelName}` : ""
                }`
              : `${filtered.length.toLocaleString()} prompts in scope`
          }
          accent="#7c9cf5"
          markdown={reportMarkdown}
          generating={busyReport === openReport}
          hasStored={Boolean(storedReport)}
          generateLabel="Build report"
          saveOptions={[
            { label: "Save to workspace", format: "markdown" },
            { label: ".instructions.md", format: "instructions" },
          ]}
          emptyState={<p>{reportCard.blurb}</p>}
          estimate={reportCard.local ? null : estimate}
          onGenerate={() => runReport(openReport)}
          onCancel={() => post({ type: "cancelGenerate" })}
          onCopy={(text) => post({ type: "copy", text })}
          onSave={(format) =>
            post({ type: "saveReport", reportId: openReport, format })
          }
          onClear={() => {
            post({ type: "clearReport", reportId: openReport });
            setStreamedReports((current) => {
              const next = { ...current };
              delete next[openReport];
              return next;
            });
          }}
          onClose={() => setOpenReport(null)}
        />
      ) : null}
    </div>
  );
}
