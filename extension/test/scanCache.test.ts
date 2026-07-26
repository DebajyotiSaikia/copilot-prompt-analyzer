import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { ScanCache, type ScanCacheEntry } from "../src/scanCache.ts";
import type { PromptRecord, SessionRecord } from "../src/types.ts";

async function scratch(): Promise<string> {
  return fs.mkdtemp(path.join(tmpdir(), "cca-cache-"));
}

function entry(overrides: Partial<ScanCacheEntry> = {}): ScanCacheEntry {
  return {
    stamp: "100:5",
    bytesRead: 100,
    session: { id: "s" } as SessionRecord,
    prompts: [] as PromptRecord[],
    ...overrides,
  };
}

test("exact() only returns an entry when the stamp matches", async () => {
  const cache = await ScanCache.open(await scratch());
  cache.set("a.jsonl", entry({ stamp: "100:5" }));

  assert.ok(cache.exact("a.jsonl", "100:5"));
  // A file that grew, or was touched, must not be served from cache.
  assert.equal(cache.exact("a.jsonl", "200:5"), undefined);
  assert.equal(cache.exact("a.jsonl", "100:9"), undefined);
  assert.equal(cache.exact("missing.jsonl", "100:5"), undefined);
});

test("resumable() accepts a file that only grew", async () => {
  const cache = await ScanCache.open(await scratch());
  cache.set("a.jsonl", entry({ bytesRead: 100 }));

  assert.ok(cache.resumable("a.jsonl", 500));
  // Same size is still resumable; the caller decides whether there is anything
  // left to read.
  assert.ok(cache.resumable("a.jsonl", 100));
});

/*
 * A file smaller than what was already consumed cannot be an append — it was
 * truncated or replaced, so resuming would silently skip content.
 */
test("resumable() refuses a file that shrank", async () => {
  const cache = await ScanCache.open(await scratch());
  cache.set("a.jsonl", entry({ bytesRead: 100 }));

  assert.equal(cache.resumable("a.jsonl", 99), undefined);
});

test("resumable() refuses an entry that read nothing", async () => {
  const cache = await ScanCache.open(await scratch());
  cache.set("a.jsonl", entry({ bytesRead: 0 }));

  assert.equal(cache.resumable("a.jsonl", 500), undefined);
});

test("retain() drops entries for files that are gone", async () => {
  const cache = await ScanCache.open(await scratch());
  cache.set("keep.jsonl", entry());
  cache.set("gone.jsonl", entry());

  cache.retain(new Set(["keep.jsonl"]));

  assert.ok(cache.exact("keep.jsonl", "100:5"));
  assert.equal(cache.exact("gone.jsonl", "100:5"), undefined);
});

test("a flushed cache is gzipped and reloads identically", async () => {
  const dir = await scratch();
  const cache = await ScanCache.open(dir);
  cache.set("a.jsonl", entry({ bytesRead: 42, stamp: "7:8" }));
  await cache.flush();

  const file = path.join(dir, "scan-cache.json.gz");
  const bytes = await fs.readFile(file);
  // gzip magic number, so the file really is compressed on disk.
  assert.equal(bytes[0], 0x1f);
  assert.equal(bytes[1], 0x8b);

  const reopened = await ScanCache.open(dir);
  const found = reopened.exact("a.jsonl", "7:8");
  assert.ok(found);
  assert.equal(found.bytesRead, 42);
});

test("flush() writes nothing when nothing changed", async () => {
  const dir = await scratch();
  const cache = await ScanCache.open(dir);
  await cache.flush();

  await assert.rejects(fs.stat(path.join(dir, "scan-cache.json.gz")));
});

test("a cache from an older version is ignored rather than trusted", async () => {
  const dir = await scratch();
  await fs.writeFile(
    path.join(dir, "scan-cache.json.gz"),
    gzipSync(
      Buffer.from(
        JSON.stringify({ version: 1, entries: { "a.jsonl": entry() } }),
        "utf8"
      )
    )
  );

  const cache = await ScanCache.open(dir);
  assert.equal(cache.exact("a.jsonl", "100:5"), undefined);
});

test("a corrupt cache degrades to empty instead of throwing", async () => {
  const dir = await scratch();
  await fs.writeFile(path.join(dir, "scan-cache.json.gz"), "not gzip at all");

  const cache = await ScanCache.open(dir);
  assert.equal(cache.exact("a.jsonl", "100:5"), undefined);
});

test("opening removes a superseded uncompressed cache", async () => {
  const dir = await scratch();
  const legacy = path.join(dir, "scan-cache.json");
  await fs.writeFile(legacy, "{}");

  await ScanCache.open(dir);
  // The removal is fire-and-forget, so allow the microtask to land.
  await new Promise((resolve) => setTimeout(resolve, 50));

  await assert.rejects(fs.stat(legacy));
});
