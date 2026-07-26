import * as vscode from "vscode";

import { isCorrection, packEvidence, scorePrompt } from "./analysis";
import { contextBudget, resolveModel, streamText } from "./lm";
import type { Classification, PromptRecord } from "./types";

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

function isoDate(ts: number): string {
  return ts ? new Date(ts).toISOString().slice(0, 10) : "?";
}

const GROUNDING = [
  "Work only from the evidence supplied. Never invent a requirement, technology, file path, date or decision that does not appear in it.",
  "Be specific and concrete — name the actual frameworks, services, files and conventions you observe. Generic advice is worthless here.",
  "Return GitHub-flavoured markdown only. No preamble, no explanation of what you did, no code fence around the whole document.",
].join(" ");

async function budget(): Promise<number> {
  return contextBudget(await resolveModel());
}

/* ------------------------------------------------------------------ */
/* Section 2 — global copilot-instructions.md                           */
/* ------------------------------------------------------------------ */

export async function* generateGlobalInstructions(
  prompts: PromptRecord[],
  classifications: Record<string, Classification>,
  existing: string | null,
  token: vscode.CancellationToken
): AsyncGenerator<string> {
  const evidence = packEvidence(prompts, classifications, await budget(), 900);

  const areaCounts = new Map<string, number>();
  for (const prompt of prompts) {
    const area = classifications[prompt.hash]?.area;
    if (area) {
      areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
    }
  }

  const system = [
    "You write `copilot-instructions.md` files: the standing rules an AI coding assistant should follow for a particular developer, in every conversation.",
    "You are given a representative sample of everything one developer has ever asked an AI assistant, across many projects.",
    "Extract only the rules that hold UNIVERSALLY — how they want to be communicated with, how they want work done, what they never want to see.",
    "Project-specific facts belong in per-project files, not here. Leave them out.",
    "Aim for 25–50 lines. A short file that is always followed beats a long one that is skimmed.",
    GROUNDING,
  ].join(" ");

  const request = [
    `Corpus: ${prompts.length} prompts across ${evidence.workspaces.length} projects (${evidence.workspaces.join(", ")}).`,
    `Requests supplied: ${evidence.sampled}. Flagged as corrections: ${evidence.corrections}.`,
    areaCounts.size
      ? `Topic mix: ${[...areaCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([area, count]) => `${area} (${count})`)
          .join(", ")}.`
      : "",
    existing
      ? `\nAn instructions file already exists. Preserve any of its rules that the evidence still supports, and mark genuinely new rules so they are easy to spot:\n\n${truncate(
          existing,
          4000
        )}`
      : "",
    "",
    "=== REQUESTS ===",
    evidence.lines.join("\n\n"),
    "=== END REQUESTS ===",
    "",
    "Produce the file with this shape:",
    "",
    "# Copilot instructions",
    "",
    "## Communication",
    "How this developer wants to be talked to. Length, tone, what to omit.",
    "",
    "## How to work",
    "Process rules: planning, verification, when to ask versus act.",
    "",
    "## Code",
    "Standards that recur regardless of project.",
    "",
    "## Never",
    "Hard prohibitions, drawn from repeated corrections.",
    "",
    "Drop any section the evidence does not support.",
  ]
    .filter(Boolean)
    .join("\n");

  yield* streamText(
    [
      vscode.LanguageModelChatMessage.User(system),
      vscode.LanguageModelChatMessage.User(request),
    ],
    token
  );
}

/* ------------------------------------------------------------------ */
/* Section 3 — correction mining                                        */
/* ------------------------------------------------------------------ */

