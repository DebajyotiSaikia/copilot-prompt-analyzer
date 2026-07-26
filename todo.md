# Copilot Chat Analyzer — Roadmap

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

Author is **Debajyoti Saikia** — LICENSE, `author` in `package.json` and the
site footer are filled in.

- [x] Copyright holder in `extension/LICENSE`
- [ ] Create the Marketplace publisher at `marketplace.visualstudio.com/manage`;
      give me the ID and I replace `"publisher": "local"` in
      `extension/package.json` and `<publisher>` in `site/index.html`.
      `DebajyotiSaikia` matches the GitHub handle, `deb0` matches the domain —
      your call. Also drop `"private": true` at that point.
- [ ] Create an Azure DevOps PAT with **Marketplace → Manage** scope, then run
      `npx vsce login <publisher>` and type it at the prompt. Never paste it into
      chat or a file.
- [ ] `git init`, push to `github.com/DebajyotiSaikia/<repo>`, then add
      `repository` / `homepage` / `bugs` to `package.json`
- [ ] Add the demo GIF to `extension/README.md`. **The Marketplace requires an absolute
      HTTPS URL** — a relative path fails `vsce publish`. The spot is marked with a TODO.
- [ ] Tag a release, then `vsce publish`
- [ ] Optionally mirror to Open VSX for VSCodium users

## 3. Ship the homepage

`site/` is static, dependency-free and self-contained, so any host works unchanged.

- [ ] Decide the host. Every other product sits on a `*.deb0.com` subdomain
      (hyperion, upload, radio, prism, enclave, capture…), so something like
      `chats.deb0.com` would match — confirm the subdomain and I wire it up.
- [ ] Deploy
- [ ] Fill the three `data-marketplace` hrefs and the two link TODOs in `site/index.html`

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
