# Copilot Prompt Analyzer

**You have already written the spec. It is buried in your chat history.**

Every prompt you have sent to GitHub Copilot Chat is sitting on your disk — the
requirements, the conventions, and every correction you had to make. This
extension reads all of it, groups it by topic, and distils each area into one
reusable prompt you can drop straight into `.github/prompts/`.

Runs on your machine, through the Copilot subscription you already have. No API
key, no account, no telemetry.

![Copilot Prompt Analyzer](https://raw.githubusercontent.com/DebajyotiSaikia/copilot-prompt-analyzer/main/site/demo.gif)

[Watch the narrated demo](https://prompts.deb0.com/)

---

## The one that matters: working prompts

Open the **Areas** view, pick an area — auth, database, UI — and press
**Build working prompt**. It reads every request you ever made in that area and
produces a single document.

The default style is **Portable**: it generalises every specific instance into
the rule behind it and names no repository, service or file path, so the result
applies to any project including one you have not started yet.

- **Role** — what the assistant is being asked to do whenever it works here
- **Rules** — the standing requirements, numbered and checkable
- **Conventions** — how you want work done
- **Do not** — mined from the corrections you had to issue
- **Definition of done** — the checks to run before claiming completion
- **Ask me first** — decisions you have historically wanted to make yourself

The **Do not** section is usually the surprise. Those rules came from every time
you typed "no, not like that" and then watched the reason evaporate when the
session closed.

Switch to **Project-anchored** when you want the opposite: the stack, services
and file layout of the work these requests came from, as a spec for continuing it.

Save it and it becomes something you use tomorrow:

| Destination                                   | Effect                                  |
| --------------------------------------------- | --------------------------------------- |
| `.github/prompts/<area>.prompt.md`            | A `/` command in Copilot Chat           |
| `.github/instructions/<area>.instructions.md` | Applied automatically to matching files |
| Anywhere via **Save as…**                     | Plain markdown                          |

## The dashboard

Press **Dashboard** — next to **Expand**, or run
`Copilot Prompt Analyzer: Open Dashboard` — and twenty-one visualisations open in
their own editor tab, scoped to whatever your filters select. Every number is
computed locally, so it is instant, costs nothing, and works signed out.

Four of them are the point:

| Chart                         | Answers                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------- |
| **Correction rate over time** | Where the assistant keeps failing you. Every spike is a missing instruction file  |
| **Where the turns went**      | How much of your history was steering, repeats and pasted output rather than work |
| **Prompt quality over time**  | Whether _you_ are getting better at asking                                        |
| **Effort treemap**            | Where your requests actually land, which is rarely where you think                |

Then the operational set — activity heatmap, models and modes over time, response
time, session length and duration, tool usage — and the exploratory one: file
hotspots, topic drift, prompt length against quality, tool calls against reply
length, a project timeline, estimated token spend, slash commands, and the
questions you asked twice.

Charts are hand-drawn SVG, so they take the editor's theme and add nothing to the
download.

## Everything else

**Grouped by topic.** Prompts are classified into areas — UI, API, data, auth,
security, infra, testing, performance, debugging and more. Don't like the
taxonomy? Describe a different one in plain English and it regroups.

**Ask your own history.** "What did I keep getting wrong about auth?" "Extract
every bug I reported, with dates." Answers are grounded in whichever prompts your
filters select, and cite them by id.

**Seven reports** in the Insights tab. Three run entirely on your machine and cost
nothing:

| Report                      | Local | What it gives you                                                                     |
| --------------------------- | :---: | ------------------------------------------------------------------------------------- |
| Global Copilot instructions |       | The rules that hold across every project, for `copilot-instructions.md`               |
| Correction patterns         |       | Recurring assistant failure modes, each with a rule that prevents it                  |
| Prompt quality              |   ✓   | Specificity / context / actionability scores, a monthly trend, your weakest prompts   |
| Repeated questions          |   ✓   | Near-duplicate asks across sessions — each cluster is a missing instruction file      |
| Project specs               |       | What each project is, reconstructed from the questions you asked building it          |
| Decision log                |       | Architecture decisions stated in chat, as a timeline plus ADR records, with reversals |
| Paste hygiene               |   ✓   | Prompts that are mostly pasted terminal output, what they cost, what to do instead    |

**Improve this prompt.** Open any prompt and get a rewrite plus an explanation of
what changed.

## Getting started

1. Click the **Copilot Prompt Analyzer** icon in the activity bar. Your history is
   read immediately — no setup, no export.
2. Press **Classify with AI** and approve model access. Results are cached by
   prompt text, so later runs only classify what is new.
3. Explore **Areas**, **Prompts**, **Timeline** and **Insights**. Filter by area,
   workspace, model, mode, date or free text.
4. Press **Expand** for the full-width dashboard in an editor tab. Both views share
   one data source and stay in sync.

## Model, reasoning and context

Nothing here is a hardcoded list.

- **Model** — enumerated from your Copilot plan, each shown with the context
  window the provider reports.
- **Reasoning** — VS Code publishes no reasoning metadata: `LanguageModelChat`
  exposes only id, name, vendor, family, version and `maxInputTokens`, and
  `modelOptions` is an untyped passthrough. So **Detect** asks the provider
  directly, trying candidate option keys and effort values with one-token
  requests and keeping only what is accepted. The dropdown is populated from that
  result and stays empty when a provider genuinely refuses. Cached per model.
- **Context** — budget options are computed from the model's own window, so a 32k
  model and a 1M model both get sensible choices. The characters-per-token ratio
  is measured with `countTokens()` rather than assumed.

Open any working prompt or AI report and the footer shows the real token cost of
what will be sent, before it is sent.

## Commands

| Command                    | What it does                                                |
| -------------------------- | ----------------------------------------------------------- |
| `Show Analyzer Sidebar`    | Reveals the activity bar view                               |
| `Open Analyzer In Editor`  | Opens the full-width dashboard                              |
| `Rescan Chat History`      | Re-reads session files from disk                            |
| `Classify Prompts With AI` | Assigns an area to every new prompt                         |
| `Export Prompts As JSON`   | Writes prompts + classifications to a file                  |
| `Toggle Demo Data`         | Swaps in a fabricated corpus for screenshots and recordings |

## Settings

| Setting                                | Default       | Purpose                                                 |
| -------------------------------------- | ------------- | ------------------------------------------------------- |
| `copilotPromptAnalyzer.model`          | `gpt-4o-mini` | Fallback model family when no model is picked in the UI |
| `copilotPromptAnalyzer.batchSize`      | `20`          | Prompts per classification request                      |
| `copilotPromptAnalyzer.maxPromptChars` | `1200`        | Truncation applied before sending a prompt to the model |
| `copilotPromptAnalyzer.extraUserDirs`  | `[]`          | Extra VS Code `User` directories to scan                |

## Privacy

**Stays on your machine.** Chat history is read from local files and never
uploaded. Classifications and generated documents are stored locally. Three of the
seven reports never make a network call at all. No telemetry, no analytics, no
account.

**Worth knowing.** Classification and synthesis send prompt text to a language
model through _your_ Copilot subscription, under its terms. Your prompts contain
code, paths and anything you pasted into chat — filter to a project first if some
of it is sensitive. Prompt text is truncated to
`copilotPromptAnalyzer.maxPromptChars` before it is sent. Exports are as sensitive
as the original chats.

## Requirements

VS Code 1.95 or later, and an active GitHub Copilot subscription with chat.

Only chat history still on disk is visible — VS Code prunes old sessions, so
running the extension periodically preserves more of it going forward.

---

Not affiliated with GitHub or Microsoft.
