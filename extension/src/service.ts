import { promises as fs } from "node:fs";
import * as vscode from "vscode";

import { answerQuestion } from "./ask";
import {
  duplicateReport,
  packEvidence,
  pasteReport,
  qualityReport,
} from "./analysis";
import { classifyPrompts, proposeTaxonomy } from "./classifier";
import { scanChatHistory, userDirFromGlobalStorage } from "./chatStore";
import { buildDemoCorpus } from "./demoData";
import { ScanCache } from "./scanCache";
import {
  ModelUnavailableError,
  activeModel,
  applyCapabilities,
  applySettings,
  calibrate,
  contextBudget,
  contextBudgetTokens,
  invalidateModelCache,
  listModels,
  probeCapabilities,
  resolveModel,
} from "./lm";
import {
  REPORTS,
  buildSaveTarget,
  generateAreaPrompt,
  sampledCount,
} from "./promptBuilder";
import { AnalyzerStore, DEFAULT_TAXONOMY } from "./store";
import {
  generateCorrectionReport,
  generateDecisionLog,
  generateGlobalInstructions,
  generateProjectSpecs,
  rewritePrompt,
} from "./synthesis";
import type {
  InboundMessage,
  ModelInfo,
  OutboundMessage,
  PromptMode,
  PromptRecord,
  ReportId,
  SaveFormat,
  SessionRecord,
  Snapshot,
} from "./types";

/**
 * Owns the data and every long-running operation. Any number of webviews (the
 * sidebar view, the editor panel) attach to it and receive the same snapshots,
 * so the two hosts never drift apart. Only Q&A streams are addressed to the
 * webview that asked.
 */
export class AnalyzerService {
  private prompts: PromptRecord[] = [];
  private sessions: SessionRecord[] = [];
  private scannedDirs: string[] = [];
  private scannedAt = 0;
  private working = false;
  private scanning: Promise<void> | undefined;

  private readonly views = new Set<vscode.Webview>();
  private readonly askTokens = new Map<
    vscode.Webview,
    vscode.CancellationTokenSource
  >();
  private generateTokens: vscode.CancellationTokenSource | undefined;
  private models: ModelInfo[] = [];
  private activeModelInfo: ModelInfo | null = null;
  private probingModel: string | null = null;
  private demoMode = false;
  private demoClassifications: Record<
    string,
    import("./types").Classification
  > = {};
  private failures: string[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: AnalyzerStore
  ) {
    applySettings(store.settings);
    applyCapabilities(store.capabilities);
    context.subscriptions.push(
      vscode.lm.onDidChangeChatModels(() => {
        invalidateModelCache();
        void this.refreshModels();
      })
    );
  }

  get hasData(): boolean {
    return this.scannedAt > 0;
  }

  /** Registers a webview; the returned disposable detaches it. */
  attach(webview: vscode.Webview): vscode.Disposable {
    this.views.add(webview);
    const subscription = webview.onDidReceiveMessage(
      (message: InboundMessage) => void this.handle(message, webview)
    );
    return new vscode.Disposable(() => {
      this.askTokens.get(webview)?.cancel();
      this.askTokens.delete(webview);
      this.views.delete(webview);
      subscription.dispose();
    });
  }

  /* ------------------------------------------------------------------ */

  private broadcast(message: OutboundMessage): void {
    for (const view of this.views) {
      void view.postMessage(message);
    }
  }

  private toast(level: "info" | "warn" | "error", message: string): void {
    this.broadcast({ type: "toast", level, message });
  }

  private snapshot(): Snapshot {
    return {
      prompts: this.prompts,
      sessions: this.sessions,
      taxonomy: this.store.taxonomy,
      classifications: this.demoMode
        ? this.demoClassifications
        : this.store.classifications,
      generated: this.store.generated,
      reports: this.store.reports,
      models: this.models,
      settings: this.store.settings,
      capabilities: this.store.capabilities,
      probingModel: this.probingModel,
      activeModel: this.activeModelInfo?.name ?? null,
      activeModelId: this.activeModelInfo?.id ?? null,
      unclassified: this.unclassifiedCount(),
      failures: this.failures,
      scannedAt: this.scannedAt,
      scannedDirs: this.demoMode ? ["<demo data>"] : this.scannedDirs,
    };
  }

