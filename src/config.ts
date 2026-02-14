// ─── TAM Configuration ───────────────────────────────────────────
// All tunable values in one place.

// ─── Timing (milliseconds) ──────────────────────────────────────

/** Debounce delay for click-to-focus on tree items */
export const FOCUS_DEBOUNCE_MS = 150;

/** Debounce delay for tree view refresh after data changes */
export const TREE_REFRESH_DEBOUNCE_MS = 300;

/** Interval for polling terminal name changes (no VS Code event) */
export const NAME_CHECK_INTERVAL_MS = 2_000;

/** Interval for polling Claude Code process state */
export const CLAUDE_CHECK_INTERVAL_MS = 3_000;

/** Interval for polling remote window globalState */
export const REMOTE_POLL_INTERVAL_MS = 7_000;

/** Time after which a remote window is considered stale and cleaned up */
export const STALE_WINDOW_THRESHOLD_MS = 60_000;

/** Time "approval" state persists before falling back to "idle" */
export const APPROVAL_TIMEOUT_MS = 30_000;

/** Timeout for child process commands (ps, lsof) */
export const COMMAND_TIMEOUT_MS = 3_000;

// ─── Thresholds ─────────────────────────────────────────────────

/** CPU % above which a Claude process is considered "generating" */
export const CPU_GENERATING_THRESHOLD = 5;

// ─── Colors (VS Code ThemeColor IDs) ────────────────────────────

export const COLOR_ACTIVE = "terminal.ansiGreen";
export const COLOR_STALE = "disabledForeground";
export const COLOR_STATUS_BAR_STALE = "terminal.ansiYellow";
export const COLOR_CLAUDE_IDLE = "terminal.ansiGreen";
export const COLOR_CLAUDE_GENERATING = "terminal.ansiBlue";
export const COLOR_CLAUDE_APPROVAL = "terminal.ansiRed";

// ─── Icons (VS Code ThemeIcon names) ────────────────────────────

export const ICON_TERMINAL = "terminal";
export const ICON_GROUP_ACTIVE = "circle-filled";
export const ICON_GROUP_STALE = "circle-outline";
export const ICON_CLAUDE_GENERATING = "sync~spin";
export const ICON_CLAUDE_APPROVAL = "bell";

// ─── Labels ─────────────────────────────────────────────────────

export const LABEL_GROUP_ACTIVE = "Active Today";
export const LABEL_GROUP_STALE = "Stale";
export const LABEL_CLAUDE_IDLE = "idle";
export const LABEL_CLAUDE_GENERATING = "generating";
export const LABEL_CLAUDE_APPROVAL = "waiting";

// ─── Paths ──────────────────────────────────────────────────────

import * as path from "path";
import * as os from "os";

/** Directory where saved terminal sessions are stored */
export const SESSIONS_DIR = path.join(os.homedir(), ".vscode-terminal-sessions");

// ─── Tooltip ────────────────────────────────────────────────────

/** Max length for last prompt text in Claude tooltip */
export const TOOLTIP_PROMPT_MAX_LENGTH = 120;

// ─── Internal keys ──────────────────────────────────────────────

/** Prefix for globalState keys used by activity tracker / window manager */
export const GLOBAL_STATE_PREFIX = "activity:";
