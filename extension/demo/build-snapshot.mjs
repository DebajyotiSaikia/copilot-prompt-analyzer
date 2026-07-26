// Generates demo/snapshot.js — a browser-loadable snapshot plus sample
// documents, so the webview can be rendered and driven outside VS Code.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, ".snapshot-bundle.cjs");

execFileSync(
  process.execPath,
  [
    join(here, "..", "node_modules", "esbuild", "bin", "esbuild"),
    join(here, "snapshotEntry.ts"),
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--outfile=${bundle}`,
    `--alias:vscode=${join(here, "vscode-stub.cjs")}`,
    "--log-level=error",
  ],
  { stdio: "inherit" }
);

const { buildSnapshot } = await import(`file://${bundle}`);
const snapshot = buildSnapshot();

const workingPrompt = `# Auth & Identity — Working Prompt

## Objective

You are working on authentication and identity for a storefront and its orders
service. Sessions, tokens and authorisation rules are the surface area; the
developer cares about them being correct at the server, not just the UI.

## Context

- Node/TypeScript services: \`storefront\` (web) and \`orders-service\` (API).
- Sessions are cookie-based; tokens follow OAuth refresh-rotation patterns.
- Roles already exist in the UI and must be mirrored server side.

## Requirements

1. Store sessions in \`httpOnly\` cookies with \`SameSite=Lax\`. Never localStorage.
2. Rotate the session id on any privilege change.
3. Implement refresh-token rotation with reuse detection; revoke the whole token
   family when a refresh token is presented twice.
4. Enforce every role check on the server, not only in the client.
5. Add a test proving a viewer role cannot \`POST /orders\`.

## Conventions and preferences

- Write the failing test first, then the fix.
- Prefer composition over inheritance; pass strategies in rather than subclassing.
- Keep public interfaces stable when restructuring.

## Do not

- Do not keep session state in localStorage.
- Do not treat a UI-side role check as sufficient.
- Do not introduce a base class where a strategy object would do.
- Do not shorten a TTL when the developer asked for explicit invalidation.

## Definition of done

- [ ] Session cookie flags verified in an integration test.
- [ ] Refresh reuse revokes the family and is covered by a test.
- [ ] A viewer role receives 403 from \`POST /orders\`.
- [ ] No role decision is made only in the client.

## Ask me first

- Token lifetimes and rotation windows.
- Which existing module owns session state when more than one candidate exists.
\`\`\`mermaid
flowchart TD
  A[Request] --> B{Session cookie valid?}
  B -- No --> C[401 and clear cookie]
  B -- Yes --> D{Privilege change?}
  D -- Yes --> E[Rotate session id]
  D -- No --> F[Load role from server]
  E --> F
  F --> G{Role permits action?}
  G -- No --> H[403]
  G -- Yes --> I[Handle request]
\`\`\`
`;

const report = `# Paste hygiene

**22** of 3,536 prompts are mostly pasted machine output, accounting for
**106,055 characters** — a meaningful share of everything you typed.

Every one of those characters is re-sent on every subsequent turn of the same
session.

## By kind

| Kind | Count | Advice |
| --- | --- | --- |
| terminal | 11 | Let the agent run the command itself instead of pasting the transcript. |
| stacktrace | 6 | Paste the top 3 frames and reference the file. |
| data | 3 | Attach the file rather than inlining the payload. |
| bulk | 2 | Reference the source file; the agent can read the range it needs. |
`;

const answer = `Three things recur across your auth prompts.

**Server-side enforcement.** You asked twice for role checks to be mirrored on
the server after they were implemented only in the UI [demo-orders-service#2].

**Explicit invalidation over shorter TTLs.** When caching came up you rejected a
shortened TTL and required invalidation wired into the write path.

**Composition over inheritance.** You pushed back on a base class and asked for
the pricing strategy to be passed in instead.
`;

mkdirSync(here, { recursive: true });
writeFileSync(
  join(here, "snapshot.js"),
  [
    "window.__SNAPSHOT = " + JSON.stringify(snapshot) + ";",
    "window.__DEMO_PROMPT = " + JSON.stringify(workingPrompt) + ";",
    "window.__DEMO_REPORT = " + JSON.stringify(report) + ";",
    "window.__DEMO_ANSWER = " + JSON.stringify(answer) + ";",
  ].join("\n"),
  "utf8"
);

console.log(
  `snapshot.js written: ${snapshot.prompts.length} prompts, ${snapshot.sessions.length} sessions`
);
