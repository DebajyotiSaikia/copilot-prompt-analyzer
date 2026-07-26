import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

import type { ScanCache, ScanCacheEntry } from "./scanCache";
import type { PromptRecord, SessionRecord } from "./types";

interface RawPart {
  kind?: string;
  text?: string;
  value?: unknown;
  toolId?: string;
  id?: string;
  name?: string;
}

interface RawRequest {
  requestId?: string;
  timestamp?: number;
  modelId?: string;
  message?: { text?: string; parts?: RawPart[] };
  variableData?: { variables?: RawPart[] };
  response?: RawPart[];
  agent?: { name?: string; modes?: string[] };
  result?: { details?: string; timings?: { totalElapsed?: number } };
}

interface RawSession {
  sessionId?: string;
  creationDate?: number;
  lastMessageDate?: number;
  initialLocation?: string;
  requests?: RawRequest[];
}

export interface ScanResult {
  prompts: PromptRecord[];
  sessions: SessionRecord[];
  scannedDirs: string[];
  /** files that could not be read or parsed, as basenames */
  failures: string[];
}

/**
 * Only this much assistant text is kept per prompt. Agent transcripts run to
 * megabytes; accumulating them all before truncating is the single most
 * expensive thing this scanner could do.
 */
const REPLY_LIMIT = 4000;

/**
 * `globalStorageUri` is `<user>/globalStorage/<publisher>.<name>`, so the VS Code
 * `User` directory is two levels up. Deriving it this way works for stable,
 * Insiders, portable installs and remote hosts without platform guesswork.
 */
export function userDirFromGlobalStorage(globalStoragePath: string): string {
  return path.dirname(path.dirname(globalStoragePath));
}

