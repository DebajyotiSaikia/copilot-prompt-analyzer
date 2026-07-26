import assert from "node:assert/strict";
import test from "node:test";

import {
  activityHeatmap,
  areaEffort,
  correctionTrend,
  duplicateSummary,
  fileHotspots,
  headline,
  latencyHistogram,
  lengthVsQuality,
  modeTrend,
  modelTrend,
  monthKey,
  monthSpan,
  projectSpans,
  qualityTrend,
  sessionAnatomy,
  slashCommands,
  tokenSpend,
  toolUsage,
  topicDrift,
  wastedTurns,
} from "../webview/dashboard.ts";
import type {
  Area,
  Classification,
  PromptRecord,
  SessionRecord,
} from "../src/types.ts";

let seq = 0;

function prompt(
  text: string,
  overrides: Partial<PromptRecord> = {}
): PromptRecord {
  seq += 1;
  const sessionId = overrides.sessionId ?? `s${seq}`;
  return {
    id: `${sessionId}#${seq}`,
    sessionId,
    seq,
    ts: Date.UTC(2026, 0, 15),
    workspace: null,
    workspaceName: "demo",
    model: "gpt-4o",
    modelLabel: "GPT-4o",
    modelKey: "gpt-4o",
    mode: "agent",
    command: null,
    text,
    chars: text.length,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    refs: [],
    tools: [],
    toolCalls: 0,
    elapsedMs: null,
    reply: "",
    hash: `h${seq}`,
    ...overrides,
  } as PromptRecord;
}

const AREAS: Area[] = [
  { id: "ui", label: "UI & UX", description: "", color: "#f00" },
  { id: "api", label: "API", description: "", color: "#0f0" },
];

function classify(
  prompts: PromptRecord[],
  area: string
): Record<string, Classification> {
  const map: Record<string, Classification> = {};
  for (const p of prompts) {
    map[p.hash] = { area, subarea: null, intent: null, tags: [] };
  }
  return map;
}

/* ---------- month helpers ---------- */

test("monthKey is zero-padded and sorts lexicographically", () => {
  assert.equal(monthKey(Date.UTC(2026, 0, 5)), "2026-01");
  assert.equal(monthKey(Date.UTC(2026, 11, 31)), "2026-12");
  assert.ok("2026-02" > "2026-01");
});

test("monthSpan fills the gaps between the first and last prompt", () => {
  const span = monthSpan([
    prompt("a", { ts: Date.UTC(2026, 0, 1) }),
    prompt("b", { ts: Date.UTC(2026, 3, 1) }),
  ]);
  assert.deepEqual(span, ["2026-01", "2026-02", "2026-03", "2026-04"]);
});

test("monthSpan is empty for an empty corpus", () => {
  assert.deepEqual(monthSpan([]), []);
});

/* ---------- tier 1 ---------- */

test("correctionTrend reports a rate, not a count", () => {
  // Twelve turns, three of them corrections, so the rate is 0.25 regardless of
  // how busy the month was.
  const prompts = [
    ...Array.from({ length: 9 }, (_, i) => prompt(`add feature ${i}`)),
    prompt("no, that is not what I asked for"),
    prompt("don't do it like that"),
    prompt("you ignored the instruction"),
  ];
  const trend = correctionTrend(prompts, classify(prompts, "ui"), AREAS);

  assert.equal(trend.months.length, 1);
  assert.equal(trend.series.length, 1);
  assert.equal(trend.series[0].name, "UI & UX");
  assert.equal(trend.series[0].points[0], 0.25);
  assert.equal(trend.overall[0], 0.25);
  assert.equal(trend.worstArea?.label, "UI & UX");
});

// A rate over three prompts is noise, not signal.
test("correctionTrend drops areas with too little evidence", () => {
  const prompts = [prompt("no, wrong"), prompt("also wrong")];
  const trend = correctionTrend(prompts, classify(prompts, "ui"), AREAS);
  assert.equal(trend.series.length, 0);
});

test("wastedTurns counts each prompt once, in its most specific bucket", () => {
  const waste = wastedTurns([
    prompt("continue"),
    prompt("ok"),
    prompt("add a cache index for pending orders please"),
  ]);

  assert.equal(waste.total, 3);
  assert.equal(waste.steering, 2);
  assert.equal(waste.useful, 1);
  assert.equal(waste.wastedShare, 2 / 3);
});

test("wastedTurns treats only the repeats in a cluster as waste", () => {
  const first = prompt(
    "how do I resume the scan from a byte offset stored in the cache"
  );
  const repeat = prompt(
    "how do i resume a scan from the byte offset stored in the cache"
  );
  const waste = wastedTurns([first, repeat]);

  // The first ask was legitimate.
  assert.equal(waste.duplicate, 1);
  assert.equal(waste.useful, 1);
});

