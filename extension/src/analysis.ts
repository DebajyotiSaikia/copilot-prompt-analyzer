import type { Classification, PromptRecord } from "./types";

/**
 * Short, low-information turns ("continue", "no", "try again") carry almost no
 * requirement signal on their own, but a burst of them marks a request the
 * assistant misunderstood.
 *
 * The `@agent …` forms are emitted by VS Code's own Continue / Try Again /
 * Enable buttons, not typed by the user, so they are noise by definition.
 */
export const STEERING =
  /^(@agent\s+(continue|try\s*again|enable|pause|resume)\b|(ok(ay)?|yes|no|nope|yep|continue|go on|proceed|next|again|try again|do it|fix it|still|same|hmm+|k|thanks|ty|cool|nice|great)\b[\s.!?]*$)/i;

export const CORRECTION =
  /\b(no,|not like that|that'?s? not|don'?t |do not |stop |wrong|instead of|i said|i asked|you (misunderstood|ignored|forgot|broke|didn'?t)|revert|undo|why did you|never |again\?|still (not|broken|failing|wrong))/i;

export function isSteering(prompt: PromptRecord): boolean {
  return STEERING.test(prompt.text.trim());
}

export function isCorrection(prompt: PromptRecord): boolean {
  return CORRECTION.test(prompt.text);
}

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

function isoDate(ts: number): string {
  return ts ? new Date(ts).toISOString().slice(0, 10) : "?";
}

/* ------------------------------------------------------------------ */
/* Evidence packing — shared by every synthesis pass                    */
/* ------------------------------------------------------------------ */

export interface Evidence {
  lines: string[];
  sampled: number;
  corrections: number;
  workspaces: string[];
  tools: string[];
}

/**
 * Packs prompts into a character budget. Substantive requests are kept whole and
 * preferentially by length (longer requests carry more requirement signal);
 * corrections are always pulled in because they produce the best rules.
 */
export function packEvidence(
  prompts: PromptRecord[],
  classifications: Record<string, Classification>,
  budget: number,
  perPrompt = 1400
): Evidence {
  const chronological = [...prompts].sort((a, b) => a.ts - b.ts);
  const substantive = chronological.filter((prompt) => !isSteering(prompt));
  const corrections = chronological.filter(isCorrection);

  const ranked = [...substantive].sort((a, b) => b.chars - a.chars);
  const keep = new Set<string>();
  let used = 0;

  for (const prompt of ranked) {
    const cost = Math.min(prompt.chars, perPrompt) + 80;
    if (used + cost > budget) {
      continue;
    }
    keep.add(prompt.id);
    used += cost;
  }
  for (const prompt of corrections) {
    if (!keep.has(prompt.id) && used < budget) {
      keep.add(prompt.id);
      used += Math.min(prompt.chars, 600) + 80;
    }
  }

  const lines: string[] = [];
  for (const prompt of chronological) {
    if (!keep.has(prompt.id)) {
      continue;
    }
    const topic = classifications[prompt.hash]?.subarea;
    const flag = isCorrection(prompt) ? " [CORRECTION]" : "";
    lines.push(
      `--- ${prompt.id} · ${isoDate(prompt.ts)} · ${prompt.workspaceName}${
        topic ? ` · ${topic}` : ""
      }${flag}\n${truncate(prompt.text, perPrompt)}`
    );
  }

  const tools = new Map<string, number>();
  for (const prompt of prompts) {
    for (const tool of prompt.tools) {
      tools.set(tool, (tools.get(tool) ?? 0) + 1);
    }
  }

  return {
    lines,
    sampled: keep.size,
    corrections: corrections.length,
    workspaces: [...new Set(prompts.map((prompt) => prompt.workspaceName))],
    tools: [...tools.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tool]) => tool),
  };
}

/* ------------------------------------------------------------------ */
/* Section 8 — paste hygiene                                            */
/* ------------------------------------------------------------------ */