  /**
   * Swaps the corpus for a fabricated one. Real history cannot be filmed — it
   * contains source, paths and anything the user pasted into a prompt.
   */
  async setDemoMode(enabled: boolean): Promise<void> {
    this.demoMode = enabled;
    if (enabled) {
      const corpus = buildDemoCorpus();
      this.prompts = corpus.prompts;
      this.sessions = corpus.sessions;
      this.demoClassifications = corpus.classifications;
      this.scannedAt = Date.now();
      this.sendSnapshot();
      this.toast("info", "Demo data loaded. Your real history is untouched.");
    } else {
      this.demoClassifications = {};
      await this.rescan();
      this.toast("info", "Back to your real chat history.");
    }
  }

  get isDemoMode(): boolean {
    return this.demoMode;
  }

  /** Classifications for whichever corpus is currently loaded. */
  private get activeClassifications(): Record<
    string,
    import("./types").Classification
  > {
    return this.demoMode
      ? this.demoClassifications
      : this.store.classifications;
  }

  /** Distinct prompt texts in the active corpus. */
  private distinctPrompts(): number {
    return new Set(this.prompts.map((prompt) => prompt.hash)).size;
  }

  /**
   * Classification costs real requests against the user's Copilot quota and can
   * run for minutes on a large corpus, so anything beyond a trivial batch is
   * confirmed with the actual numbers rather than started silently.
   */
  private async confirmClassify(
    pending: number,
    force: boolean
  ): Promise<boolean> {
    const batchSize = Math.max(
      1,
      vscode.workspace
        .getConfiguration("copilotChatAnalyzer")
        .get<number>("batchSize") ?? 20
    );
    const requests = Math.ceil(pending / batchSize);
    if (!force && requests <= 3) {
      return true; // small top-up, not worth interrupting for
    }

    const model = this.activeModelInfo?.name ?? "the selected model";
    const choice = await vscode.window.showInformationMessage(
      force
        ? `Re-classify all ${pending.toLocaleString()} prompts?`
        : `Classify ${pending.toLocaleString()} new prompts?`,
      {
        modal: true,
        detail: [
          `About ${requests.toLocaleString()} request(s) to ${model}, ${batchSize} prompts each.`,
          force
            ? "Existing classifications for these prompts will be replaced."
            : "Already-classified prompts are skipped, and results are cached so this only happens once.",
          "It runs in the background and can be cancelled at any point; whatever finished is kept.",
        ].join("\n\n"),
      },
      force ? "Re-classify all" : "Classify"
    );
    return choice !== undefined;
  }

  /** Distinct prompt texts with no classification in the active corpus. */
  private unclassifiedCount(): number {
    const known = this.activeClassifications;
    const pending = new Set<string>();
    for (const prompt of this.prompts) {
      if (!known[prompt.hash]) {
        pending.add(prompt.hash);
      }
    }
    return pending.size;
  }

  /** Re-enumerates available models and refreshes the resolved one. */
  async refreshModels(): Promise<void> {
    try {
      this.models = await listModels();
    } catch {
      this.models = [];
    }
    this.activeModelInfo = await activeModel();
    this.sendSnapshot();
  }