test("wastedTurns records pasted bulk", () => {
  // detectPaste ignores anything under 600 characters, so this has to be the
  // size of a real paste to exercise the path.
  const pasted =
    "PS C:\\Projects\\app> npm run build\n" +
    Array.from(
      { length: 30 },
      (_, i) => `line ${i} of extremely noisy build output that nobody reads`
    ).join("\n");
  const waste = wastedTurns([prompt(pasted)]);

  assert.ok(pasted.length > 600);
  assert.equal(waste.paste, 1);
  assert.equal(waste.pastedChars, pasted.length);
});

test("wastedTurns handles an empty corpus without dividing by zero", () => {
  const waste = wastedTurns([]);
  assert.equal(waste.total, 0);
  assert.equal(waste.wastedShare, 0);
});

test("qualityTrend excludes steering turns from the averages", () => {
  const prompts = [
    prompt("continue"),
    prompt(
      "In src/scanCache.ts, gzip the cache before writing and key entries by " +
        "size and mtimeMs so an unchanged file is never re-parsed."
    ),
  ];
  const trend = qualityTrend(prompts);

  assert.equal(trend.emptyShare[0], 0.5);
  // The steering turn scored zero but must not drag the mean down.
  assert.ok(trend.specificity[0] > 0);
});

test("areaEffort pairs volume with how often the area went wrong", () => {
  const ui = [prompt("no, not like that"), prompt("build the modal")];
  const api = [prompt("add an endpoint")];
  const classifications = {
    ...classify(ui, "ui"),
    ...classify(api, "api"),
  };

  const effort = areaEffort([...ui, ...api], classifications, AREAS);

  assert.equal(effort[0].label, "UI & UX");
  assert.equal(effort[0].count, 2);
  assert.equal(effort[0].correctionRate, 0.5);
  assert.equal(effort[1].correctionRate, 0);
});

test("areaEffort labels unknown areas rather than dropping them", () => {
  const prompts = [prompt("something")];
  const effort = areaEffort(prompts, {}, AREAS);
  assert.equal(effort[0].label, "Unclassified");
});

/* ---------- tier 2 ---------- */

test("activityHeatmap buckets by local day and hour", () => {
  const when = new Date(2026, 0, 14, 9, 30);
  const map = activityHeatmap([prompt("a", { ts: when.getTime() })]);

  assert.equal(map.grid[when.getDay()][9], 1);
  assert.equal(map.peak, 1);
  assert.equal(map.busiestHour, 9);
});

test("modelTrend folds the long tail into Other and puts it last", () => {
  const prompts = [
    ...Array.from({ length: 9 }, () => prompt("x", { modelLabel: "Main" })),
    ...Array.from({ length: 9 }, (_, i) =>
      prompt("x", { modelLabel: `Rare ${i}` })
    ),
  ];
  const trend = modelTrend(prompts);

  assert.equal(trend.series[0].name, "Main");
  assert.equal(trend.series[trend.series.length - 1].name, "Other");
});

test("modeTrend counts agent and ask separately", () => {
  const trend = modeTrend([
    prompt("a", { mode: "agent" }),
    prompt("b", { mode: "ask" }),
    prompt("c", { mode: "agent" }),
  ]);
  const agent = trend.series.find((s) => s.name === "agent");
  assert.equal(agent?.points[0], 2);
});

test("latencyHistogram buckets seconds and reports percentiles", () => {
  const hist = latencyHistogram([
    prompt("a", { elapsedMs: 1000 }),
    prompt("b", { elapsedMs: 3000 }),
    prompt("c", { elapsedMs: 30000 }),
  ]);

  assert.equal(hist.buckets[0].count, 1);
  assert.equal(hist.buckets[1].count, 1);
  assert.equal(hist.median, 3);
});

test("latencyHistogram ignores turns with no timing", () => {
  const hist = latencyHistogram([prompt("a"), prompt("b", { elapsedMs: 0 })]);
  assert.equal(
    hist.buckets.reduce((t, b) => t + b.count, 0),
    0
  );
});

