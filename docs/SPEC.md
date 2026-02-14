# CCTabManagement - VS Code Extension Spec

## Problem

When working across many VS Code windows/projects in parallel, terminal sessions accumulate. There's no way to tell which terminals were recently active vs. stale (days old). This leads to zombie terminal buildup and wasted resources.

## Goal

Provide visual indication of terminal activity recency so the user can quickly identify active vs. stale terminals.

## VS Code API Constraints

**Critical limitation:** The VS Code Terminal API is **read-only** for existing terminals. Extensions cannot dynamically change terminal tab colors, icons, or names after creation. This rules out directly modifying terminal tabs.

**What works:**
- `onDidWriteTerminalData` - detects output on ALL terminals (including ones we didn't create)
- `onDidOpenTerminal` / `onDidCloseTerminal` - lifecycle events
- `onDidChangeActiveTerminal` - focus tracking
- Status bar items - fully dynamic, can update text, color, tooltip
- TreeView panels - custom sidebar with full control over rendering

## Design

### Approach: Status Bar + TreeView Panel

**1. Status Bar Indicator (always visible)**
- Shows activity status of the **currently focused terminal**
- Green dot + "today" if terminal had activity today
- Yellow dot + relative time (e.g., "2d ago") if stale
- Gray dot + "unknown" for terminals opened before extension was installed
- Click to open the full terminal activity panel

**2. Terminal Activity Panel (sidebar TreeView)**
- Listed under the Explorer or a dedicated view container
- Shows terminals from **all VS Code windows**, grouped by activity:
  - **Active today** (green icon)
  - **Stale** (gray icon, with relative timestamp like "3d ago")
- Terminals from other windows display a `[window-name]` label (e.g., `[code]`, `[Bru2025]`)
- Terminals from the current window show without a label
- Click any terminal in the **current window** to focus it
- Click a terminal from **another window** — no-op or shows a tooltip (can't focus cross-window)
- Context menu: "Close terminal" (current window only), "Close all stale terminals"
- Terminal count badges on group headers (e.g., "Active Today 12", "Stale 31")

### Activity Tracking

- Track last activity timestamp per terminal using `onDidWriteTerminalData`
- Also track when user focuses a terminal (`onDidChangeActiveTerminal`)
- Persist timestamps in `ExtensionContext.globalState` so they survive VS Code restarts
- "Active today" = any activity since midnight local time

### Cross-Window Tracking

`ExtensionContext.globalState` is shared across all VS Code windows within the same application. Each window's extension instance writes its terminal activity keyed by window identifier (workspace folder name or window index).

**Architecture:**
- Each window writes: `globalState["activity:<window-id>"] = { windowName, terminals: [...] }`
- The TreeView reads all `activity:*` keys to display terminals from every window
- Polling interval: every 5-10 seconds to pick up cross-window updates
- Stale window cleanup: remove entries for windows that haven't updated in >1 minute (window was closed)

**Window identification:**
- Use the workspace folder name as the window label (e.g., "code", "Bru2025", "CCTabManagement")
- Falls back to "Window N" if no workspace folder is open

**Limitations:**
- Cannot focus or close terminals in other windows (VS Code API restriction)
- Cross-window data has a slight delay (polling interval)

### Terminal Identification

- Terminals identified by `terminal.name` + creation index (since names aren't unique)
- Store: `{ name, processId, lastActivity, createdAt, windowId, windowName }`

### Session Save & Restore

Save the entire terminal workspace (all windows, their terminals, and working directories) to a file, and restore it later to recreate the same layout.

**Save ("Snapshot"):**
- Capture all terminals across all windows (via cross-window globalState data)
- For each terminal: name, working directory (resolved via `processId` + macOS `lsof -d cwd`)
- Group by window (identified by workspace folder path)
- Save to `~/.vscode-terminal-sessions/<session-name>.json`
- Command: `ccTabManagement.saveSession` — prompts for session name (default: date-based)

**Session file format:**
```json
{
  "name": "daily-workflow",
  "savedAt": "2026-02-14T00:24:00Z",
  "windows": [
    {
      "folderPath": "/Users/david/code",
      "folderName": "code",
      "terminals": [
        { "name": "zsh - project-alpha", "cwd": "/Users/david/code/project-alpha" },
        { "name": "node dev server", "cwd": "/Users/david/code/project-alpha" }
      ]
    },
    {
      "folderPath": "/Users/david/Library/Mobile Documents/iCloud~md~obsidian/Documents/dpx",
      "folderName": "dpx",
      "terminals": [
        { "name": "zsh", "cwd": "/Users/david/.../dpx/!/PER/AI" },
        { "name": "zsh", "cwd": "/Users/david/.../dpx/!/WORK/2026/Bru2025" }
      ]
    }
  ]
}
```

**Restore:**
- Command: `ccTabManagement.restoreSession` — pick a saved session from a quick-pick list
- For each window in the session:
  - If a VS Code window is already open for that folder → restore terminals there (via globalState signal)
  - If not → open the folder in a new window (`vscode.openFolder` with `forceNewWindow: true`)
- For each terminal: `vscode.window.createTerminal({ name, cwd })` — creates the terminal in the correct folder
- Terminals are created idle (no commands auto-executed) — user decides what to run

**Manage sessions:**
- Command: `ccTabManagement.manageSessions` — list, rename, delete saved sessions
- TreeView integration: show saved sessions in a collapsible "Saved Sessions" section

**CWD resolution (macOS):**
- Use `child_process.execSync('lsof -p <pid> -a -d cwd -Fn')` to get the working directory
- `terminal.processId` is async (`Promise<number | undefined>`) — resolve before saving
- Fallback: use the workspace folder path if processId is unavailable

**Limitations:**
- Restore creates new terminals — it doesn't reconnect to previous shell sessions or restore shell history
- Commands that were running (dev servers, watchers) are NOT restarted — terminals open at the cwd ready for the user
- Cross-platform CWD resolution: `lsof` for macOS/Linux, different approach needed for Windows (out of scope v1)

## User Requirements

- Mark terminals **green** or indicate **#today** if they've been active today
- Everything else should be visually distinct (stale/inactive)
- Save and restore terminal workspace layouts across VS Code restarts

## Out of Scope (v1)

- Modifying terminal tab colors directly (API limitation)
- Auto-closing stale terminals (too risky, user should decide)
- Focusing or closing terminals in other windows (VS Code API limitation)
- Auto-restarting commands on restore (too risky, user should decide)
- Windows OS support for CWD resolution

## Tech Stack

- TypeScript
- VS Code Extension API
- No external dependencies (uses OS-level `lsof` for CWD resolution)
