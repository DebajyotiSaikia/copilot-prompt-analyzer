# Copilot Prompt Analyzer — Roadmap

Only outstanding work is listed. Completed sections have been removed; see
`extension/CHANGELOG.md` for what shipped.

## Status

**v0.2.0 — live on the Marketplace.**

https://marketplace.visualstudio.com/items?itemName=DebajyotiSaikia.copilot-prompt-analyzer

Corpus after the JSONL fix: **3,536 prompts / 85 sessions / 2025-09-16 → 2026-07-26**,
525k words across 15+ projects. Cold scan ~60s, cached rescan ~1.6s, resumed
append ~0.1s. Cache 3.4 MB gzipped.

Shipping future versions is now one command:

```
cd extension
npx vsce publish --azure-credential --packagePath .\copilot-prompt-analyzer-<version>.vsix
```

---

## 1. Ship the homepage

Deployed by `.github/workflows/pages.yml` on every push that touches `site/`.
Pages can only serve `/` or `/docs` from a branch, so the folder is uploaded as
an artifact instead. The custom domain is already registered with GitHub and
`site/CNAME` is in place — the only missing piece is the DNS record.

- [ ] Add the DNS record at IONOS: **CNAME**, host `chat-analyzer`, value
      `debajyotisaikia.github.io`. No A record, no trailing content.
- [ ] Once it resolves, turn on HTTPS enforcement:
      `gh api -X PUT repos/DebajyotiSaikia/copilot-prompt-analyzer/pages -F https_enforced=true`
      GitHub issues the certificate automatically, which can take up to an hour
      after the record propagates.

## 2. Nice to have

- [ ] Mirror to Open VSX so VSCodium and Cursor users can install it. Separate
      account at `open-vsx.org` with its own token; `npx ovsx publish` takes the
      same VSIX.
- [ ] Verify `deb0.com` on the publisher profile for the verified badge. Needs a
      DNS TXT record; cosmetic only, does not affect publishing.

## 3. Known gap in the demo

The scratch profile used for recording is not signed in to Copilot, so the four
AI-backed beats — build a working prompt, Ask, and the three model-written
reports — are not on camera. `node demo/capture.mjs --attach` drives an
already-running signed-in VS Code instead, but that instance has to be started
with `--remote-debugging-port=9333`.

## 4. Things worth not rediscovering

**Publisher identity.** The Marketplace publisher `DebajyotiSaikia` was created
under the **Microsoft Account** directory, which is a different principal from
the same email in the Entra tenant. `az` can never hold the Microsoft Account
one — ARM refuses the `/consumers` endpoint (`AADSTS9002332`), and both WAM and
device-code sign-in fail. Azure DevOps exposes only `Default Directory`, so
tokens minted there carry the Entra principal, and creating a second publisher
from the API is refused by design (`InvalidReCaptchaTokenException`). The fix
was adding the Entra guest identity
`debajyoti.saikia_yahoo.co.in#EXT#@debajyotisaikiayahooco.onmicrosoft.com` to
the publisher's members. Do not remove it, or CLI publishing breaks.

**Extension names are globally unique**, not scoped per publisher.
`copilot-chat-analyzer` belongs to `wudandong` — an unrelated Copilot call-chain
visualiser — which is why this ships as `copilot-prompt-analyzer`.

**The narration says the product name aloud**, so any rename means re-recording
the demo, not just editing text.

**Secrets.** `extension/demo/.azure-speech-key` is git-ignored; `AZURE_SPEECH_KEY`
or `AZURE_SPEECH_KEY_FILE` override it. Run `node scripts/secret-scan.mjs` before
every release — it reads `git ls-files`, so it only ever checks what would
actually be published.