export async function* generateCorrectionReport(
  prompts: PromptRecord[],
  classifications: Record<string, Classification>,
  token: vscode.CancellationToken
): AsyncGenerator<string> {
  const corrections = prompts.filter(isCorrection);
  if (corrections.length === 0) {
    yield "# Correction patterns\n\nNo corrections detected in the current selection. Either the assistant behaved, or the filter is too narrow.";
    return;
  }

  const evidence = packEvidence(
    corrections,
    classifications,
    await budget(),
    700
  );

  const system = [
    "You analyse where an AI coding assistant went wrong for one developer.",
    "Every request you are given is a moment where the developer had to correct, contradict or re-steer the assistant.",
    "Cluster them into recurring FAILURE MODES — the underlying mistake, not the surface wording.",
    "For each failure mode produce a single imperative rule that would have prevented it. The rule must be copy-pasteable into an instructions file.",
    "Rank clusters by how often they occur and how recent they are.",
    GROUNDING,
  ].join(" ");

  const request = [
    `${corrections.length} corrections out of ${prompts.length} prompts (${(
      (corrections.length / prompts.length) *
      100
    ).toFixed(1)}%).`,
    `Supplied: ${evidence.sampled}. Projects: ${evidence.workspaces.join(", ")}.`,
    "",
    "=== CORRECTIONS ===",
    evidence.lines.join("\n\n"),
    "=== END CORRECTIONS ===",
    "",
    "Produce:",
    "",
    "# Correction patterns",
    "",
    "A one-paragraph summary of what the assistant most often gets wrong for this developer.",
    "",
    "## Failure modes",
    "",
    "For each, a `### <short name>` heading, then:",
    "- **What happens** — one sentence.",
    "- **How often** — count and rough date range, from the evidence only.",
    "- **Evidence** — 2–3 prompt ids in `[id]` form.",
    "- **Rule** — a single imperative line in a blockquote, ready to paste into an instructions file.",
    "",
    "## Rules to adopt",
    "",
    "Every rule from above, collected as a plain bullet list with nothing else.",
  ].join("\n");

  yield* streamText(
    [
      vscode.LanguageModelChatMessage.User(system),
      vscode.LanguageModelChatMessage.User(request),
    ],
    token
  );
}

/* ------------------------------------------------------------------ */
/* Section 6 — per-project spec                                         */
/* ------------------------------------------------------------------ */

export async function* generateProjectSpecs(
  prompts: PromptRecord[],
  classifications: Record<string, Classification>,
  token: vscode.CancellationToken
): AsyncGenerator<string> {
  const byProject = new Map<string, PromptRecord[]>();
  for (const prompt of prompts) {
    const list = byProject.get(prompt.workspaceName);
    if (list) {
      list.push(prompt);
    } else {
      byProject.set(prompt.workspaceName, [prompt]);
    }
  }

  const ranked = [...byProject.entries()]
    .filter(([name]) => name !== "(no workspace)")
    .sort((a, b) => b[1].length - a[1].length);

  if (ranked.length === 0) {
    yield "# Project specs\n\nNo workspace-attributed prompts in the current selection.";
    return;
  }

  const total = await budget();
  const share = Math.floor(total / Math.min(4, ranked.length));

  const system = [
    "You reconstruct what a software project is and how it is built, using only the requests its developer made to an AI coding assistant while working on it.",
    "This is archaeology: the developer never wrote a spec, so you are recovering one from the questions they asked.",
    "State plainly when something is unknown rather than filling the gap.",
    GROUNDING,
  ].join(" ");

  for (const [project, items] of ranked.slice(0, 4)) {
    if (token.isCancellationRequested) {
      return;
    }
    const evidence = packEvidence(items, classifications, share, 900);
    const request = [
      `Project: ${project}`,
      `${items.length} prompts, ${isoDate(Math.min(...items.map((p) => p.ts)))} to ${isoDate(
        Math.max(...items.map((p) => p.ts))
      )}.`,
      `Supplied: ${evidence.sampled}. Tools used most: ${evidence.tools.join(", ") || "n/a"}.`,
      "",
      "=== REQUESTS ===",
      evidence.lines.join("\n\n"),
      "=== END REQUESTS ===",
      "",
      "Produce exactly this, and nothing else:",
      "",
      `## ${project}`,
      "",
      "**What it is** — one paragraph.",
      "",
      "**Stack** — bullets of the languages, frameworks and services actually named.",
      "",
      "**Architecture** — the components and how they fit, as far as the evidence shows.",
      "",
      "**Decisions** — choices the developer made, with dates where visible.",
      "",
      "**Conventions** — how this project is worked on.",
      "",
      "**Open threads** — things that were being worked on and may be unfinished.",
    ].join("\n");

    yield* streamText(
      [
        vscode.LanguageModelChatMessage.User(system),
        vscode.LanguageModelChatMessage.User(request),
      ],
      token
    );
    yield "\n\n---\n\n";
  }
}

/* ------------------------------------------------------------------ */
/* Section 7 — decision log                                             */
/* ------------------------------------------------------------------ */

