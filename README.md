# copilot-chat-analyzer

Reads every GitHub Copilot Chat prompt VS Code has stored on disk, groups them by
topic area with AI, and lets you interrogate the result in natural language.
Read-only: it never writes to VS Code's own storage.

Two pieces that share one data source:

| Part                                                              | Use it for                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [extension/](extension) — VS Code extension                       | The dashboard: AI grouping, filtering, and asking questions about your history |
| [copilot_chat_analyzer.py](copilot_chat_analyzer.py) — Python CLI | Headless indexing, SQL queries, scripted exports                               |

The extension is the product. The CLI is there when you want raw SQL over the
corpus or a scheduled export. Neither depends on the other.

## The extension

Grouping and Q&A run through the VS Code Language Model API, so they use your
existing Copilot subscription — no API key, nothing uploaded anywhere else.

It is already built and installed. Click the **Copilot Chat Analyzer** icon in the
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
| `<user>/workspaceStorage/<hash>/chatSessions/*.jsonl` | sessions after Feb 2026 (append-only log)  |
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
py copilot_chat_analyzer.py index          # build/refresh copilot-chats.db
py copilot_chat_analyzer.py stats          # how you prompt, at a glance
py copilot_chat_analyzer.py list -n 50     # most recent prompts
py copilot_chat_analyzer.py search "docker deploy"
py copilot_chat_analyzer.py session 4f312b # full transcript of one session
py copilot_chat_analyzer.py export --format csv --out out/prompts.csv
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
py copilot_chat_analyzer.py search "firebase AND deploy"
py copilot_chat_analyzer.py search '"session resumption"'
py copilot_chat_analyzer.py search "auth*" --workspace Nexus --since 2026-01-01
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
subscription. Prompt text is truncated to `copilotChatAnalyzer.maxPromptChars`
before it is sent; lower that value, or filter first, if a workspace is sensitive.
