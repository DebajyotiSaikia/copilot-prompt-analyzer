/** Shared between the extension host and the webview. */

export interface PromptRecord {
  /** `${sessionId}#${seq}` */
  id: string;
  sessionId: string;
  seq: number;
  /** epoch ms */
  ts: number;
  workspace: string | null;
  workspaceName: string;
  model: string | null;
  modelLabel: string | null;
  modelKey: string | null;
  mode: string | null;
  command: string | null;
  text: string;
  chars: number;
  words: number;
  refs: string[];
  tools: string[];
  toolCalls: number;
  elapsedMs: number | null;
  reply: string;
  /** stable hash of `text`, used as the classification cache key */
  hash: string;
}

export interface SessionRecord {
  id: string;
  sourceFile: string;
  workspace: string | null;
  workspaceName: string;
  location: string | null;
  createdAt: number | null;
  lastMessageAt: number | null;
  promptCount: number;
}

export interface Classification {
  area: string;
  subarea: string | null;
  intent: string | null;
  tags: string[];
}

export interface Area {
  id: string;
  label: string;
  description: string;
  color: string;
}

export interface Taxonomy {
  name: string;
  areas: Area[];
  /** free-form instruction applied on top of the taxonomy when regrouping */
  instruction: string | null;
}

/**
 * How a working prompt should be written.
 *
 * `portable` keeps only what transfers: the rules, corrections and standards.
 * It names no project, so it can be dropped into any repository, including one
 * that does not exist yet.
 *
 * `project` additionally pins the prompt to the stack, services and file layout
 * seen in the requests. Useful as a spec for continuing that specific work.
 */
export type PromptMode = "portable" | "project";

/** A reusable master prompt distilled from every request made within one area. */
export interface GeneratedPrompt {
  areaId: string;
  areaLabel: string;
  markdown: string;
  generatedAt: number;
  /** how many prompts were synthesised, and how many were sent to the model */
  sourceCount: number;
  sampledCount: number;
  extraInstruction: string | null;
  mode: PromptMode;
}

export type SaveFormat = "prompt" | "instructions" | "markdown";

/* ---------- model selection ---------- */

export interface ModelInfo {
  id: string;
  name: string;
  family: string;
  vendor: string;
  version: string;
  maxInputTokens: number;
}

/**
 * Discovered by probing the provider, because `vscode.lm` exposes no reasoning
 * metadata at all — `modelOptions` is an untyped passthrough and the API has no
 * field describing what a model accepts.
 */
export interface ModelCapabilities {
  modelId: string;
  /** the option key the provider accepted, e.g. `reasoning_effort`; null if none */
  reasoningKey: string | null;
  /** the effort values the provider actually accepted */
  reasoningLevels: string[];
  maxInputTokens: number;
  /** measured characters per token for this model, calibrated from real evidence */
  charsPerToken: number;
  probedAt: number;
  /** requests spent discovering the above */
  probeRequests: number;
}

export interface AnalyzerSettings {
  /** null means "resolve automatically from the configured family" */
  modelId: string | null;
  /** must be one of the probed levels; null means send no reasoning option */
  reasoningLevel: string | null;
  /** absolute input-token budget; null means derive from the model's window */
  contextTokens: number | null;
}

export type ReasoningSupport = boolean | null;

/* ---------- generated documents ---------- */

export type ReportId =
  | "instructions"
  | "corrections"
  | "quality"
  | "duplicates"
  | "projects"
  | "decisions"
  | "pastes";

export interface Report {
  id: ReportId;
  title: string;
  markdown: string;
  generatedAt: number;
  /** short line describing the corpus it was built from */
  meta: string;
  /** suggested workspace-relative path when saving */
  suggestedPath: string;
  modelName: string | null;
}

export interface Snapshot {
  prompts: PromptRecord[];
  sessions: SessionRecord[];
  taxonomy: Taxonomy;
  /** promptHash -> classification */
  classifications: Record<string, Classification>;
  /** areaId -> generated master prompt */
  generated: Record<string, GeneratedPrompt>;
  /** reportId -> generated report */
  reports: Partial<Record<ReportId, Report>>;
  models: ModelInfo[];
  settings: AnalyzerSettings;
  /** modelId -> probed capabilities */
  capabilities: Record<string, ModelCapabilities>;
  probingModel: string | null;
  activeModel: string | null;
  activeModelId: string | null;
  /** distinct prompt texts with no classification yet */
  unclassified: number;
  /** session files that could not be read, as basenames */
  failures: string[];
  scannedAt: number;
  scannedDirs: string[];
}

export interface Filter {
  query: string;
  workspaces: string[];
  areas: string[];
  models: string[];
  modes: string[];
  from: string | null;
  to: string | null;
}

export interface AskContext {
  /** ids of the prompts currently visible, used to scope the question */
  promptIds: string[];
  label: string;
}

/* ---------- webview -> extension ---------- */

export type InboundMessage =
  | { type: "ready" }
  | { type: "rescan" }
  | { type: "classify"; force: boolean }
  | { type: "regroup"; instruction: string }
  | { type: "resetTaxonomy" }
  | { type: "ask"; requestId: string; question: string; context: AskContext }
  | { type: "cancelAsk" }
  | {
      type: "generatePrompt";
      areaId: string;
      areaLabel: string;
      promptIds: string[];
      extra: string;
      mode: PromptMode;
    }
  | { type: "cancelGenerate" }
  | { type: "savePrompt"; areaId: string; format: SaveFormat }
  | { type: "clearPrompt"; areaId: string }
  | { type: "setSettings"; settings: Partial<AnalyzerSettings> }
  | { type: "openDashboard" }
  | { type: "refreshModels" }
  | { type: "probeCapabilities"; modelId: string | null }
  | { type: "buildReport"; reportId: ReportId; promptIds: string[] }
  | { type: "saveReport"; reportId: ReportId; format: SaveFormat }
  | { type: "clearReport"; reportId: ReportId }
  | { type: "rewritePrompt"; requestId: string; promptId: string }
  | { type: "estimateContext"; estimateId: string; promptIds: string[] }
  | { type: "openSession"; sessionId: string }
  | { type: "openInEditor" }
  | { type: "copy"; text: string }
  | { type: "saveMarkdown"; label: string; markdown: string }
  | { type: "export" };

/* ---------- extension -> webview ---------- */

export type OutboundMessage =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "busy"; busy: boolean; label?: string; progress?: number }
  | { type: "answerStart"; requestId: string }
  | { type: "answerChunk"; requestId: string; text: string }
  | { type: "answerEnd"; requestId: string }
  | { type: "promptStart"; areaId: string }
  | { type: "promptChunk"; areaId: string; text: string }
  | { type: "promptEnd"; areaId: string }
  | { type: "reportStart"; reportId: ReportId }
  | { type: "reportChunk"; reportId: ReportId; text: string }
  | { type: "reportEnd"; reportId: ReportId }
  | {
      type: "contextEstimate";
      estimateId: string;
      /** null when no model is available to count with */
      tokens: number | null;
      maxTokens: number;
      budgetTokens: number;
      sampled: number;
      total: number;
    }
  | { type: "toast"; level: "info" | "warn" | "error"; message: string };
