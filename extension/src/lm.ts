import * as vscode from "vscode";

import type { AnalyzerSettings, ModelCapabilities, ModelInfo } from "./types";

/** Thrown for conditions the user can act on (no Copilot access, quota, blocked content). */
export class ModelUnavailableError extends Error {}

export const DEFAULT_SETTINGS: AnalyzerSettings = {
  modelId: null,
  reasoningLevel: null,
  contextTokens: null,
};

/** Share of the model's window used when the user has not chosen a budget. */
const DEFAULT_CONTEXT_SHARE = 0.55;

/**
 * Starting characters-per-token guess, replaced with a measured value the first
 * time we count real evidence for a model. Only used to decide how much text to
 * pack; deliberately conservative because under-estimating fails a request.
 */
const FALLBACK_CHARS_PER_TOKEN = 3.4;

/**
 * Candidate option keys and values to try when probing a provider.
 *
 * `vscode.lm` has no reasoning metadata whatsoever — `LanguageModelChat` exposes
 * only id/name/vendor/family/version/maxInputTokens, and `modelOptions` is an
 * untyped passthrough. These are therefore probe inputs, not a declared answer:
 * what the UI offers is only ever what the provider actually accepted.
 */
const CANDIDATE_KEYS = ["reasoning_effort", "reasoningEffort", "thinking"];
const CANDIDATE_LEVELS = ["minimal", "low", "medium", "high"];

let resolved: vscode.LanguageModelChat | undefined;
let settings: AnalyzerSettings = DEFAULT_SETTINGS;
let capabilities: Record<string, ModelCapabilities> = {};

export function applySettings(next: AnalyzerSettings): void {
  if (next.modelId !== settings.modelId) {
    resolved = undefined;
  }
  settings = next;
}

export function applyCapabilities(
  next: Record<string, ModelCapabilities>
): void {
  capabilities = next;
}

export function capabilitiesFor(
  modelId: string | undefined
): ModelCapabilities | undefined {
  return modelId ? capabilities[modelId] : undefined;
}

export function invalidateModelCache(): void {
  resolved = undefined;
}

function describeModel(model: vscode.LanguageModelChat): ModelInfo {
  return {
    id: model.id,
    name: model.name,
    family: model.family,
    vendor: model.vendor,
    version: model.version,
    maxInputTokens: model.maxInputTokens,
  };
}

export async function listModels(): Promise<ModelInfo[]> {
  const models = await vscode.lm.selectChatModels({});
  return models
    .map(describeModel)
    .sort(
      (a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name)
    );
}

export async function resolveModel(): Promise<vscode.LanguageModelChat> {
  if (resolved) {
    return resolved;
  }

  if (settings.modelId) {
    const all = await vscode.lm.selectChatModels({});
    const match = all.find((model) => model.id === settings.modelId);
    if (match) {
      resolved = match;
      return match;
    }
  }

  const family = vscode.workspace
    .getConfiguration("copilotPromptAnalyzer")
    .get<string>("model");
  const attempts: vscode.LanguageModelChatSelector[] = [];
  if (family) {
    attempts.push({ vendor: "copilot", family });
  }
  attempts.push({ vendor: "copilot" }, {});

  for (const selector of attempts) {
    const models = await vscode.lm.selectChatModels(selector);
    if (models.length > 0) {
      resolved = models[0];
      return resolved;
    }
  }

  throw new ModelUnavailableError(
    "No language model is available. Sign in to GitHub Copilot and make sure your plan includes chat."
  );
}

export async function activeModel(): Promise<ModelInfo | null> {
  try {
    return describeModel(await resolveModel());
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Capability probing                                                   */
/* ------------------------------------------------------------------ */

function looksLikeOptionRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("reasoning") ||
    message.includes("thinking") ||
    message.includes("unsupported parameter") ||
    message.includes("unknown parameter") ||
    message.includes("unrecognized") ||
    message.includes("invalid_request") ||
    message.includes("invalid parameter") ||
    message.includes("modeloptions") ||
    message.includes("not supported")
  );
}

