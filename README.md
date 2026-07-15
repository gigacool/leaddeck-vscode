# LeadDeck

A VS Code extension for one person. Capture, Organize, Review, Engage.

Not a task tracker — an efficiency instrument for someone carrying 10–20 parallel projects who has accepted the overload. *Which is exactly why it must never cost more than it returns.*

## Status

**Foundation.** `model/` and `store/` are built and tested. `derive/` and `surface/` are next.

## The laws

These are not preferences. Each one was decided against a documented failure, and **every one of them will look like an improvement when it comes back.**

- **Priority is dead.** With 10–20 projects, everything becomes "high" — a signal that doesn't discriminate stops being a signal. The only judgment authored is `committed: weekOf`. Urgency is **computed**; there is no field to argue with.
- **Capture ≠ Organize.** Capture is 2 seconds and dumb. Organize is Friday and rich. Fusing them is what killed the last two attempts.
- **Pull inserts a stub, never a sentence.** ~80% of the Friday report is prose the app cannot write. It works *precisely to the extent it doesn't help*. Test any change: *does it reduce what he types?* If yes — **refuse it.**
- **A project has one deadline.** Multiple deadlines means it's several projects, grouped by tag.
- **The retrospective is an export, not a feature.** The app owes data, not opinions.
- **If the iteration stepper grows a date range, a filter, or a compare control** — it has become the analytics panel v1 died of. **Delete the stepper. Do not extend it.**

## Your data

Plain JSON in a folder you own. No database, no index, no event log, no cache.

```
~/LeadDeck/
  projects.json  tasks.json  captures.json  stakeholders.json
  reports/2026-W29.md
```

Diffable. `git init`-able. Readable without the extension. A `.leaddeck/` folder in a workspace overrides the global root — **exactly one is ever live**, never merged, and the workbench header always names which.

## Develop

Requires Node 20+ (Node 24 recommended — it matches what VS Code ships).

```
npm install
npm run check     # typecheck + test
npm run watch     # rebuild on change, then F5
```

Tests run on Node's native TypeScript support — no compile step, no test framework.

## Architecture

The spine is [`ARCHITECTURE-SPINE.md`](../noosia/_bmad-output/planning-artifacts/architecture/architecture-leaddeck-v2-2026-07-15/ARCHITECTURE-SPINE.md) — 14 ADs. Read it before changing anything structural; the ADs record what each decision *prevents*, which is the part that isn't recoverable from the code.

**Paradigm:** in-memory document store, a pure derivation layer, a one-way render pipe. The whole dataset fits in memory — that single fact is what lets the rest be this small.

```
src/
  model/     types + ids. Imports nothing.
  store/     load, mutate, ordered atomic writes, watch.
  derive/    urgency, bands, blocked, collisions. PURE — no vscode, no fs, no clock.
  surface/   extension.ts, the one webview, the QuickPick. The only layer that owns `vscode`.
```

The dependency rule: **`derive/` importing `vscode` or `fs` is the paradigm breaking.** It's the one rule that keeps urgency testable.
