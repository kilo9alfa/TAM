export type ClaudeState = "none" | "idle" | "generating" | "approval";

export interface ClaudeInfo {
  pid: number;
  cwd?: string;
  etime?: string;
  skipPermissions: boolean;
  cpu: number;
  rss: number; // KB
  lastPrompt?: string;
  mcpServers: string[];
  childProcessCount: number;
}

export interface ActivityRecord {
  /** Stable ID: "<windowId>:<creationIndex>" */
  id: string;
  /** Raw terminal name from VS Code */
  name: string;
  /** Display name shown in tree instead of raw name */
  displayName?: string;
  /** True if displayName was explicitly set by user (won't be overwritten by auto-CWD) */
  displayNameIsCustom?: boolean;
  processId: number | undefined;
  lastActivity: number; // epoch ms
  createdAt: number; // epoch ms
  windowId: string;
  windowName: string;
  /** True if this terminal belongs to the current VS Code window */
  isLocal: boolean;
  /** Claude Code state detected via process inspection */
  claudeState?: ClaudeState;
  /** Rich Claude info (volatile, not persisted) */
  claudeInfo?: ClaudeInfo;
}

export interface WindowState {
  windowId: string;
  windowName: string;
  lastUpdated: number; // epoch ms
  terminals: Omit<ActivityRecord, "isLocal">[];
}

/** Event fired when any activity data changes */
export interface ActivityChangeEvent {
  /** All terminals across all windows */
  allTerminals: ActivityRecord[];
}
