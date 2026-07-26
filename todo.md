# Copilot Prompt Analyzer — Roadmap

Only outstanding work is listed. Completed sections have been removed; see
`extension/CHANGELOG.md` for what shipped.

## Status

**v0.2.1 — shipped.**

- Extension: https://marketplace.visualstudio.com/items?itemName=DebajyotiSaikia.copilot-prompt-analyzer
- Homepage: https://chat-analyzer.deb0.com/ (HTTPS enforced)
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

## 1. Needs the Marketplace website

Both are blocked the same way: the gallery API rejects publisher writes with
`InvalidReCaptchaTokenException` — "You can update a publisher directly from the
Marketplace website" — so no amount of CLI work gets around them.

- [ ] Repoint the publisher profile's **Support** and **Source code repository**
      fields at `https://github.com/DebajyotiSaikia/copilot-prompt-analyzer`.
      They still name the pre-rename repository and survive only on a GitHub
      redirect.
- [ ] Verify `deb0.com` for the verified-publisher badge. The portal issues a
      TXT record to add at IONOS. Cosmetic; it does not gate publishing.

## 2. Needs a separate account

- [ ] Mirror to Open VSX so VSCodium, Cursor and Windsurf users can install it.
      Needs an Eclipse Foundation account, a signed publisher agreement and its
      own token — none of which can be automated. Once the token exists,
      `npx ovsx publish extension/copilot-prompt-analyzer-<version>.vsix -p <token>`
      takes the same VSIX unchanged.

## 3. Known gap in the demo

The scratch profile used for recording is not signed in to Copilot, so the four
AI-backed beats — build a working prompt, Ask, and the three model-written
reports — are not on camera. `node demo/capture.mjs --attach` drives an
already-running signed-in VS Code instead, but that instance has to have been
started with `--remote-debugging-port=9333`, which means relaunching your own
editor before recording.

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
`.github/workflows/pages.yml` uploads the folder as an artifact instead. After
adding the DNS record, GitHub kept serving a cached `NXDOMAIN` and refused to
issue a certificate; clearing the custom domain and re-setting it forced
revalidation.

**Secrets.** `extension/demo/.azure-speech-key` is git-ignored; `AZURE_SPEECH_KEY`
or `AZURE_SPEECH_KEY_FILE` override it. Run `node scripts/secret-scan.mjs` before
every release — it reads `git ls-files`, so it only ever checks what would
actually be published.
