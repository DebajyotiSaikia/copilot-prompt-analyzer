# Copilot Prompt Analyzer — Roadmap

Only outstanding work is listed. Completed sections have been removed; see
`extension/CHANGELOG.md` for what shipped.

## Status

**v0.2.2 — shipped.**

- Extension: https://marketplace.visualstudio.com/items?itemName=DebajyotiSaikia.copilot-prompt-analyzer
- Homepage: https://prompts.deb0.com/
- Source: https://github.com/DebajyotiSaikia/copilot-prompt-analyzer

Corpus after the JSONL fix: **3,536 prompts / 85 sessions / 2025-09-16 → 2026-07-26**,
525k words across 15+ projects. Cold scan ~60s, cached rescan ~1.6s, resumed
append ~0.1s. Cache 3.4 MB gzipped.

Releasing:

```
cd extension
npm run package                # typecheck, test, bundle
npx vsce package --out copilot-prompt-analyzer-<version>.vsix
npx vsce publish --azure-credential --packagePath .\copilot-prompt-analyzer-<version>.vsix
```

The homepage redeploys itself on any push that touches `site/`. CI runs the
typecheck, the tests, a production bundle, a trial package, the secret scan and
the site check on every push and pull request.

---

## 1. Blocked on the Marketplace website

Both are blocked identically: the gallery API rejects publisher writes with
`InvalidReCaptchaTokenException` — "You can update a publisher directly from the
Marketplace website" — so no amount of CLI work gets around them. Open
https://marketplace.visualstudio.com/manage/publishers/debajyotisaikia and edit
the publisher; it is the same form used to create it.

- [ ] Repoint **Support** at
      `https://github.com/DebajyotiSaikia/copilot-prompt-analyzer/issues` and
      **Source code repository** at
      `https://github.com/DebajyotiSaikia/copilot-prompt-analyzer`. Both still
      name the pre-rename repository and survive only on a GitHub redirect,
      which lapses if anything else ever claims the old slug.
- [ ] In the same form, put `https://deb0.com` in **Verified domain** and press
      **Verify**. It returns a TXT record to add at IONOS; once that resolves,
      the publisher shows a verified badge. Cosmetic — it does not gate
      publishing, and the record is separate from the `prompts` CNAME.

## 2. Not worth doing — Open VSX

Dropped after checking. Open VSX serves VSCodium, Cursor and Windsurf, and
**neither `github.copilot` nor `github.copilot-chat` is published there** (both
404 on the Open VSX API). Without Copilot Chat those editors have no
`chatSessions` history to read and no `vscode.lm` provider, so classification,
Ask and the four model-written reports cannot run. The extension would install
and then do essentially nothing.

Revisit only if the analyzer learns to read another assistant's history format.

## 3. Film the four AI-backed beats

**Build working prompt**, **Ask**, and the three model-written reports are the
headline features and none of them are on camera — the video shows only the
local report. The homepage and the Marketplace listing both lead with working
prompts, so the demo is selling something it never shows.

The blocker is narrower than it looked. Copilot Chat is a **built-in** extension
in current VS Code, so the scratch profile at `%TEMP%\cca-demo-vscode` already
has it — it is simply signed out.

- [ ] Sign the scratch profile in to Copilot once. It persists in that profile's
      `user-data`, so every later recording just works:

      ```
      & "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" `
        --user-data-dir "$env:TEMP\cca-demo-vscode\user-data" `
        --extensions-dir "$env:TEMP\cca-demo-vscode\extensions"
      ```

      Then sign in from the account menu and close the window. **Do not pass
      `--fresh` to `capture.mjs` afterwards** — it deletes the profile and the
      sign-in with it.

- [ ] Write the beats in `demo/capture.mjs` and their lines in
      `demo/narration.mjs`. Each AI beat streams, so it needs to wait for
      completion rather than a fixed hold.

## 4. Things worth not rediscovering

**Publisher identity.** The Marketplace publisher `DebajyotiSaikia` was created
under the **Microsoft Account** directory, which is a different principal from
the same email in the Entra tenant. `az` can never hold the Microsoft Account
one — ARM refuses the `/consumers` endpoint (`AADSTS9002332`), and both WAM and
device-code sign-in fail. Azure DevOps exposes only `Default Directory`, so
tokens minted there carry the Entra principal. CLI publishing works only because
the Entra guest identity
`debajyoti.saikia_yahoo.co.in#EXT#@debajyotisaikiayahooco.onmicrosoft.com` was
added to the publisher's members. Remove it and `vsce publish` breaks with an
`Access Denied` that names a GUID and explains nothing.

**Extension names are globally unique**, not scoped per publisher.
`copilot-chat-analyzer` belongs to `wudandong` — an unrelated Copilot call-chain
visualiser — which is why this ships as `copilot-prompt-analyzer`.

**The narration says the product name aloud**, so any rename means re-recording
the demo, not just editing text.

**GitHub Pages** cannot serve `/site` from a branch — only `/` or `/docs` — so
`.github/workflows/pages.yml` uploads the folder as an artifact instead. When a
custom domain changes, GitHub keeps serving a cached `NXDOMAIN` and refuses to
issue a certificate; clearing the domain and re-setting it forces revalidation.
Pages serves exactly one custom domain, so moving it breaks the old address with
no redirect.

**No TypeScript parameter properties in `src/`.** The tests run through
`node --test` with type stripping, which cannot transform them —
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Write constructors longhand.

**Windows PowerShell 5.1 mangles `@vscode/vsce`** — the leading `@` is read as a
splat, giving "npm error could not determine executable to run". Inside scripts,
call it through `cmd.exe /c "npx --yes @vscode/vsce ..."`.

**Secrets.** `extension/demo/.azure-speech-key` is git-ignored; `AZURE_SPEECH_KEY`
or `AZURE_SPEECH_KEY_FILE` override it. `node scripts/secret-scan.mjs` reads
`git ls-files`, so it only ever checks what would actually be published.
