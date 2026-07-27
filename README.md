# copilot-prompt-analyzer

Reads every GitHub Copilot Chat prompt VS Code has stored on disk, groups them by
topic area with AI, and lets you interrogate the result in natural language.
Read-only: it never writes to VS Code's own storage.

Two pieces that share one data source:

| Part                                                                  | Use it for                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [extension/](extension) — VS Code extension                           | The dashboard: AI grouping, filtering, and asking questions about your history |
| [copilot_prompt_analyzer.py](copilot_prompt_analyzer.py) — Python CLI | Headless indexing, SQL queries, scripted exports                               |

The extension is the product. The CLI is there when you want raw SQL over the
corpus or a scheduled export. Neither depends on the other.

## The extension

Grouping and Q&A run through the VS Code Language Model API, so they use your
existing Copilot subscription — no API key, nothing uploaded anywhere else.

It is already built and installed. Click the **Copilot Prompt Analyzer** icon in the
activity bar, then **Classify with AI**. Use **Expand** for the full-width dashboard
in an editor tab; both views share one data source and stay in sync.

To rebuild after changes:

```powershell
cd extension
npm install
npm run build          # or: npm run watch
npx @vscode/vsce package --allow-missing-repository --skip-license
```

Press <kbd>F5</kbd> from the repo root to launch an Extension Development Host instead.

See [extension/README.md](extension/README.md) for commands and settings.

## The Python CLI

Pure Python 3.9+ standard library — no dependencies.

## Where the data comes from

VS Code writes each chat panel session to a JSON file:

| Path                                                  | Contains                                  |
| ----------------------------------------------------- | ----------------------------------------- |
| `<user>/workspaceStorage/<hash>/chatSessions/*.json`  | sessions from before Feb 2026             |
| `<user>/workspaceStorage/<hash>/chatSessions/*.jsonl` | sessions after Feb 2026 (append-only log) |
| `<user>/globalStorage/emptyWindowChatSessions/*`      | sessions from windows with no folder open |

`<user>` is:

- Windows — `%APPDATA%\Code\User`
- macOS — `~/Library/Application Support/Code/User`
- Linux — `~/.config/Code/User`

Insiders and VSCodium are picked up automatically too.

Each `requests[]` entry holds the exact prompt (`message.text`), the timestamp,
the model, the chat mode, attached context, the tools the agent invoked, and the
reply. All of that is extracted. Both the extension and the CLI read these files
and produce identical results.

> Note: VS Code prunes old sessions, so this covers whatever is still on disk —
> not necessarily your entire history.

## CLI usage

```powershell
py copilot_prompt_analyzer.py index          # build/refresh copilot-chats.db
py copilot_prompt_analyzer.py stats          # how you prompt, at a glance
py copilot_prompt_analyzer.py list -n 50     # most recent prompts
py copilot_prompt_analyzer.py search "docker deploy"
py copilot_prompt_analyzer.py session 4f312b # full transcript of one session
py copilot_prompt_analyzer.py export --format csv --out out/prompts.csv
```

`index` is incremental; add `--rebuild` to start from scratch. Use
`--user-dir "D:\path\to\Code\User"` to point at a non-default install.

### Filters

`stats`, `list`, `search`, and `export` all accept:

```
--workspace Nexus        substring match on the workspace path
--model opus             substring match on model id or display name
--mode agent             exact mode: agent, ask, edit
--since 2026-01-01       ISO date lower bound
--until 2026-03-01       ISO date upper bound
```

### Search syntax

`search` uses SQLite FTS5, so boolean and phrase queries work:

```powershell
py copilot_prompt_analyzer.py search "firebase AND deploy"
py copilot_prompt_analyzer.py search '"session resumption"'
py copilot_prompt_analyzer.py search "auth*" --workspace Nexus --since 2026-01-01
```

Pass `--like` for a plain substring match when a query trips FTS5 syntax.

## Querying it yourself

The database is plain SQLite. Table `prompts` has one row per prompt:

| column                              | meaning                                                     |
| ----------------------------------- | ----------------------------------------------------------- |
| `ts`                                | ISO 8601 UTC timestamp                                      |
| `workspace`                         | folder the chat belonged to                                 |
| `model`, `model_label`, `model_key` | raw id, display name, normalized join key                   |
| `mode`                              | `agent`, `ask`, `edit`                                      |
| `command`                           | leading slash command, if any                               |
| `text`                              | the prompt, verbatim                                        |
| `chars`, `words`                    | prompt size                                                 |
| `refs`                              | JSON array of attached context (`#file`, selections, tools) |
| `tools`, `tool_calls`               | JSON array of tool ids the agent ran, and the count         |
| `elapsed_ms`                        | wall-clock time for the response                            |
| `reply`                             | first 4000 chars of the assistant reply                     |

Table `sessions` holds one row per conversation, `prompts_fts` is the FTS5 index.