test("sessionAnatomy only counts sessions present in the filter", () => {
  const kept = prompt("a", { sessionId: "keep" });
  const sessions: SessionRecord[] = [
    {
      id: "keep",
      sourceFile: "",
      workspace: null,
      workspaceName: "demo",
      location: null,
      createdAt: Date.UTC(2026, 0, 1, 10, 0),
      lastMessageAt: Date.UTC(2026, 0, 1, 10, 45),
      promptCount: 12,
    },
    {
      id: "filtered-out",
      sourceFile: "",
      workspace: null,
      workspaceName: "demo",
      location: null,
      createdAt: null,
      lastMessageAt: null,
      promptCount: 99,
    },
  ];

  const anatomy = sessionAnatomy([kept], sessions);

  assert.equal(anatomy.longest?.promptCount, 12);
  // 45 minutes lands in the 30-60m bucket.
  assert.equal(anatomy.durations.buckets[3].count, 1);
});

test("toolUsage ranks tools and flags heavy turns", () => {
  const usage = toolUsage([
    prompt("a", { tools: ["read", "edit"], toolCalls: 4 }),
    prompt("b", { tools: ["read"], toolCalls: 25 }),
  ]);

  assert.equal(usage.tools[0].name, "read");
  assert.equal(usage.tools[0].count, 2);
  assert.equal(usage.heavyTurns, 1);
  assert.equal(usage.totalCalls, 29);
});

/* ---------- tier 3 ---------- */

test("fileHotspots counts by basename so paths do not fragment", () => {
  const spots = fileHotspots([
    prompt("a", { refs: ["src/a/service.ts"] }),
    prompt("b", { refs: ["src\\b\\service.ts"] }),
    prompt("c", { refs: ["other.ts"] }),
  ]);

  assert.equal(spots[0].name, "service.ts");
  assert.equal(spots[0].count, 2);
});

test("topicDrift links an area across consecutive months", () => {
  const jan = Array.from({ length: 3 }, () =>
    prompt("x", { ts: Date.UTC(2026, 0, 5) })
  );
  const feb = Array.from({ length: 5 }, () =>
    prompt("y", { ts: Date.UTC(2026, 1, 5) })
  );
  const all = [...jan, ...feb];
  const drift = topicDrift(all, classify(all, "ui"), AREAS);

  assert.deepEqual(drift.months, ["2026-01", "2026-02"]);
  assert.equal(drift.links.length, 1);
  // Carry-over is the smaller of the two months.
  assert.equal(drift.links[0].value, 3);
});

test("lengthVsQuality skips steering turns", () => {
  const points = lengthVsQuality([
    prompt("ok"),
    prompt("add a cache index for the pending orders table"),
  ]);
  assert.equal(points.length, 1);
});

test("projectSpans reports first and last activity per project", () => {
  const spans = projectSpans([
    prompt("a", { workspaceName: "alpha", ts: Date.UTC(2026, 0, 1) }),
    prompt("b", { workspaceName: "alpha", ts: Date.UTC(2026, 2, 1) }),
    prompt("c", { workspaceName: "beta", ts: Date.UTC(2026, 1, 1) }),
  ]);

  const alpha = spans.find((s) => s.name === "alpha");
  assert.equal(alpha?.count, 2);
  assert.equal(alpha?.first, Date.UTC(2026, 0, 1));
  assert.equal(alpha?.last, Date.UTC(2026, 2, 1));
});

test("duplicateSummary counts repeats, not cluster members", () => {
  const summary = duplicateSummary([
    prompt("how do I resume the scan from a byte offset stored in the cache"),
    prompt("how do i resume a scan from the byte offset stored in the cache"),
  ]);

  assert.equal(summary.clusters.length, 1);
  assert.equal(summary.repeatedAsks, 1);
});

test("tokenSpend divides by the calibrated ratio", () => {
  const spend = tokenSpend([prompt("12345678", { reply: "1234" })], 4);
  assert.equal(spend.prompt[0], 2);
  assert.equal(spend.reply[0], 1);
  assert.equal(spend.total, 3);
});

test("tokenSpend falls back when the ratio is nonsense", () => {
  const spend = tokenSpend([prompt("12345678")], 0);
  assert.equal(spend.prompt[0], 2);
});

test("slashCommands ignores turns without one", () => {
  const commands = slashCommands([
    prompt("a", { command: "explain" }),
    prompt("b", { command: "explain" }),
    prompt("c"),
  ]);

  assert.equal(commands.length, 1);
  assert.equal(commands[0].count, 2);
});

test("headline summarises the corpus", () => {
  const prompts = [
    prompt("a", { workspaceName: "alpha", ts: Date.UTC(2026, 0, 1) }),
    prompt("no, not like that", {
      workspaceName: "beta",
      ts: Date.UTC(2026, 0, 11),
    }),
  ];
  const line = headline(prompts, wastedTurns(prompts));

  assert.equal(line.prompts, 2);
  assert.equal(line.projects, 2);
  assert.equal(line.days, 10);
  assert.equal(line.correctionRate, 0.5);
});