  /**
   * Asks the provider what it supports by trying it, because the API declares
   * nothing about reasoning. Explicit user action only — it spends a handful of
   * one-token requests.
   */
  private async probe(): Promise<void> {
    if (this.probingModel) {
      return;
    }
    const model = await activeModel();
    if (!model) {
      this.toast("error", "No language model is available to probe.");
      return;
    }

    this.probingModel = model.id;
    this.sendSnapshot();
    const tokens = new vscode.CancellationTokenSource();

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Detecting what ${model.name} supports`,
          cancellable: true,
        },
        async (progress, cancelToken) => {
          cancelToken.onCancellationRequested(() => tokens.cancel());
          const result = await probeCapabilities(tokens.token, (message) =>
            progress.report({ message })
          );
          await this.store.setCapabilities(result);
          applyCapabilities(this.store.capabilities);

          // A level that is no longer supported must not stay selected.
          const current = this.store.settings.reasoningLevel;
          if (current && !result.reasoningLevels.includes(current)) {
            applySettings(
              await this.store.setSettings({ reasoningLevel: null })
            );
          }

          this.toast(
            "info",
            result.reasoningKey
              ? `${model.name} accepts "${result.reasoningKey}": ${result.reasoningLevels.join(", ")} (${result.probeRequests} probe requests).`
              : `${model.name} rejected every reasoning option tried (${result.probeRequests} probe requests). The control stays off for this model.`
          );
        }
      );
    } catch (error) {
      this.toast(
        "error",
        error instanceof ModelUnavailableError
          ? `Probe stopped: ${error.message}`
          : `Probe failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      tokens.dispose();
      this.probingModel = null;
      this.sendSnapshot();
    }
  }

  private sendSnapshot(target?: vscode.Webview): void {
    const message: OutboundMessage = {
      type: "snapshot",
      snapshot: this.snapshot(),
    };
    if (target) {
      void target.postMessage(message);
    } else {
      this.broadcast(message);
    }
  }

  private busy(busy: boolean, label?: string, progress?: number): void {
    this.working = busy;
    this.broadcast({ type: "busy", busy, label, progress });
  }

  private userDirs(): string[] {
    const primary = userDirFromGlobalStorage(
      this.context.globalStorageUri.fsPath
    );
    const extra = vscode.workspace
      .getConfiguration("copilotChatAnalyzer")
      .get<string[]>("extraUserDirs", []);
    return [...new Set([primary, ...extra])];
  }

  /* ------------------------------------------------------------------ */

  async rescan(): Promise<void> {
    if (this.demoMode) {
      await this.setDemoMode(true);
      return;
    }
    if (this.scanning) {
      return this.scanning;
    }
    this.scanning = (async () => {
      this.busy(true, "Scanning chat history…", 0);
      try {
        const cache = await ScanCache.open(
          this.context.globalStorageUri.fsPath
        );
        const result = await scanChatHistory(this.userDirs(), {
          cache,
          onProgress: (done, total) =>
            this.busy(
              true,
              `Reading sessions ${done} / ${total}`,
              total === 0 ? 1 : done / total
            ),
        });
        await cache.flush();
        this.prompts = result.prompts;
        this.sessions = result.sessions;
        this.scannedDirs = result.scannedDirs;
        this.failures = result.failures;
        this.scannedAt = Date.now();
        this.sendSnapshot();
        if (result.prompts.length === 0) {
          this.toast("warn", "No Copilot chat history was found on disk.");
        }
      } catch (error) {
        this.toast(
          "error",
          `Scan failed: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        this.busy(false);
      }
    })();
    try {
      await this.scanning;
    } finally {
      this.scanning = undefined;
    }
  }

  async classify(force: boolean): Promise<void> {
    if (this.working) {
      this.toast("warn", "Another operation is still running.");
      return;
    }
    if (!this.hasData) {
      await this.rescan();
    }

    const pending = force ? this.distinctPrompts() : this.unclassifiedCount();
    if (pending === 0) {
      const total = this.distinctPrompts();
      this.toast(
        "info",
        total === 0
          ? "There are no prompts to classify yet. Try Rescan."
          : `All ${total.toLocaleString()} distinct prompts are already classified. Use “Re-classify all” to redo them.`
      );
      return;
    }

    if (!(await this.confirmClassify(pending, force))) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Classifying Copilot prompts",
        cancellable: true,
      },
      async (progress, token) => {
        this.busy(true, "Classifying prompts…", 0);
        try {
          const { results, skipped } = await classifyPrompts(
            this.prompts,
            this.store.taxonomy,
            this.store.classifications,
            force,
            token,
            (done, total) => {
              progress.report({ message: `${done} / ${total}` });
              this.busy(
                true,
                `Classifying ${done} / ${total}`,
                total === 0 ? 1 : done / total
              );
            }
          );

          await this.store.setClassifications(results);
          this.sendSnapshot();

          const count = Object.keys(results).length;
          if (token.isCancellationRequested) {
            this.toast(
              "info",
              `Cancelled. ${count} prompt(s) classified before stopping.`
            );
          } else if (count === 0) {
            this.toast(
              "warn",
              "The model returned nothing usable. Nothing was classified — try again, or pick a different model."
            );
          } else {
            const remaining = this.unclassifiedCount();
            this.toast(
              skipped > 0 ? "warn" : "info",
              `Classified ${count.toLocaleString()} prompt(s).` +
                (skipped > 0
                  ? ` ${skipped} were skipped and will retry next run.`
                  : "") +
                (remaining > 0
                  ? ` ${remaining.toLocaleString()} still unclassified.`
                  : "")
            );
          }
        } catch (error) {
          this.toast(
            "error",
            error instanceof ModelUnavailableError
              ? error.message
              : `Classification failed: ${
                  error instanceof Error ? error.message : String(error)
                }`
          );
        } finally {
          this.busy(false);
        }
      }
    );
  }

  private async regroup(instruction: string): Promise<void> {
    if (this.working || !instruction.trim()) {
      return;
    }
    this.busy(true, "Designing new grouping…");
    const tokens = new vscode.CancellationTokenSource();
    try {
      const taxonomy = await proposeTaxonomy(
        instruction.trim(),
        this.prompts,
        tokens.token
      );
      if (!taxonomy) {
        this.toast(
          "error",
          "The model did not return a usable grouping. Try rephrasing."
        );
        return;
      }
      await this.store.setTaxonomy(taxonomy, true);
      this.sendSnapshot();
      this.toast(
        "info",
        `Regrouped into ${taxonomy.areas.length} areas. Reclassifying…`
      );
    } catch (error) {
      this.toast(
        "error",
        error instanceof ModelUnavailableError
          ? error.message
          : `Regrouping failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    } finally {
      tokens.dispose();
      this.busy(false);
    }
    await this.classify(true);
  }

  private async ask(
    source: vscode.Webview,
    requestId: string,
    question: string,
    promptIds: string[],
    label: string
  ): Promise<void> {
    this.askTokens.get(source)?.cancel();
    const tokens = new vscode.CancellationTokenSource();
    this.askTokens.set(source, tokens);

    const wanted = new Set(promptIds);
    const scoped = this.prompts.filter((prompt) => wanted.has(prompt.id));

    void source.postMessage({
      type: "answerStart",
      requestId,
    } satisfies OutboundMessage);
    try {
      for await (const chunk of answerQuestion(
        question,
        scoped,
        this.activeClassifications,
        label,
        tokens.token
      )) {
        if (tokens.token.isCancellationRequested) {
          break;
        }
        void source.postMessage({
          type: "answerChunk",
          requestId,
          text: chunk,
        } satisfies OutboundMessage);
      }
    } catch (error) {
      void source.postMessage({
        type: "answerChunk",
        requestId,
        text: `\n\n**Error:** ${error instanceof Error ? error.message : String(error)}`,
      } satisfies OutboundMessage);
    } finally {
      void source.postMessage({
        type: "answerEnd",
        requestId,
      } satisfies OutboundMessage);
      if (this.askTokens.get(source) === tokens) {
        this.askTokens.delete(source);
      }
      tokens.dispose();
    }
  }

  /**
   * Distils every request in one area into a reusable master prompt. Streams to
   * the requesting view, then persists and broadcasts so both hosts show it.
   */
  private async generatePrompt(
    source: vscode.Webview,
    areaId: string,
    areaLabel: string,
    promptIds: string[],
    extra: string,
    mode: PromptMode
  ): Promise<void> {
    const area =
      this.store.taxonomy.areas.find((candidate) => candidate.id === areaId) ??
      ({
        id: areaId,
        label: areaLabel,
        description: "",
        color: "#64748b",
      } as const);

    const wanted = new Set(promptIds);
    const scoped = this.prompts.filter((prompt) => wanted.has(prompt.id));
    const extraInstruction = extra.trim() || null;

    this.generateTokens?.cancel();
    const tokens = new vscode.CancellationTokenSource();
    this.generateTokens = tokens;

    void source.postMessage({
      type: "promptStart",
      areaId,
    } satisfies OutboundMessage);
    let markdown = "";
    try {
      for await (const chunk of generateAreaPrompt(
        area,
        scoped,
        this.activeClassifications,
        extraInstruction,
        mode,
        tokens.token
      )) {
        if (tokens.token.isCancellationRequested) {
          break;
        }
        markdown += chunk;
        void source.postMessage({
          type: "promptChunk",
          areaId,
          text: chunk,
        } satisfies OutboundMessage);
      }

      if (markdown.trim()) {
        await this.store.setGenerated({
          areaId,
          areaLabel: area.label,
          markdown: markdown.trim(),
          generatedAt: Date.now(),
          sourceCount: scoped.length,
          sampledCount: await sampledCount(scoped, this.activeClassifications),
          extraInstruction,
          mode,
        });
        this.sendSnapshot();
      }
    } catch (error) {
      this.toast(
        "error",
        error instanceof ModelUnavailableError
          ? error.message
          : `Prompt generation failed: ${
              error instanceof Error ? error.message : String(error)
            }`
      );
    } finally {
      void source.postMessage({
        type: "promptEnd",
        areaId,
      } satisfies OutboundMessage);
      if (this.generateTokens === tokens) {
        this.generateTokens = undefined;
      }
      tokens.dispose();
    }
  }

  /**
   * Builds one of the corpus-wide reports. Locally computed reports return
   * instantly and cost nothing; the rest stream from the model.
   */
  private async buildReport(
    source: vscode.Webview,
    reportId: ReportId,
    promptIds: string[]
  ): Promise<void> {
    const spec = REPORTS.find((candidate) => candidate.id === reportId);
    if (!spec) {
      return;
    }

    const wanted = new Set(promptIds);
    const scoped = this.prompts.filter((prompt) => wanted.has(prompt.id));
    const meta = `${scoped.length.toLocaleString()} prompts · ${
      new Set(scoped.map((prompt) => prompt.workspaceName)).size
    } projects`;

    const persist = async (
      markdown: string,
      modelName: string | null
    ): Promise<void> => {
      if (!markdown.trim()) {
        return;
      }
      await this.store.setReport({
        id: reportId,
        title: spec.title,
        markdown: markdown.trim(),
        generatedAt: Date.now(),
        meta,
        suggestedPath: spec.suggestedPath,
        modelName,
      });
      this.sendSnapshot();
    };

    void source.postMessage({
      type: "reportStart",
      reportId,
    } satisfies OutboundMessage);

    if (spec.local) {
      try {
        const markdown =
          reportId === "quality"
            ? qualityReport(scoped)
            : reportId === "duplicates"
              ? duplicateReport(scoped)
              : pasteReport(scoped);
        void source.postMessage({
          type: "reportChunk",
          reportId,
          text: markdown,
        } satisfies OutboundMessage);
        await persist(markdown, null);
      } catch (error) {
        this.toast(
          "error",
          `Report failed: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        void source.postMessage({
          type: "reportEnd",
          reportId,
        } satisfies OutboundMessage);
      }
      return;
    }

    this.generateTokens?.cancel();
    const tokens = new vscode.CancellationTokenSource();
    this.generateTokens = tokens;

    let markdown = "";
    try {
      const existing =
        reportId === "instructions"
          ? await this.readWorkspaceInstructions()
          : null;

      const stream =
        reportId === "instructions"
          ? generateGlobalInstructions(
              scoped,
              this.activeClassifications,
              existing,
              tokens.token
            )
          : reportId === "corrections"
            ? generateCorrectionReport(
                scoped,
                this.activeClassifications,
                tokens.token
              )
            : reportId === "projects"
              ? generateProjectSpecs(
                  scoped,
                  this.activeClassifications,
                  tokens.token
                )
              : generateDecisionLog(
                  scoped,
                  this.activeClassifications,
                  tokens.token
                );

      for await (const chunk of stream) {
        if (tokens.token.isCancellationRequested) {
          break;
        }
        markdown += chunk;
        void source.postMessage({
          type: "reportChunk",
          reportId,
          text: chunk,
        } satisfies OutboundMessage);
      }
      await persist(
        markdown,
        (await resolveModel().catch(() => null))?.name ?? null
      );
    } catch (error) {
      this.toast(
        "error",
        error instanceof ModelUnavailableError
          ? error.message
          : `Report failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      void source.postMessage({
        type: "reportEnd",
        reportId,
      } satisfies OutboundMessage);
      if (this.generateTokens === tokens) {
        this.generateTokens = undefined;
      }
      tokens.dispose();
    }
  }

  /**
   * Packs the evidence exactly as a real run would, then counts it once with the
   * model's own tokeniser. One API call, so it is cheap enough to run whenever a
   * modal opens or the filters change.
   */
  private async estimateContext(
    source: vscode.Webview,
    estimateId: string,
    promptIds: string[]
  ): Promise<void> {
    const wanted = new Set(promptIds);
    const scoped = this.prompts.filter((prompt) => wanted.has(prompt.id));

    let tokens: number | null = null;
    let maxTokens = 0;
    let budgetTokens = 0;
    let sampled = 0;

    try {
      const model = await resolveModel();
      const budget = contextBudget(model);
      const evidence = packEvidence(scoped, this.activeClassifications, budget);
      const text = evidence.lines.join("\n\n");
      sampled = evidence.sampled;
      maxTokens = model.maxInputTokens;
      budgetTokens = contextBudgetTokens(model);
      tokens = await model.countTokens(text);

      // Use the measurement to replace the characters-per-token guess, so the
      // next pack is sized from this model's real tokeniser.
      const calibrated = calibrate(model.id, text.length, tokens);
      if (calibrated) {
        await this.store.setCapabilities(calibrated);
      }
    } catch {
      tokens = null;
    }

    void source.postMessage({
      type: "contextEstimate",
      estimateId,
      tokens,
      maxTokens,
      budgetTokens,
      sampled,
      total: scoped.length,
    } satisfies OutboundMessage);
  }

  private async readWorkspaceInstructions(): Promise<string | null> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return null;
    }
    const uri = vscode.Uri.joinPath(
      folder.uri,
      ".github",
      "copilot-instructions.md"
    );
    try {
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(
        "utf8"
      );
    } catch {
      return null;
    }
  }

  private async rewriteOne(
    source: vscode.Webview,
    requestId: string,
    promptId: string
  ): Promise<void> {
    const prompt = this.prompts.find((candidate) => candidate.id === promptId);
    if (!prompt) {
      return;
    }
    this.askTokens.get(source)?.cancel();
    const tokens = new vscode.CancellationTokenSource();
    this.askTokens.set(source, tokens);

    void source.postMessage({
      type: "answerStart",
      requestId,
    } satisfies OutboundMessage);
    try {
      for await (const chunk of rewritePrompt(
        prompt,
        this.activeClassifications[prompt.hash],
        tokens.token
      )) {
        if (tokens.token.isCancellationRequested) {
          break;
        }
        void source.postMessage({
          type: "answerChunk",
          requestId,
          text: chunk,
        } satisfies OutboundMessage);
      }
    } catch (error) {
      void source.postMessage({
        type: "answerChunk",
        requestId,
        text: `\n\n**Error:** ${error instanceof Error ? error.message : String(error)}`,
      } satisfies OutboundMessage);
    } finally {
      void source.postMessage({
        type: "answerEnd",
        requestId,
      } satisfies OutboundMessage);
      if (this.askTokens.get(source) === tokens) {
        this.askTokens.delete(source);
      }
      tokens.dispose();
    }
  }

  /**
   * Writes a generated document. Inside a workspace, structured formats go to
   * their conventional path; otherwise the user picks. Existing files are never
   * clobbered without confirmation.
   */
  private async writeDocument(
    label: string,
    markdown: string,
    format: SaveFormat,
    explicitPath?: string
  ): Promise<void> {
    const target = buildSaveTarget(label, markdown, format, explicitPath);
    const folder = vscode.workspace.workspaceFolders?.[0];
    let uri: vscode.Uri | undefined;

    if (folder) {
      uri = vscode.Uri.joinPath(folder.uri, ...target.relativePath.split("/"));
    } else {
      uri = await vscode.window.showSaveDialog({
        saveLabel: "Save",
        filters: { Markdown: ["md"] },
        defaultUri: vscode.Uri.file(
          target.relativePath.split("/").pop() ?? "document.md"
        ),
      });
    }
    if (!uri) {
      return;
    }

    let exists = false;
    try {
      await vscode.workspace.fs.stat(uri);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists && folder) {
      const choice = await vscode.window.showWarningMessage(
        `${target.relativePath} already exists. Overwrite it?`,
        { modal: true },
        "Overwrite"
      );
      if (choice !== "Overwrite") {
        return;
      }
    }

    const parent = uri.with({
      path: uri.path.slice(0, uri.path.lastIndexOf("/")),
    });
    await vscode.workspace.fs.createDirectory(parent);
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(target.contents, "utf8")
    );
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
    this.toast("info", `Saved ${target.relativePath}.`);
  }

  private async savePrompt(areaId: string, format: SaveFormat): Promise<void> {
    const generated = this.store.generatedFor(areaId);
    if (!generated) {
      this.toast("warn", "Generate the prompt first.");
      return;
    }
    await this.writeDocument(generated.areaLabel, generated.markdown, format);
  }

  private async saveReport(
    reportId: ReportId,
    format: SaveFormat
  ): Promise<void> {
    const report = this.store.reportFor(reportId);
    if (!report) {
      this.toast("warn", "Generate the report first.");
      return;
    }
    await this.writeDocument(
      report.title,
      report.markdown,
      format,
      format === "markdown" ? report.suggestedPath : undefined
    );
  }

  async exportJson(): Promise<void> {
    if (!this.hasData) {
      await this.rescan();
    }
    const target = await vscode.window.showSaveDialog({
      saveLabel: "Export",
      filters: { JSON: ["json"] },
      defaultUri: vscode.Uri.file("copilot-prompts.json"),
    });
    if (!target) {
      return;
    }
    const payload = this.prompts.map((prompt) => ({
      ...prompt,
      classification: this.store.classifications[prompt.hash] ?? null,
    }));
    await fs.writeFile(target.fsPath, JSON.stringify(payload, null, 2), "utf8");
    this.toast("info", `Exported ${payload.length} prompt(s).`);
  }

  private async openSession(sessionId: string): Promise<void> {
    const session = this.sessions.find(
      (candidate) => candidate.id === sessionId
    );
    if (!session) {
      return;
    }
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(session.sourceFile)
    );
    await vscode.window.showTextDocument(document, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
  }

  /* ------------------------------------------------------------------ */

  private async handle(
    message: InboundMessage,
    source: vscode.Webview
  ): Promise<void> {
    switch (message.type) {
      case "ready":
        if (this.hasData) {
          this.sendSnapshot(source);
        } else {
          await this.rescan();
        }
        void this.refreshModels();
        return;
      case "rescan":
        await this.rescan();
        return;
      case "classify":
        await this.classify(message.force);
        return;
      case "regroup":
        await this.regroup(message.instruction);
        return;
      case "resetTaxonomy":
        await this.store.setTaxonomy(DEFAULT_TAXONOMY, true);
        this.sendSnapshot();
        this.toast(
          "info",
          "Restored the default grouping. Run Classify to repopulate."
        );
        return;
      case "ask":
        await this.ask(
          source,
          message.requestId,
          message.question,
          message.context.promptIds,
          message.context.label
        );
        return;
      case "cancelAsk":
        this.askTokens.get(source)?.cancel();
        return;
      case "generatePrompt":
        await this.generatePrompt(
          source,
          message.areaId,
          message.areaLabel,
          message.promptIds,
          message.extra,
          message.mode
        );
        return;
      case "cancelGenerate":
        this.generateTokens?.cancel();
        return;
      case "savePrompt":
        await this.savePrompt(message.areaId, message.format);
        return;
      case "clearPrompt":
        await this.store.clearGenerated(message.areaId);
        this.sendSnapshot();
        return;
      case "setSettings": {
        const next = await this.store.setSettings(message.settings);
        applySettings(next);
        this.activeModelInfo = await activeModel();
        this.sendSnapshot();
        return;
      }
      case "refreshModels":
        await this.refreshModels();
        return;
      case "probeCapabilities":
        await this.probe();
        return;
      case "buildReport":
        await this.buildReport(source, message.reportId, message.promptIds);
        return;
      case "saveReport":
        await this.saveReport(message.reportId, message.format);
        return;
      case "clearReport":
        await this.store.clearReport(message.reportId);
        this.sendSnapshot();
        return;
      case "rewritePrompt":
        await this.rewriteOne(source, message.requestId, message.promptId);
        return;
      case "estimateContext":
        await this.estimateContext(
          source,
          message.estimateId,
          message.promptIds
        );
        return;
      case "openSession":
        await this.openSession(message.sessionId);
        return;
      case "openInEditor":
        await vscode.commands.executeCommand("copilotChatAnalyzer.open");
        return;
      case "copy":
        await vscode.env.clipboard.writeText(message.text);
        this.toast("info", "Copied to clipboard.");
        return;
      case "export":
        await this.exportJson();
        return;
      default:
        return;
    }
  }
}
