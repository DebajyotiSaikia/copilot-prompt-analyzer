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

**Nothing is outstanding.** The sections below are reference, not work.

---

## 1. Re-recording the demo

`node demo/capture.mjs --video` from `extension/`. Two minutes, narrated,
1920×1080, thirteen beats including the three that need a model — **Build
working prompt**, **Correction patterns** and **Ask**.

Those three only film when the recording profile is signed in to Copilot;
`capture.mjs` probes the model picker at startup and logs which path it took.
The profile at `%TEMP%\cca-demo-vscode` is signed in and persists, so this is
already handled — but **never pass `--fresh`**, which deletes the profile and
the sign-in with it. To sign in again:

```
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" `
  --user-data-dir "$env:TEMP\cca-demo-vscode\user-data" `
  --extensions-dir "$env:TEMP\cca-demo-vscode\extensions"
```

See `docs/demo-script.md` for how the beats and narration fit together.

## 2. Things worth not rediscovering

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
