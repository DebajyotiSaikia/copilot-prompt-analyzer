import * as vscode from "vscode";

import { packEvidence } from "./analysis";
import { contextBudget, resolveModel, streamText } from "./lm";
import type {
  Area,
  Classification,
  PromptRecord,
  ReportId,
  SaveFormat,
} from "./types";

const SYSTEM = [
  "You are a senior prompt engineer.",
  "You are given the complete set of requests one developer made to an AI coding assistant within a single topic area, in chronological order.",
  "Your job is to distil them into ONE reusable master prompt that would let an assistant satisfy this developer's requirements for this area correctly on the first attempt.",
  "Work only from the evidence. Never invent a requirement, technology, file path or standard that does not appear in the requests.",
  "Where the developer corrected or contradicted the assistant, encode the correction as an explicit rule — those are the highest-value lines in the output.",
  "Be specific and concrete. Name the actual frameworks, services, files and conventions you observe. Generic advice is worthless here.",
  "Address the assistant in the second person, imperative mood.",
  "Return GitHub-flavoured markdown only. No preamble, no explanation of what you did, no code fences around the whole document.",
].join(" ");

function outline(area: Area): string {
  return [
    `# ${area.label} — Working Prompt`,
    "",
    "## Objective",
    "One paragraph: what the assistant is being asked to do in this area, in this developer's world.",
    "",
    "## Context",
    "The projects, stack, services and file layout that recur across the requests. Bullets.",
    "",
    "## Requirements",
    "The concrete, repeated asks — numbered, specific, testable. This is the bulk of the document.",
    "",
    "## Conventions and preferences",
    "How this developer wants work done: style, structure, tooling, communication. Bullets.",
    "",
    "## Do not",
    "Explicit prohibitions mined from every [CORRECTION] and from anything the developer rejected. Bullets.",
    "",
    "## Definition of done",
    "The checks the assistant should run before claiming completion. Checklist.",
    "",
    "## Ask me first",
    "Decisions the developer has historically wanted to make themselves rather than have guessed. Bullets. Omit the section if there is no evidence for it.",
  ].join("\n");
}

/** Streams a reusable master prompt for one area. */
export async function* generateAreaPrompt(
  area: Area,
  prompts: PromptRecord[],
  classifications: Record<string, Classification>,
  extraInstruction: string | null,
  token: vscode.CancellationToken
): AsyncGenerator<string> {
  if (prompts.length === 0) {
    yield `_No prompts in **${area.label}** yet. Classify your history first._`;
    return;
  }

  const budget = contextBudget(await resolveModel());
  const evidence = packEvidence(prompts, classifications, budget);
  const omitted = prompts.length - evidence.sampled;

  const request = [
    `Area: ${area.label} — ${area.description}`,
    `Projects involved: ${evidence.workspaces.join(", ")}`,
    evidence.tools.length
      ? `Tools the assistant used most here: ${evidence.tools.join(", ")}`
      : "",
    `Requests supplied: ${evidence.sampled} of ${prompts.length}${
      omitted > 0 ? ` (${omitted} short steering turns omitted)` : ""
    }`,
    `Requests explicitly flagged as corrections: ${evidence.corrections}`,
    extraInstruction
      ? `\nAdditional instruction from the developer: ${extraInstruction}`
      : "",
    "",
    "=== REQUESTS ===",
    evidence.lines.join("\n\n"),
    "=== END REQUESTS ===",
    "",
    "Produce the master prompt using exactly this outline:",
    "",
    outline(area),
    "",
    "Drop any section you have no evidence for rather than padding it.",
  ]
    .filter(Boolean)
    .join("\n");

  yield* streamText(
    [
      vscode.LanguageModelChatMessage.User(SYSTEM),
      vscode.LanguageModelChatMessage.User(request),
    ],
    token
  );
}