/** One minimal request. Resolves true when the provider accepted the options. */
async function accepts(
  model: vscode.LanguageModelChat,
  modelOptions: Record<string, unknown>,
  token: vscode.CancellationToken
): Promise<boolean> {
  try {
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User("ok")],
      { modelOptions },
      token
    );
    // The provider can also reject while streaming, so drain the first fragment.
    for await (const _fragment of response.text) {
      break;
    }
    return true;
  } catch (error) {
    if (
      error instanceof vscode.CancellationError ||
      token.isCancellationRequested
    ) {
      throw error;
    }
    if (looksLikeOptionRejection(error)) {
      return false;
    }
    // Quota, auth or network problems are not capability answers.
    throw new ModelUnavailableError(
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Asks the provider what it supports by trying it. Runs at most
 * `CANDIDATE_KEYS.length + CANDIDATE_LEVELS.length` one-token requests, and only
 * ever in response to an explicit user action.
 */
export async function probeCapabilities(
  token: vscode.CancellationToken,
  onProgress?: (message: string) => void
): Promise<ModelCapabilities> {
  const model = await resolveModel();
  let requests = 0;
  let reasoningKey: string | null = null;

  for (const key of CANDIDATE_KEYS) {
    if (token.isCancellationRequested) {
      break;
    }
    onProgress?.(`Trying option "${key}"…`);
    requests += 1;
    if (await accepts(model, { [key]: "low" }, token)) {
      reasoningKey = key;
      break;
    }
  }

  const levels: string[] = [];
  if (reasoningKey) {
    levels.push("low");
    for (const level of CANDIDATE_LEVELS) {
      if (token.isCancellationRequested || level === "low") {
        continue;
      }
      onProgress?.(`Trying "${reasoningKey}: ${level}"…`);
      requests += 1;
      if (await accepts(model, { [reasoningKey]: level }, token)) {
        levels.push(level);
      }
    }
  }

  const existing = capabilities[model.id];
  const result: ModelCapabilities = {
    modelId: model.id,
    reasoningKey,
    reasoningLevels: CANDIDATE_LEVELS.filter((level) => levels.includes(level)),
    maxInputTokens: model.maxInputTokens,
    charsPerToken: existing?.charsPerToken ?? FALLBACK_CHARS_PER_TOKEN,
    probedAt: Date.now(),
    probeRequests: requests,
  };
  capabilities = { ...capabilities, [model.id]: result };
  return result;
}

/* ------------------------------------------------------------------ */
/* Context budgeting                                                    */
/* ------------------------------------------------------------------ */

/** Token budget for one request, from the provider's own window. */
export function contextBudgetTokens(model: vscode.LanguageModelChat): number {
  const max = Math.max(1000, model.maxInputTokens);
  const chosen =
    settings.contextTokens ?? Math.floor(max * DEFAULT_CONTEXT_SHARE);
  return Math.min(max, Math.max(1000, chosen));
}

/** The same budget expressed in characters, using this model's measured ratio. */
export function contextBudget(model: vscode.LanguageModelChat): number {
  const ratio =
    capabilities[model.id]?.charsPerToken ?? FALLBACK_CHARS_PER_TOKEN;
  return Math.floor(contextBudgetTokens(model) * ratio);
}

/**
 * Records the real characters-per-token ratio observed for a model so future
 * packing is sized from measurement rather than a guess.
 */
export function calibrate(
  modelId: string,
  chars: number,
  tokens: number
): ModelCapabilities | null {
  if (tokens < 200 || chars < 200) {
    return null;
  }
  const ratio = Math.min(6, Math.max(1.5, chars / tokens));
  const existing = capabilities[modelId];
  if (existing && Math.abs(existing.charsPerToken - ratio) < 0.05) {
    return null;
  }
  const next: ModelCapabilities = existing
    ? { ...existing, charsPerToken: ratio }
    : {
        modelId,
        reasoningKey: null,
        reasoningLevels: [],
        maxInputTokens: 0,
        charsPerToken: ratio,
        probedAt: 0,
        probeRequests: 0,
      };
  capabilities = { ...capabilities, [modelId]: next };
  return next;
}

/* ------------------------------------------------------------------ */
/* Requests                                                             */
/* ------------------------------------------------------------------ */

function describe(error: unknown): string {
  if (error instanceof vscode.LanguageModelError) {
    switch (error.code) {
      case vscode.LanguageModelError.NoPermissions.name:
        return "Access to the language model was denied. Re-run the command and allow access when prompted.";
      case vscode.LanguageModelError.Blocked.name:
        return "The model refused this request. Try narrowing the selection or rewording the question.";
      case vscode.LanguageModelError.NotFound.name:
        return "The selected model is no longer available. Pick another one from the model dropdown.";
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function requestOptions(
  model: vscode.LanguageModelChat
): vscode.LanguageModelChatRequestOptions {
  const capability = capabilities[model.id];
  const level = settings.reasoningLevel;
  if (
    !level ||
    !capability?.reasoningKey ||
    !capability.reasoningLevels.includes(level)
  ) {
    return {};
  }
  return { modelOptions: { [capability.reasoningKey]: level } };
}

/** Sends one request and yields text as it streams in. */
export async function* streamText(
  messages: vscode.LanguageModelChatMessage[],
  token: vscode.CancellationToken
): AsyncGenerator<string> {
  const model = await resolveModel();
  try {
    const response = await model.sendRequest(
      messages,
      requestOptions(model),
      token
    );
    for await (const fragment of response.text) {
      yield fragment;
    }
  } catch (error) {
    if (
      error instanceof vscode.CancellationError ||
      token.isCancellationRequested
    ) {
      return;
    }
    invalidateModelCache();
    throw new ModelUnavailableError(describe(error));
  }
}

/** Sends one request and returns the complete response text. */
export async function completeText(
  messages: vscode.LanguageModelChatMessage[],
  token: vscode.CancellationToken
): Promise<string> {
  let out = "";
  for await (const chunk of streamText(messages, token)) {
    out += chunk;
  }
  return out;
}

/**
 * Models wrap JSON in prose or fences even when told not to. Pull out the first
 * balanced array/object rather than trusting the whole response to parse.
 */
export function extractJson<T>(raw: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidates = [fenced?.[1], raw].filter(
    (candidate): candidate is string => typeof candidate === "string"
  );

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // fall through to substring extraction
    }
    for (const [open, close] of [
      ["[", "]"],
      ["{", "}"],
    ] as const) {
      const start = trimmed.indexOf(open);
      const end = trimmed.lastIndexOf(close);
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1)) as T;
        } catch {
          // try the next shape
        }
      }
    }
  }
  return null;
}
