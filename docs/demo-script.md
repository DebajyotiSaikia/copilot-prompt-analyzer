# Demo script

Target length **75 seconds**. One take, no cuts, no narration overlay — the UI
carries the story. Record with demo data, never with real history.

## Before you record

```
Ctrl+Shift+P → Copilot Chat Analyzer: Toggle Demo Data
```

Checklist:

- [ ] Demo data on. The header should read 40 prompts / storefront, orders-service, recommender.
- [ ] Theme: Dark Modern. Zoom level 1. Window 1600×900, hide the status bar and activity bar labels.
- [ ] Close every other editor tab. Empty the terminal panel.
- [ ] Sign out of nothing — the model dropdown should show real model names, that is the point.
- [ ] Hide any personal folder in the Explorer; open no workspace at all if possible.
- [ ] Turn off notifications (`Do Not Disturb` in the bell menu) so nothing pops mid-take.

## Beats

| Time      | On screen                                                                                                                                | Why it matters                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 0:00–0:06 | VS Code with the activity bar icon visible. Click it. Sidebar opens, metrics populate instantly.                                         | Establishes: this reads history you already have, with no setup.                                       |
| 0:06–0:14 | Click **Expand**. Full dashboard opens in an editor tab, already populated.                                                              | Same tool, two surfaces, no reload.                                                                    |
| 0:14–0:24 | Hover the Areas grid. Slowly scroll so several area cards pass — UI & UX, Auth & Identity, Security, Debugging.                          | The payoff shot: months of scattered chat, now organised.                                              |
| 0:24–0:32 | Click the model button. Show the dropdown: model names, context windows, reasoning, the context slider. Close it.                        | Answers "what is this actually running on" before anyone asks.                                         |
| 0:32–0:48 | Click **Build working prompt** on **Auth & Identity**. Let it stream. Scroll the result to show Requirements and the **Do not** section. | The core idea. The **Do not** list is the moment people understand it is built from their corrections. |
| 0:48–0:56 | Click **Save .prompt.md**. The file opens. Cut to Copilot Chat, type `/`, show the new command in the list.                              | Closes the loop: analysis becomes something you use tomorrow.                                          |
| 0:56–1:07 | Back to the dashboard. **Insights** tab. Open **Paste hygiene**. Let the number land.                                                    | One concrete, quantified, uncomfortable insight. Local, so it is instant.                              |
| 1:07–1:15 | Open **Ask**, type "what do I keep getting wrong about auth?", let the first lines stream, hold on the answer.                           | Ends on the open-ended capability, implying everything not shown.                                      |

## Rules

- **Never show real data.** If demo mode is off, stop and start again.
- Do not narrate. Add captions in post if a beat needs explaining.
- Let each stream finish rendering before moving on. Dead air reads as speed.
- Do not use the mouse to point at things. Move it only to click.
- If a model call is slow, cut the wait in post rather than re-taking.

## Outputs

| File                      | Format                                | Use                             |
| ------------------------- | ------------------------------------- | ------------------------------- |
| `demo.mp4`                | 1600×900, H.264, no audio             | Homepage hero                   |
| `demo.gif`                | 800×450, ≤ 8 MB, beats 0:32–0:56 only | Marketplace README, top of page |
| `shot-areas.png`          | 1600×900                              | Marketplace gallery 1           |
| `shot-working-prompt.png` | 1600×900                              | Marketplace gallery 2           |
| `shot-insights.png`       | 1600×900                              | Marketplace gallery 3           |

The GIF is the single most important asset — it is what people see before they
decide to read anything. Keep it under 8 MB or the marketplace will not inline it.

## After you record

```
Ctrl+Shift+P → Copilot Chat Analyzer: Toggle Demo Data
```

Confirm the header returns to your real prompt count before doing anything else.
