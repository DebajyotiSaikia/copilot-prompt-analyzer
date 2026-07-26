import * as vscode from "vscode";

import { completeText, extractJson } from "./lm";
import type { Classification, PromptRecord, Taxonomy } from "./types";

interface BatchItem {
  i: number;
  area: string;
  subarea?: string;
  intent?: string;
  tags?: string[];
}

const CLASSIFY_SYSTEM = [
  "You are a precise classifier for software-engineering chat prompts.",
  "You are given prompts a developer sent to an AI coding assistant.",
  "Assign each prompt to exactly one area from the provided taxonomy.",
  "Judge by what the developer was trying to accomplish, not by surface keywords.",
  "Pasted error output belongs to the area of the thing that broke when that is clear.",
  'Short steering messages such as "continue", "no, try again" or "that is wrong" belong to the process area.',
  "Reply with JSON only. No prose, no code fences.",
].join(" ");

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

function buildBatchPrompt(
  taxonomy: Taxonomy,
  batch: PromptRecord[],
  limit: number
): string {
  const areas = taxonomy.areas
    .map((a) => `- ${a.id}: ${a.label} — ${a.description}`)
    .join("\n");
  const items = batch
    .map((p, i) => `#${i} [${p.workspaceName}] ${truncate(p.text, limit)}`)
    .join("\n");

  return [
    `Taxonomy "${taxonomy.name}":`,
    areas,
    taxonomy.instruction
      ? `\nAdditional grouping instruction from the user: ${taxonomy.instruction}`
      : "",
    "",
    "Prompts:",
    items,
    "",
    "For every prompt return one object:",
    '{"i": <index>, "area": "<area id from the taxonomy>", "subarea": "<2-4 word specific topic>", "intent": "<max 8 words describing what the developer wanted>", "tags": ["<lowercase keyword>", ...]}',
    "Use at most 4 tags. Return a JSON array with one object per prompt, in order.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function classifyBatch(
  taxonomy: Taxonomy,
  batch: PromptRecord[],
  limit: number,
  token: vscode.CancellationToken
): Promise<Record<string, Classification>> {
  const messages = [
    vscode.LanguageModelChatMessage.User(CLASSIFY_SYSTEM),
    vscode.LanguageModelChatMessage.User(
      buildBatchPrompt(taxonomy, batch, limit)
    ),
  ];
  const raw = await completeText(messages, token);
  const parsed = extractJson<BatchItem[]>(raw);

  const valid = new Set(taxonomy.areas.map((a) => a.id));
  const fallback = valid.has("other")
    ? "other"
    : taxonomy.areas[taxonomy.areas.length - 1].id;
  const out: Record<string, Classification> = {};

  if (!Array.isArray(parsed)) {
    return out;
  }

  for (const item of parsed) {
    const record = batch[item?.i ?? -1];
    if (!record) {
      continue;
    }
    const area =
      typeof item.area === "string" && valid.has(item.area)
        ? item.area
        : fallback;
    out[record.hash] = {
      area,
      subarea:
        typeof item.subarea === "string" ? item.subarea.slice(0, 60) : null,
      intent:
        typeof item.intent === "string" ? item.intent.slice(0, 120) : null,
      tags: Array.isArray(item.tags)
        ? item.tags
            .filter((t): t is string => typeof t === "string")
            .slice(0, 4)
            .map((t) => t.toLowerCase())
        : [],
    };
  }
  return out;
}

export interface ClassifyProgress {
  (done: number, total: number): void;
}

/**
 * Classifies every prompt whose text has not been seen before. Batches run with
 * small concurrency; a batch the model mangles is skipped rather than failing
 * the whole run, and will be retried on the next invocation.
 */
export async function classifyPrompts(
  prompts: PromptRecord[],
  taxonomy: Taxonomy,
  known: Record<string, Classification>,
  force: boolean,
  token: vscode.CancellationToken,
  onProgress: ClassifyProgress
): Promise<{ results: Record<string, Classification>; skipped: number }> {
  const config = vscode.workspace.getConfiguration("copilotPromptAnalyzer");
  const batchSize = Math.max(1, config.get<number>("batchSize") ?? 20);
  const limit = Math.max(200, config.get<number>("maxPromptChars") ?? 1200);

  const byHash = new Map<string, PromptRecord>();
  for (const prompt of prompts) {
    if (!byHash.has(prompt.hash) && (force || !known[prompt.hash])) {
      byHash.set(prompt.hash, prompt);
    }
  }
  const pending = [...byHash.values()];
  const batches: PromptRecord[][] = [];
  for (let i = 0; i < pending.length; i += batchSize) {
    batches.push(pending.slice(i, i + batchSize));
  }

  const results: Record<string, Classification> = {};
  let done = 0;
  let skipped = 0;
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < batches.length && !token.isCancellationRequested) {
      const batch = batches[next++];
      try {
        Object.assign(
          results,
          await classifyBatch(taxonomy, batch, limit, token)
        );
      } catch (error) {
        if (token.isCancellationRequested) {
          return;
        }
        throw error;
      }
      const resolved = batch.filter((p) => results[p.hash]).length;
      skipped += batch.length - resolved;
      done += batch.length;
      onProgress(done, pending.length);
    }
  };

  const concurrency = Math.min(4, Math.max(1, batches.length));
  await Promise.all(Array.from({ length: concurrency }, worker));

  return { results, skipped };
}

/** Asks the model to design a new taxonomy from a natural-language instruction. */
export async function proposeTaxonomy(
  instruction: string,
  prompts: PromptRecord[],
  token: vscode.CancellationToken
): Promise<Taxonomy | null> {
  const sample = prompts
    .filter((_, i) => i % Math.max(1, Math.floor(prompts.length / 120)) === 0)
    .slice(0, 120)
    .map((p) => `- [${p.workspaceName}] ${truncate(p.text, 180)}`)
    .join("\n");

  const messages = [
    vscode.LanguageModelChatMessage.User(
      [
        "You design taxonomies for grouping developer chat prompts.",
        "Return JSON only. No prose, no code fences.",
      ].join(" ")
    ),
    vscode.LanguageModelChatMessage.User(
      [
        `The user wants their prompts regrouped like this: "${instruction}"`,
        "",
        "Here is a representative sample of their prompts:",
        sample,
        "",
        'Design between 4 and 16 mutually exclusive groups that cover this corpus, plus a catch-all group with id "other".',
        'Return: {"name": "<short taxonomy name>", "areas": [{"id": "<lowercase-slug>", "label": "<short label>", "description": "<one sentence describing what belongs here>", "color": "<hex colour that is readable on both light and dark backgrounds>"}]}',
      ].join("\n")
    ),
  ];

  const parsed = extractJson<{ name?: string; areas?: Taxonomy["areas"] }>(
    await completeText(messages, token)
  );
  if (!parsed?.areas?.length) {
    return null;
  }

  const areas = parsed.areas
    .filter((a) => a && typeof a.id === "string" && typeof a.label === "string")
    .map((a) => ({
      id:
        a.id
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "other",
      label: String(a.label).slice(0, 40),
      description: String(a.description ?? "").slice(0, 200),
      color: /^#[0-9a-f]{6}$/i.test(String(a.color))
        ? String(a.color)
        : "#64748b",
    }));

  if (areas.length === 0) {
    return null;
  }
  if (!areas.some((a) => a.id === "other")) {
    areas.push({
      id: "other",
      label: "Other",
      description: "Anything that does not fit.",
      color: "#64748b",
    });
  }

  return {
    name: parsed.name?.slice(0, 60) || instruction.slice(0, 60),
    areas,
    instruction,
  };
}
