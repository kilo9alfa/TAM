import * as vscode from "vscode";
import * as path from "path";
import { ActivityRecord, WindowState } from "./types";
import { resolveCwd, batchResolveCwds } from "./cwdResolver";
import { detectClaudeStates, disposeClaudeDetector } from "./claudeDetector";
import { getLastPrompt, disposeHistoryCache } from "./claudeHistoryCache";
import {
  GLOBAL_STATE_PREFIX,
  NAME_CHECK_INTERVAL_MS,
  CLAUDE_CHECK_INTERVAL_MS,
} from "./config";

export class ActivityTracker implements vscode.Disposable {
  private records = new Map<number, ActivityRecord>();
  private creationIndex = 0;
  private terminalIndexMap = new Map<vscode.Terminal, number>();
  private disposables: vscode.Disposable[] = [];

  readonly windowId: string;
  readonly windowName: string;

  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private context: vscode.ExtensionContext) {
    const folder = vscode.workspace.workspaceFolders?.[0];
    this.windowName = folder?.name ?? `Window`;
    this.windowId = folder?.uri.fsPath ?? `window-${process.pid}`;

    // Load persisted records BEFORE registering terminals so displayNames are matched
    this.loadFromGlobalState();

    // Register existing terminals
    for (const terminal of vscode.window.terminals) {
      this.registerTerminal(terminal);
    }

    // Lifecycle listeners
    this.disposables.push(
      vscode.window.onDidOpenTerminal((t) => {
        this.registerTerminal(t);
        this.fireChange();
      }),
      vscode.window.onDidCloseTerminal((t) => {
        this.unregisterTerminal(t);
        this.fireChange();
      }),
      vscode.window.onDidChangeActiveTerminal(() => {
        const active = vscode.window.activeTerminal;
        if (active) {
          this.touch(active);
        }
      }),
      // Activity detection via stable shell integration events
      vscode.window.onDidStartTerminalShellExecution((e) => {
        this.touch(e.terminal);
      }),
      vscode.window.onDidEndTerminalShellExecution((e) => {
        this.touch(e.terminal);
      })
    );

    // Poll for terminal name changes (no VS Code event for renames)
    this.nameCheckTimer = setInterval(() => this.checkNameChanges(), NAME_CHECK_INTERVAL_MS);

    // Poll for Claude Code state
    this.claudeCheckTimer = setInterval(() => this.checkClaudeStates(), CLAUDE_CHECK_INTERVAL_MS);
  }

  private nameCheckTimer: ReturnType<typeof setInterval> | undefined;
  private claudeCheckTimer: ReturnType<typeof setInterval> | undefined;

  /** Get activity record for a terminal */
  getRecord(terminal: vscode.Terminal): ActivityRecord | undefined {
    const idx = this.terminalIndexMap.get(terminal);
    if (idx === undefined) return undefined;
    return this.records.get(idx);
  }

  /** Set a custom display name for a terminal */
  setDisplayName(recordId: string, displayName: string | undefined): void {
    for (const record of this.records.values()) {
      if (record.id === recordId) {
        record.displayName = displayName || undefined;
        record.displayNameIsCustom = !!displayName;
        this.fireChange();
        return;
      }
    }
  }

  /** Get all local terminal records */
  getLocalRecords(): ActivityRecord[] {
    return [...this.records.values()];
  }

  /** Get a map from Terminal object to its record, for command handlers */
  getTerminalMap(): Map<vscode.Terminal, ActivityRecord> {
    const result = new Map<vscode.Terminal, ActivityRecord>();
    for (const [terminal, idx] of this.terminalIndexMap) {
      const record = this.records.get(idx);
      if (record) result.set(terminal, record);
    }
    return result;
  }

  /** Write current window state to globalState for cross-window sharing */
  persistToGlobalState(): void {
    const state: WindowState = {
      windowId: this.windowId,
      windowName: this.windowName,
      lastUpdated: Date.now(),
      // Exclude claudeInfo (volatile data, not serialized)
      terminals: this.getLocalRecords().map((r) => ({
        id: r.id,
        name: r.name,
        displayName: r.displayName,
        displayNameIsCustom: r.displayNameIsCustom,
        processId: r.processId,
        lastActivity: r.lastActivity,
        createdAt: r.createdAt,
        windowId: r.windowId,
        windowName: r.windowName,
      })),
    };
    this.context.globalState.update(
      `${GLOBAL_STATE_PREFIX}${this.windowId}`,
      state
    );
  }

  private registerTerminal(terminal: vscode.Terminal): void {
    const idx = this.creationIndex++;
    this.terminalIndexMap.set(terminal, idx);

    const id = `${this.windowId}:${idx}`;
    const now = Date.now();

    // Check if we have a persisted record for a terminal with this name
    const persisted = this.findPersistedMatch(terminal.name);

    this.records.set(idx, {
      id,
      name: terminal.name,
      displayName: persisted?.displayName,
      displayNameIsCustom: persisted?.displayNameIsCustom,
      processId: undefined, // resolved async below
      lastActivity: persisted?.lastActivity ?? now,
      createdAt: persisted?.createdAt ?? now,
      windowId: this.windowId,
      windowName: this.windowName,
      isLocal: true,
    });

    // Resolve processId async, then auto-set displayName from CWD
    terminal.processId.then((pid) => {
      const record = this.records.get(idx);
      if (!record) return;
      record.processId = pid;

      // Auto-name from CWD if no user-set custom displayName
      if (!record.displayNameIsCustom && pid) {
        const cwd = resolveCwd(pid);
        if (cwd) {
          record.displayName = path.basename(cwd);
          this.fireChange();
        }
      }
    });
  }

  private unregisterTerminal(terminal: vscode.Terminal): void {
    const idx = this.terminalIndexMap.get(terminal);
    if (idx !== undefined) {
      this.records.delete(idx);
      this.terminalIndexMap.delete(terminal);
    }
  }

  private touch(terminal: vscode.Terminal): void {
    const idx = this.terminalIndexMap.get(terminal);
    if (idx === undefined) return;
    const record = this.records.get(idx);
    if (record) {
      record.lastActivity = Date.now();
      record.name = terminal.name; // name may change over time
      this.fireChange();
    }
  }

  private fireChange(): void {
    this.persistToGlobalState();
    this._onDidChange.fire();
  }

  private loadFromGlobalState(): void {
    const state = this.context.globalState.get<WindowState>(
      `${GLOBAL_STATE_PREFIX}${this.windowId}`
    );
    if (!state) return;

    // Store persisted terminals for matching during registerTerminal
    this._persistedTerminals = state.terminals;
  }

  private _persistedTerminals: WindowState["terminals"] = [];

  private findPersistedMatch(
    name: string
  ): WindowState["terminals"][number] | undefined {
    // Find and consume a persisted terminal with matching name
    const idx = this._persistedTerminals.findIndex((t) => t.name === name);
    if (idx === -1) return undefined;
    return this._persistedTerminals.splice(idx, 1)[0];
  }

  private checkNameChanges(): void {
    let changed = false;
    for (const [terminal, idx] of this.terminalIndexMap) {
      const record = this.records.get(idx);
      if (record && record.name !== terminal.name) {
        record.name = terminal.name;
        changed = true;
      }
    }
    if (changed) {
      this.fireChange();
    }
  }

  private checkClaudeStates(): void {
    // Collect PIDs for all local terminals
    const pidToIdx = new Map<number, number>();
    for (const [_terminal, idx] of this.terminalIndexMap) {
      const record = this.records.get(idx);
      if (record?.processId) {
        pidToIdx.set(record.processId, idx);
      }
    }

    if (pidToIdx.size === 0) return;

    const results = detectClaudeStates([...pidToIdx.keys()]);
    let changed = false;

    // Collect Claude PIDs that need CWD resolution
    const claudePids: number[] = [];
    for (const [, { info }] of results) {
      if (info) {
        claudePids.push(info.pid);
      }
    }

    // Batch resolve CWDs for all Claude processes
    const cwds = claudePids.length > 0 ? batchResolveCwds(claudePids) : new Map<number, string>();

    for (const [pid, { state, info }] of results) {
      const idx = pidToIdx.get(pid);
      if (idx === undefined) continue;
      const record = this.records.get(idx);
      if (!record) continue;

      if (record.claudeState !== state) {
        record.claudeState = state;
        changed = true;
      }

      if (info) {
        // Fill CWD from batch result
        info.cwd = cwds.get(info.pid);
        // Fill last prompt from history cache
        if (info.cwd) {
          info.lastPrompt = getLastPrompt(info.cwd);
        }
        // Only trigger tree refresh when claudeInfo is first attached or key fields change
        const prev = record.claudeInfo;
        if (!prev || prev.pid !== info.pid || prev.cwd !== info.cwd
            || prev.childProcessCount !== info.childProcessCount
            || prev.mcpServers.length !== info.mcpServers.length
            || prev.lastPrompt !== info.lastPrompt) {
          changed = true;
        }
        record.claudeInfo = info;
      } else if (record.claudeInfo) {
        record.claudeInfo = undefined;
        changed = true;
      }
    }

    if (changed) {
      this.fireChange();
    }
  }

  dispose(): void {
    if (this.nameCheckTimer) clearInterval(this.nameCheckTimer);
    if (this.claudeCheckTimer) clearInterval(this.claudeCheckTimer);
    disposeClaudeDetector();
    disposeHistoryCache();
    this.persistToGlobalState();
    this._onDidChange.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