export async function sampledCount(
  prompts: PromptRecord[],
  classifications: Record<string, Classification>
): Promise<number> {
  try {
    const budget = contextBudget(await resolveModel());
    return packEvidence(prompts, classifications, budget).sampled;
  } catch {
    return prompts.length;
  }
}

function slug(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "area"
  );
}

export interface SaveTarget {
  relativePath: string;
  contents: string;
}

/**
 * Wraps markdown for the chosen destination. `.prompt.md` becomes a slash command
 * in chat; `.instructions.md` is auto-applied to matching files.
 */
export function buildSaveTarget(
  label: string,
  markdown: string,
  format: SaveFormat,
  explicitPath?: string
): SaveTarget {
  const name = slug(label);
  const description = `${label}, distilled from past Copilot chats.`;

  if (format === "prompt") {
    return {
      relativePath: explicitPath ?? `.github/prompts/${name}.prompt.md`,
      contents: [
        "---",
        "mode: agent",
        `description: "${description}"`,
        "---",
        "",
        markdown,
        "",
      ].join("\n"),
    };
  }

  if (format === "instructions") {
    return {
      relativePath:
        explicitPath ?? `.github/instructions/${name}.instructions.md`,
      contents: [
        "---",
        "applyTo: '**' # TODO: narrow this glob to the files this covers",
        `description: "${description}"`,
        "---",
        "",
        markdown,
        "",
      ].join("\n"),
    };
  }

  return {
    relativePath: explicitPath ?? `${name}.md`,
    contents: `${markdown}\n`,
  };
}

/* ------------------------------------------------------------------ */
/* Report catalogue                                                      */
/* ------------------------------------------------------------------ */

export interface ReportSpec {
  id: ReportId;
  title: string;
  blurb: string;
  /** computed locally, no model call */
  local: boolean;
  suggestedPath: string;
  /** which save format makes sense as the primary action */
  primaryFormat: SaveFormat;
}

export const REPORTS: ReportSpec[] = [
  {
    id: "instructions",
    title: "Global Copilot instructions",
    blurb:
      "The standing rules that hold across every project, ready to drop into .github/copilot-instructions.md.",
    local: false,
    suggestedPath: ".github/copilot-instructions.md",
    primaryFormat: "markdown",
  },
  {
    id: "corrections",
    title: "Correction patterns",
    blurb:
      "Where the assistant repeatedly gets it wrong for you, clustered into failure modes with a rule that prevents each.",
    local: false,
    suggestedPath: "docs/copilot-correction-patterns.md",
    primaryFormat: "markdown",
  },
  {
    id: "quality",
    title: "Prompt quality",
    blurb:
      "How specific, contextual and actionable your prompts are, how many turns carried no information, and which are weakest.",
    local: true,
    suggestedPath: "docs/copilot-prompt-quality.md",
    primaryFormat: "markdown",
  },
  {
    id: "duplicates",
    title: "Repeated questions",
    blurb:
      "Questions you asked more than once across sessions — each cluster is a missing instruction file or skill.",
    local: true,
    suggestedPath: "docs/copilot-repeated-questions.md",
    primaryFormat: "markdown",
  },
  {
    id: "projects",
    title: "Project specs",
    blurb:
      "What each project is, its stack, architecture and decisions — reconstructed from the questions you asked while building it.",
    local: false,
    suggestedPath: "docs/PROJECTS.md",
    primaryFormat: "markdown",
  },
  {
    id: "decisions",
    title: "Decision log",
    blurb:
      "Architecture decisions stated in chat, as a dated timeline plus ADR records, including reversals.",
    local: false,
    suggestedPath: "docs/adr/DECISIONS.md",
    primaryFormat: "markdown",
  },
  {
    id: "pastes",
    title: "Paste hygiene",
    blurb:
      "Prompts that are mostly pasted terminal output or data, what they cost you, and the cheaper alternative.",
    local: true,
    suggestedPath: "docs/copilot-paste-hygiene.md",
    primaryFormat: "markdown",
  },
];
