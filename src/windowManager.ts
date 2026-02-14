import * as vscode from "vscode";
import { ActivityRecord, WindowState } from "./types";
import { ActivityTracker } from "./activityTracker";
import {
  GLOBAL_STATE_PREFIX,
  REMOTE_POLL_INTERVAL_MS,
  STALE_WINDOW_THRESHOLD_MS,
} from "./config";

export class WindowManager implements vscode.Disposable {
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private remoteTerminals: ActivityRecord[] = [];

  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private context: vscode.ExtensionContext,
    private tracker: ActivityTracker
  ) {
    this.pollTimer = setInterval(() => this.poll(), REMOTE_POLL_INTERVAL_MS);
    // Do an initial poll
    this.poll();
  }

  /** Get all terminals: local (from tracker) + remote (from other windows) */
  getAllTerminals(): ActivityRecord[] {
    return [...this.tracker.getLocalRecords(), ...this.remoteTerminals];
  }

  /** Get only remote terminals (other windows) */
  getRemoteTerminals(): ActivityRecord[] {
    return [...this.remoteTerminals];
  }

  private poll(): void {
    const keys = this.context.globalState.keys().filter(
      (k) => k.startsWith(GLOBAL_STATE_PREFIX)
    );

    const now = Date.now();
    const newRemote: ActivityRecord[] = [];

    for (const key of keys) {
      const state = this.context.globalState.get<WindowState>(key);
      if (!state) continue;

      // Skip our own window
      if (state.windowId === this.tracker.windowId) continue;

      // Clean up stale windows (closed >1 minute ago)
      if (now - state.lastUpdated > STALE_WINDOW_THRESHOLD_MS) {
        this.context.globalState.update(key, undefined);
        continue;
      }

      for (const t of state.terminals) {
        newRemote.push({ ...t, isLocal: false });
      }
    }

    // Check if anything changed
    const changed =
      newRemote.length !== this.remoteTerminals.length ||
      newRemote.some(
        (t, i) =>
          t.id !== this.remoteTerminals[i]?.id ||
          t.lastActivity !== this.remoteTerminals[i]?.lastActivity
      );

    this.remoteTerminals = newRemote;

    if (changed) {
      this._onDidChange.fire();
    }
  }

  dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this._onDidChange.dispose();
  }
}
