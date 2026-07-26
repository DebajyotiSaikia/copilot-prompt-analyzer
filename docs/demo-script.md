# Recording the demo

The demo is not filmed by hand. `extension/demo/capture.mjs` drives a real VS
Code window over the Chrome DevTools Protocol, so the footage is the actual
product rather than a mock-up, and re-recording after a UI change costs one
command:

```
cd extension
node demo/capture.mjs --video
```

That produces `demo/demo.mp4`, `demo/demo.gif` and nine stills in `demo/shots/`.
Copy whichever you need into `site/`.

| Flag       | Effect                                                          |
| ---------- | --------------------------------------------------------------- |
| _(none)_   | Stills only. Fast, useful when checking layout.                   |
| `--video`  | Also records frames, stitches them with ffmpeg, adds the voiceover |
| `--silent` | Skips the voiceover                                               |
| `--fresh`  | Rebuilds the scratch profile from nothing                          |
| `--keep`   | Leaves VS Code running so you can inspect the final state          |
| `--attach` | Drives an already-running VS Code instead of a scratch profile     |

## How it stays honest

**Real history is never filmed.** The capture runs
`Copilot Prompt Analyzer: Toggle Demo Data` first, which swaps in the fabricated
corpus from `src/demoData.ts` — three invented projects, `storefront`,
`orders-service` and `recommender`. The scratch profile is a throwaway VS Code
with its own `--user-data-dir`, so it has no chat history of its own either.

**The window is configured declaratively.** `demo/vscode-driver.mjs` writes a
`settings.json` before launch rather than toggling things through the command
palette, which depends on current state and can land on the wrong view. Light
theme, no minimap, no command centre, no release notes.

**The chat pane is closed twice.** Opening the analyzer brings it back, so the
second close happens after the layout has settled. Stray context menus are also
stripped before every still — an open menu installs a full-window click blocker
that silently eats later clicks.

## The voiceover

`demo/narration.mjs` holds one line per beat. It is read by Azure AI Speech
(`en-US-Ava:DragonHDLatestNeural`), falling back to the offline Windows engine
when no key is configured, so anyone can rebuild the demo without a key.

Clips are synthesised **before** the capture runs. That ordering matters: each
beat then holds the screen until its own line has finished, so the picture never
runs ahead of the words. The hold is measured against the frame counter, not the
wall clock — screenshots lag the target frame rate, so wall time drifts ahead of
the stitched timeline and the last line gets clipped.

Editing a line re-synthesises it and re-times its beat automatically. Renaming
the product means re-recording, because two lines say the name aloud.

## Changing the story

Beats live in `capture.mjs` as `beat(page, id, action)`, where `id` matches an
entry in `narration.mjs`. To add one, write the line, then write the action; the
timing takes care of itself.

## Known gap

The scratch profile is not signed in to Copilot, so the four AI-backed beats —
build a working prompt, Ask, and the three model-written reports — cannot run
there and are not on camera. `--attach` drives your own signed-in VS Code
instead, but that instance has to have been launched with
`--remote-debugging-port=9333`.