```sql
-- longest agent-mode prompts in the last 90 days
SELECT ts, workspace, chars, substr(text, 1, 120)
FROM prompts
WHERE mode = 'agent' AND ts >= date('now', '-90 days')
ORDER BY chars DESC LIMIT 20;
```

## Privacy

Prompts and replies frequently contain source code, file paths, terminal output,
and secrets you pasted into chat. `copilot-chats.db`, anything under `out/`, and
exports from the extension are as sensitive as the original chats — keep them out
of version control.

Classification and Q&A send prompt text to a language model through your Copilot
subscription. Prompt text is truncated to `copilotPromptAnalyzer.maxPromptChars`
before it is sent; lower that value, or filter first, if a workspace is sensitive.

## Maintaining

```
cd extension
npm run package        # typecheck, test, production bundle
npm test               # node --test, no framework, TypeScript run directly
node demo/capture.mjs --video
```

CI runs the typecheck, tests, a production bundle, a trial `vsce package`, the
secret scan and the site check on every push. Releasing is
`npx vsce publish --azure-credential --packagePath .\copilot-prompt-analyzer-<version>.vsix`;
the homepage redeploys itself on any push touching `site/`.

Two scripts guard the repo, and both read `git ls-files` so they only ever check
what would actually ship:

- `node scripts/secret-scan.mjs` — credentials, tokens, local paths, personal data
- `node scripts/site-check.mjs` — every page in `site/`: broken assets, dead
  anchors across pages, missing alt text, the SEO and social metadata, the
  sitemap, the manifest and its icons

Two more are run by hand when `site/` changes:

- `node scripts/site-shots.mjs` — serves `site/` and drives it through Chromium
  at desktop, iPad and iPhone sizes in both themes, asserting no horizontal
  overflow, 44px touch targets, that the theme toggle works with **JavaScript
  disabled**, and that every page renders identically without scripting.
  Screenshots land in `out/site-shots/`.
- `node scripts/make-icons.mjs` — regenerates the favicon, Apple touch icon,
  maskable icon and pinned-tab glyph from one SVG source

And one that checks the deployed site rather than the working tree:

- `node scripts/site-audit.mjs [origin]` — audits production against the six
  things the site has to get right: Apple-compatible icons, the three-state
  theme toggle, SEO and structured data, the legal pages, static rendering, and
  the iPhone/iPad form factors. Defaults to `https://prompts.deb0.com`.

  It reads colours and rendered text, both of which depend on the stylesheet
  having been applied, so it waits for a non-transparent background before
  measuring. Reading at `domcontentloaded` produces convincing nonsense —
  a transparent body, or two strings of identical length that differ only in
  case because `text-transform` had not landed yet.

### Things worth not rediscovering

**Publisher identity.** The Marketplace publisher `DebajyotiSaikia` was created
under the **Microsoft Account** directory, which is a different principal from
the same email in the Entra tenant. `az` can never hold the Microsoft Account
one — ARM refuses the `/consumers` endpoint (`AADSTS9002332`), and both WAM and
device-code sign-in fail. Azure DevOps exposes only `Default Directory`, so
tokens minted there carry the Entra principal. CLI publishing works only because
the Entra guest identity
`debajyoti.saikia_yahoo.co.in#EXT#@debajyotisaikiayahooco.onmicrosoft.com` was
added to the publisher's members. Remove it and `vsce publish` fails with an
`Access Denied` that names a GUID and explains nothing.

**Publisher edits are website-only.** The gallery API rejects them with
`InvalidReCaptchaTokenException`. So is creating a publisher.

**Extension names are globally unique**, not scoped per publisher.
`copilot-chat-analyzer` belongs to `wudandong` — an unrelated Copilot call-chain
visualiser — which is why this ships as `copilot-prompt-analyzer`.

**Never pass `--fresh` to the demo capture.** It deletes the scratch profile at
`%TEMP%\cca-demo-vscode`, including its Copilot sign-in, and the three
model-backed beats then silently drop out of the recording. The narration also
says the product name aloud, so a rename means re-recording rather than editing
text.

**No TypeScript parameter properties in `src/`.** The tests run through
`node --test` with type stripping, which cannot transform them
(`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). Write constructors longhand.

**GitHub Pages** cannot serve `/site` from a branch — only `/` or `/docs` — so
`.github/workflows/pages.yml` uploads the folder as an artifact. When a custom
domain changes, GitHub keeps serving a cached `NXDOMAIN` and refuses to issue a
certificate; clearing the domain and re-setting it forces revalidation. Pages
serves exactly one custom domain, so moving it breaks the old address with no
redirect.

**Windows PowerShell 5.1 mangles `@vscode/vsce`** — the leading `@` is read as a
splat, giving "npm error could not determine executable to run". Inside scripts,
call it through `cmd.exe /c "npx --yes @vscode/vsce ..."`.
