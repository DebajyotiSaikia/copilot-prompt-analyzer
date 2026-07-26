import assert from "node:assert/strict";
import test from "node:test";

import {
  CORRECTION,
  STEERING,
  detectPaste,
  findDuplicates,
  isCorrection,
  isSteering,
  scorePrompt,
} from "../src/analysis.ts";
import type { PromptRecord } from "../src/types.ts";

let seq = 0;

/** A record with only the fields the analysis functions actually read. */
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
    ts: Date.UTC(2026, 0, seq),
    workspace: null,
    workspaceName: "demo",
    model: null,
    modelLabel: null,
    modelKey: null,
    mode: null,
    command: null,
    text,
    chars: text.length,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    refs: [],
    tools: [],
    toolCalls: 0,
    elapsedMs: null,
    reply: "",
    ...overrides,
  } as PromptRecord;
}

/*
 * VS Code writes its own button presses into the history as ordinary user
 * turns. Treating them as real prompts inflated the "no information" count and
 * manufactured a duplicate cluster, so each spelling is pinned here.
 */
test("recognises VS Code's own agent buttons as steering", () => {
  for (const text of [
    '@agent Continue: "Continue to iterate?"',
    "@agent Try Again",
    '@agent Enable: "some tool"',
    "@agent Pause",
    "@agent Resume",
  ]) {
    assert.equal(isSteering(prompt(text)), true, text);
  }
});

test("recognises bare acknowledgements as steering", () => {
  for (const text of [
    "continue",
    "Continue.",
    "ok",
    "okay!",
    "yes",
    "no",
    "yep",
    "proceed",
    "next",
    "try again",
    "do it",
    "fix it",
    "hmmm",
    "k",
    "thanks",
    "ty",
    "cool",
    "  nice  ",
  ]) {
    assert.equal(isSteering(prompt(text)), true, text);
  }
});

test("does not treat a real request as steering", () => {
  for (const text of [
    "continue the migration by adding the index",
    "ok, now wire the cache into the scanner",
    "no, use a CNAME record instead of an A record",
    "fix it by narrowing the glob in the instructions file",
  ]) {
    assert.equal(isSteering(prompt(text)), false, text);
  }
});

test("STEERING is anchored so it cannot match mid-sentence", () => {
  assert.equal(STEERING.test("please continue with the refactor"), false);
});

test("recognises corrections", () => {
  for (const text of [
    "no, that is not what I asked for",
    "not like that",
    "don't invent contact details",
    "do not add error handling for that",
    "that's not the file I meant",
    "you ignored the instruction about tables",
    "revert that change",
    "why did you rename the command?",
    "still broken",
    "instead of a redirect, set the record directly",
  ]) {
    assert.equal(isCorrection(prompt(text)), true, text);
  }
});

test("does not flag ordinary requests as corrections", () => {
  for (const text of [
    "add a cache index for pending orders",
    "explain how the scanner resumes",
  ]) {
    assert.equal(isCorrection(prompt(text)), false, text);
  }
});

test("CORRECTION requires a word boundary", () => {
  // "nostop" and "known" should not trip "no," / "stop " / "never ".
  assert.equal(CORRECTION.test("the knob is unknown"), false);
});

test("steering turns score zero and are marked empty", () => {
  const score = scorePrompt(prompt('@agent Continue: "Continue to iterate?"'));
  assert.equal(score.empty, true);
  assert.equal(score.total, 0);
  assert.match(score.notes.join(" "), /carried no new information/i);
});

test("a specific, contextual request outscores a vague one", () => {
  const vague = scorePrompt(prompt("make it better"));
  const specific = scorePrompt(
    prompt(
      "In src/scanCache.ts, gzip the cache before writing it and key entries " +
        "by size and mtimeMs so an unchanged file is never re-parsed. Add a " +
        "resumable() helper that returns the byte offset to continue from.",
      { refs: ["src/scanCache.ts"] }
    )
  );

  assert.equal(vague.empty, false);
  assert.ok(
    specific.total > vague.total,
    `expected ${specific.total} > ${vague.total}`
  );
});

test("detectPaste ignores short prompts", () => {
  assert.equal(detectPaste(prompt("npm ERR! something failed")), null);
});

test("detectPaste identifies pasted terminal output", () => {
  const text =
    "PS C:\\Projects\\app> npm run build\n" +
    Array.from(
      { length: 20 },
      (_, i) => `line ${i} of noisy build output`
    ).join("\n");
  const found = detectPaste(prompt(text));

  assert.ok(found);
  assert.equal(found.kind, "terminal");
  assert.equal(found.chars, text.length);
});

test("detectPaste identifies stack traces", () => {
  const text =
    "Traceback (most recent call last):\n" +
    Array.from(
      { length: 20 },
      () => "    at Object.<anonymous> (a.js:1:1)"
    ).join("\n");
  const found = detectPaste(prompt(text));

  assert.ok(found);
  assert.equal(found.kind, "stacktrace");
});

// Repeats within one session are follow-ups, not forgotten knowledge, so only
// cross-session matches count.
test("findDuplicates clusters near-identical questions across sessions", () => {
  const clusters = findDuplicates([
    prompt("how do I resume the scan from a byte offset stored in the cache"),
    prompt("how do i resume a scan from the byte offset stored in the cache"),
    prompt("what colour should the area accent stripe be on the card"),
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].prompts.length, 2);
});

test("findDuplicates ignores repeats inside one session", () => {
  const clusters = findDuplicates([
    prompt("how do I resume the scan from a byte offset stored in the cache", {
      sessionId: "same",
    }),
    prompt("how do i resume a scan from the byte offset stored in the cache", {
      sessionId: "same",
    }),
  ]);

  assert.equal(clusters.length, 0);
});

// Steering turns share almost no vocabulary but are numerous and identical,
// which is exactly how they used to form a bogus cluster.
test("findDuplicates ignores steering turns", () => {
  const clusters = findDuplicates([
    prompt('@agent Continue: "Continue to iterate?"'),
    prompt('@agent Continue: "Continue to iterate?"'),
    prompt('@agent Continue: "Continue to iterate?"'),
  ]);

  assert.equal(clusters.length, 0);
});
