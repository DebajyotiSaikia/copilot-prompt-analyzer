import type {
  Area,
  Classification,
  Filter,
  PromptRecord,
  Taxonomy,
} from "../src/types";

export const EMPTY_FILTER: Filter = {
  query: "",
  workspaces: [],
  areas: [],
  models: [],
  modes: [],
  from: null,
  to: null,
};

export const UNCLASSIFIED: Area = {
  id: "__unclassified",
  label: "Not yet classified",
  description: "Run Classify to sort these prompts into areas.",
  color: "#6b7280",
};

export function areaOf(
  prompt: PromptRecord,
  classifications: Record<string, Classification>
): string {
  return classifications[prompt.hash]?.area ?? UNCLASSIFIED.id;
}

export function applyFilter(
  prompts: PromptRecord[],
  classifications: Record<string, Classification>,
  filter: Filter
): PromptRecord[] {
  const query = filter.query.trim().toLowerCase();
  const from = filter.from ? Date.parse(filter.from) : null;
  const to = filter.to ? Date.parse(filter.to) + 86_400_000 : null;

  return prompts.filter((prompt) => {
    if (
      filter.workspaces.length &&
      !filter.workspaces.includes(prompt.workspaceName)
    ) {
      return false;
    }
    if (
      filter.modes.length &&
      !filter.modes.includes(prompt.mode ?? "unknown")
    ) {
      return false;
    }
    if (
      filter.models.length &&
      !filter.models.includes(prompt.modelLabel ?? prompt.model ?? "unknown")
    ) {
      return false;
    }
    if (
      filter.areas.length &&
      !filter.areas.includes(areaOf(prompt, classifications))
    ) {
      return false;
    }
    if (from !== null && prompt.ts < from) {
      return false;
    }
    if (to !== null && prompt.ts > to) {
      return false;
    }
    if (query) {
      const classification = classifications[prompt.hash];
      const haystack = [
        prompt.text,
        prompt.workspaceName,
        classification?.subarea ?? "",
        classification?.intent ?? "",
        (classification?.tags ?? []).join(" "),
      ]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });
}

function tally(values: (string | null)[]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw ?? "unknown";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export interface Facets {
  workspaces: { value: string; count: number }[];
  models: { value: string; count: number }[];
  modes: { value: string; count: number }[];
}

export function buildFacets(prompts: PromptRecord[]): Facets {
  return {
    workspaces: tally(prompts.map((p) => p.workspaceName)),
    models: tally(prompts.map((p) => p.modelLabel ?? p.model)),
    modes: tally(prompts.map((p) => p.mode)),
  };
}

export interface AreaBucket {
  area: Area;
  prompts: PromptRecord[];
  share: number;
  topics: { value: string; count: number }[];
  tags: { value: string; count: number }[];
  lastTs: number;
}

export function groupByArea(
  prompts: PromptRecord[],
  classifications: Record<string, Classification>,
  taxonomy: Taxonomy
): AreaBucket[] {
  const byId = new Map<string, Area>(taxonomy.areas.map((a) => [a.id, a]));
  byId.set(UNCLASSIFIED.id, UNCLASSIFIED);

  const buckets = new Map<string, PromptRecord[]>();
  for (const prompt of prompts) {
    const id = areaOf(prompt, classifications);
    const list = buckets.get(id);
    if (list) {
      list.push(prompt);
    } else {
      buckets.set(id, [prompt]);
    }
  }

  const total = prompts.length || 1;
  return [...buckets.entries()]
    .map(([id, items]) => ({
      area: byId.get(id) ?? { ...UNCLASSIFIED, id, label: id },
      prompts: items,
      share: items.length / total,
      topics: tally(
        items.map((p) => classifications[p.hash]?.subarea ?? null)
      ).slice(0, 6),
      tags: tally(
        items.flatMap((p) => classifications[p.hash]?.tags ?? [])
      ).slice(0, 10),
      lastTs: Math.max(...items.map((p) => p.ts)),
    }))
    .sort((a, b) => b.prompts.length - a.prompts.length);
}

export interface MonthBucket {
  month: string;
  total: number;
  byArea: Map<string, number>;
}

export function groupByMonth(
  prompts: PromptRecord[],
  classifications: Record<string, Classification>
): MonthBucket[] {
  const months = new Map<string, MonthBucket>();
  for (const prompt of prompts) {
    if (!prompt.ts) {
      continue;
    }
    const month = new Date(prompt.ts).toISOString().slice(0, 7);
    let bucket = months.get(month);
    if (!bucket) {
      bucket = { month, total: 0, byArea: new Map() };
      months.set(month, bucket);
    }
    bucket.total += 1;
    const area = areaOf(prompt, classifications);
    bucket.byArea.set(area, (bucket.byArea.get(area) ?? 0) + 1);
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface Stats {
  prompts: number;
  sessions: number;
  workspaces: number;
  words: number;
  classified: number;
  coverage: number;
  from: number | null;
  to: number | null;
}

export function buildStats(
  prompts: PromptRecord[],
  classifications: Record<string, Classification>
): Stats {
  const timestamps = prompts.map((p) => p.ts).filter(Boolean);
  const classified = prompts.filter((p) => classifications[p.hash]).length;
  return {
    prompts: prompts.length,
    sessions: new Set(prompts.map((p) => p.sessionId)).size,
    workspaces: new Set(prompts.map((p) => p.workspaceName)).size,
    words: prompts.reduce((sum, p) => sum + p.words, 0),
    classified,
    coverage: prompts.length === 0 ? 0 : classified / prompts.length,
    from: timestamps.length ? Math.min(...timestamps) : null,
    to: timestamps.length ? Math.max(...timestamps) : null,
  };
}

export function formatDate(ts: number | null): string {
  return ts ? new Date(ts).toISOString().slice(0, 10) : "—";
}

export function formatDateTime(ts: number | null): string {
  return ts ? new Date(ts).toISOString().slice(0, 16).replace("T", " ") : "—";
}

export function compact(n: number): string {
  if (n < 1000) {
    return String(n);
  }
  if (n < 1_000_000) {
    return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  }
  return `${(n / 1_000_000).toFixed(1)}m`;
}
