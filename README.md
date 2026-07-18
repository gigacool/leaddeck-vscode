# LeadDeck

**Capture, organize, review, engage — one webview inside VS Code.**

LeadDeck is a lightweight command center for people juggling many small projects at once. It isn't a task tracker with statuses and priority flags. It's a place to *dump* a thought in two seconds while you're mid-work, then — once a week, deliberately — organize what you dumped, review what's urgent, and write the update that's actually owed.

It's built for someone carrying 10–20 parallel projects who has accepted the overload. Which is exactly why it stays out of your way: it must never cost more than it returns.

## Why it's different

- **Priority is dead.** When everything is "high," priority stops meaning anything. LeadDeck doesn't ask you to rank things — urgency is *computed* from deadlines and what you've committed to this week. There's no field to argue with.
- **Capturing and organizing are separate on purpose.** Capture is instant and dumb — a keystroke from anywhere. Organizing is a calmer, weekly activity. Keeping them apart is what makes the capture worth using.
- **Your data is yours.** Everything is plain JSON in a folder you own. No database, no cloud, no account. It's diffable, `git init`-able, and readable without the extension.

## Getting started

After installing, open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **LeadDeck: Open Workbench**, or use the keyboard shortcuts below.

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+L` (`Cmd+Alt+L` on macOS) | **Capture** — jot something down from anywhere, without leaving what you're doing |
| `Ctrl+Alt+O` (`Cmd+Alt+O` on macOS) | **Open the workbench** — the main view where you organize and review |

There's also a **LeadDeck** icon in the Activity Bar for quick access, and a **LeadDeck: Celebrate 🎉** command for when you close something out.

## Where your data lives

By default, LeadDeck keeps everything under a `LeadDeck` folder in your home directory:

```
~/LeadDeck/
  projects.json  tasks.json  captures.json  stakeholders.json
  reports/2026-W29.md
```

Everything is human-readable JSON and Markdown. Back it up, version it, or open it in any editor — it's just files.

**Per-project storage.** If a workspace contains a `.leaddeck/` folder, LeadDeck uses that instead of the global folder, so a project can carry its own deck. Exactly one location is ever live — never merged — and the workbench header always tells you which one you're looking at.

## Settings

| Setting | Description |
|---|---|
| `leaddeck.storagePath` | Storage root. Leave empty for `~/LeadDeck`. A `.leaddeck` folder in the workspace overrides both. |

## Installing from a VSIX

If you received a `.vsix` file directly:

```
code --install-extension leaddeck-2.0.0.vsix
```

Or in VS Code: **Extensions** view → `⋯` menu → **Install from VSIX…**

## For developers

Architecture notes, the design laws, and build/packaging instructions live in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Cédric Hartland
