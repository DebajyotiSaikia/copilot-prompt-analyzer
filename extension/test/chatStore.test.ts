import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";

import { scanChatHistory } from "../src/chatStore.ts";
import { ScanCache } from "../src/scanCache.ts";

/** Builds a VS Code user directory containing one chat session log. */
async function userDirWith(
  sessionId: string,
  lines: unknown[]
): Promise<{ userDir: string; file: string }> {
  const userDir = await fs.mkdtemp(path.join(tmpdir(), "cca-store-"));
  const chatDir = path.join(userDir, "workspaceStorage", "ws1", "chatSessions");
  await fs.mkdir(chatDir, { recursive: true });
  const file = path.join(chatDir, `${sessionId}.jsonl`);
  await write(file, lines);
  return { userDir, file };
}

async function write(file: string, lines: unknown[]): Promise<void> {
  await fs.writeFile(
    file,
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n"
  );
}

async function append(file: string, lines: unknown[]): Promise<void> {
  await fs.appendFile(
    file,
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n"
  );
}

function request(text: string, extra: Record<string, unknown> = {}) {
  return {
    message: { text },
    timestamp: Date.UTC(2026, 0, 1),
    modelId: "copilot/gpt-4o",
    ...extra,
  };
}

const base = (sessionId: string, requests: unknown[]) => ({
  kind: 0,
  v: { sessionId, creationDate: Date.UTC(2026, 0, 1), requests },
});

test("reads a base snapshot", async () => {
  const { userDir } = await userDirWith("s1", [
    base("s1", [request("add a cache index")]),
  ]);

  const result = await scanChatHistory([userDir]);

  assert.equal(result.prompts.length, 1);
  assert.equal(result.prompts[0].text, "add a cache index");
  assert.equal(result.sessions.length, 1);
  assert.deepEqual(result.failures, []);
});

// kind 2 appends to an array at a path — this is how new turns arrive.
test("replays appends to the requests array", async () => {
  const { userDir } = await userDirWith("s2", [
    base("s2", [request("first")]),
    { kind: 2, k: ["requests"], v: [request("second")] },
    { kind: 2, k: ["requests"], v: [request("third")] },
  ]);

  const result = await scanChatHistory([userDir]);

  assert.deepEqual(
    result.prompts.map((p) => p.text),
    ["first", "second", "third"]
  );
});

// kind 1 sets a value at a path, including deep inside a request.
test("replays a set patch into an existing request", async () => {
  const { userDir } = await userDirWith("s3", [
    base("s3", [request("ask something")]),
    {
      kind: 1,
      k: ["requests", 0, "result"],
      v: { timings: { totalElapsed: 4321 } },
    },
  ]);

  const result = await scanChatHistory([userDir]);

  assert.equal(result.prompts[0].elapsedMs, 4321);
});

/*
 * Requests can arrive as nulls, and turns with no user text at all are common
 * once a session has been edited. Neither may abort the file.
 */
test("skips null and text-less requests without failing the file", async () => {
  const { userDir } = await userDirWith("s4", [
    base("s4", [
      request("first"),
      null,
      { message: { text: "" }, timestamp: 0 },
      request("last"),
    ]),
  ]);

  const result = await scanChatHistory([userDir]);

  assert.deepEqual(
    result.prompts.map((p) => p.text),
    ["first", "last"]
  );
  assert.deepEqual(result.failures, []);
});

test("a session with no prompts is not a failure", async () => {
  const { userDir } = await userDirWith("s5", [base("s5", [])]);

  const result = await scanChatHistory([userDir]);

  assert.equal(result.prompts.length, 0);
  assert.deepEqual(result.failures, []);
});

/*
 * A half-written final line is normal: the log is appended to while VS Code is
 * running. The reader must stop there *without* counting those bytes, so the
 * next scan re-reads them once the write completed. Consuming them would drop
 * the turn permanently.
 */
