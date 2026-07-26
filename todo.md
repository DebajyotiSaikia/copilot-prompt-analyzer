# Copilot Prompt Analyzer — Roadmap

Only outstanding work is listed. Completed sections have been removed; see
`extension/CHANGELOG.md` for what shipped.

## Status

**v0.2.1 — shipped.**

- Extension: https://marketplace.visualstudio.com/items?itemName=DebajyotiSaikia.copilot-prompt-analyzer
- Homepage: https://prompts.deb0.com/
- Source: https://github.com/DebajyotiSaikia/copilot-prompt-analyzer

Corpus after the JSONL fix: **3,536 prompts / 85 sessions / 2025-09-16 → 2026-07-26**,
525k words across 15+ projects. Cold scan ~60s, cached rescan ~1.6s, resumed
append ~0.1s. Cache 3.4 MB gzipped.

Releasing is two commands:

```
cd extension
npx vsce package --out copilot-prompt-analyzer-<version>.vsix
npx vsce publish --azure-credential --packagePath .\copilot-prompt-analyzer-<version>.vsix
```

The homepage redeploys itself on any push that touches `site/`.

---

## 1. Blocked on the Marketplace website

Both are blocked identically: the gallery API rejects publisher writes with
`InvalidReCaptchaTokenException` — "You can update a publisher directly from the
Marketplace website" — so no amount of CLI work gets around them.

- [ ] Repoint the publisher profile's **Support** and **Source code repository**
      fields at `https://github.com/DebajyotiSaikia/copilot-prompt-analyzer`.
      They still name the pre-rename repository and survive only on a GitHub
      redirect, which lapses if anything else ever claims the old slug.
- [ ] Verify `deb0.com` for the verified-publisher badge. The portal issues a
      TXT record to add at IONOS. Cosmetic; it does not gate publishing.

## 2. Blocked on a separate account

- [ ] Mirror to Open VSX so VSCodium, Cursor and Windsurf users can install it.
      Needs an Eclipse Foundation account, a signed publisher agreement and its
      own token — none of which can be automated. Once the token exists,
      `npx ovsx publish extension/copilot-prompt-analyzer-<version>.vsix -p <token>`
      takes the same VSIX unchanged.

## 3. Demo

- [ ] Film the four AI-backed beats: **Build working prompt**, **Ask**, and the
      three model-written reports. The scratch profile the recorder creates is
      not signed in to Copilot, so none of them can run there.
      `node demo/capture.mjs --attach` drives an already-running signed-in VS
      Code instead, but that instance has to have been launched with
      `--remote-debugging-port=9333`, which means relaunching your own editor
      before recording. The beats themselves still need writing in
      `demo/capture.mjs` and `demo/narration.mjs`.
- [ ] `docs/demo-script.md` is stale. It describes a manual 75-second take in
      Dark Modern at 1600×900 with a pre-flight checklist — all of it superseded
      by `demo/capture.mjs`, which is scripted, light-mode, 1080p and narrated.
      Either rewrite it as a description of the automation or delete it.

## 4. Engineering debt

- [ ] No automated tests. Everything so far was verified by hand or by one-off
      scripts that were then deleted. The parts that would repay a test most are
      the ones that were hardest to get right: - `chatStore.readJsonl` — patch replay (`kind` 0/1/2), sparse arrays from
      index patches, and byte-offset resume producing output identical to a
      full parse - `scanCache` — key derivation from size and mtime, and `resumable()`
      against a file that only grew - `analysis` — the `STEERING` regex, which silently skewed quality scores
      and invented a duplicate cluster when `@agent Continue:` slipped through - `webview/markdown` — pipe tables, which shipped broken once already
- [ ] No CI. A workflow running `npm run typecheck` and the tests above on push
      would have caught both the table regression and the steering-regex bug
      before they reached a recording.

## 5. Things worth not rediscovering

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
`.github/workflows/pages.yml` uploads the folder as an artifact instead. After
the DNS record was added, GitHub kept serving a cached `NXDOMAIN` and refused to
issue a certificate; clearing the custom domain and re-setting it forced
revalidation.

**Windows PowerShell 5.1 mangles `@vscode/vsce`** — the leading `@` is read as a
splat, giving "npm error could not determine executable to run". Inside scripts,
call it through `cmd.exe /c "npx --yes @vscode/vsce ..."`.

**Secrets.** `extension/demo/.azure-speech-key` is git-ignored; `AZURE_SPEECH_KEY`
or `AZURE_SPEECH_KEY_FILE` override it. Run `node scripts/secret-scan.mjs` before
every release — it reads `git ls-files`, so it only ever checks what would
actually be published.
