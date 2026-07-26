import * as vscode from "vscode";

import { contextBudget, resolveModel, streamText } from "./lm";
import type { Classification, PromptRecord } from "./types";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "what",
  "when",
  "where",
  "which",
  "from",
  "have",
  "has",
  "was",
  "were",
  "did",
  "does",
  "are",
  "you",
  "your",
  "all",
  "any",
  "how",
  "why",
  "about",
  "into",
  "them",
  "they",
  "their",
  "there",
  "been",
  "over",
  "most",
  "more",
  "show",
  "give",
  "list",
  "find",
  "tell",
  "many",
  "much",
  "used",
  "using",
  "use",
  "prompt",
  "prompts",
  "chat",
  "chats",
]);

const WANTS_REPLIES =
  /\brepl(y|ies)|response|answer|said|told|suggest|solution|output\b/i;

function terms(text: string): string[] {
  return [
    ...new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]{2,}/g) ?? []),
  ].filter((t) => !STOPWORDS.has(t));
}

function score(prompt: PromptRecord, queryTerms: string[]): number {
  if (queryTerms.length === 0) {
    return 0;
  }
  const haystack =
    `${prompt.text}\n${prompt.workspaceName}\n${prompt.tools.join(" ")}`.toLowerCase();
  let hits = 0;
  for (const term of queryTerms) {
    if (haystack.includes(term)) {
      hits += 1;
    }
  }
  return hits;
}

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

function render(
  prompt: PromptRecord,
  classification: Classification | undefined,
  includeReply: boolean,
  promptChars: number
): string {
  const date = prompt.ts
    ? new Date(prompt.ts).toISOString().slice(0, 10)
    : "unknown-date";
  const area = classification?.area ?? "unclassified";
  const head = `[${prompt.id}] ${date} | ${prompt.workspaceName} | ${area} | ${prompt.modelLabel ?? prompt.model ?? "?"}`;
  const body = `PROMPT: ${truncate(prompt.text, promptChars)}`;
  const reply =
    includeReply && prompt.reply
      ? `\nREPLY: ${truncate(prompt.reply, 600)}`
      : "";
  return `${head}\n${body}${reply}`;
}

/**
 * Ranks the scoped prompts against the question, packs as many as the budget
 * allows, and streams a grounded answer. Recency breaks ties so "lately"-style
 * questions behave sensibly.
 */
export async function* answerQuestion(
  question: string,
  scoped: PromptRecord[],
  classifications: Record<string, Classification>,
  scopeLabel: string,
  token: vscode.CancellationToken
): AsyncGenerator<string> {
  if (scoped.length === 0) {
    yield "There are no prompts in the current selection. Clear a filter and ask again.";
    return;
  }

  const includeReply = WANTS_REPLIES.test(question);
  const promptChars = includeReply ? 400 : 700;
  const queryTerms = terms(question);

  const ranked = [...scoped]
    .map((prompt) => ({ prompt, relevance: score(prompt, queryTerms) }))
    .sort((a, b) => b.relevance - a.relevance || b.prompt.ts - a.prompt.ts);

  const lines: string[] = [];
  let used = 0;
  const budget = contextBudget(await resolveModel());
  for (const { prompt } of ranked) {
    const block = render(
      prompt,
      classifications[prompt.hash],
      includeReply,
      promptChars
    );
    if (used + block.length > budget) {
      break;
    }
    lines.push(block);
    used += block.length;
  }

  const omitted = scoped.length - lines.length;
  const system = [
    "You analyse a developer's own history of prompts sent to an AI coding assistant.",
    "Answer only from the supplied records. Never invent prompts, dates or numbers.",
    "Cite specific prompts by their [id] when you reference them.",
    "Prefer tight markdown: short paragraphs, bullet lists and tables. Be concrete.",
    "If the records cannot answer the question, say so and suggest a narrower filter.",
  ].join(" ");

  const context = [
    `Scope: ${scopeLabel}`,
    `Records supplied: ${lines.length} of ${scoped.length}${omitted > 0 ? ` (${omitted} omitted to fit the context budget, lowest relevance first)` : ""}`,
    "",
    lines.join("\n\n"),
    "",
    `Question: ${question}`,
  ].join("\n");

  yield* streamText(
    [
      vscode.LanguageModelChatMessage.User(system),
      vscode.LanguageModelChatMessage.User(context),
    ],
    token
  );
}
