/**
 * Every number the dashboard draws, computed here as pure functions over the
 * already-filtered corpus.
 *
 * Nothing in this file touches the DOM or the model: the dashboard has to be
 * instant and has to work signed out, which is what makes it the first thing
 * worth trusting. Keeping the maths separate also means it can be tested under
 * `node --test` without a browser.
 */
import {
  findDuplicates,
  detectPaste,
  isCorrection,
  isSteering,
  scorePrompt,
} from "../src/analysis.ts";
import type {
  Area,
  Classification,
  PromptRecord,
  SessionRecord,
} from "../src/types.ts";
import { formatCount, formatPercent } from "./format.ts";

export type Classifications = Record<string, Classification>;

/** `YYYY-MM`, which sorts lexicographically and needs no locale. */
export function monthKey(ts: number): string {
  const date = new Date(ts);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

/** Every month between the first and last prompt, including empty ones. */
export function monthSpan(prompts: PromptRecord[]): string[] {
  const stamps = prompts.map((p) => p.ts).filter((ts) => ts > 0);
  if (stamps.length === 0) {
    return [];
  }
  const start = new Date(Math.min(...stamps));
  const end = new Date(Math.max(...stamps));
  const months: string[] = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
  );
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1);
  while (cursor.getTime() <= last) {
    months.push(monthKey(cursor.getTime()));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function countBy<T>(
  items: T[],
  key: (item: T) => string | null
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k === null) {
      continue;
    }
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

function ranked(counts: Map<string, number>, limit: number): NamedCount[] {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export interface NamedCount {
  name: string;
  count: number;
}

export interface Series {
  name: string;
  color?: string;
  points: number[];
}

/* ------------------------------------------------------------------ */
/* Tier 1                                                              */
/* ------------------------------------------------------------------ */

export interface CorrectionTrend {
  months: string[];
  /** one series per area, each point the share of that area's turns that were corrections */
  series: Series[];
  /** share across every area, for the summary line */
  overall: number[];
  worstArea: { label: string; rate: number } | null;
}

/**
 * Where the assistant keeps failing you, over time. A rate rather than a count,
 * because a busy month would otherwise always look like the worst one.
 */
export function correctionTrend(
  prompts: PromptRecord[],
  classifications: Classifications,
  areas: Area[]
): CorrectionTrend {
  const months = monthSpan(prompts);
  const index = new Map(months.map((m, i) => [m, i]));
  const totals = new Map<string, number[]>();
  const bad = new Map<string, number[]>();

  const areaLabel = new Map(areas.map((a) => [a.id, a.label]));
  const areaColor = new Map(areas.map((a) => [a.id, a.color]));

  const overallTotal = new Array(months.length).fill(0);
  const overallBad = new Array(months.length).fill(0);

  for (const prompt of prompts) {
    const slot = index.get(monthKey(prompt.ts));
    if (slot === undefined) {
      continue;
    }
    const area = classifications[prompt.hash]?.area ?? "unclassified";
    if (!totals.has(area)) {
      totals.set(area, new Array(months.length).fill(0));
      bad.set(area, new Array(months.length).fill(0));
    }
    totals.get(area)![slot] += 1;
    overallTotal[slot] += 1;
    if (isCorrection(prompt)) {
      bad.get(area)![slot] += 1;
      overallBad[slot] += 1;
    }
  }

  const series: Series[] = [];
  let worstArea: CorrectionTrend["worstArea"] = null;

  for (const [area, total] of totals) {
    const badCounts = bad.get(area)!;
    const sumTotal = total.reduce((a, b) => a + b, 0);
    const sumBad = badCounts.reduce((a, b) => a + b, 0);
    // A handful of prompts produces a meaningless rate.
    if (sumTotal < 10) {
      continue;
    }
    series.push({
      name: areaLabel.get(area) ?? area,
      color: areaColor.get(area),
      points: total.map((t, i) => (t > 0 ? badCounts[i] / t : 0)),
    });
    const rate = sumBad / sumTotal;
    if (!worstArea || rate > worstArea.rate) {
      worstArea = { label: areaLabel.get(area) ?? area, rate };
    }
  }

  series.sort((a, b) => sum(b.points) - sum(a.points));

  return {
    months,
    series,
    overall: overallTotal.map((t, i) => (t > 0 ? overallBad[i] / t : 0)),
    worstArea,
  };
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export interface WastedTurns {
  total: number;
  useful: number;
  steering: number;
  duplicate: number;
  paste: number;
  /** characters pasted in, as a rough sense of the bulk involved */
  pastedChars: number;
  wastedShare: number;
}

/**
 * Turns that produced nothing. Each prompt is counted once, in the most
 * specific category it falls into, so the bars sum to the corpus.
 */
export function wastedTurns(prompts: PromptRecord[]): WastedTurns {
  const duplicateIds = new Set<string>();
  for (const cluster of findDuplicates(prompts)) {
    // The first ask was legitimate; every repeat after it was not.
    for (const prompt of cluster.prompts.slice(1)) {
      duplicateIds.add(prompt.id);
    }
  }

  let steering = 0;
  let duplicate = 0;
  let paste = 0;
  let pastedChars = 0;

  for (const prompt of prompts) {
    if (isSteering(prompt)) {
      steering += 1;
      continue;
    }
    if (duplicateIds.has(prompt.id)) {
      duplicate += 1;
      continue;
    }
    const pasted = detectPaste(prompt);
    if (pasted) {
      paste += 1;
      pastedChars += pasted.chars;
    }
  }

  const total = prompts.length;
  const wasted = steering + duplicate + paste;
  return {
    total,
    useful: total - wasted,
    steering,
    duplicate,
    paste,
    pastedChars,
    wastedShare: total > 0 ? wasted / total : 0,
  };
}

export interface QualityTrend {
  months: string[];
  specificity: number[];
  context: number[];
  actionability: number[];
  /** share of turns that carried no new information */
  emptyShare: number[];
  /** mean total, first month vs last, for the summary */
  change: { first: number; last: number } | null;
}

export function qualityTrend(prompts: PromptRecord[]): QualityTrend {
  const months = monthSpan(prompts);
  const index = new Map(months.map((m, i) => [m, i]));
  const zero = (): number[] => new Array(months.length).fill(0);

  const spec = zero();
  const ctx = zero();
  const act = zero();
  const scored = zero();
  const empty = zero();
  const all = zero();

  for (const prompt of prompts) {
    const slot = index.get(monthKey(prompt.ts));
    if (slot === undefined) {
      continue;
    }
    all[slot] += 1;
    const score = scorePrompt(prompt);
    if (score.empty) {
      empty[slot] += 1;
      continue;
    }
    spec[slot] += score.specificity;
    ctx[slot] += score.context;
    act[slot] += score.actionability;
    scored[slot] += 1;
  }

  const mean = (totals: number[]): number[] =>
    totals.map((value, i) => (scored[i] > 0 ? value / scored[i] : 0));

  const specificity = mean(spec);
  const context = mean(ctx);
  const actionability = mean(act);

  const totals = months.map(
    (_, i) => specificity[i] + context[i] + actionability[i]
  );
  const populated = totals
    .map((value, i) => ({ value, i }))
    .filter((entry) => scored[entry.i] > 0);

  return {
    months,
    specificity,
    context,
    actionability,
    emptyShare: all.map((count, i) => (count > 0 ? empty[i] / count : 0)),
    change:
      populated.length >= 2
        ? {
            first: populated[0].value,
            last: populated[populated.length - 1].value,
          }
        : null,
  };
}

export interface AreaEffort {
  id: string;
  label: string;
  color: string;
  count: number;
  correctionRate: number;
}

/** Areas sized by volume and coloured by how often they went wrong. */
export function areaEffort(
  prompts: PromptRecord[],
  classifications: Classifications,
  areas: Area[]
): AreaEffort[] {
  const meta = new Map(areas.map((a) => [a.id, a]));
  const totals = new Map<string, number>();
  const bad = new Map<string, number>();

  for (const prompt of prompts) {
    const area = classifications[prompt.hash]?.area ?? "unclassified";
    totals.set(area, (totals.get(area) ?? 0) + 1);
    if (isCorrection(prompt)) {
      bad.set(area, (bad.get(area) ?? 0) + 1);
    }
  }

  return [...totals.entries()]
    .map(([id, count]) => ({
      id,
      label: meta.get(id)?.label ?? "Unclassified",
      color: meta.get(id)?.color ?? "#64748b",
      count,
      correctionRate: count > 0 ? (bad.get(id) ?? 0) / count : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------ */
/* Tier 2                                                              */
/* ------------------------------------------------------------------ */

export interface ActivityHeatmap {
  /** [day 0-6 Sunday first][hour 0-23] */
  grid: number[][];
  peak: number;
  busiestHour: number;
  busiestDay: number;
}

export function activityHeatmap(prompts: PromptRecord[]): ActivityHeatmap {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const prompt of prompts) {
    if (!prompt.ts) {
      continue;
    }
    // Local time: "when do I work" is a question about the person, not UTC.
    const date = new Date(prompt.ts);
    grid[date.getDay()][date.getHours()] += 1;
  }

  let peak = 0;
  let busiestHour = 0;
  let busiestDay = 0;
  const byHour = new Array(24).fill(0);
  const byDay = new Array(7).fill(0);

  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const value = grid[day][hour];
      peak = Math.max(peak, value);
      byHour[hour] += value;
      byDay[day] += value;
    }
  }
  busiestHour = byHour.indexOf(Math.max(...byHour));
  busiestDay = byDay.indexOf(Math.max(...byDay));

  return { grid, peak, busiestHour, busiestDay };
}

export interface StackedTrend {
  months: string[];
  series: Series[];
}

/** Shared shape for "what did I use, month by month". */
function stackedByMonth(
  prompts: PromptRecord[],
  key: (prompt: PromptRecord) => string | null,
  limit = 8
): StackedTrend {
  const months = monthSpan(prompts);
  const index = new Map(months.map((m, i) => [m, i]));
  const top = new Set(ranked(countBy(prompts, key), limit).map((e) => e.name));
  const rows = new Map<string, number[]>();

  for (const prompt of prompts) {
    const slot = index.get(monthKey(prompt.ts));
    const raw = key(prompt);
    if (slot === undefined || raw === null) {
      continue;
    }
    const name = top.has(raw) ? raw : "Other";
    if (!rows.has(name)) {
      rows.set(name, new Array(months.length).fill(0));
    }
    rows.get(name)![slot] += 1;
  }

  const series = [...rows.entries()]
    .map(([name, points]) => ({ name, points }))
    .sort((a, b) => sum(b.points) - sum(a.points));

  // "Other" is a residue, so it belongs at the end regardless of size.
  const other = series.findIndex((s) => s.name === "Other");
  if (other >= 0) {
    series.push(series.splice(other, 1)[0]);
  }
  return { months, series };
}

export function modelTrend(prompts: PromptRecord[]): StackedTrend {
  return stackedByMonth(prompts, (p) => p.modelLabel ?? p.model);
}

export function modeTrend(prompts: PromptRecord[]): StackedTrend {
  return stackedByMonth(prompts, (p) => p.mode, 6);
}

export interface Histogram {
  buckets: { label: string; count: number }[];
  median: number;
  p90: number;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return low === high
    ? sorted[low]
    : sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** Response time, in buckets a human reads rather than raw milliseconds. */
export function latencyHistogram(prompts: PromptRecord[]): Histogram {
  const edges = [0, 2, 5, 10, 20, 40, 80, 160, Infinity];
  const labels = [
    "<2s",
    "2–5s",
    "5–10s",
    "10–20s",
    "20–40s",
    "40–80s",
    "80–160s",
    "160s+",
  ];
  const counts = new Array(labels.length).fill(0);
  const seconds: number[] = [];

  for (const prompt of prompts) {
    if (prompt.elapsedMs === null || prompt.elapsedMs <= 0) {
      continue;
    }
    const value = prompt.elapsedMs / 1000;
    seconds.push(value);
    for (let i = 0; i < labels.length; i++) {
      if (value >= edges[i] && value < edges[i + 1]) {
        counts[i] += 1;
        break;
      }
    }
  }

  seconds.sort((a, b) => a - b);
  return {
    buckets: labels.map((label, i) => ({ label, count: counts[i] })),
    median: percentile(seconds, 0.5),
    p90: percentile(seconds, 0.9),
  };
}

export interface SessionAnatomy {
  lengths: Histogram;
  /** minutes from first to last message, for sessions that have both stamps */
  durations: Histogram;
  longest: { id: string; workspaceName: string; promptCount: number } | null;
}

export function sessionAnatomy(
  prompts: PromptRecord[],
  sessions: SessionRecord[]
): SessionAnatomy {
  const present = new Set(prompts.map((p) => p.sessionId));
  const scoped = sessions.filter((s) => present.has(s.id));

  const lengthEdges = [1, 2, 4, 8, 16, 32, 64, Infinity];
  const lengthLabels = ["1", "2–3", "4–7", "8–15", "16–31", "32–63", "64+"];
  const lengthCounts = new Array(lengthLabels.length).fill(0);
  const lengthValues: number[] = [];

  const durationEdges = [0, 5, 15, 30, 60, 120, 240, Infinity];
  const durationLabels = [
    "<5m",
    "5–15m",
    "15–30m",
    "30–60m",
    "1–2h",
    "2–4h",
    "4h+",
  ];
  const durationCounts = new Array(durationLabels.length).fill(0);
  const durationValues: number[] = [];

  let longest: SessionAnatomy["longest"] = null;

  for (const session of scoped) {
    const count = session.promptCount;
    lengthValues.push(count);
    for (let i = 0; i < lengthLabels.length; i++) {
      if (count >= lengthEdges[i] && count < lengthEdges[i + 1]) {
        lengthCounts[i] += 1;
        break;
      }
    }
    if (!longest || count > longest.promptCount) {
      longest = {
        id: session.id,
        workspaceName: session.workspaceName,
        promptCount: count,
      };
    }

    if (session.createdAt && session.lastMessageAt) {
      const minutes = (session.lastMessageAt - session.createdAt) / 60000;
      if (minutes >= 0) {
        durationValues.push(minutes);
        for (let i = 0; i < durationLabels.length; i++) {
          if (minutes >= durationEdges[i] && minutes < durationEdges[i + 1]) {
            durationCounts[i] += 1;
            break;
          }
        }
      }
    }
  }

  lengthValues.sort((a, b) => a - b);
  durationValues.sort((a, b) => a - b);

  return {
    lengths: {
      buckets: lengthLabels.map((label, i) => ({
        label,
        count: lengthCounts[i],
      })),
      median: percentile(lengthValues, 0.5),
      p90: percentile(lengthValues, 0.9),
    },
    durations: {
      buckets: durationLabels.map((label, i) => ({
        label,
        count: durationCounts[i],
      })),
      median: percentile(durationValues, 0.5),
      p90: percentile(durationValues, 0.9),
    },
    longest,
  };
}

export interface ToolUsage {
  tools: NamedCount[];
  /** turns that burned an unusual number of calls */
  heavyTurns: number;
  totalCalls: number;
}

export function toolUsage(prompts: PromptRecord[], limit = 12): ToolUsage {
  const counts = new Map<string, number>();
  let heavyTurns = 0;
  let totalCalls = 0;

  for (const prompt of prompts) {
    totalCalls += prompt.toolCalls;
    if (prompt.toolCalls >= 20) {
      heavyTurns += 1;
    }
    for (const tool of prompt.tools) {
      counts.set(tool, (counts.get(tool) ?? 0) + 1);
    }
  }

  return { tools: ranked(counts, limit), heavyTurns, totalCalls };
}

/* ------------------------------------------------------------------ */
/* Tier 3                                                              */
/* ------------------------------------------------------------------ */

/** The files you drag into chat most — usually where the architecture hurts. */
export function fileHotspots(
  prompts: PromptRecord[],
  limit = 15
): NamedCount[] {
  const counts = new Map<string, number>();
  for (const prompt of prompts) {
    for (const ref of prompt.refs) {
      const name = ref.split(/[\\/]/).pop() || ref;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return ranked(counts, limit);
}

export interface DriftNode {
  id: string;
  month: string;
  area: string;
  label: string;
  color: string;
  value: number;
}

export interface DriftLink {
  source: string;
  target: string;
  value: number;
}

export interface TopicDrift {
  months: string[];
  nodes: DriftNode[];
  links: DriftLink[];
}

/**
 * How work moved between areas from one month to the next. Link width is the
 * smaller of the two months' volumes, which is what "carried over" means.
 */
export function topicDrift(
  prompts: PromptRecord[],
  classifications: Classifications,
  areas: Area[],
  maxMonths = 6
): TopicDrift {
  const meta = new Map(areas.map((a) => [a.id, a]));
  const all = monthSpan(prompts);
  const months = all.slice(-maxMonths);
  const inMonth = new Set(months);

  const volume = new Map<string, Map<string, number>>();
  for (const prompt of prompts) {
    const month = monthKey(prompt.ts);
    if (!inMonth.has(month)) {
      continue;
    }
    const area = classifications[prompt.hash]?.area ?? "unclassified";
    if (!volume.has(month)) {
      volume.set(month, new Map());
    }
    const row = volume.get(month)!;
    row.set(area, (row.get(area) ?? 0) + 1);
  }

  const nodes: DriftNode[] = [];
  for (const month of months) {
    for (const [area, value] of volume.get(month) ?? []) {
      nodes.push({
        id: `${month}|${area}`,
        month,
        area,
        label: meta.get(area)?.label ?? "Unclassified",
        color: meta.get(area)?.color ?? "#64748b",
        value,
      });
    }
  }

  const links: DriftLink[] = [];
  for (let i = 0; i < months.length - 1; i++) {
    const from = volume.get(months[i]);
    const to = volume.get(months[i + 1]);
    if (!from || !to) {
      continue;
    }
    for (const [area, value] of from) {
      const next = to.get(area);
      if (next) {
        links.push({
          source: `${months[i]}|${area}`,
          target: `${months[i + 1]}|${area}`,
          value: Math.min(value, next),
        });
      }
    }
  }

  return { months, nodes, links };
}

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
}

/** Are your long prompts actually better, or just long? */
export function lengthVsQuality(
  prompts: PromptRecord[],
  limit = 600
): ScatterPoint[] {
  const points: ScatterPoint[] = [];
  const step = Math.max(1, Math.ceil(prompts.length / limit));
  for (let i = 0; i < prompts.length; i += step) {
    const prompt = prompts[i];
    const score = scorePrompt(prompt);
    if (score.empty) {
      continue;
    }
    points.push({
      x: prompt.words,
      y: score.total,
      label: prompt.text.slice(0, 60),
    });
  }
  return points;
}

export function replyVsTools(
  prompts: PromptRecord[],
  limit = 600
): ScatterPoint[] {
  const points: ScatterPoint[] = [];
  const step = Math.max(1, Math.ceil(prompts.length / limit));
  for (let i = 0; i < prompts.length; i += step) {
    const prompt = prompts[i];
    if (prompt.toolCalls === 0 && prompt.reply.length === 0) {
      continue;
    }
    points.push({
      x: prompt.toolCalls,
      y: prompt.reply.length,
      label: prompt.text.slice(0, 60),
    });
  }
  return points;
}

export interface ProjectSpan {
  name: string;
  first: number;
  last: number;
  count: number;
}

/** When each project started, and when it went quiet. */
export function projectSpans(
  prompts: PromptRecord[],
  limit = 14
): ProjectSpan[] {
  const spans = new Map<string, ProjectSpan>();
  for (const prompt of prompts) {
    if (!prompt.ts) {
      continue;
    }
    const name = prompt.workspaceName;
    const existing = spans.get(name);
    if (!existing) {
      spans.set(name, { name, first: prompt.ts, last: prompt.ts, count: 1 });
      continue;
    }
    existing.first = Math.min(existing.first, prompt.ts);
    existing.last = Math.max(existing.last, prompt.ts);
    existing.count += 1;
  }
  return [...spans.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .sort((a, b) => a.first - b.first);
}

export interface DuplicateSummary {
  clusters: {
    keywords: string[];
    size: number;
    sessions: number;
    spanDays: number;
    sample: string;
  }[];
  repeatedAsks: number;
}

export function duplicateSummary(
  prompts: PromptRecord[],
  limit = 10
): DuplicateSummary {
  const clusters = findDuplicates(prompts);
  return {
    repeatedAsks: clusters.reduce(
      (total, cluster) => total + cluster.prompts.length - 1,
      0
    ),
    clusters: clusters.slice(0, limit).map((cluster) => ({
      keywords: cluster.keywords,
      size: cluster.prompts.length,
      sessions: cluster.sessions,
      spanDays: cluster.spanDays,
      sample: cluster.prompts[0].text.replace(/\s+/g, " ").slice(0, 90),
    })),
  };
}

export interface TokenSpend {
  months: string[];
  prompt: number[];
  reply: number[];
  total: number;
}

/**
 * A proxy, not a bill. `charsPerToken` is calibrated per model by the capability
 * probe; 4 is the usual fallback.
 */
export function tokenSpend(
  prompts: PromptRecord[],
  charsPerToken = 4
): TokenSpend {
  const months = monthSpan(prompts);
  const index = new Map(months.map((m, i) => [m, i]));
  const promptTokens = new Array(months.length).fill(0);
  const replyTokens = new Array(months.length).fill(0);
  const divisor = charsPerToken > 0 ? charsPerToken : 4;

  for (const prompt of prompts) {
    const slot = index.get(monthKey(prompt.ts));
    if (slot === undefined) {
      continue;
    }
    promptTokens[slot] += prompt.chars / divisor;
    replyTokens[slot] += prompt.reply.length / divisor;
  }

  return {
    months,
    prompt: promptTokens.map(Math.round),
    reply: replyTokens.map(Math.round),
    total: Math.round(sum(promptTokens) + sum(replyTokens)),
  };
}

export function slashCommands(
  prompts: PromptRecord[],
  limit = 10
): NamedCount[] {
  return ranked(
    countBy(prompts, (p) => p.command),
    limit
  );
}

/* ------------------------------------------------------------------ */
/* Headline numbers                                                    */
/* ------------------------------------------------------------------ */

export interface Headline {
  prompts: number;
  sessions: number;
  projects: number;
  days: number;
  correctionRate: number;
  wastedShare: number;
}

export function headline(
  prompts: PromptRecord[],
  waste: WastedTurns
): Headline {
  const stamps = prompts.map((p) => p.ts).filter(Boolean);
  const corrections = prompts.filter(isCorrection).length;
  return {
    prompts: prompts.length,
    sessions: new Set(prompts.map((p) => p.sessionId)).size,
    projects: new Set(prompts.map((p) => p.workspaceName)).size,
    days:
      stamps.length > 1
        ? Math.max(
            1,
            Math.round((Math.max(...stamps) - Math.min(...stamps)) / 86400000)
          )
        : 0,
    correctionRate: prompts.length > 0 ? corrections / prompts.length : 0,
    wastedShare: waste.wastedShare,
  };
}

/* ------------------------------------------------------------------ */
/* The whole set                                                       */
/* ------------------------------------------------------------------ */

export interface DashboardMetrics {
  waste: WastedTurns;
  head: Headline;
  corrections: CorrectionTrend;
  quality: QualityTrend;
  effort: AreaEffort[];
  heat: ActivityHeatmap;
  models: StackedTrend;
  modes: StackedTrend;
  latency: Histogram;
  anatomy: SessionAnatomy;
  tools: ToolUsage;
  files: NamedCount[];
  drift: TopicDrift;
  lengthQuality: ScatterPoint[];
  projects: ProjectSpan[];
  duplicates: DuplicateSummary;
  tokens: TokenSpend;
  commands: NamedCount[];
  replyTools: ScatterPoint[];
}

/**
 * Computed in one place so the page and its markdown export can never disagree
 * about what the numbers are.
 */
export function collectMetrics(
  prompts: PromptRecord[],
  sessions: SessionRecord[],
  classifications: Classifications,
  areas: Area[],
  charsPerToken: number
): DashboardMetrics {
  const waste = wastedTurns(prompts);
  return {
    waste,
    head: headline(prompts, waste),
    corrections: correctionTrend(prompts, classifications, areas),
    quality: qualityTrend(prompts),
    effort: areaEffort(prompts, classifications, areas),
    heat: activityHeatmap(prompts),
    models: modelTrend(prompts),
    modes: modeTrend(prompts),
    latency: latencyHistogram(prompts),
    anatomy: sessionAnatomy(prompts, sessions),
    tools: toolUsage(prompts),
    files: fileHotspots(prompts),
    drift: topicDrift(prompts, classifications, areas),
    lengthQuality: lengthVsQuality(prompts),
    projects: projectSpans(prompts),
    duplicates: duplicateSummary(prompts),
    tokens: tokenSpend(prompts, charsPerToken),
    commands: slashCommands(prompts),
    replyTools: replyVsTools(prompts),
  };
}

/* ------------------------------------------------------------------ */
/* Markdown export                                                     */
/* ------------------------------------------------------------------ */

/**
 * Pearson's r. A scatter plot cannot survive the trip into markdown, but the
 * one thing a reader wants from it — whether the two axes move together — is a
 * single number.
 */
export function correlation(points: { x: number; y: number }[]): number | null {
  if (points.length < 3) {
    return null;
  }
  const n = points.length;
  const meanX = sum(points.map((p) => p.x)) / n;
  const meanY = sum(points.map((p) => p.y)) / n;
  let covariance = 0;
  let varX = 0;
  let varY = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    covariance += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) {
    return null;
  }
  return covariance / Math.sqrt(varX * varY);
}

/** "no relationship" is the honest reading of most of these, so say it. */
function describeCorrelation(r: number | null): string {
  if (r === null) {
    return "not enough spread to say";
  }
  const strength =
    Math.abs(r) < 0.2
      ? "essentially no relationship"
      : Math.abs(r) < 0.4
        ? "a weak relationship"
        : Math.abs(r) < 0.6
          ? "a moderate relationship"
          : "a strong relationship";
  const direction = r > 0 ? "positive" : "negative";
  return `${strength} (r = ${r.toFixed(2)}, ${direction})`;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Pipes would split the cell, and a summary is not worth a broken table. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function table(headers: string[], rows: string[][]): string[] {
  if (rows.length === 0) {
    return ["_Nothing to report for this selection._", ""];
  }
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
    "",
  ];
}

function isoDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * The dashboard as text. Charts do not paste into a retro, an issue or a
 * commit message; these numbers do.
 */
export function dashboardMarkdown(
  metrics: DashboardMetrics,
  scopeLabel: string,
  charsPerToken: number
): string {
  const {
    waste,
    head,
    corrections,
    quality,
    effort,
    heat,
    models,
    modes,
    latency,
    anatomy,
    tools,
    files,
    drift,
    lengthQuality,
    projects,
    duplicates,
    tokens,
    commands,
    replyTools,
  } = metrics;

  const months = quality.months.map(monthLabel);
  const lines: string[] = [
    "# Prompt dashboard",
    "",
    `Computed locally from ${formatCount(head.prompts)} prompt(s) — ${scopeLabel}. No model was called.`,
    "",
    ...table(
      ["Metric", "Value"],
      [
        ["Prompts", formatCount(head.prompts)],
        ["Sessions", formatCount(head.sessions)],
        ["Projects", formatCount(head.projects)],
        ["Span", `${formatCount(head.days)} days`],
        ["Correction rate", formatPercent(head.correctionRate, 1)],
        ["Wasted turns", formatPercent(head.wastedShare, 1)],
        ["Estimated tokens", formatCount(tokens.total)],
      ]
    ),
    "## What to act on",
    "",
    "### Correction rate over time",
    "",
    corrections.worstArea
      ? `Worst area: **${corrections.worstArea.label}** at ${formatPercent(corrections.worstArea.rate, 1)}. Every spike is an instruction file you have not written.`
      : "Not enough classified history to break corrections down by area yet.",
    "",
    ...table(
      ["Month", "All areas", ...corrections.series.map((s) => s.name)],
      corrections.months.map((month, i) => [
        monthLabel(month),
        formatPercent(corrections.overall[i] ?? 0, 1),
        ...corrections.series.map((s) => formatPercent(s.points[i] ?? 0, 1)),
      ])
    ),
    "### Where the turns went",
    "",
    `${formatPercent(waste.wastedShare, 1)} of requests carried no new information, including ${formatCount(waste.pastedChars)} characters of pasted output.`,
    "",
    ...table(
      ["Bucket", "Turns", "Share"],
      (
        [
          ["Useful", waste.useful],
          ["Steering only", waste.steering],
          ["Repeated asks", waste.duplicate],
          ["Mostly pasted", waste.paste],
        ] as [string, number][]
      ).map(([name, value]) => [
        name,
        formatCount(value),
        formatPercent(waste.total > 0 ? value / waste.total : 0, 1),
      ])
    ),
    "### Prompt quality over time",
    "",
    ...table(
      ["Month", "Specificity", "Context", "Actionability", "No information"],
      months.map((month, i) => [
        month,
        (quality.specificity[i] ?? 0).toFixed(1),
        (quality.context[i] ?? 0).toFixed(1),
        (quality.actionability[i] ?? 0).toFixed(1),
        formatPercent(quality.emptyShare[i] ?? 0, 1),
      ])
    ),
    "### Where your effort goes",
    "",
    ...table(
      ["Area", "Prompts", "Correction rate"],
      effort.map((area) => [
        area.label,
        formatCount(area.count),
        formatPercent(area.correctionRate, 1),
      ])
    ),
    "## How you work",
    "",
    "### When you work",
    "",
    `Busiest around ${heat.busiestHour}:00, and ${DAY_NAMES[heat.busiestDay]} more than any other day. Peak cell: ${formatCount(heat.peak)} prompt(s).`,
    "",
    "### Models",
    "",
    ...table(
      ["Model", "Prompts"],
      models.series.map((series) => [
        series.name,
        formatCount(sum(series.points)),
      ])
    ),
    "### Modes",
    "",
    ...table(
      ["Mode", "Prompts"],
      modes.series.map((series) => [
        series.name,
        formatCount(sum(series.points)),
      ])
    ),
    "### Response time",
    "",
    `Median ${latency.median.toFixed(1)}s, 90th percentile ${latency.p90.toFixed(1)}s.`,
    "",
    ...table(
      ["Bucket", "Turns"],
      latency.buckets
        .filter((bucket) => bucket.count > 0)
        .map((bucket) => [bucket.label, formatCount(bucket.count)])
    ),
    "### Sessions",
    "",
    `Median ${anatomy.lengths.median.toFixed(0)} prompt(s) per session, median ${anatomy.durations.median.toFixed(0)} minute(s) from first message to last.` +
      (anatomy.longest
        ? ` Longest: ${formatCount(anatomy.longest.promptCount)} prompt(s) in ${anatomy.longest.workspaceName}.`
        : ""),
    "",
    "### Tools",
    "",
    `${formatCount(tools.totalCalls)} call(s) in total, ${formatCount(tools.heavyTurns)} turn(s) burning 20 or more.`,
    "",
    ...table(
      ["Tool", "Turns"],
      tools.tools.map((tool) => [tool.name, formatCount(tool.count)])
    ),
    "## Worth a look",
    "",
    "### File hotspots",
    "",
    ...table(
      ["File", "Mentions"],
      files.map((file) => [file.name, formatCount(file.count)])
    ),
    "### Slash commands",
    "",
    ...table(
      ["Command", "Uses"],
      commands.map((command) => [
        `/${command.name}`,
        formatCount(command.count),
      ])
    ),
    "### Topic drift",
    "",
    ...table(
      ["From", "To", "Prompts carried"],
      [...drift.links]
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
        .map((link) => {
          const from = drift.nodes.find((node) => node.id === link.source);
          const to = drift.nodes.find((node) => node.id === link.target);
          return [
            from ? `${from.label} (${monthLabel(from.month)})` : link.source,
            to ? `${to.label} (${monthLabel(to.month)})` : link.target,
            formatCount(link.value),
          ];
        })
    ),
    "### Correlations",
    "",
    `- Prompt length against quality: ${describeCorrelation(correlation(lengthQuality))}, over ${formatCount(lengthQuality.length)} prompt(s).`,
    `- Tool calls against reply length: ${describeCorrelation(correlation(replyTools))}, over ${formatCount(replyTools.length)} turn(s).`,
    "",
    "### Projects",
    "",
    ...table(
      ["Project", "Prompts", "First", "Last"],
      projects.map((project) => [
        project.name,
        formatCount(project.count),
        isoDay(project.first),
        isoDay(project.last),
      ])
    ),
    "### Estimated token spend",
    "",
    `At ${charsPerToken.toFixed(1)} characters per token. A proxy, not a bill.`,
    "",
    ...table(
      ["Month", "Prompts", "Replies"],
      tokens.months.map((month, i) => [
        monthLabel(month),
        formatCount(tokens.prompt[i] ?? 0),
        formatCount(tokens.reply[i] ?? 0),
      ])
    ),
    "### Questions you asked twice",
    "",
    `${formatCount(duplicates.repeatedAsks)} repeat ask(s). Each cluster is a document you have not written.`,
    "",
    ...(duplicates.clusters.length === 0
      ? ["_No repeated questions in this selection._", ""]
      : [
          ...duplicates.clusters.map(
            (cluster) =>
              `- **×${cluster.size}** ${cell(cluster.sample)} — ${cluster.sessions} session(s), ${cluster.spanDays} day span`
          ),
          "",
        ]),
  ];

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}
