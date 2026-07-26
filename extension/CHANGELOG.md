# Change Log

## 0.2.0

### Changed

- **Working prompts are portable by default.** The generator used to be told to
  name the actual projects, services and files it saw, which produced a good
  spec for continuing that work and a useless prompt anywhere else. There are now
  two styles: **Portable**, which generalises every instance into the rule behind
  it and names no repository, service or path, so it can be dropped into a project
  that does not exist yet; and **Project-anchored**, the previous behaviour. Each
  style has its own outline — portable leads with Role and Rules, project-anchored
  with Objective and Context.

### Fixed

- **Markdown tables rendered as raw pipes.** The webview renderer had no table
  support, so the prompt quality, paste hygiene and decision log reports — all of
  which are mostly tables — printed `| Score | Date | Prompt |` as a paragraph.
  Pipe tables with an alignment rule now render as real tables.

- **Area card actions were being clipped.** The card was a scroll container
  (`overflow: hidden`) and also a stretched grid item. That is a cyclic size
  dependency: the row is sized from the item's min-content contribution, which for
  a scroll container is zero, so rows collapsed to the header plus actions and hid
  everything between. Cards now size to their content and the accent stripe is a
  border rather than a clipped bar. The actions are also grouped into one block
  pinned to the bottom edge.

- **Read the newer session format.** VS Code switched chat storage from one JSON document per session (`chatSessions/*.json`) to an append-only log
  (`chatSessions/*.jsonl`) in February 2026. Only the old format was being read, so
  everything since then was invisible — on a real corpus that was 3,536 prompts found
  instead of 475. The reader now replays the log format (base snapshot plus set and
  append patches) as well as the original.
- Scans are cached per file by size and modification time. Session logs are
  append-only, so an unchanged file is never re-parsed and a file that only grew is
  resumed from where the last scan stopped: a full rescan drops from ~60s to ~1.6s,
  and picking up new turns in an open session takes ~0.1s. The cache is gzipped
  (13 MB → 3.4 MB).
- Sessions with no prompts are no longer reported as read failures.
- Files that genuinely cannot be read are listed in an expandable banner instead of
  only a toast count.
- The classify button now shows how many prompts actually need classifying, and
  offers **Re-classify all** once none are left. Large runs confirm first with the
  real prompt and request counts; "Everything is already classified" no longer hides
  a stale snapshot.
- Assistant replies are truncated while streaming rather than after, so multi-megabyte
  agent transcripts no longer have to be assembled in memory first.
- Guarded against sparse arrays produced by index-addressed patches, which could
  crash the scan.

### Added

- **Mermaid diagrams render inline.** Any ```mermaid block in a generated document
  or answer is drawn as a diagram, themed to match the editor. Mermaid is a
  separate 3.3 MB bundle loaded only the first time a diagram appears, so the
  webview still starts from a 182 KB bundle. Blocks that fail to parse keep their
  source visible instead of disappearing.
- The steer box under a generated document now labels its button **Send &
  regenerate** while it has text, and clears after sending, so an instruction can
  no longer be silently reapplied on the next run. Ctrl+Enter sends.

- **Model controls** — pick the language model, reasoning effort and context share from the toolbar. The context budget for every operation is now derived from the selected model's window instead of a fixed character count.
- **Insights tab** with seven reports:
  - Global Copilot instructions — the standing rules that hold across every project.
  - Correction patterns — recurring assistant failure modes, each with a preventing rule.
  - Prompt quality — specificity, context and actionability scoring, plus a trend and the weakest prompts. Computed locally.
  - Repeated questions — near-duplicate asks across sessions. Computed locally.
  - Project specs — what each project is, reconstructed from the questions asked while building it.
  - Decision log — architecture decisions stated in chat, as a timeline plus ADR records.
  - Paste hygiene — prompts that are mostly pasted machine output, and what they cost. Computed locally.
- **Improve this prompt** in the detail drawer — rewrites a weak prompt and explains what changed.
- **Demo data mode** (`Copilot Prompt Analyzer: Toggle Demo Data`) — swaps in a fabricated corpus for screenshots and recordings so real history is never shown.

### Changed

- Reports and working prompts share one document viewer with consistent copy and save actions.
- Steering detection now recognises VS Code's own `@agent Continue:` / `@agent Enable:` button artefacts, which previously inflated quality scores and produced false duplicate clusters.
- Generated files are written through a single path that never overwrites an existing file without confirmation.

## 0.1.0

Initial release.

- Reads Copilot Chat history from VS Code's on-disk session files.
- AI classification of prompts into topic areas, cached by prompt text.
- Regroup with AI — redesign the taxonomy from a natural-language instruction.
- Areas, Prompts and Timeline views with faceted filtering.
- Ask — grounded Q&A over the current filter selection, citing prompts by id.
- Per-area working prompts, saveable as `.prompt.md` or `.instructions.md`.
- Activity bar sidebar and editor panel sharing one service.
