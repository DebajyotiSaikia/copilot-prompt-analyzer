import { createHash } from "node:crypto";

import type { Classification, PromptRecord, SessionRecord } from "./types";

/**
 * Synthetic corpus for demos and screenshots.
 *
 * Real chat history contains source code, absolute paths, terminal output and
 * anything the user pasted into a prompt — none of which can be filmed. This
 * dataset is fabricated end to end and is never mixed with real data.
 */

interface Seed {
  text: string;
  area: string;
  subarea: string;
  intent: string;
  tags: string[];
  project: string;
  /** days before "now" */
  ago: number;
  model: string;
  tools?: string[];
}

const SEEDS: Seed[] = [
  {
    text: "The checkout summary card overflows on mobile. Make the totals stack under 420px and keep the CTA pinned to the bottom of the viewport.",
    area: "ux",
    subarea: "responsive layout",
    intent: "Fix checkout card overflow on mobile",
    tags: ["layout", "mobile", "checkout"],
    project: "storefront",
    ago: 3,
    model: "Claude Sonnet 4.5",
    tools: ["copilot_readFile", "copilot_replaceString"],
  },
  {
    text: "Our buttons have four different heights across the app. Consolidate them into a single Button component with sm/md/lg and update every usage.",
    area: "ux",
    subarea: "design system",
    intent: "Unify button sizes into one component",
    tags: ["components", "design-system"],
    project: "storefront",
    ago: 11,
    model: "Claude Opus 4.5",
    tools: ["copilot_findTextInFiles", "copilot_multiReplaceString"],
  },
  {
    text: "Add a skeleton loading state to the product grid. It should not shift layout when the real cards arrive.",
    area: "ux",
    subarea: "loading states",
    intent: "Add non-shifting skeleton loader",
    tags: ["loading", "cls"],
    project: "storefront",
    ago: 19,
    model: "Claude Sonnet 4.5",
  },
  {
    text: "The empty state for search results is just the word 'None'. Write something useful that suggests what to try next.",
    area: "ux",
    subarea: "empty states",
    intent: "Improve search empty state copy",
    tags: ["copy", "search"],
    project: "storefront",
    ago: 26,
    model: "GPT-5 mini",
  },
  {
    text: "Every form field re-renders when any field changes. Make the address form only re-render the field being edited.",
    area: "performance",
    subarea: "render cost",
    intent: "Stop whole-form re-renders",
    tags: ["react", "rerender"],
    project: "storefront",
    ago: 8,
    model: "Claude Opus 4.5",
  },

  {
    text: "Add a POST /orders endpoint. It takes a cart id and an idempotency key, and must return the existing order if the key was already used.",
    area: "api",
    subarea: "endpoint design",
    intent: "Add idempotent order creation endpoint",
    tags: ["rest", "idempotency"],
    project: "orders-service",
    ago: 5,
    model: "Claude Opus 4.5",
    tools: ["copilot_createFile", "copilot_readFile"],
  },
  {
    text: "The inventory client retries forever when the upstream is down. Add exponential backoff with a hard cap of 5 attempts and surface a typed error.",
    area: "api",
    subarea: "resilience",
    intent: "Bound retries with backoff",
    tags: ["retry", "backoff", "errors"],
    project: "orders-service",
    ago: 14,
    model: "Claude Sonnet 4.5",
  },
  {
    text: "Split the order service — it does pricing, tax and fulfilment in one 900 line file. Keep the public interface identical.",
    area: "refactor",
    subarea: "service decomposition",
    intent: "Split oversized order service",
    tags: ["architecture", "cleanup"],
    project: "orders-service",
    ago: 22,
    model: "Claude Opus 4.5",
  },
  {
    text: "No, don't introduce a new base class for that. I want composition, not inheritance — pass the pricing strategy in.",
    area: "refactor",
    subarea: "design pushback",
    intent: "Reject inheritance, require composition",
    tags: ["composition", "correction"],
    project: "orders-service",
    ago: 22,
    model: "Claude Opus 4.5",
  },
  {
    text: "Webhook handlers should be idempotent. Add a processed-events table and skip anything we have already seen.",
    area: "api",
    subarea: "webhooks",
    intent: "Make webhook handling idempotent",
    tags: ["webhooks", "idempotency"],
    project: "orders-service",
    ago: 31,
    model: "Claude Sonnet 4.5",
  },

  {
    text: "Write a migration adding a partial index on orders(status) where status = 'pending'. The full index is 4GB and we only ever query pending.",
    area: "data",
    subarea: "indexing",
    intent: "Add partial index for pending orders",
    tags: ["postgres", "index", "migration"],
    project: "orders-service",
    ago: 7,
    model: "Claude Opus 4.5",
  },
  {
    text: "Our migrations are not reversible. Add a down step to each of the last six and verify they actually roll back.",
    area: "data",
    subarea: "migrations",
    intent: "Make recent migrations reversible",
    tags: ["migration", "rollback"],
    project: "orders-service",
    ago: 17,
    model: "Claude Sonnet 4.5",
  },
  {
    text: "Reads of the product catalogue hit the database on every request. Add a cache with a 5 minute TTL and explicit invalidation on write.",
    area: "data",
    subarea: "caching",
    intent: "Cache catalogue reads with invalidation",
    tags: ["cache", "ttl"],
    project: "storefront",
    ago: 29,
    model: "Claude Sonnet 4.5",
  },
  {
    text: "That's not what I asked. I said invalidate on write, not just shorten the TTL. Wire the invalidation into the write path.",
    area: "data",
    subarea: "caching",
    intent: "Insist on write-path invalidation",
    tags: ["cache", "correction"],
    project: "storefront",
    ago: 29,
    model: "Claude Sonnet 4.5",
  },

  {
    text: "Move session handling off localStorage onto httpOnly cookies with SameSite=Lax, and rotate the session id on privilege change.",
    area: "auth",
    subarea: "session handling",
    intent: "Move sessions to httpOnly cookies",
    tags: ["session", "cookies"],
    project: "orders-service",
    ago: 9,
    model: "Claude Opus 4.5",
  },
  {
    text: "Add refresh token rotation with reuse detection. If a refresh token is presented twice, revoke the whole family.",
    area: "auth",
    subarea: "tokens",
    intent: "Add refresh rotation with reuse detection",
    tags: ["oauth", "tokens"],
    project: "orders-service",
    ago: 20,
    model: "Claude Opus 4.5",
  },
  {
    text: "Roles are checked in the UI only. Enforce them server side too and add a test that a viewer cannot POST /orders.",
    area: "auth",
    subarea: "authorisation",
    intent: "Enforce roles server-side",
    tags: ["rbac", "authz"],
    project: "orders-service",
    ago: 34,
    model: "Claude Sonnet 4.5",
  },

  {
    text: "Audit the repo for secrets committed to git history and tell me what needs rotating. Do not print the values.",
    area: "security",
    subarea: "secret hygiene",
    intent: "Audit repo for committed secrets",
    tags: ["secrets", "audit"],
    project: "orders-service",
    ago: 12,
    model: "Claude Opus 4.5",
    tools: ["copilot_findTextInFiles"],
  },
  {
    text: "Every user-supplied string ends up in a template. Add output escaping and a test that proves script tags are neutralised.",
    area: "security",
    subarea: "xss",
    intent: "Escape user input in templates",
    tags: ["xss", "escaping"],
    project: "storefront",
    ago: 24,
    model: "Claude Opus 4.5",
  },
  {
    text: "Add rate limiting to the login endpoint. Per IP and per account, and it must not lock a real user out permanently.",
    area: "security",
    subarea: "rate limiting",
    intent: "Rate limit login endpoint",
    tags: ["ratelimit", "login"],
    project: "orders-service",
    ago: 37,
    model: "Claude Sonnet 4.5",
  },

  {
    text: "The deploy workflow runs on every push to every branch. Restrict it to main and to changes under services/.",
    area: "infra",
    subarea: "ci triggers",
    intent: "Narrow deploy workflow triggers",
    tags: ["ci", "github-actions"],
    project: "orders-service",
    ago: 4,
    model: "GPT-5 mini",
    tools: ["run_in_terminal"],
  },
  {
    text: "Our container image is 1.2GB. Move to a multi-stage build and a distroless runtime, and show me the final size.",
    area: "infra",
    subarea: "containers",
    intent: "Shrink container image",
    tags: ["docker", "image-size"],
    project: "orders-service",
    ago: 15,
    model: "Claude Sonnet 4.5",
    tools: ["run_in_terminal"],
  },
  {
    text: "Staging and production config have drifted. Put both in one file with explicit per-environment overrides.",
    area: "infra",
    subarea: "configuration",
    intent: "Unify environment config",
    tags: ["config", "environments"],
    project: "orders-service",
    ago: 27,
    model: "Claude Sonnet 4.5",
  },
  {
    text: "Deploy the web app to Firebase Hosting, not Cloud Run. The API stays on Cloud Run.",
    area: "infra",
    subarea: "hosting",
    intent: "Split hosting between Firebase and Cloud Run",
    tags: ["firebase", "cloud-run", "decision"],
    project: "storefront",
    ago: 33,
    model: "Claude Opus 4.5",
  },

  {
    text: "The checkout total is wrong when a discount and a gift card are both applied. Write a failing test first, then fix it.",
    area: "testing",
    subarea: "regression tests",
    intent: "Reproduce discount bug with a test",
    tags: ["tdd", "checkout"],
    project: "storefront",
    ago: 6,
    model: "Claude Opus 4.5",
  },
  {
    text: "Our e2e suite takes 22 minutes. Find the slowest specs and tell me which are actually redundant.",
    area: "testing",
    subarea: "suite performance",
    intent: "Speed up slow e2e suite",
    tags: ["e2e", "flaky"],
    project: "storefront",
    ago: 21,
    model: "Claude Sonnet 4.5",
  },
  {
    text: "Add contract tests between the storefront and the orders API so a breaking response shape fails CI.",
    area: "testing",
    subarea: "contract testing",
    intent: "Add cross-service contract tests",
    tags: ["contract", "ci"],
    project: "orders-service",
    ago: 30,
    model: "Claude Opus 4.5",
  },

  {
    text: "Getting 'Cannot read properties of undefined (reading map)' in the cart reducer after removing the last item. Find the cause.",
    area: "debugging",
    subarea: "runtime errors",
    intent: "Debug cart reducer crash",
    tags: ["bug", "reducer"],
    project: "storefront",
    ago: 2,
    model: "Claude Haiku 4.5",
    tools: ["copilot_readFile", "copilot_findTextInFiles"],
  },
  {
    text: "Still broken. The reducer is fine — look at where the cart is initialised on first render.",
    area: "debugging",
    subarea: "runtime errors",
    intent: "Redirect debugging to initialisation",
    tags: ["bug", "correction"],
    project: "storefront",
    ago: 2,
    model: "Claude Haiku 4.5",
  },
  {
    text: "Builds pass locally and fail in CI with a module resolution error. The only difference is Node version.",
    area: "debugging",
    subarea: "ci failures",
    intent: "Diagnose CI-only build failure",
    tags: ["ci", "node"],
    project: "orders-service",
    ago: 16,
    model: "Claude Sonnet 4.5",
    tools: ["run_in_terminal"],
  },

  {
    text: "The bundle is 780KB gzipped. Show me the five biggest dependencies and what we would save by dropping each.",
    area: "performance",
    subarea: "bundle size",
    intent: "Analyse and reduce bundle size",
    tags: ["bundle", "webpack"],
    project: "storefront",
    ago: 13,
    model: "Claude Opus 4.5",
  },
  {
    text: "The orders list query takes 3 seconds with 50k rows. It is doing an N+1 on customer lookups.",
    area: "performance",
    subarea: "query cost",
    intent: "Fix N+1 in orders listing",
    tags: ["n+1", "sql"],
    project: "orders-service",
    ago: 25,
    model: "Claude Opus 4.5",
  },

  {
    text: "Write a README for the orders service: what it does, how to run it locally, and how to deploy. No marketing language.",
    area: "docs",
    subarea: "readme",
    intent: "Write orders service README",
    tags: ["readme"],
    project: "orders-service",
    ago: 10,
    model: "Claude Sonnet 4.5",
  },
  {
    text: "Document the order state machine as a diagram plus a table of allowed transitions.",
    area: "docs",
    subarea: "architecture docs",
    intent: "Document order state machine",
    tags: ["diagram", "state-machine"],
    project: "orders-service",
    ago: 28,
    model: "Claude Sonnet 4.5",
  },

  {
    text: "Set up an evaluation harness for the recommendations model so we can compare prompt versions on the same 200 examples.",
    area: "ai",
    subarea: "evaluation",
    intent: "Build prompt evaluation harness",
    tags: ["eval", "llm"],
    project: "recommender",
    ago: 1,
    model: "Claude Opus 4.5",
  },
  {
    text: "Our embeddings are recomputed on every deploy. Cache them by content hash and only recompute what changed.",
    area: "ai",
    subarea: "embeddings",
    intent: "Cache embeddings by content hash",
    tags: ["embeddings", "cache"],
    project: "recommender",
    ago: 18,
    model: "Claude Opus 4.5",
  },
  {
    text: "The model sometimes returns prose around the JSON. Make the parser tolerant instead of tightening the prompt again.",
    area: "ai",
    subarea: "output parsing",
    intent: "Make JSON parsing tolerant",
    tags: ["json", "parsing"],
    project: "recommender",
    ago: 23,
    model: "Claude Sonnet 4.5",
  },
  {
    text: "Don't add another retry loop. I said make the parser tolerant, not call the model twice.",
    area: "ai",
    subarea: "output parsing",
    intent: "Reject retry loop in favour of parsing",
    tags: ["correction", "parsing"],
    project: "recommender",
    ago: 23,
    model: "Claude Sonnet 4.5",
  },

  {
    text: "Migrate the build from webpack to Vite and keep the existing path aliases working.",
    area: "tooling",
    subarea: "build system",
    intent: "Migrate webpack to Vite",
    tags: ["vite", "migration", "decision"],
    project: "storefront",
    ago: 35,
    model: "Claude Opus 4.5",
  },
  {
    text: "Add a pre-commit hook that runs typecheck and lint on staged files only. It must not take more than 5 seconds.",
    area: "tooling",
    subarea: "developer workflow",
    intent: "Add fast pre-commit hook",
    tags: ["husky", "lint"],
    project: "storefront",
    ago: 38,
    model: "GPT-5 mini",
  },
];

