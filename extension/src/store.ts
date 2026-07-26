import * as vscode from "vscode";

import { DEFAULT_SETTINGS } from "./lm";
import type {
  AnalyzerSettings,
  Classification,
  GeneratedPrompt,
  ModelCapabilities,
  Report,
  ReportId,
  Taxonomy,
} from "./types";

const STATE_KEY = "copilotPromptAnalyzer.state.v1";

export const DEFAULT_TAXONOMY: Taxonomy = {
  name: "Engineering areas",
  instruction: null,
  areas: [
    {
      id: "ux",
      label: "UI & UX",
      description:
        "Layout, styling, components, design, accessibility, copy in the interface.",
      color: "#c084fc",
    },
    {
      id: "api",
      label: "API & Services",
      description:
        "Endpoints, service layers, business logic, integrations, messaging.",
      color: "#60a5fa",
    },
    {
      id: "data",
      label: "Database & Data",
      description: "Schemas, queries, migrations, modelling, caching, storage.",
      color: "#34d399",
    },
    {
      id: "auth",
      label: "Auth & Identity",
      description:
        "Login, signup, sessions, tokens, roles, permissions, tenancy.",
      color: "#fbbf24",
    },
    {
      id: "security",
      label: "Security",
      description:
        "Secrets, vulnerabilities, hardening, encryption, compliance, privacy.",
      color: "#f87171",
    },
    {
      id: "infra",
      label: "Infra & Deployment",
      description:
        "CI/CD, containers, cloud resources, hosting, networking, environments.",
      color: "#38bdf8",
    },
    {
      id: "testing",
      label: "Testing & QA",
      description:
        "Unit/integration/e2e tests, fixtures, coverage, validation.",
      color: "#a3e635",
    },
    {
      id: "tooling",
      label: "Build & Tooling",
      description:
        "Bundlers, package managers, linters, scripts, editor and repo config.",
      color: "#fb923c",
    },
    {
      id: "debugging",
      label: "Debugging & Errors",
      description:
        'Stack traces, pasted error output, "why does this fail", regressions.',
      color: "#f472b6",
    },
    {
      id: "performance",
      label: "Performance",
      description: "Latency, memory, bundle size, profiling, optimisation.",
      color: "#2dd4bf",
    },
    {
      id: "docs",
      label: "Docs & Content",
      description: "READMEs, comments, specs, marketing and product copy.",
      color: "#94a3b8",
    },
    {
      id: "refactor",
      label: "Refactoring",
      description:
        "Restructuring, renaming, cleanup, architecture changes with no new behaviour.",
      color: "#818cf8",
    },
    {
      id: "ai",
      label: "AI & Prompting",
      description: "Models, prompts, agents, embeddings, LLM plumbing.",
      color: "#e879f9",
    },
    {
      id: "process",
      label: "Process & Meta",
      description:
        'Steering the agent, "continue", planning, todo lists, git and workflow.',
      color: "#cbd5e1",
    },
    {
      id: "other",
      label: "Other",
      description: "Anything that does not fit the areas above.",
      color: "#64748b",
    },
  ],
};

interface PersistedState {
  taxonomy: Taxonomy;
  classifications: Record<string, Classification>;
  generated: Record<string, GeneratedPrompt>;
  reports: Partial<Record<ReportId, Report>>;
  settings: AnalyzerSettings;
  capabilities: Record<string, ModelCapabilities>;
}

/**
 * Classifications are cached by prompt-text hash, so rescanning chat history or
 * changing filters never triggers re-classification. Changing the taxonomy does.
 */
export class AnalyzerStore {
  private state: PersistedState;

  constructor(private readonly memento: vscode.Memento) {
    const stored = memento.get<PersistedState>(STATE_KEY);
    this.state = {
      taxonomy: stored?.taxonomy ?? DEFAULT_TAXONOMY,
      classifications: stored?.classifications ?? {},
      generated: stored?.generated ?? {},
      reports: stored?.reports ?? {},
      settings: { ...DEFAULT_SETTINGS, ...(stored?.settings ?? {}) },
      capabilities: stored?.capabilities ?? {},
    };
  }

  get capabilities(): Record<string, ModelCapabilities> {
    return this.state.capabilities;
  }

  async setCapabilities(entry: ModelCapabilities): Promise<void> {
    this.state.capabilities = {
      ...this.state.capabilities,
      [entry.modelId]: entry,
    };
    await this.flush();
  }

  get taxonomy(): Taxonomy {
    return this.state.taxonomy;
  }

  get settings(): AnalyzerSettings {
    return this.state.settings;
  }

  async setSettings(
    patch: Partial<AnalyzerSettings>
  ): Promise<AnalyzerSettings> {
    this.state.settings = { ...this.state.settings, ...patch };
    await this.flush();
    return this.state.settings;
  }

  get reports(): Partial<Record<ReportId, Report>> {
    return this.state.reports;
  }

  reportFor(id: ReportId): Report | undefined {
    return this.state.reports[id];
  }

  async setReport(report: Report): Promise<void> {
    this.state.reports = { ...this.state.reports, [report.id]: report };
    await this.flush();
  }

  async clearReport(id: ReportId): Promise<void> {
    const next = { ...this.state.reports };
    delete next[id];
    this.state.reports = next;
    await this.flush();
  }

  get classifications(): Record<string, Classification> {
    return this.state.classifications;
  }

  get generated(): Record<string, GeneratedPrompt> {
    return this.state.generated;
  }

  generatedFor(areaId: string): GeneratedPrompt | undefined {
    return this.state.generated[areaId];
  }

  async setGenerated(prompt: GeneratedPrompt): Promise<void> {
    this.state.generated = { ...this.state.generated, [prompt.areaId]: prompt };
    await this.flush();
  }

  async clearGenerated(areaId: string): Promise<void> {
    const next = { ...this.state.generated };
    delete next[areaId];
    this.state.generated = next;
    await this.flush();
  }

  classificationFor(hash: string): Classification | undefined {
    return this.state.classifications[hash];
  }

  async setClassifications(
    entries: Record<string, Classification>
  ): Promise<void> {
    this.state.classifications = { ...this.state.classifications, ...entries };
    await this.flush();
  }

  async setTaxonomy(
    taxonomy: Taxonomy,
    clearClassifications: boolean
  ): Promise<void> {
    this.state.taxonomy = taxonomy;
    if (clearClassifications) {
      this.state.classifications = {};
      this.state.generated = {};
    }
    await this.flush();
  }

  async reset(): Promise<void> {
    this.state = {
      taxonomy: DEFAULT_TAXONOMY,
      classifications: {},
      generated: {},
      reports: {},
      settings: DEFAULT_SETTINGS,
      capabilities: {},
    };
    await this.flush();
  }

  private flush(): Thenable<void> {
    return this.memento.update(STATE_KEY, this.state);
  }
}
