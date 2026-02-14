# TAM - Terminal Activity Management

A VS Code extension for developers who run many terminals in parallel. TAM adds a sidebar panel that shows all your terminals grouped by activity, with automatic naming, search, and session management. If you use [Claude Code](https://docs.anthropic.com/en/docs/claude-code), TAM detects it and shows real-time status for each session.

## Why

VS Code gives every terminal a generic name like `zsh` or `bash`. When you have 10+ terminals across multiple projects, finding the right one is painful. TAM solves this by:

- Automatically naming terminals after their working directory
- Grouping them into "Active Today" and "Stale"
- Letting you search and jump to any terminal instantly
- Showing which Claude Code sessions are busy, idle, or waiting for you

## Install

Clone the repo and build from source:

```bash
git clone https://github.com/kilo9alfa/TAM.git
cd TAM
npm install
npm run build
npx @vscode/vsce package --allow-missing-repository
code --install-extension tam-terminal-activity-management-0.1.0.vsix --force
```

Then reload VS Code: `Cmd+Shift+P` (or `Ctrl+Shift+P`) > **Developer: Reload Window**

To update after pulling new changes:

```bash
npm run build && npx @vscode/vsce package --allow-missing-repository && code --install-extension tam-terminal-activity-management-0.1.0.vsix --force
```

## Features

### Sidebar Panel

The **Terminal Activity** panel appears in the Explorer sidebar. Terminals are grouped into:

- **Active Today** - terminals with activity since midnight
- **Stale** - terminals with no activity today

Each terminal shows its name (auto-detected from the working directory or custom) and the time of last activity. Single-click to jump to a terminal. Right-click to rename or close.

### Claude Code Detection

TAM detects Claude Code processes running in your terminals and shows their state:

| Icon | Color | Meaning |
|------|-------|---------|
| Anthropic logo | Green | Idle - waiting for your next prompt |
| Spinning sync | Blue | Generating - actively thinking or producing output |
| Anthropic logo | Red | Waiting - likely needs you to approve a tool action |

Detection works by inspecting the process tree every 3 seconds via `ps`. The "waiting" state is a heuristic based on CPU transitions: when Claude was recently generating (high CPU) and suddenly goes quiet, it's likely waiting for approval. After 30 seconds of inactivity it transitions back to idle.

### Terminal Search

Press `Ctrl+Alt+S` to open a quick search across all terminals. Matches on display name, status, and raw terminal name. Select a result to jump to it.

### Rename

Right-click a terminal in the panel and select **Rename**, or press `Ctrl+Alt+R` while focused in a terminal. Custom names persist across sessions and take priority over auto-detected names.

### Session Save & Restore

Save your current terminal layout (names and working directories) and restore it later. Sessions are stored in `~/.vscode-terminal-sessions/`.

- **Save** - click the save icon in the panel header (default name: today's date)
- **Restore** - Command Palette > **Terminal Activity: Restore Terminal Session**
- **Manage** - Command Palette > **Terminal Activity: Manage Terminal Sessions** (delete old sessions)

### Status Bar

The status bar shows the last activity time for the currently focused terminal. Green for today, yellow for stale.

### Cross-Window

TAM shares terminal state across VS Code windows via globalState. Terminals from other windows appear in your panel (grayed out) so you can see what's running elsewhere.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+S` | Search terminals |
| `Ctrl+Alt+R` | Rename active terminal |

## Configuration

All settings are centralized in [`src/config.ts`](src/config.ts). Key values:

| Setting | Default | Description |
|---------|---------|-------------|
| `CPU_GENERATING_THRESHOLD` | 5% | CPU above this = Claude is generating |
| `APPROVAL_TIMEOUT_MS` | 30s | Time before "waiting" falls back to "idle" |
| `CLAUDE_CHECK_INTERVAL_MS` | 3s | How often to poll Claude process state |
| `NAME_CHECK_INTERVAL_MS` | 2s | How often to check for terminal renames |
| `REMOTE_POLL_INTERVAL_MS` | 7s | How often to sync cross-window state |
| `STALE_WINDOW_THRESHOLD_MS` | 60s | When to clean up closed windows |

## Requirements

- VS Code 1.85+
- macOS or Linux (CWD detection uses `lsof` on macOS, `/proc` on Linux)
- Node.js for building from source

## Development

```bash
npm install              # Install dependencies
npm run lint             # TypeScript type-check
npm run build            # Production build
npm run watch            # Dev build with watch mode
```

### Architecture

```
src/
├── extension.ts        # Entry point
├── config.ts           # All configuration in one place
├── types.ts            # Shared interfaces
├── activityTracker.ts  # Terminal monitoring + auto-CWD naming
├── claudeDetector.ts   # Claude Code process detection
├── windowManager.ts    # Cross-window state sync
├── statusBar.ts        # Status bar indicator
├── treeView.ts         # Sidebar TreeView
├── commands.ts         # Command handlers
├── sessionManager.ts   # Session save/restore
├── cwdResolver.ts      # OS-level CWD resolution
└── utils.ts            # Time formatting helpers
```

## License

MIT
