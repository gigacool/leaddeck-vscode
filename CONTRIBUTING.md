# Contributing to LeadDeck

Developer and architecture notes. For what the extension *is* and how to use it, see [README.md](README.md).

## Status

**All four layers built.** 87 tests. Press `F5` to run it.

**Not built yet:** the editor sheet (FR-23–28), the `＋` rail, commit-to-week from the shelf, the burndown, the six-week stepper, export.

## The laws

These are not preferences. Each one was decided against a documented failure, and **every one of them will look like an improvement when it comes back.**

- **Priority is dead.** With 10–20 projects, everything becomes "high" — a signal that doesn't discriminate stops being a signal. The only judgment authored is `committed: weekOf`. Urgency is **computed**; there is no field to argue with.
- **Capture ≠ Organize.** Capture is 2 seconds and dumb. Organize is Friday and rich. Fusing them is what killed the last two attempts.
- **Pull inserts a stub, never a sentence.** ~80% of the Friday report is prose the app cannot write. It works *precisely to the extent it doesn't help*. Test any change: *does it reduce what he types?* If yes — **refuse it.**
- **A project has one deadline.** Multiple deadlines means it's several projects, grouped by tag.
- **The retrospective is an export, not a feature.** The app owes data, not opinions.
- **If the iteration stepper grows a date range, a filter, or a compare control** — it has become the analytics panel v1 died of. **Delete the stepper. Do not extend it.**

## Develop

Requires Node 20+ (Node 24 recommended — it matches what VS Code ships).

```
npm install
npm run check     # typecheck + test
npm run watch     # rebuild on change, then F5
```

Tests run on Node's native TypeScript support — no compile step, no test framework.

## Architecture

The spine is `ARCHITECTURE-SPINE.md` (kept alongside the planning artifacts, outside this repo) — 14 ADs. Read it before changing anything structural; the ADs record what each decision *prevents*, which is the part that isn't recoverable from the code.

**Paradigm:** in-memory document store, a pure derivation layer, a one-way render pipe. The whole dataset fits in memory — that single fact is what lets the rest be this small.

```
src/
  model/     types + ids. Imports nothing.
  store/     load, mutate, ordered atomic writes, watch.
  derive/    urgency, bands, blocked, collisions. PURE — no vscode, no fs, no clock.
  surface/   extension.ts, the one webview, the QuickPick. The only layer that owns `vscode`.
```

The dependency rule: **`derive/` importing `vscode` or `fs` is the paradigm breaking.** It's the one rule that keeps urgency testable.

## Packaging

```
npm run package                 # production bundle into dist/ and media/
npx @vscode/vsce package        # produces leaddeck-<version>.vsix
```

The VSIX ships only `dist/`, `media/`, `package.json`, `README.md`, and `LICENSE` — see `.vscodeignore`.
