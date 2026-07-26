import { promises as fs } from "node:fs";
import * as path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import type { PromptRecord, SessionRecord } from "./types";

/**
 * Parsing the full corpus is expensive — the JSONL session logs run to hundreds
 * of megabytes of response payload. Session logs are append-only and never
 * rewritten, so:
 *
 *  - an unchanged file (same size and mtime) is not re-read at all;
 *  - a file that only grew is resumed from `bytesRead` rather than re-parsed.
 *
 * The cache is stored gzipped; it is mostly prompt and reply text and compresses
 * to roughly a fifth of its size.
 */

export interface ScanCacheEntry {
  /** `${size}:${mtimeMs}` — changes whenever the log is appended to */
  stamp: string;
  /** bytes consumed when the entry was produced; enables resuming an append */
  bytesRead: number;
  session: SessionRecord;
  prompts: PromptRecord[];
}

interface Persisted {
  version: number;
  entries: Record<string, ScanCacheEntry>;
}

const VERSION = 2;
const FILE = "scan-cache.json.gz";
const LEGACY_FILE = "scan-cache.json";

export class ScanCache {
  private entries: Record<string, ScanCacheEntry> = {};
  private dirty = false;

  private constructor(
    private readonly file: string,
    private readonly legacy: string
  ) {}

  static async open(globalStorageDir: string): Promise<ScanCache> {
    const cache = new ScanCache(
      path.join(globalStorageDir, FILE),
      path.join(globalStorageDir, LEGACY_FILE)
    );
    try {
      const raw = JSON.parse(
        gunzipSync(await fs.readFile(cache.file)).toString("utf8")
      ) as Persisted;
      if (raw?.version === VERSION && raw.entries) {
        cache.entries = raw.entries;
      }
    } catch {
      // no cache yet, or it is unreadable — rebuild from scratch
    }
    // An uncompressed v1 cache from an earlier build is superseded.
    void fs.rm(cache.legacy, { force: true }).catch(() => undefined);
    return cache;
  }

  /** An entry usable as-is, because the file has not changed. */
  exact(file: string, stamp: string): ScanCacheEntry | undefined {
    const entry = this.entries[file];
    return entry?.stamp === stamp ? entry : undefined;
  }

  /**
   * An entry that can be resumed: the file grew but everything already parsed is
   * still valid, because the log is append-only.
   */
  resumable(file: string, size: number): ScanCacheEntry | undefined {
    const entry = this.entries[file];
    if (!entry || entry.bytesRead <= 0 || entry.bytesRead > size) {
      return undefined;
    }
    return entry;
  }

  set(file: string, entry: ScanCacheEntry): void {
    this.entries[file] = entry;
    this.dirty = true;
  }

  /** Drops entries for files that no longer exist, so the cache cannot grow forever. */
  retain(files: Set<string>): void {
    for (const key of Object.keys(this.entries)) {
      if (!files.has(key)) {
        delete this.entries[key];
        this.dirty = true;
      }
    }
  }

  async flush(): Promise<void> {
    if (!this.dirty) {
      return;
    }
    const payload: Persisted = { version: VERSION, entries: this.entries };
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(
        this.file,
        gzipSync(Buffer.from(JSON.stringify(payload), "utf8"))
      );
      this.dirty = false;
    } catch {
      // a cache that cannot be written is a performance problem, not a failure
    }
  }
}