const PROJECT_PATHS: Record<string, string> = {
  storefront: "C:\\Demo\\storefront",
  "orders-service": "C:\\Demo\\orders-service",
  recommender: "C:\\Demo\\recommender",
};

function modelKeyOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hashOf(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

export interface DemoCorpus {
  prompts: PromptRecord[];
  sessions: SessionRecord[];
  classifications: Record<string, Classification>;
}

export function buildDemoCorpus(now = Date.now()): DemoCorpus {
  const prompts: PromptRecord[] = [];
  const classifications: Record<string, Classification> = {};
  const sessionsByKey = new Map<string, PromptRecord[]>();

  for (const seed of SEEDS) {
    const ts = now - seed.ago * 86_400_000;
    const day = new Date(ts).toISOString().slice(0, 10);
    const sessionId = `demo-${seed.project}-${day}`;
    const seq = sessionsByKey.get(sessionId)?.length ?? 0;
    const hash = hashOf(seed.text);

    const prompt: PromptRecord = {
      id: `${sessionId}#${seq}`,
      sessionId,
      seq,
      ts,
      workspace: PROJECT_PATHS[seed.project] ?? null,
      workspaceName: seed.project,
      model: `copilot/${modelKeyOf(seed.model)}`,
      modelLabel: seed.model,
      modelKey: modelKeyOf(seed.model),
      mode: "agent",
      command: null,
      text: seed.text,
      chars: seed.text.length,
      words: seed.text.split(/\s+/).filter(Boolean).length,
      refs: [],
      tools: seed.tools ?? [],
      toolCalls: (seed.tools ?? []).length * 2,
      elapsedMs: 8000 + seed.text.length * 12,
      reply: `Demo reply for "${seed.intent}".`,
      hash,
    };

    prompts.push(prompt);
    classifications[hash] = {
      area: seed.area,
      subarea: seed.subarea,
      intent: seed.intent,
      tags: seed.tags,
    };

    const bucket = sessionsByKey.get(sessionId);
    if (bucket) {
      bucket.push(prompt);
    } else {
      sessionsByKey.set(sessionId, [prompt]);
    }
  }

  const sessions: SessionRecord[] = [...sessionsByKey.entries()].map(
    ([id, items]) => ({
      id,
      sourceFile: `<demo>/${id}.json`,
      workspace: items[0].workspace,
      workspaceName: items[0].workspaceName,
      location: "panel",
      createdAt: Math.min(...items.map((item) => item.ts)),
      lastMessageAt: Math.max(...items.map((item) => item.ts)),
      promptCount: items.length,
    })
  );

  prompts.sort((a, b) => b.ts - a.ts);
  sessions.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

  return { prompts, sessions, classifications };
}