test("a torn final line is left for the next scan", async () => {
  const { userDir, file } = await userDirWith("s6", [
    base("s6", [request("good turn")]),
  ]);
  const cache = await ScanCache.open(
    await fs.mkdtemp(path.join(tmpdir(), "cca-c-"))
  );

  // Simulate a write caught mid-flight.
  const torn = `{"kind":2,"k":["requests"],"v":[{"message":{"text":"half`;
  await fs.appendFile(file, torn);

  const first = await scanChatHistory([userDir], { cache });
  assert.deepEqual(
    first.prompts.map((p) => p.text),
    ["good turn"]
  );
  assert.deepEqual(first.failures, []);

  // Complete the line; the turn must now appear.
  await fs.appendFile(file, ` written"}}]}\n`);
  const second = await scanChatHistory([userDir], { cache });

  assert.deepEqual(
    second.prompts.map((p) => p.text),
    ["good turn", "half written"]
  );
});

test("the reply is truncated rather than held whole", async () => {
  const huge = "x".repeat(20000);
  const { userDir } = await userDirWith("s7", [
    base("s7", [request("ask", { response: [{ value: huge }] })]),
  ]);

  const result = await scanChatHistory([userDir]);

  assert.ok(result.prompts[0].reply.length <= 4100, "reply was not truncated");
});

/*
 * The whole point of the cache: a log that only grew is resumed from a byte
 * offset. The result has to be indistinguishable from parsing the file whole.
 */
test("resuming an appended log matches a full parse exactly", async () => {
  const first = [
    base("s8", [request("one")]),
    { kind: 2, k: ["requests"], v: [request("two")] },
  ];
  const rest = [
    { kind: 2, k: ["requests"], v: [request("three")] },
    { kind: 2, k: ["requests"], v: [request("four")] },
  ];

  // Pass 1: scan the partial file with a cache, then grow it and rescan.
  const { userDir, file } = await userDirWith("s8", first);
  const cacheDir = await fs.mkdtemp(path.join(tmpdir(), "cca-c-"));
  const cache = await ScanCache.open(cacheDir);

  const partial = await scanChatHistory([userDir], { cache });
  assert.equal(partial.prompts.length, 2);

  await append(file, rest);
  const resumed = await scanChatHistory([userDir], { cache });

  // Pass 2: a cold scan of the same complete file.
  const cold = await scanChatHistory([userDir]);

  assert.deepEqual(
    resumed.prompts.map((p) => p.text),
    ["one", "two", "three", "four"]
  );
  assert.deepEqual(
    resumed.prompts.map((p) => p.id),
    cold.prompts.map((p) => p.id)
  );
  assert.deepEqual(
    resumed.prompts.map((p) => p.text),
    cold.prompts.map((p) => p.text)
  );
});

test("an unchanged file is served from cache", async () => {
  const { userDir } = await userDirWith("s9", [
    base("s9", [request("stable")]),
  ]);
  const cache = await ScanCache.open(
    await fs.mkdtemp(path.join(tmpdir(), "cca-c-"))
  );

  const first = await scanChatHistory([userDir], { cache });
  const second = await scanChatHistory([userDir], { cache });

  assert.deepEqual(
    first.prompts.map((p) => p.id),
    second.prompts.map((p) => p.id)
  );
});

test("progress is reported once per file", async () => {
  const { userDir } = await userDirWith("s10", [base("s10", [request("a")])]);

  const seen: number[] = [];
  await scanChatHistory([userDir], {
    onProgress: (done, total) => {
      seen.push(done);
      assert.equal(total, 1);
    },
  });

  assert.deepEqual(seen, [1]);
});

test("a missing user directory is skipped, not fatal", async () => {
  const result = await scanChatHistory([
    path.join(tmpdir(), "cca-does-not-exist-", String(Date.now())),
  ]);

  assert.equal(result.prompts.length, 0);
  assert.deepEqual(result.failures, []);
});