const PASTE_MARKERS = [
  /^PS [A-Z]:\\/m,
  /^\s*\$ /m,
  /^\s*at [\w$.<>]+ \(/m,
  /^Traceback \(most recent call last\)/m,
  /^npm ERR!/m,
  /^\s*(Error|Exception|Warning):/m,
  /^[+-]{3} [ab]\//m,
  /^\s*\w+Error: /m,
];

export interface PasteFinding {
  prompt: PromptRecord;
  kind: "terminal" | "stacktrace" | "data" | "bulk";
  chars: number;
}

/**
 * Flags prompts that are mostly pasted machine output. These are pure token cost:
 * the same information is usually reachable via a file reference or a tool call.
 */
export function detectPaste(prompt: PromptRecord): PasteFinding | null {
  const text = prompt.text;
  if (text.length < 600) {
    return null;
  }

  const lines = text.split("\n");
  const longBlock = lines.length >= 8;

  if (/^PS [A-Z]:\\|^\s*\$ /m.test(text)) {
    return { prompt, kind: "terminal", chars: text.length };
  }
  if (/^\s*at [\w$.<>]+ \(|^Traceback|^npm ERR!/m.test(text)) {
    return { prompt, kind: "stacktrace", chars: text.length };
  }
  if (/^[[{]/.test(text.trim()) && text.length > 1500) {
    return { prompt, kind: "data", chars: text.length };
  }
  if (PASTE_MARKERS.some((marker) => marker.test(text))) {
    return { prompt, kind: "terminal", chars: text.length };
  }

  // No marker, but a wall of unpunctuated lines is still a paste.
  if (longBlock) {
    const prose = lines.filter((line) => /[.!?]\s*$/.test(line.trim())).length;
    if (prose / lines.length < 0.15 && text.length > 1200) {
      return { prompt, kind: "bulk", chars: text.length };
    }
  }
  return null;
}

const PASTE_ADVICE: Record<PasteFinding["kind"], string> = {
  terminal:
    "Let the agent run the command itself (`run_in_terminal`) instead of pasting the transcript — it sees the exit code and only the relevant tail.",
  stacktrace:
    "Paste the top 3 frames and reference the file with `#file:` — the agent can read the rest on demand.",
  data: "Attach the file or reference it with `#file:` rather than inlining the payload.",
  bulk: "Reference the source file instead of inlining it; the agent can read exactly the range it needs.",
};

export function pasteReport(prompts: PromptRecord[]): string {
  const findings = prompts
    .map(detectPaste)
    .filter((finding): finding is PasteFinding => finding !== null)
    .sort((a, b) => b.chars - a.chars);

  const totalChars = prompts.reduce((sum, prompt) => sum + prompt.chars, 0);
  const pastedChars = findings.reduce((sum, finding) => sum + finding.chars, 0);
  const share = totalChars === 0 ? 0 : (pastedChars / totalChars) * 100;

  if (findings.length === 0) {
    return [
      "# Paste hygiene",
      "",
      `No pasted machine output detected across ${prompts.length.toLocaleString()} prompts. Nothing to fix.`,
    ].join("\n");
  }

  const bySession = new Map<string, number>();
  for (const finding of findings) {
    bySession.set(
      finding.prompt.sessionId,
      (bySession.get(finding.prompt.sessionId) ?? 0) + finding.chars
    );
  }

  const kinds = new Map<string, number>();
  for (const finding of findings) {
    kinds.set(finding.kind, (kinds.get(finding.kind) ?? 0) + 1);
  }

  const lines = [
    "# Paste hygiene",
    "",
    `**${findings.length}** of ${prompts.length.toLocaleString()} prompts are mostly pasted machine output, `,
    `accounting for **${pastedChars.toLocaleString()} characters** — ${share.toFixed(1)}% of everything you typed.`,
    "",
    "Every one of those characters is re-sent on every subsequent turn of the same session.",
    "",
    "## By kind",
    "",
    "| Kind | Count | Advice |",
    "| --- | --- | --- |",
    ...[...kinds.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(
        ([kind, count]) =>
          `| ${kind} | ${count} | ${PASTE_ADVICE[kind as PasteFinding["kind"]]} |`
      ),
    "",
    "## Worst offenders",
    "",
    "| Chars | Date | Workspace | Kind | Opening |",
    "| --- | --- | --- | --- | --- |",
    ...findings
      .slice(0, 20)
      .map(
        (finding) =>
          `| ${finding.chars.toLocaleString()} | ${isoDate(finding.prompt.ts)} | ${
            finding.prompt.workspaceName
          } | ${finding.kind} | ${truncate(finding.prompt.text, 70).replace(/\|/g, "\\|")} |`
      ),
    "",
    "## Sessions carrying the most paste weight",
    "",
    ...[...bySession.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(
        ([sessionId, chars]) =>
          `- \`${sessionId}\` — ${chars.toLocaleString()} chars`
      ),
  ];

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Section 4 — prompt quality scoring                                   */
/* ------------------------------------------------------------------ */

const CONCRETE =
  /(`[^`]+`|[\w-]+\.(ts|tsx|js|jsx|py|go|rs|java|cs|json|yml|yaml|md|css|html|sql|sh|ps1)\b|[A-Za-z]:\\|\/[\w.-]+\/|https?:\/\/|#file:|#[\w-]+\b|\b[A-Z][a-z]+[A-Z]\w+\b)/;
const OUTCOME =
  /\b(so that|should|must|expected|instead|goal|requirement|acceptance|when i|then it)\b/i;
const ACTION =
  /\b(add|create|build|write|fix|update|change|remove|refactor|implement|generate|explain|why|how|what|convert|migrate|test|debug|optimi[sz]e|rename|move|support)\b/i;

export interface QualityScore {
  prompt: PromptRecord;
  total: number;
  specificity: number;
  context: number;
  actionability: number;
  /** carried no new information for the assistant */
  empty: boolean;
  notes: string[];
}

export function scorePrompt(prompt: PromptRecord): QualityScore {
  const text = prompt.text;
  const notes: string[] = [];
  const empty = isSteering(prompt);

  if (empty) {
    return {
      prompt,
      total: 0,
      specificity: 0,
      context: 0,
      actionability: 0,
      empty: true,
      notes: ["Steering only — carried no new information."],
    };
  }

  let specificity = 0;
  if (prompt.words >= 12) {
    specificity += 14;
  } else if (prompt.words >= 6) {
    specificity += 8;
  } else {
    notes.push("Very short; the assistant has to guess the scope.");
  }
  if (CONCRETE.test(text)) {
    specificity += 16;
  } else {
    notes.push("Names no file, symbol, path or identifier.");
  }
  if (/\d/.test(text)) {
    specificity += 5;
  }
  if (prompt.words > 400) {
    specificity -= 5;
    notes.push("Very long; likely mixes several asks into one turn.");
  }
  specificity = Math.max(0, Math.min(35, specificity));

  let context = 0;
  if (prompt.refs.length > 0) {
    context += 18;
  } else {
    notes.push("No context attached (`#file:`, selection or tool reference).");
  }
  if (/```|^\s{4}\S/m.test(text)) {
    context += 8;
  }
  if (detectPaste(prompt)) {
    context -= 10;
    notes.push("Large paste — reference the source instead.");
  }
  context = Math.max(0, Math.min(30, context));

  let actionability = 0;
  if (ACTION.test(text)) {
    actionability += 18;
  } else {
    notes.push("No clear verb — what should the assistant actually do?");
  }
  if (OUTCOME.test(text)) {
    actionability += 17;
  } else {
    notes.push("States no expected outcome or acceptance criterion.");
  }
  actionability = Math.max(0, Math.min(35, actionability));

  return {
    prompt,
    total: specificity + context + actionability,
    specificity,
    context,
    actionability,
    empty: false,
    notes,
  };
}

function monthOf(ts: number): string {
  return ts ? new Date(ts).toISOString().slice(0, 7) : "?";
}

export function qualityReport(prompts: PromptRecord[]): string {
  if (prompts.length === 0) {
    return "# Prompt quality\n\nNo prompts in the current selection.";
  }

  const scores = prompts.map(scorePrompt);
  const emptyCount = scores.filter((score) => score.empty).length;
  const scored = scores.filter((score) => !score.empty);
  const average =
    scored.reduce((sum, score) => sum + score.total, 0) /
    Math.max(1, scored.length);

  const byMonth = new Map<string, { sum: number; n: number; empty: number }>();
  for (const score of scores) {
    const month = monthOf(score.prompt.ts);
    const bucket = byMonth.get(month) ?? { sum: 0, n: 0, empty: 0 };
    if (score.empty) {
      bucket.empty += 1;
    } else {
      bucket.sum += score.total;
      bucket.n += 1;
    }
    byMonth.set(month, bucket);
  }

  const noteCounts = new Map<string, number>();
  for (const score of scored) {
    for (const note of score.notes) {
      noteCounts.set(note, (noteCounts.get(note) ?? 0) + 1);
    }
  }

  const weakest = [...scored].sort((a, b) => a.total - b.total).slice(0, 15);

  return [
    "# Prompt quality",
    "",
    `Scored **${prompts.length.toLocaleString()}** prompts. Average score of substantive prompts: **${average.toFixed(
      0
    )} / 100**.`,
    "",
    `**${emptyCount.toLocaleString()}** turns (${(
      (emptyCount / prompts.length) *
      100
    ).toFixed(
      1
    )}%) carried no new information — pure steering such as "continue" or "try again".`,
    "Those are the cheapest wins: each one is a full round trip that re-sends the whole context to say nothing.",
    "",
    "Scores combine specificity (0–35), attached context (0–30) and actionability (0–35).",
    "",
    "## Trend",
    "",
    "| Month | Prompts | Avg score | No-information turns |",
    "| --- | --- | --- | --- |",
    ...[...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(
        ([month, bucket]) =>
          `| ${month} | ${bucket.n + bucket.empty} | ${
            bucket.n ? (bucket.sum / bucket.n).toFixed(0) : "—"
          } | ${bucket.empty} |`
      ),
    "",
    "## Most common weaknesses",
    "",
    ...[...noteCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([note, count]) => `- **${count}×** ${note}`),
    "",
    "## Weakest prompts",
    "",
    "Open any of these in the Prompts view and use **Improve this prompt** for a rewrite.",
    "",
    "| Score | Date | Workspace | Prompt |",
    "| --- | --- | --- | --- |",
    ...weakest.map(
      (score) =>
        `| ${score.total} | ${isoDate(score.prompt.ts)} | ${score.prompt.workspaceName} | ${truncate(
          score.prompt.text,
          90
        ).replace(/\|/g, "\\|")} |`
    ),
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Section 5 — repeat-question detection                                */
/* ------------------------------------------------------------------ */

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
  "can",
  "should",
  "would",
  "could",
  "will",
  "not",
  "but",
  "its",
  "it's",
  "please",
]);

function tokenSet(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9][a-z0-9+#._-]{2,}/g) ?? []).filter(
      (token) => !STOPWORDS.has(token)
    )
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) {
      shared += 1;
    }
  }
  return shared / (a.size + b.size - shared);
}

export interface DuplicateCluster {
  prompts: PromptRecord[];
  /** distinct sessions the cluster spans */
  sessions: number;
  spanDays: number;
  keywords: string[];
}

const SIMILARITY = 0.5;

/**
 * Finds near-duplicate asks across different sessions. Same-session repeats are
 * ignored — those are follow-ups, not forgotten knowledge.
 */
export function findDuplicates(prompts: PromptRecord[]): DuplicateCluster[] {
  const candidates = prompts
    .filter(
      (prompt) =>
        !isSteering(prompt) && prompt.words >= 5 && prompt.chars < 2000
    )
    .map((prompt) => ({ prompt, tokens: tokenSet(prompt.text) }))
    .filter((entry) => entry.tokens.size >= 4);

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) && parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootA, rootB);
    }
  };
  for (const entry of candidates) {
    parent.set(entry.prompt.id, entry.prompt.id);
  }

  // Inverted index keeps this from being O(n^2) over the whole corpus.
  const index = new Map<string, number[]>();
  candidates.forEach((entry, position) => {
    for (const token of entry.tokens) {
      const bucket = index.get(token);
      if (bucket) {
        bucket.push(position);
      } else {
        index.set(token, [position]);
      }
    }
  });

  candidates.forEach((entry, position) => {
    const seen = new Set<number>();
    for (const token of entry.tokens) {
      for (const other of index.get(token) ?? []) {
        if (other <= position || seen.has(other)) {
          continue;
        }
        seen.add(other);
        const candidate = candidates[other];
        if (candidate.prompt.sessionId === entry.prompt.sessionId) {
          continue;
        }
        if (jaccard(entry.tokens, candidate.tokens) >= SIMILARITY) {
          union(entry.prompt.id, candidate.prompt.id);
        }
      }
    }
  });

  const groups = new Map<string, PromptRecord[]>();
  for (const entry of candidates) {
    const root = find(entry.prompt.id);
    const group = groups.get(root);
    if (group) {
      group.push(entry.prompt);
    } else {
      groups.set(root, [entry.prompt]);
    }
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const sorted = [...group].sort((a, b) => a.ts - b.ts);
      const counts = new Map<string, number>();
      for (const prompt of sorted) {
        for (const token of tokenSet(prompt.text)) {
          counts.set(token, (counts.get(token) ?? 0) + 1);
        }
      }
      return {
        prompts: sorted,
        sessions: new Set(sorted.map((prompt) => prompt.sessionId)).size,
        spanDays: Math.round(
          (sorted[sorted.length - 1].ts - sorted[0].ts) / 86_400_000
        ),
        keywords: [...counts.entries()]
          .filter(([, count]) => count === sorted.length)
          .map(([token]) => token)
          .slice(0, 6),
      };
    })
    .sort(
      (a, b) => b.prompts.length - a.prompts.length || b.spanDays - a.spanDays
    );
}

export function duplicateReport(prompts: PromptRecord[]): string {
  const clusters = findDuplicates(prompts);
  if (clusters.length === 0) {
    return [
      "# Repeated questions",
      "",
      `No cross-session repeats found in ${prompts.length.toLocaleString()} prompts.`,
    ].join("\n");
  }

  const repeated = clusters.reduce(
    (sum, cluster) => sum + cluster.prompts.length,
    0
  );

  return [
    "# Repeated questions",
    "",
    `**${clusters.length}** clusters covering **${repeated}** prompts were asked more than once across different sessions.`,
    "Each cluster is a candidate for a `.github/instructions/` rule or a custom skill — the knowledge exists, it just is not written down.",
    "",
    ...clusters
      .slice(0, 25)
      .flatMap((cluster) => [
        `## ${cluster.keywords.join(", ") || "Related asks"}`,
        "",
        `${cluster.prompts.length} asks · ${cluster.sessions} sessions · spanning ${cluster.spanDays} day(s)`,
        "",
        ...cluster.prompts
          .slice(0, 6)
          .map(
            (prompt) =>
              `- \`${isoDate(prompt.ts)}\` **${prompt.workspaceName}** — ${truncate(prompt.text, 140)}`
          ),
        "",
      ]),
  ].join("\n");
}
