# TAM - Terminal Activity Management

## Project Overview

VS Code extension that provides visual indication of terminal activity recency. Helps identify active vs. stale terminals when working across many projects in parallel.

## Key Technical Constraint

**VS Code Terminal API is READ-ONLY for existing terminals.** Extensions CANNOT dynamically change terminal tab colors, icons, or names after creation. This is a deliberate API design decision, not a bug. Do not attempt to modify terminal tab appearance directly — it will not work.

**What DOES work on all terminals (including ones we didn't create):**
- `onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution` - detect command activity
- `onDidOpenTerminal` / `onDidCloseTerminal` - lifecycle events
- `onDidChangeActiveTerminal` - focus tracking
- Status bar items - fully dynamic
- TreeView panels - custom sidebar with full rendering control

**Workaround approach:** Use a status bar indicator + sidebar TreeView panel instead of modifying terminal tabs directly.

## Docs

- `docs/SPEC.md` - Full specification and requirements
- `docs/PLAN.md` - Implementation plan with phases and file structure

## Build & Run

```bash
npm install              # Install dependencies
npm run lint             # TypeScript type-check
npm run build            # Production build
npm run watch            # Dev build with watch mode
```

### Package & Install

```bash
npx @vscode/vsce package --allow-missing-repository
code --install-extension tam-terminal-activity-management-0.1.0.vsix --force
```

Then reload VS Code: `Cmd+Shift+P` → "Developer: Reload Window"

## Architecture

- `src/extension.ts` - Entry point, wires all modules
- `src/activityTracker.ts` - Core terminal monitoring + globalState sync + auto-CWD naming
- `src/windowManager.ts` - Cross-window state polling + stale cleanup
- `src/statusBar.ts` - Status bar indicator (green/yellow, HH:MM or relative time)
- `src/treeView.ts` - Sidebar TreeView with Active Today / Stale groups, sort toggle
- `src/commands.ts` - All command handlers
- `src/sessionManager.ts` - Session save/restore to `~/.vscode-terminal-sessions/`
- `src/cwdResolver.ts` - OS-level CWD resolution (macOS lsof, Linux /proc)
- `src/utils.ts` - `isActiveToday()`, `formatRelativeTime()`
- `src/types.ts` - Shared interfaces

# currentDate
Today's date is 2026-02-14.