function uriToPath(uri: string | undefined | null): string | null {
  if (!uri) {
    return null;
  }
  if (!uri.startsWith("file://")) {
    return uri;
  }
  const decoded = decodeURIComponent(uri.slice("file://".length)).replace(
    /^\/+/,
    ""
  );
  return process.platform === "win32"
    ? decoded.replace(/\//g, path.sep)
    : `/${decoded}`;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function workspaceOf(storageDir: string): Promise<string | null> {
  const meta = await readJson<{
    folder?: string;
    configuration?: string | { path?: string };
  }>(path.join(storageDir, "workspace.json"));
  if (!meta) {
    return null;
  }
  let folder: string | undefined | null = meta.folder;
  if (!folder) {
    folder =
      typeof meta.configuration === "string"
        ? meta.configuration
        : meta.configuration?.path;
  }
  return uriToPath(folder);
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

/** VS Code used `.json` until Feb 2026 and `.jsonl` after; both still exist on disk. */
function isSessionFile(name: string): boolean {
  return name.endsWith(".json") || name.endsWith(".jsonl");
}

/* ------------------------------------------------------------------ */
/* Field extraction                                                     */
/* ------------------------------------------------------------------ */

function promptTextOf(request: RawRequest): string {
  const direct = request.message?.text;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  return (request.message?.parts ?? [])
    .map((part) => (part && typeof part === "object" ? (part.text ?? "") : ""))
    .join("")
    .trim();
}

function contextRefsOf(request: RawRequest): string[] {
  const names = new Set<string>();
  for (const variable of request.variableData?.variables ?? []) {
    if (!variable || typeof variable !== "object") {
      continue;
    }
    const name = variable.name ?? variable.id;
    if (name) {
      names.add(name);
    }
  }
  for (const part of request.message?.parts ?? []) {
    if (!part || typeof part !== "object" || !part.kind) {
      continue;
    }
    if (["file", "toolReference", "reference"].includes(part.kind)) {
      const name = part.text ?? part.id;
      if (name) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

function modelLabelOf(result: RawRequest["result"]): string | null {
  const details = result?.details;
  if (typeof details !== "string" || !details) {
    return null;
  }
  return details.split("\u2022")[0].trim() || null;
}

/** Collapses `Claude Haiku 4.5` and `copilot/claude-haiku-4.5` onto one key. */
function modelKeyOf(
  label: string | null,
  modelId: string | null
): string | null {
  const source = label ?? (modelId ?? "").split("/").pop() ?? "";
  return source.toLowerCase().replace(/[^a-z0-9]/g, "") || null;
}

function slashCommandOf(text: string): string | null {
  return /^\/([A-Za-z][\w.-]*)/.exec(text)?.[1] ?? null;
}

function hashOf(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* Streaming session builder                                            */
/* ------------------------------------------------------------------ */

type PathSegment = string | number;

interface PatchLine {
  kind: number;
  k?: PathSegment[];
  v?: unknown;
}

/**
 * Derives prompt records directly from the session log rather than
 * reconstructing the whole raw document first. Two reasons:
 *
 *  - memory: response payloads are discarded as soon as they are reduced;
 *  - resumability: a cached result can be rehydrated and new patches applied on
 *    top, so an appended log is read from its previous end rather than restarted.
 */
class SessionBuilder {
  private sessionId: string | null = null;
  private createdAt: number | null = null;
  private lastMessageAt: number | null = null;
  private location: string | null = null;

  /** keyed by request index (`seq`), which is stable across appends */
  private readonly drafts = new Map<number, PromptRecord>();
  private readonly tools = new Map<number, Map<string, number>>();
  /** tool calls already counted before a rehydrate, whose per-tool tallies are lost */
  private readonly priorToolCalls = new Map<number, number>();
  private readonly replyChars = new Map<number, number>();
  private nextSeq = 0;
  private readonly file: string;
  private readonly workspace: string | null;

  // Longhand rather than parameter properties: those need a full TypeScript
  // transform, and this module is exercised directly by `node --test`, which
  // only strips types.
  constructor(file: string, workspace: string | null) {
    this.file = file;
    this.workspace = workspace;
  }

  /** Restores state from a cached result so appended patches can continue it. */
  rehydrate(entry: ScanCacheEntry): void {
    this.sessionId = entry.session.id;
    this.createdAt = entry.session.createdAt;
    this.lastMessageAt = entry.session.lastMessageAt;
    this.location = entry.session.location;

    for (const prompt of entry.prompts) {
      this.drafts.set(prompt.seq, { ...prompt });
      // Only the distinct tool names survive in a PromptRecord, so the running
      // total is carried separately to keep `toolCalls` exact across appends.
      this.tools.set(
        prompt.seq,
        new Map(prompt.tools.map((tool) => [tool, 0]))
      );
      this.priorToolCalls.set(prompt.seq, prompt.toolCalls);
      this.replyChars.set(prompt.seq, prompt.reply.length);
      this.nextSeq = Math.max(this.nextSeq, prompt.seq + 1);
    }
  }

  applyBase(raw: RawSession): void {
    this.sessionId = raw.sessionId ?? this.sessionId;
    this.createdAt = raw.creationDate ?? this.createdAt;
    this.lastMessageAt = raw.lastMessageDate ?? this.lastMessageAt;
    this.location = raw.initialLocation ?? this.location;
    this.appendRequests(raw.requests ?? []);
  }

  apply(line: PatchLine): void {
    const key = line.k;
    if (!key || key.length === 0) {
      return;
    }
    const head = String(key[0]);

    if (key.length === 1) {
      if (head === "requests" && line.kind === 2) {
        this.appendRequests(
          Array.isArray(line.v) ? (line.v as RawRequest[]) : []
        );
      } else if (head === "lastMessageDate" && typeof line.v === "number") {
        this.lastMessageAt = line.v;
      } else if (head === "sessionId" && typeof line.v === "string") {
        this.sessionId = line.v;
      }
      return;
    }

    if (head !== "requests" || typeof key[1] !== "number") {
      return;
    }
    const seq = key[1];
    const field = key.length > 2 ? String(key[2]) : null;

    if (field === "response" && line.kind === 2) {
      this.mergeResponse(
        seq,
        Array.isArray(line.v) ? (line.v as RawPart[]) : []
      );
      return;
    }
    if (field === "result" && line.kind === 1) {
      this.mergeResult(seq, line.v as RawRequest["result"]);
      return;
    }
    if (field === "timestamp" && typeof line.v === "number") {
      const draft = this.drafts.get(seq);
      if (draft) {
        draft.ts = line.v;
      }
    }
  }

  private appendRequests(requests: RawRequest[]): void {
    for (const request of requests) {
      const seq = this.nextSeq++;
      if (!request || typeof request !== "object") {
        continue;
      }
      const text = promptTextOf(request);
      if (!text) {
        continue;
      }

      const label = modelLabelOf(request.result);
      const model = request.modelId ?? null;
      const workspaceName = this.workspace
        ? path.basename(this.workspace)
        : "(no workspace)";
      const tools = new Map<string, number>();
      let reply = "";

      for (const part of request.response ?? []) {
        if (!part || typeof part !== "object") {
          continue;
        }
        if (part.kind === "toolInvocationSerialized") {
          const id = part.toolId ?? "unknown";
          tools.set(id, (tools.get(id) ?? 0) + 1);
        } else if (
          part.kind === undefined &&
          typeof part.value === "string" &&
          reply.length < REPLY_LIMIT
        ) {
          reply += part.value;
        }
      }

      this.tools.set(seq, tools);
      this.replyChars.set(seq, reply.length);
      this.drafts.set(seq, {
        id: `${this.sessionId ?? path.basename(this.file)}#${seq}`,
        sessionId: this.sessionId ?? path.basename(this.file),
        seq,
        ts: request.timestamp ?? this.createdAt ?? 0,
        workspace: this.workspace,
        workspaceName,
        model,
        modelLabel: label,
        modelKey: modelKeyOf(label, model),
        mode: request.agent?.modes?.[0] ?? request.agent?.name ?? null,
        command: slashCommandOf(text),
        text,
        chars: text.length,
        words: text.split(/\s+/).filter(Boolean).length,
        refs: contextRefsOf(request),
        tools: [...tools.keys()].sort(),
        toolCalls: [...tools.values()].reduce((sum, n) => sum + n, 0),
        elapsedMs: request.result?.timings?.totalElapsed ?? null,
        reply: reply.slice(0, REPLY_LIMIT).trim(),
        hash: hashOf(text),
      });
    }
  }

  private mergeResponse(seq: number, parts: RawPart[]): void {
    const draft = this.drafts.get(seq);
    if (!draft) {
      return;
    }
    const tools = this.tools.get(seq) ?? new Map<string, number>();
    let chars = this.replyChars.get(seq) ?? draft.reply.length;
    let reply = draft.reply;

    for (const part of parts) {
      if (!part || typeof part !== "object") {
        continue;
      }
      if (part.kind === "toolInvocationSerialized") {
        const id = part.toolId ?? "unknown";
        tools.set(id, (tools.get(id) ?? 0) + 1);
      } else if (
        part.kind === undefined &&
        typeof part.value === "string" &&
        chars < REPLY_LIMIT
      ) {
        reply += part.value;
        chars += part.value.length;
      }
    }

    this.tools.set(seq, tools);
    this.replyChars.set(seq, chars);
    draft.tools = [...tools.keys()].sort();
    draft.toolCalls =
      (this.priorToolCalls.get(seq) ?? 0) +
      [...tools.values()].reduce((sum, n) => sum + n, 0);
    draft.reply = reply.slice(0, REPLY_LIMIT).trim();
  }

  private mergeResult(seq: number, result: RawRequest["result"]): void {
    const draft = this.drafts.get(seq);
    if (!draft || !result) {
      return;
    }
    const label = modelLabelOf(result);
    if (label) {
      draft.modelLabel = label;
      draft.modelKey = modelKeyOf(label, draft.model);
    }
    if (typeof result.timings?.totalElapsed === "number") {
      draft.elapsedMs = result.timings.totalElapsed;
    }
  }

  result(): { session: SessionRecord; prompts: PromptRecord[] } {
    const prompts = [...this.drafts.values()].sort((a, b) => a.seq - b.seq);
    const id =
      this.sessionId ?? path.basename(this.file).replace(/\.jsonl?$/, "");
    for (const prompt of prompts) {
      prompt.sessionId = id;
      prompt.id = `${id}#${prompt.seq}`;
    }
    return {
      session: {
        id,
        sourceFile: this.file,
        workspace: this.workspace,
        workspaceName: this.workspace
          ? path.basename(this.workspace)
          : "(no workspace)",
        location: this.location,
        createdAt: this.createdAt,
        lastMessageAt:
          this.lastMessageAt ??
          (prompts.length
            ? Math.max(...prompts.map((prompt) => prompt.ts))
            : null),
        promptCount: prompts.length,
      },
      prompts,
    };
  }
}

/* ------------------------------------------------------------------ */
/* File readers                                                         */
/* ------------------------------------------------------------------ */

export interface ParsedFile {
  session: SessionRecord;
  prompts: PromptRecord[];
  bytesRead: number;
}

/**
 * Replays an append-only session log.
 *
 *   {"kind":0, "v": {...session...}}                      base snapshot
 *   {"kind":1, "k":["requests",1,"result"], "v": {...}}   set value at path
 *   {"kind":2, "k":["requests"], "v":[{...}]}             append to array at path
 *
 * When `resume` is supplied, reading starts at its `bytesRead` offset and the
 * cached records are continued rather than rebuilt.
 */
async function readJsonl(
  file: string,
  workspace: string | null,
  resume?: ScanCacheEntry
): Promise<ParsedFile | null> {
  const builder = new SessionBuilder(file, workspace);
  const start = resume?.bytesRead ?? 0;
  if (resume) {
    builder.rehydrate(resume);
  }

  let consumed = start;
  let sawLine = start > 0;

  const input = createReadStream(file, { encoding: "utf8", start });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const raw of lines) {
      // Only count bytes for lines that parsed, so a torn tail is re-read next time.
      const width = Buffer.byteLength(raw, "utf8") + 1;
      if (!raw.trim()) {
        consumed += width;
        continue;
      }
      let parsed: PatchLine;
      try {
        parsed = JSON.parse(raw) as PatchLine;
      } catch {
        break; // a torn final line is normal for an append-only log
      }
      consumed += width;
      if (!parsed || typeof parsed !== "object") {
        continue;
      }
      sawLine = true;

      if (parsed.kind === 0) {
        builder.applyBase((parsed.v ?? {}) as RawSession);
      } else {
        builder.apply(parsed);
      }
    }
  } catch {
    // fall through with whatever was read
  } finally {
    lines.close();
    input.destroy();
  }

  if (!sawLine) {
    return null;
  }
  return { ...builder.result(), bytesRead: consumed };
}

async function readSingleJson(
  file: string,
  workspace: string | null
): Promise<ParsedFile | null> {
  const raw = await readJson<RawSession>(file);
  if (!raw) {
    return null;
  }
  const builder = new SessionBuilder(file, workspace);
  builder.applyBase(raw);
  return { ...builder.result(), bytesRead: 0 };
}

/* ------------------------------------------------------------------ */
/* Scan                                                                 */
/* ------------------------------------------------------------------ */

/** Reads every Copilot Chat session VS Code has persisted under the given `User` directories. */
export async function scanChatHistory(
  userDirs: string[],
  options: {
    cache?: ScanCache;
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<ScanResult> {
  const prompts: PromptRecord[] = [];
  const sessions: SessionRecord[] = [];
  const failures: string[] = [];
  const scannedDirs: string[] = [];
  const seenSessions = new Set<string>();
  const { cache, onProgress } = options;

  const targets: { file: string; workspace: string | null }[] = [];

  for (const userDir of userDirs) {
    const workspaceStorage = path.join(userDir, "workspaceStorage");
    const storageDirs = await listDir(workspaceStorage);
    if (storageDirs.length === 0 && !(await listDir(userDir)).length) {
      continue;
    }
    scannedDirs.push(userDir);

    for (const entry of storageDirs) {
      const storageDir = path.join(workspaceStorage, entry);
      const chatDir = path.join(storageDir, "chatSessions");
      const files = (await listDir(chatDir)).filter(isSessionFile);
      if (files.length === 0) {
        continue;
      }
      const workspace = await workspaceOf(storageDir);
      for (const file of files) {
        targets.push({ file: path.join(chatDir, file), workspace });
      }
    }

    const emptyWindow = path.join(
      userDir,
      "globalStorage",
      "emptyWindowChatSessions"
    );
    for (const file of (await listDir(emptyWindow)).filter(isSessionFile)) {
      targets.push({ file: path.join(emptyWindow, file), workspace: null });
    }
  }

  const accept = (session: SessionRecord, items: PromptRecord[]): void => {
    // A session with no prompts is a real but empty conversation, not a failure.
    if (items.length === 0 || seenSessions.has(session.id)) {
      return;
    }
    seenSessions.add(session.id);
    sessions.push(session);
    prompts.push(...items);
  };

  let done = 0;
  for (const target of targets) {
    done += 1;
    onProgress?.(done, targets.length);

    let size = 0;
    let stamp: string | null = null;
    try {
      const info = await fs.stat(target.file);
      size = info.size;
      stamp = `${info.size}:${info.mtimeMs}`;
    } catch {
      failures.push(path.basename(target.file));
      continue;
    }

    const exact = cache?.exact(target.file, stamp);
    if (exact) {
      accept(exact.session, exact.prompts);
      continue;
    }

    const isJsonl = target.file.endsWith(".jsonl");
    const resume = isJsonl ? cache?.resumable(target.file, size) : undefined;
    const parsed = isJsonl
      ? await readJsonl(target.file, target.workspace, resume)
      : await readSingleJson(target.file, target.workspace);

    if (!parsed) {
      failures.push(path.basename(target.file));
      continue;
    }
    cache?.set(target.file, {
      stamp,
      bytesRead: parsed.bytesRead,
      session: parsed.session,
      prompts: parsed.prompts,
    });
    accept(parsed.session, parsed.prompts);
  }

  cache?.retain(new Set(targets.map((target) => target.file)));

  prompts.sort((a, b) => b.ts - a.ts);
  sessions.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  return { prompts, sessions, scannedDirs, failures };
}