const DECISION =
  /\b(use |using |switch(ed)? to|move to|moved to|migrate to|instead of|let'?s go with|we (will|should|are) use|decided|deploy to|host on|replace .* with|drop |remove .* and use|go with)\b/i;

export async function* generateDecisionLog(
  prompts: PromptRecord[],
  classifications: Record<string, Classification>,
  token: vscode.CancellationToken
): AsyncGenerator<string> {
  const candidates = prompts.filter(
    (prompt) => DECISION.test(prompt.text) && prompt.words >= 4
  );
  if (candidates.length === 0) {
    yield "# Decision log\n\nNo decision statements detected in the current selection.";
    return;
  }

  const evidence = packEvidence(
    candidates,
    classifications,
    await budget(),
    800
  );

  const system = [
    "You extract architecture decision records from a developer's chat history.",
    "A decision is a durable choice between alternatives — a tool, service, library, pattern or approach that was adopted or rejected.",
    "Ignore transient instructions, bug fixes and one-off requests. If a statement is not a durable choice, leave it out.",
    "Where a later decision contradicts an earlier one, say so explicitly — reversals are the most valuable thing in this log.",
    GROUNDING,
  ].join(" ");

  const request = [
    `${candidates.length} candidate statements from ${prompts.length} prompts. Supplied: ${evidence.sampled}.`,
    `Projects: ${evidence.workspaces.join(", ")}.`,
    "",
    "=== CANDIDATES ===",
    evidence.lines.join("\n\n"),
    "=== END CANDIDATES ===",
    "",
    "Produce:",
    "",
    "# Decision log",
    "",
    "## Timeline",
    "",
    "A table: | Date | Project | Decision | Rejected alternative | Stated reason |",
    "Use `—` where the evidence does not say. Order oldest first.",
    "",
    "## Reversals",
    "",
    "Any decision later contradicted, with both dates and what changed. Omit the section if there are none.",
    "",
    "## Records",
    "",
    "For each significant decision, an ADR-style block: `### NNNN — <title>`, then **Status**, **Context**, **Decision**, **Consequences**. Keep each under 8 lines.",
  ].join("\n");

  yield* streamText(
    [
      vscode.LanguageModelChatMessage.User(system),
      vscode.LanguageModelChatMessage.User(request),
    ],
    token
  );
}

/* ------------------------------------------------------------------ */
/* Section 4 — single prompt rewrite                                    */
/* ------------------------------------------------------------------ */

export async function* rewritePrompt(
  prompt: PromptRecord,
  classification: Classification | undefined,
  token: vscode.CancellationToken
): AsyncGenerator<string> {
  const score = scorePrompt(prompt);

  const system = [
    "You improve prompts a developer sent to an AI coding assistant.",
    "You are shown the original prompt, an automated quality score, and the specific weaknesses detected.",
    "Rewrite it so the assistant could act correctly without a follow-up round trip.",
    "Preserve the original intent exactly. Do not invent requirements, file names or constraints that are not implied by the original.",
    "Where information is genuinely missing, use an explicit `<placeholder>` rather than guessing.",
    "Return markdown only.",
  ].join(" ");

  const request = [
    `Score: ${score.total}/100 (specificity ${score.specificity}/35, context ${score.context}/30, actionability ${score.actionability}/35).`,
    score.notes.length
      ? `Detected weaknesses:\n${score.notes.map((n) => `- ${n}`).join("\n")}`
      : "",
    classification?.area
      ? `Topic area: ${classification.area}${classification.subarea ? ` / ${classification.subarea}` : ""}.`
      : "",
    `Workspace: ${prompt.workspaceName}. Mode: ${prompt.mode ?? "unknown"}.`,
    "",
    "=== ORIGINAL PROMPT ===",
    prompt.text,
    "=== END ORIGINAL PROMPT ===",
    "",
    "Produce:",
    "",
    "**Rewritten prompt**",
    "",
    "The improved prompt in a fenced code block so it can be copied verbatim.",
    "",
    "**What changed**",
    "",
    "2–4 bullets, each naming the weakness it fixes.",
  ]
    .filter(Boolean)
    .join("\n");

  yield* streamText(
    [
      vscode.LanguageModelChatMessage.User(system),
      vscode.LanguageModelChatMessage.User(request),
    ],
    token
  );
}
