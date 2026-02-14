# CCTabManagement - Implementation Plan

## Phase 1: Project Scaffolding

1. Initialize VS Code extension with `yo code` or manual setup
2. Configure TypeScript, ESBuild bundler, package.json with extension manifest
3. Set up build/watch/package scripts

**Files:**
- `package.json` - Extension manifest, contributes (views, commands, status bar)
- `tsconfig.json` - TypeScript config
- `esbuild.js` - Build script
- `src/extension.ts` - Entry point

## Phase 2: Activity Tracker (with Cross-Window Support)

Core module that monitors terminal activity across all terminals in the current window, and shares data with other windows via globalState.

1. Listen to `onDidWriteTerminalData` for output activity
2. Listen to `onDidChangeActiveTerminal` for focus activity
3. Listen to `onDidOpenTerminal` / `onDidCloseTerminal` for lifecycle
4. Store `Map<terminalId, ActivityRecord>` with timestamps
5. Persist to `ExtensionContext.globalState` for cross-session memory
6. Helper: `isActiveToday(terminal)` - checks if last activity >= midnight
7. Write current window's data to `globalState["activity:<windowId>"]`
8. Derive `windowId` from workspace folder name, fallback to "Window N"
9. Include a `lastUpdated` timestamp per window entry for stale cleanup
10. Poll globalState every 5-10 seconds to read other windows' data
11. Remove window entries that haven't updated in >1 minute (closed windows)

**Files:**
- `src/activityTracker.ts` - ActivityTracker class (local tracking + globalState sync)
- `src/windowManager.ts` - Cross-window state reading, polling, stale cleanup

## Phase 3: Status Bar

Status bar item showing activity status of the current terminal.

1. Create status bar item aligned to the left
2. Update on terminal focus change and on activity events
3. Show: green "$(terminal) Active today" or yellow "$(terminal) 3d ago"
4. Click action: focus the Terminal Activity panel

**Files:**
- `src/statusBar.ts` - StatusBarManager class

## Phase 4: TreeView Panel

Sidebar panel listing all terminals from all windows with activity info.

1. Register TreeDataProvider for "ccTabManagement.terminalActivity" view
2. Group terminals: "Active Today" / "Stale" with count badges
3. Each item shows: terminal name, last activity (relative time), color icon
4. Terminals from other windows show a `[window-name]` label suffix
5. Click to focus terminal (current window only; no-op for other windows)
6. Context menu: "Close Terminal" (current window only), "Close All Stale Terminals"
7. Auto-refresh on activity changes and cross-window poll (debounced)

**Files:**
- `src/treeView.ts` - TerminalTreeDataProvider class
- `src/treeItems.ts` - TreeItem factories

## Phase 5: Session Save & Restore

Save and restore the full terminal workspace: all windows, terminals, and their working directories.

**Save:**
1. Collect terminals from all windows (current window via API, others via globalState)
2. Resolve each terminal's CWD: `terminal.processId` → `lsof -p <pid> -a -d cwd -Fn`
3. Group by window (workspace folder path)
4. Write to `~/.vscode-terminal-sessions/<session-name>.json`
5. Quick-pick prompt for session name (default: `YYYY-MM-DD` date)

**Restore:**
1. Quick-pick to select a saved session
2. For each window in the session:
   - Check if a VS Code window is already open for that folder
   - If not, open via `vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true })`
3. For the current window's terminals: create via `vscode.window.createTerminal({ name, cwd })`
4. For other windows: write a restore request to globalState; each window's extension picks it up on activation and creates its terminals

**Manage:**
1. List saved sessions in a "Saved Sessions" section of the TreeView
2. Delete sessions from context menu

**Files:**
- `src/sessionManager.ts` - Save/restore/manage logic, CWD resolution
- `src/cwdResolver.ts` - OS-level CWD resolution (macOS `lsof`, Linux `/proc`)

## Phase 6: Commands

1. `ccTabManagement.closeStaleTerminals` - Close all terminals with no activity today
2. `ccTabManagement.showTerminalActivity` - Focus the panel
3. `ccTabManagement.refreshActivity` - Force refresh
4. `ccTabManagement.saveSession` - Save current terminal workspace
5. `ccTabManagement.restoreSession` - Restore a saved session
6. `ccTabManagement.manageSessions` - List/delete saved sessions

**Files:**
- `src/commands.ts` - Command handlers

## Phase 7: Polish & Package

1. Extension icon
2. README.md
3. `.vscodeignore` for packaging
4. Test manually across multiple windows
5. `vsce package` to create .vsix

## File Structure

```
CCTabManagement/
├── docs/
│   ├── SPEC.md
│   └── PLAN.md
├── src/
│   ├── extension.ts          # activate/deactivate
│   ├── activityTracker.ts    # Core activity monitoring + globalState sync
│   ├── windowManager.ts      # Cross-window state reader, polling, cleanup
│   ├── statusBar.ts          # Status bar indicator
│   ├── treeView.ts           # Sidebar tree panel
│   ├── treeItems.ts          # TreeItem factories
│   ├── sessionManager.ts     # Session save/restore/manage
│   ├── cwdResolver.ts        # OS-level CWD resolution (lsof)
│   └── commands.ts           # Command handlers
├── package.json              # Extension manifest
├── tsconfig.json
├── esbuild.js
├── .vscodeignore
└── README.md
```

## Estimated Effort

- Phase 1: Scaffolding - quick
- Phase 2: Activity Tracker - core logic + cross-window sync
- Phase 3: Status Bar - straightforward
- Phase 4: TreeView - most UI work
- Phase 5: Session Save & Restore - key differentiator
- Phase 6: Commands - simple
- Phase 7: Polish - packaging
