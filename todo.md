# Copilot Prompt Analyzer — Roadmap

Only outstanding work is listed. Completed sections have been removed; see
`extension/CHANGELOG.md` for what shipped.

## Status

**v0.2.0 — built, packaged, installed locally, demo recorded.**

Corpus after the JSONL fix: **3,536 prompts / 85 sessions / 2025-09-16 → 2026-07-26**,
525k words across 15+ projects. Cold scan ~60s, cached rescan ~1.6s, resumed
append ~0.1s. Cache 3.4 MB gzipped.

Only publishing and hosting are left, and both are blocked on decisions only you
can make — see sections 2 and 3.

---

## 1. Record the demo — done

Recorded against the real extension in a real VS Code window, driven over the
Chrome DevTools Protocol (`extension/demo/`), so the footage is the product and
not a mock-up. One command rebuilds everything:

```
node demo/capture.mjs --video
```

- [x] Scratch profile in light mode, analyzer sidebar in place of the explorer,
      chat pane and context menus kept off camera
- [x] 1920×1080, 96 s, narrated — `site/demo.mp4`
- [x] Voiceover read by **Azure AI Speech**, voice `en-US-Ava:DragonHDLatestNeural`
      (`demo/narration.mjs` + `demo/tts-azure.mjs`), with the offline Windows
      engine as a fallback when no key is configured. Each beat holds until its
      line finishes — timed off the frame counter, not the wall clock — so the
      picture never runs ahead of the words.
- [x] `site/demo.gif` — silent 22 s opening for the README
- [x] `shot-areas.png`, `shot-insights.png`, `shot-report.png` for the gallery

The speech key lives in `extension/demo/.azure-speech-key`, which is git-ignored;
`AZURE_SPEECH_KEY` or `AZURE_SPEECH_KEY_FILE` override it. Region defaults to
`eastus2`, voice to `AZURE_SPEECH_VOICE`.

Re-recording after a UI change needs no manual steps; editing `narration.mjs`
re-synthesises the lines and re-times the beats automatically.

## 2. Publish

Author **Debajyoti Saikia**, repo
[DebajyotiSaikia/copilot-chat-analyzer](https://github.com/DebajyotiSaikia/copilot-chat-analyzer),
homepage `https://chat-analyzer.deb0.com/`. All of that is wired in and pushed.

- [x] Copyright holder in `extension/LICENSE`
- [x] `git init`, initial commit, pushed to `main`
- [x] `author` / `homepage` / `repository` / `bugs` in `package.json`;
      `"private": true` removed
- [x] Demo GIF in `extension/README.md` as an absolute HTTPS URL
      (`raw.githubusercontent.com/.../main/site/demo.gif`) — resolves as soon as
      the repo is public
- [x] Publisher wired as `DebajyotiSaikia` in `extension/package.json` and
      `site/index.html`. Extension identity:
      `DebajyotiSaikia.copilot-prompt-analyzer`
- [x] GitHub repo is public; the README GIF resolves over HTTPS (verified 200)
- [x] Marketplace publisher created —
      `marketplace.visualstudio.com/manage/publishers/debajyotisaikia`
      (publisherId `4e44f280-…`, website and logo set, domain unverified)
- [x] Renamed to `copilot-prompt-analyzer` — `copilot-chat-analyzer` is taken by
      an unrelated extension, `wudandong.copilot-chat-analyzer`, a Copilot
      call-chain visualiser. Marketplace extension names are globally unique.
      Demo re-recorded because the voiceover says the product name aloud.
- [ ] Publish. **Blocked on a Marketplace identity mismatch**, not on the code.
      `vsce publish --azure-credential` authenticates fine, but the principal the
      Azure CLI supplies (`a91a1e6b-…`, Entra tenant `2b0a77cc…`, "Default
      Directory") has no rights on publisher `/DebajyotiSaikia`, which was
      created while the portal was in the **Microsoft Account** directory.
      - `az` cannot hold the Microsoft Account identity at all: ARM refuses the
        `/consumers` endpoint (`AADSTS9002332`). WAM sign-in and device-code
        sign-in both fail. Structural, not a machine problem.
      - Azure DevOps lists only `Default Directory`, so a PAT created there
        carries the same rejected principal, and there is no Microsoft Account
        directory to create an organisation in.
      - Resolution: accept the publisher agreement if the publisher does appear
        under Default Directory, otherwise add the Entra identity to the
        publisher as **Owner**. Either way `vsce publish --azure-credential`
        then works with no PAT to store or rotate.
- [ ] Move the `v0.2.0` tag onto the commit that actually ships
- [ ] Optionally mirror to Open VSX for VSCodium users

## 3. Ship the homepage

`site/` is static, dependency-free and self-contained, so any host works unchanged.

- [x] Host decided: `chat-analyzer.deb0.com`. `site/CNAME` is in place for GitHub
      Pages; delete it if you serve the folder from somewhere else.
- [ ] Deploy — for Pages: repo → Settings → Pages → deploy from `main`, folder
      `/site`, then point a `chat-analyzer` CNAME at `debajyotisaikia.github.io`
- [x] `var PUBLISHER` set in `site/index.html`; it fills every install link and
      the `ext install` snippet

## 4. Backlog

Nothing outstanding. The previous entries are done:

- Markdown tables render in reports and working prompts; the quality, paste
  hygiene and decision reports are table-heavy and were showing raw pipes.
- Incremental JSONL resume from a byte offset, verified byte-identical to a full
  re-parse by growing a truncated log and comparing.
- Scan cache gzipped, 13 MB → 3.4 MB.
- Scan failures surfaced as an expandable banner instead of a toast count.
- Signed-out-of-Copilot path exercised across all seven language-model entry
  points against a stubbed API; every one degrades to an actionable message.

## 5. Known gap

The scratch profile used for recording is not signed in to Copilot, so the four
AI-backed beats — build a working prompt, Ask, and the three model-written
reports — are not on camera. `node demo/capture.mjs --attach` drives an
already-running signed-in VS Code instead, but that instance has to be started
with `--remote-debugging-port=9333`.
