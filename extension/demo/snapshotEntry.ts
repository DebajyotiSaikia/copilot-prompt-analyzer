import { buildDemoCorpus } from "../src/demoData";
import { DEFAULT_TAXONOMY } from "../src/store";
import type { Snapshot } from "../src/types";

/**
 * Builds a complete Snapshot from the fabricated demo corpus so the webview can
 * be rendered outside VS Code — for visual checks and for capturing demo assets.
 */
export function buildSnapshot(): Snapshot {
  const corpus = buildDemoCorpus();
  return {
    prompts: corpus.prompts,
    sessions: corpus.sessions,
    taxonomy: DEFAULT_TAXONOMY,
    classifications: corpus.classifications,
    generated: {},
    reports: {},
    models: [
      {
        id: "demo/opus",
        name: "Claude Opus 4.8",
        family: "claude-opus",
        vendor: "copilot",
        version: "1",
        maxInputTokens: 200000,
      },
      {
        id: "demo/haiku",
        name: "Claude Haiku 4.5",
        family: "claude-haiku",
        vendor: "copilot",
        version: "1",
        maxInputTokens: 128000,
      },
    ],
    settings: {
      modelId: "demo/opus",
      reasoningLevel: null,
      contextTokens: null,
    },
    capabilities: {},
    probingModel: null,
    activeModel: "Claude Opus 4.8",
    activeModelId: "demo/opus",
    unclassified: 0,
    failures: [],
    scannedAt: Date.now(),
    scannedDirs: ["<demo data>"],
  };
}
